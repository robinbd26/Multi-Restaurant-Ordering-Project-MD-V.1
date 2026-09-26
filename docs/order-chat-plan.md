# Order chat and calling: plan

Status: plan for the `order-chat` branch (Sep 2026). Each phase lands as its own
commits, split by concern. What changed from this plan during the build is
recorded at the bottom.

## Goal

Every order gets one chat. It starts with the customer and the branch manager
of the order's branch. On a delivery order, the assigned rider joins; if the
rider changes, the old rider leaves and loses access. Messages are text, photos,
or (riders) one-tap quick replies. The chat goes read-only 2 hours after the
order is delivered or cancelled. The super admin can read any chat but not post.

Calls are plain `tel:` links. The customer calls the branch's public number.
The customer and the rider see each other's real numbers only while the delivery
is active, and the API enforces that.

Out of scope: staff logins, in-app calling, websockets, a chat inbox page.

## What exists today (and what happens to it)

| Existing piece | Decision |
|---|---|
| `OrderDeliveryChatThread/Message`: rider↔customer chat, opened only after the rider confirms pickup | **Superseded.** The new order chat covers it. The migration copies every old message into the new chat so no history is lost. The old tables stay in the schema (untouched, no longer written) so the change can be rolled back; they can be dropped in a later cleanup. The old routes (`/api/delivery-chat/*`, `/api/orders/[id]/delivery-chat`), `DeliveryChatPanel` and the chat part of `RiderOrderPanel` are removed. |
| `RiderDutyChatThread`: rider↔BM chat per duty shift | **Unchanged.** It is about the shift, not an order. `ChatBox` stays for it. |
| Web push: `lib/services/push.ts`, `/api/push/*`, `public/sw.js`, `PushRegistrar` | **Already wired in code**, gated on `VAPID_*` env vars that were never set. Kept. Chat messages go through the same pipeline. `.env.example` gets step-by-step generation instructions. |
| Two ad-hoc WebAudio beeps (BM new-order alert, rider assignment modal); the notification bell is silent | **Replaced** by one shared sound module used by the bell, both of those surfaces, and chat. |
| `serializeOrder` returns `customer_phone` / `rider_phone` / `bkash_payer_phone` to anyone who can see the order (riders browsing the unassigned pool see customers' numbers) | **Fixed.** Serialization becomes viewer-aware (see Permissions). |
| `POST /api/orders/[id]/assign-rider` accepts a pickup order (only the UI hides the card) | **Fixed.** The server refuses a rider on a pickup order, so a pickup chat can never gain a rider. |

## Data model

Three new tables. No required column is added to an existing table.

```prisma
model OrderChat {
  id        Int       @id @default(autoincrement())
  orderId   Int       @unique              // one chat per order
  order     Order     @relation(fields: [orderId], references: [id], onDelete: Cascade)
  endedAt   DateTime?                      // when the order became delivered/cancelled
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  messages  OrderChatMessage[]
  reads     OrderChatRead[]
}

model OrderChatMessage {
  id         Int       @id @default(autoincrement())
  chatId     Int
  chat       OrderChat @relation(fields: [chatId], references: [id], onDelete: Cascade)
  senderId   Int?                          // the author; for system rows, the rider it is about
  sender     User?     @relation("OrderChatSender", fields: [senderId], references: [id], onDelete: SetNull)
  senderRole String                        // customer | branch_manager | rider | system (snapshot)
  kind       String    @default("text")    // text | image | quick | system
  body       String    @default("")        // text, caption, quick-reply key, or system event key
  imageKey   String?                       // storage key under chat_photos/
  params     Json?                         // system params, e.g. { name: "Rahim" }
  createdAt  DateTime  @default(now())
  @@index([chatId, id])
}

model OrderChatRead {
  id                Int       @id @default(autoincrement())
  chatId            Int
  chat              OrderChat @relation(fields: [chatId], references: [id], onDelete: Cascade)
  userId            Int
  user              User      @relation("OrderChatReader", fields: [userId], references: [id], onDelete: Cascade)
  lastReadMessageId Int       @default(0)
  lastSeenAt        DateTime  @default(now())   // last poll; "is this person looking at the chat now?"
  @@unique([chatId, userId])
}
```

Why this shape:

- **Participants are derived from the order, not stored.** Customer =
  `order.customerId`; branch side = `order.branch.managerId`; rider =
  `order.riderId`. Every other permission in the app already reads these
  fields, so the chat can never disagree with the order about who the rider is.
  When the rider changes, `order.riderId` changes and the old rider's access
  goes with it, with no second list to keep in sync. Join/leave history is
  recorded as system messages.
- **`senderRole` is snapshotted** so an old message keeps its badge if the
  person's role later changes. Name and photo are read live from `User`, so a
  new profile photo shows everywhere.
- **Quick replies are stored as keys** (`kind: "quick"`, `body: "arrived"`) and
  rendered in each reader's language. A rider tapping "I've arrived" in Bangla
  reaches an English-reading customer in English.
- **`endedAt` is stored** when the order reaches a terminal status (in the same
  transaction). For orders that ended before this feature existed, it is
  derived once, on first read, from the terminal `OrderStatusEvent` (falling
  back to `order.updatedAt`) and saved.

### Migration

`prisma/migrations/<ts>_order_chat/migration.sql`:

1. Create the three tables and indexes (additive only; nothing existing is altered).
2. Copy the old delivery chat: one `OrderChat` per order that has an
   `OrderDeliveryChatThread`, then every `OrderDeliveryChatMessage` into
   `OrderChatMessage` (role `rider` when the sender was that thread's rider,
   otherwise `customer`, in their original time order).
   Every FK target already exists because the old rows cascade from `Order` and
   `User`, so the copy cannot violate a constraint on anyone's data.
3. Chats for all other existing orders are **not** bulk-created. They are
   created on first access (`upsert` on the unique `orderId`), which is safe
   against concurrent first reads.

Tested on a scratch copy of `dev.db` before running against the real one.

## Permissions

All checks live in one server module (`lib/services/order-chat.ts`), backed by
pure functions in `lib/order-chat/policy.ts` (unit-tested).

| Viewer | Read | Send | Notes |
|---|---|---|---|
| The order's customer | yes | until read-only | |
| The branch manager of the order's branch (`branch.managerId`) | yes | until read-only | A new manager inherits the branch's chats. |
| The order's current rider (`order.riderId`, delivery orders only) | yes | until read-only | Joins when assigned; sees the full history. |
| A previous rider of the order | **no** (403) | no | Their messages stay visible to everyone else. |
| Super admin | yes | **no** (403) | Oversight for disputes; not a participant, never notified. |
| Anyone else (other customers, other branches' managers, other riders, management, accounts, marketing) | no (403) | no | |

Read-only: `now >= endedAt + 2h`. Sending then returns 409; reading still works.

**Phone numbers** (`lib/order-chat/policy.ts#deliveryContactActive`): the
customer↔rider numbers are shared only while **all** of these hold:

- the order is a delivery order with a rider assigned;
- the status is in flight: accepted, preparing, ready, picked_up, on_the_way or delayed;
- that rider **accepted** the assignment offer (a pending offer is not an active delivery).

Enforced in the API, not just the UI:

- `serializeOrder(order, viewer)` takes the viewer (a required argument, so no
  call site can forget it). For a customer, `rider_phone` and
  `assignment.rider_phone` are null outside that window. For a rider,
  `customer_phone` is empty unless it is their own active delivery, and
  `bkash_payer_phone` is always empty (a rider never needs it). Managers and
  admins are unchanged.
- The chat API returns a per-viewer `contacts` list with `tel:` numbers computed
  by the same rule. Customer: branch public number (`branch.phone`, falling back
  to `pickupPhone`), plus the rider while active. Rider: the branch, plus the
  customer while active. Branch manager: customer and rider (they already see
  both on the order page). Super admin: none.

## API

All under the order, so clients never need a chat id. Chats are created lazily
on first access.

| Route | Purpose |
|---|---|
| `GET /api/orders/[id]/chat?after=<messageId>` | Chat state (`viewer_role`, `can_send`, `read_only`, `read_only_at`), participants (name, role badge, photo), `contacts`, and messages newer than `after`. Polled every ~4 s while the chat is on screen. Also records `lastSeenAt` / `lastReadMessageId`. |
| `POST /api/orders/[id]/chat/messages` | JSON `{ body }` for text, `{ quick: "<key>" }` for a rider quick reply, or multipart `image` (+ optional `body` caption). |
| `GET /api/orders/[id]/chat/messages/[messageId]/image?w=320` | Serves a chat photo after the same read check. |

Photos reuse `saveUpload()` (sharp → WebP, EXIF rotation, metadata stripped)
into a new private folder `chat_photos/`: max 1280 px stored plus a 320 px
thumbnail, and a **10 MB** input cap for chat (phone photos are 2-8 MB; the
global 50 MB cap is for catalogue originals). The generic `/api/uploads` route
refuses `chat_photos/*` outright, so a chat photo is only ever served after a
chat permission check, never to "any logged-in user who has the URL".

Text is capped at `LIMITS.longTextMax` (2000). Messages are rendered as text,
never HTML.

Lifecycle hooks (in the existing services, inside their transactions):

- `createOrder`: create the order's chat.
- `assignRiderToOrder`: on a rider change, write "X (Rider) left the chat" for the
  old rider and "Y (Rider) joined the chat" for the new one. Refuses pickup orders.
- `respondToAssignment` (reject): "X (Rider) left the chat".
- `updateOrderStatus`: on delivered/cancelled, set `endedAt`.

## Screens

- **Customer order page** (`/customer/orders/[id]`): chat card replaces the old
  delivery chat card. The header has call buttons (Branch, and Rider while active).
- **Rider order page** (`/rider/orders/[id]`): chat card with quick-reply chips
  above the composer ("I've arrived", "Can't find the address", "On my way",
  "Running a few minutes late", "Please come to the gate"). The confirm-receive
  button stays, separate from the chat. The customer's number on this page
  shows only while active (from the redacted API).
- **Branch manager order page** (`/branch-manager/orders/[id]`): same chat card.
- **Super admin order page** (`/admin/orders/[id]`): the chat, read-only, with an
  "Oversight — read only" note and no composer.

One component, `OrderChatPanel`, serves all four. Each message shows the
avatar (`UserAvatar`), name, a role badge ("Customer", "Branch Manager · Main
Branch", "Rider"), and the time. Own messages sit on the right. System messages
are centred grey lines. Photos show as a thumbnail that opens the full image.
When read-only, the composer is replaced by "This chat closed 2 hours after the
order ended."

## Real-time and notifications

- **Open chat:** poll `GET …/chat?after=<last id>` every 4 s while the tab is
  visible; stop while hidden (push covers that); refresh at once on focus and
  when the service worker relays a push. Only new rows are transferred.
- **Presence:** each poll stamps `OrderChatRead.lastSeenAt`. A participant seen
  within the last 15 s is looking at the chat, so they get no notification or
  push for new messages (their panel beeps instead).
- **Everyone else** gets an in-app notification (new type `chat`, links to their
  own order page `#order-chat`) mirrored to push by the existing pipeline. To
  avoid flooding the inbox, only one unread chat notification per order per
  person is kept; later messages still push (same push `tag`, so they replace
  each other on the lock screen) but add no inbox row. Customers' "mute order
  updates" toggle does not silence chat, since a rider's "I've arrived" is not a
  routine update.
- System join/leave messages notify nobody (assignment already notifies).
- **VAPID:** `.env.example` documents `npx web-push generate-vapid-keys`, which
  key goes where, that the private key is server-only, that keys must stay
  stable, and that a server restart is needed.

## Sound

`lib/sound/` (client only): one lazily created `AudioContext`, unlocked by the
first tap or keypress anywhere (browser autoplay rules), with synthesized tones
(no audio files to download on 3G): `message`, `notification`, `order`, and
`alert`.

- `announce(key, sound)` plays once per key per tab, so the same event heard by
  two surfaces (e.g. the bell and the rider assignment modal, or the bell and
  the BM order list) only sounds once. Keys are the notification link, which
  both surfaces know.
- A global mute toggle (speaker icon next to the bell), stored per browser in
  localStorage.
- Used by: the notification bell (when a new unread notification arrives,
  which covers new orders, status changes, assignments, payments and chat), the
  BM new-order alert, the rider assignment modal, and the open chat panel.
- `GET /api/notifications/unread-count` additionally returns the newest unread
  notification's `{ id, type, link }` so the bell knows what arrived.

## Test plan

Permission-focused, per the brief. Cosmetic details are not tested.

**Unit** (`tests/order-chat-policy.test.mts`, `npm run test:unit`):
read-only boundary at exactly 2 h; `deliveryContactActive` across statuses,
pickup, unassigned, pending vs accepted offer, and a different rider's offer;
role resolution for every role.

**E2E** (`tests/e2e/72-order-chat.spec.ts`, API-level, against `test.db`):

1. A new delivery order has a chat with customer + manager only; both can read
   and send.
2. 403 to read and send for: another customer, another branch's order for this
   manager, an unassigned rider, management. Super admin reads 200, sends 403.
3. Rider assigned → "joined" system message; the rider reads and sends.
   Reassigned to a second rider → old rider 403 on read and send, "left"
   message present, the customer still sees the old rider's messages, and the
   new rider reads the full history.
4. Rider rejects the offer → loses access.
5. Pickup order: assigning a rider → 400; chat stays customer + manager.
6. Phones: pending offer → hidden both ways (order API and chat contacts).
   Accepted → visible both ways. Delivered → hidden again. The unassigned pool
   (`/api/rider/eligible-orders`) never shows the customer's number.
7. Read-only: delivered order still accepts messages; with `endedAt` backdated
   3 h (direct Prisma on `test.db`), send → 409, read → 200 with
   `read_only: true`. Same for a cancelled order.
8. Photo: participant uploads → 201 and can fetch; another customer → 403;
   `/api/uploads/chat_photos/...` → 404.

Spec 22's delivery-chat assertions move to the order chat (C5 confirm-receive
gating is kept).

## Phases

1. Plan (this document).
2. Schema + migration (tested on a scratch copy of `dev.db`).
3. Policy module + unit tests.
4. Chat service, lifecycle hooks, pickup-rider guard, API routes, photo
   storage; retire the old delivery chat code.
5. Phone privacy: viewer-aware `serializeOrder` and chat `contacts`.
6. UI: `OrderChatPanel` on the four order pages.
7. Notifications + push wiring for chat; `.env.example` VAPID docs.
8. Shared sound system; bell, BM alert, rider modal and chat use it.
9. E2E permission spec; spec 22 updated.

## Changes from this plan during the build

- **Order of phases.** The sound system was built before the chat UI (the
  panel uses it), and the old delivery chat was retired after the new UI was
  in place, so no commit leaves a page pointing at a removed route.
- **Chat photo size limit** lives in `lib/order-chat/policy.ts`
  (`CHAT_PHOTO_MAX_MB = 10`) so the browser and the server check the same number.
- **Rider pickup confirmation.** The rider page used to infer "pickup
  confirmed" from whether a delivery chat existed. It now asks a new
  `GET /api/rider/orders/[id]/confirm-receive`, and the card is titled
  "Pickup confirmation".
- **Old notification strings kept.** `notifications.rider.deliveryChat.*` stays
  in `messages/`: existing inbox rows are rendered from those keys. Only the two
  UI-only strings of the old panel were removed.
- **The BM order alert's own button** ("Enable sound alert" / "Alert on" /
  "Alert muted") became the shared sound switch with a label; its three strings
  were removed.
- **Sound de-duplication** is keyed by event (e.g. the notification id), plus
  the record's link to silence the *other* source (bell vs. a live page) for
  90 s. Keying the bell by link alone would have silenced a second, different
  update about the same order.
- **Back-office dashboards** (super admin, marketing) have no user parameter, so
  `serializeOrder` gets `backOfficeViewer(role)` there.
- **Layout pass.** Screenshots at 390 px showed the call buttons squeezing the
  title and the chips stacking; the header now wraps, and participants and quick
  replies are single swipeable rows on phones.
- **Sound switch placement.** Next to the bell from `sm` up; on phones it is a
  row in the profile menu, because one more topbar button overflowed 360 px
  screens. The bell arms the audio unlock so it works with the menu closed.
