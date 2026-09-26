import fs from "node:fs";
import path from "node:path";

import { test, expect, type APIRequestContext, type Browser, type BrowserContext } from "@playwright/test";

import {
  API_BASE,
  FULL_CLOSURE_REASON,
  NIGHT_BLACKOUT_REASON,
  apiLogin,
  branchIdByName,
  inNightOrderBlackout,
  isDhakaFullClosureWindow,
} from "./helpers";
import { backdateChatEnd, chatPhotoKey } from "./helpers/order-chat-db";

/**
 * Order chat and calling — PERMISSIONS (docs/order-chat-plan.md).
 *
 * Who can read and post in which order's chat, a replaced rider losing access,
 * phone numbers withheld outside an active delivery, the read-only switch two
 * hours after the order ends, and chat photos served only to the people in the
 * chat. Asserted at the API, which is the boundary that matters; how the panel
 * looks is deliberately not tested here.
 *
 * Seeded actors: `customer`, `qa_upload_1` (another customer), `branch_manager`
 * (manages Main Branch only), `rider` and `courier2`, `super_admin`,
 * `management`. Every test places its own orders and cancels what it leaves
 * open, so the riders can go off duty afterwards.
 */

test.beforeEach(() => {
  test.skip(isDhakaFullClosureWindow(), FULL_CLOSURE_REASON);
  test.skip(inNightOrderBlackout(), NIGHT_BLACKOUT_REASON);
});

type Session = { context: BrowserContext; req: APIRequestContext };
type Product = { id: number; variation_type?: string };
type ChatBody = {
  chat: { viewer_role: string; can_send: boolean; read_only: boolean };
  participants: { user: number; role: string; name: string }[];
  contacts: { kind: string; phone: string }[];
  messages: { id: number; kind: string; sender: number | null; sender_role: string; body: string; params: Record<string, string> | null; image: string | null }[];
};

const opened: Session[] = [];
async function login(browser: Browser, username: string): Promise<Session> {
  const s = await apiLogin(browser, username);
  opened.push(s);
  return s;
}
test.afterEach(async () => {
  while (opened.length) await opened.pop()!.context.close();
});

async function me(req: APIRequestContext): Promise<{ id: number; phone: string; first_name?: string }> {
  return (await req.get(`${API_BASE}/api/auth/me`)).json();
}

async function orderableProduct(req: APIRequestContext, branchId: number): Promise<Product> {
  const res = await req.get(`${API_BASE}/api/products/?branch_id=${branchId}&page_size=100`);
  const products = (await res.json()).results as (Product & { is_available: boolean })[];
  const product = products.find((p) => p.is_available);
  if (!product) throw new Error(`branch ${branchId} has no orderable product`);
  return product;
}

async function placeOrder(customer: APIRequestContext, branchId: number, kind: "delivery" | "pickup"): Promise<number> {
  const product = await orderableProduct(customer, branchId);
  const crust = product.variation_type === "THIN" ? "THIN" : "THICK";
  const res = await customer.post(`${API_BASE}/api/orders/`, {
    data: {
      branch_id: branchId,
      payment_method: "cash",
      delivery_address: kind === "pickup" ? "Pickup" : "Chat Test Rd, Dhaka",
      fulfillment_type: kind,
      ...(kind === "delivery" ? { lat: 23.781, lng: 90.408 } : {}),
      items: [{ product_id: product.id, quantity: 1, variation_type: crust }],
    },
  });
  expect(res.status(), `${kind} order placed: ${await res.text()}`).toBe(201);
  return (await res.json()).id;
}

async function setStatus(req: APIRequestContext, id: number, status: string, reason?: string) {
  return req.post(`${API_BASE}/api/orders/${id}/update-status/`, { data: { status, ...(reason ? { reason } : {}) } });
}

async function toReady(bm: APIRequestContext, id: number) {
  for (const s of ["accepted", "preparing", "ready"]) expect((await setStatus(bm, id, s)).status(), s).toBe(200);
}

/** Put the rider on duty at `branchId` (their own earlier session is ended first). */
async function onDutyAt(rider: APIRequestContext, branchId: number) {
  const duty = await (await rider.get(`${API_BASE}/api/rider/duty`)).json();
  if (duty.active_session?.branch === branchId) return;
  if (duty.active_session) {
    expect((await rider.post(`${API_BASE}/api/rider/duty/end`, { data: {} })).status(), "rider free to go off duty").toBe(200);
  }
  expect((await rider.post(`${API_BASE}/api/rider/duty/start`, { data: { branch_id: branchId } })).status()).toBe(201);
}

async function offDuty(rider: APIRequestContext) {
  const duty = await (await rider.get(`${API_BASE}/api/rider/duty`)).json();
  if (duty.active_session) await rider.post(`${API_BASE}/api/rider/duty/end`, { data: {} });
}

const assign = (req: APIRequestContext, orderId: number, riderId: number | null) =>
  req.post(`${API_BASE}/api/orders/${orderId}/assign-rider`, { data: { rider_id: riderId } });
const readChat = (req: APIRequestContext, orderId: number) => req.get(`${API_BASE}/api/orders/${orderId}/chat`);
const say = (req: APIRequestContext, orderId: number, body: string) =>
  req.post(`${API_BASE}/api/orders/${orderId}/chat/messages`, { data: { body } });
async function chatOf(req: APIRequestContext, orderId: number): Promise<ChatBody> {
  const res = await readChat(req, orderId);
  expect(res.status(), "chat readable").toBe(200);
  return res.json();
}

test.describe("Order chat — who can read and post", () => {
  test("a new order's chat is the customer and the branch manager, and both can talk", async ({ browser }) => {
    const customer = await login(browser, "customer");
    const bm = await login(browser, "branch_manager");
    const main = await branchIdByName(customer.req, "Main Branch");
    const orderId = await placeOrder(customer.req, main, "delivery");

    const first = await chatOf(customer.req, orderId);
    expect(first.chat.viewer_role).toBe("customer");
    expect(first.chat.can_send).toBe(true);
    expect(first.participants.map((p) => p.role).sort()).toEqual(["branch_manager", "customer"]);
    expect(first.contacts.map((c) => c.kind), "customer can call the branch, no one else yet").toEqual(["branch"]);

    expect((await say(customer.req, orderId, "Is the pizza spicy?")).status()).toBe(201);
    expect((await say(bm.req, orderId, "Mildly, yes.")).status()).toBe(201);

    const seen = await chatOf(bm.req, orderId);
    expect(seen.chat.viewer_role).toBe("branch_manager");
    const bodies = seen.messages.map((m) => [m.sender_role, m.body]);
    expect(bodies).toContainEqual(["customer", "Is the pizza spicy?"]);
    expect(bodies).toContainEqual(["branch_manager", "Mildly, yes."]);

    await setStatus(bm.req, orderId, "cancelled", "e2e cleanup");
  });

  test("outsiders get 403 to read and to post; the super admin reads but cannot post", async ({ browser }) => {
    const customer = await login(browser, "customer");
    const bm = await login(browser, "branch_manager");
    const main = await branchIdByName(customer.req, "Main Branch");
    const orderId = await placeOrder(customer.req, main, "delivery");

    for (const outsider of ["qa_upload_1", "management", "rider", "courier2"]) {
      const s = await login(browser, outsider);
      expect((await readChat(s.req, orderId)).status(), `${outsider} reads`).toBe(403);
      expect((await say(s.req, orderId, "let me in")).status(), `${outsider} posts`).toBe(403);
    }

    // The manager of ANOTHER branch: this manager on an order at Cheez Gulshan.
    const cheez = await branchIdByName(customer.req, "Cheez Gulshan");
    const cheezOrder = await placeOrder(customer.req, cheez, "pickup");
    expect((await readChat(bm.req, cheezOrder)).status(), "another branch's order").toBe(403);
    expect((await say(bm.req, cheezOrder, "hi")).status()).toBe(403);

    const admin = await login(browser, "super_admin");
    const view = await chatOf(admin.req, orderId);
    expect(view.chat.viewer_role).toBe("observer");
    expect(view.chat.can_send).toBe(false);
    expect(view.contacts, "the observer is given no numbers").toEqual([]);
    expect((await say(admin.req, orderId, "admin here")).status()).toBe(403);

    await setStatus(bm.req, orderId, "cancelled", "e2e cleanup");
    await setStatus(admin.req, cheezOrder, "cancelled", "e2e cleanup");
  });

  test("the assigned rider joins; a replaced rider loses access and the history stays", async ({ browser }) => {
    const customer = await login(browser, "customer");
    const bm = await login(browser, "branch_manager");
    const riderA = await login(browser, "rider");
    const riderB = await login(browser, "courier2");
    const main = await branchIdByName(customer.req, "Main Branch");
    const [a, b] = [await me(riderA.req), await me(riderB.req)];
    await onDutyAt(riderA.req, main);
    await onDutyAt(riderB.req, main);
    const orderId = await placeOrder(customer.req, main, "delivery");
    await toReady(bm.req, orderId);

    try {
      expect((await assign(bm.req, orderId, a.id)).status()).toBe(200);
      const joined = await chatOf(customer.req, orderId);
      const join = joined.messages.find((m) => m.kind === "system" && m.body === "rider_joined");
      expect(join?.sender, "join line names the rider").toBe(a.id);
      expect(joined.participants.map((p) => p.role).sort()).toEqual(["branch_manager", "customer", "rider"]);

      // The rider reads and posts, including a quick reply; customers cannot send quick replies.
      expect((await chatOf(riderA.req, orderId)).chat.viewer_role).toBe("rider");
      expect((await say(riderA.req, orderId, "Leaving the branch now")).status()).toBe(201);
      const quick = await riderA.req.post(`${API_BASE}/api/orders/${orderId}/chat/messages`, { data: { quick: "arrived" } });
      expect(quick.status()).toBe(201);
      expect((await quick.json()).kind).toBe("quick");
      const customerQuick = await customer.req.post(`${API_BASE}/api/orders/${orderId}/chat/messages`, { data: { quick: "arrived" } });
      expect(customerQuick.status()).toBe(400);

      // Reassigned: the old rider is out, immediately and completely.
      expect((await assign(bm.req, orderId, b.id)).status()).toBe(200);
      expect((await readChat(riderA.req, orderId)).status(), "old rider reads").toBe(403);
      expect((await say(riderA.req, orderId, "still here?")).status(), "old rider posts").toBe(403);

      // Everyone else keeps the full history, with the change recorded.
      const after = await chatOf(customer.req, orderId);
      expect(after.messages.some((m) => m.sender === a.id && m.body === "Leaving the branch now" && m.sender_role === "rider")).toBe(true);
      expect(after.messages.some((m) => m.kind === "system" && m.body === "rider_left" && m.sender === a.id)).toBe(true);
      expect(after.messages.some((m) => m.kind === "system" && m.body === "rider_joined" && m.sender === b.id)).toBe(true);
      expect(after.participants.find((p) => p.role === "rider")?.user).toBe(b.id);

      // The new rider sees what was said before they joined, and can post.
      const newRider = await chatOf(riderB.req, orderId);
      expect(newRider.messages.some((m) => m.body === "Leaving the branch now")).toBe(true);
      expect((await say(riderB.req, orderId, "Taking over")).status()).toBe(201);
    } finally {
      await setStatus(bm.req, orderId, "cancelled", "e2e cleanup");
      await offDuty(riderA.req);
      await offDuty(riderB.req);
    }
  });

  test("a rider who rejects the offer leaves the chat", async ({ browser }) => {
    const customer = await login(browser, "customer");
    const bm = await login(browser, "branch_manager");
    const rider = await login(browser, "courier2");
    const main = await branchIdByName(customer.req, "Main Branch");
    const r = await me(rider.req);
    await onDutyAt(rider.req, main);
    const orderId = await placeOrder(customer.req, main, "delivery");
    await toReady(bm.req, orderId);

    try {
      expect((await assign(bm.req, orderId, r.id)).status()).toBe(200);
      expect((await readChat(rider.req, orderId)).status()).toBe(200);
      const reject = await rider.req.post(`${API_BASE}/api/rider/assignments/${orderId}/respond`, {
        data: { action: "reject", reason: "flat tyre" },
      });
      expect(reject.status()).toBe(200);
      expect((await readChat(rider.req, orderId)).status()).toBe(403);
      const view = await chatOf(customer.req, orderId);
      expect(view.messages.some((m) => m.kind === "system" && m.body === "rider_left" && m.sender === r.id)).toBe(true);
      expect(view.participants.map((p) => p.role).sort()).toEqual(["branch_manager", "customer"]);
    } finally {
      await setStatus(bm.req, orderId, "cancelled", "e2e cleanup");
      await offDuty(rider.req);
    }
  });

  test("a pickup order never gets a rider, so its chat stays customer + manager", async ({ browser }) => {
    const customer = await login(browser, "customer");
    const bm = await login(browser, "branch_manager");
    const rider = await login(browser, "courier2");
    const main = await branchIdByName(customer.req, "Main Branch");
    const r = await me(rider.req);
    await onDutyAt(rider.req, main);
    const orderId = await placeOrder(customer.req, main, "pickup");

    try {
      expect((await setStatus(bm.req, orderId, "accepted")).status()).toBe(200);
      expect((await assign(bm.req, orderId, r.id)).status(), "rider refused on a pickup order").toBe(400);
      expect((await readChat(rider.req, orderId)).status()).toBe(403);
      const view = await chatOf(customer.req, orderId);
      expect(view.participants.map((p) => p.role).sort()).toEqual(["branch_manager", "customer"]);
    } finally {
      await setStatus(bm.req, orderId, "cancelled", "e2e cleanup");
      await offDuty(rider.req);
    }
  });
});

test.describe("Order chat — phone numbers", () => {
  test("customer and rider see each other's numbers only while the accepted delivery is active", async ({ browser }) => {
    const customer = await login(browser, "customer");
    const bm = await login(browser, "branch_manager");
    const rider = await login(browser, "courier2");
    const main = await branchIdByName(customer.req, "Main Branch");
    const [c, r] = [await me(customer.req), await me(rider.req)];
    expect(c.phone && r.phone, "seeded users have phone numbers").toBeTruthy();
    await onDutyAt(rider.req, main);
    const orderId = await placeOrder(customer.req, main, "delivery");
    await toReady(bm.req, orderId);

    const orderFor = async (req: APIRequestContext) => (await req.get(`${API_BASE}/api/orders/${orderId}`)).json();
    const contactKinds = async (req: APIRequestContext) => (await chatOf(req, orderId)).contacts.map((x) => x.kind).sort();

    try {
      // The unassigned pool never carries the customer's number.
      const pool = await (await rider.req.get(`${API_BASE}/api/rider/eligible-orders`)).json();
      const pooled = (pool.results as { id: number; customer_phone: string }[]).find((o) => o.id === orderId);
      expect(pooled, "order is in the rider's pool").toBeTruthy();
      expect(pooled!.customer_phone).toBe("");

      // Offered but not yet accepted: not an active delivery.
      expect((await assign(bm.req, orderId, r.id)).status()).toBe(200);
      const pendingForCustomer = await orderFor(customer.req);
      expect(pendingForCustomer.rider_phone).toBeNull();
      expect(pendingForCustomer.assignment?.rider_phone ?? null).toBeNull();
      expect((await orderFor(rider.req)).customer_phone).toBe("");
      expect(await contactKinds(customer.req)).toEqual(["branch"]);
      expect(await contactKinds(rider.req)).toEqual(["branch"]);

      // Accepted: both directions, in the order API and the chat's call buttons.
      expect((await rider.req.post(`${API_BASE}/api/rider/assignments/${orderId}/respond`, { data: { action: "accept" } })).status()).toBe(200);
      expect((await orderFor(customer.req)).rider_phone).toBe(r.phone);
      const riderView = await orderFor(rider.req);
      expect(riderView.customer_phone).toBe(c.phone);
      expect(riderView.bkash_payer_phone, "a rider never gets the payer number").toBe("");
      expect((await chatOf(customer.req, orderId)).contacts).toContainEqual(expect.objectContaining({ kind: "rider", phone: r.phone }));
      expect((await chatOf(rider.req, orderId)).contacts).toContainEqual(expect.objectContaining({ kind: "customer", phone: c.phone }));

      // Delivered: hidden again, both ways.
      expect((await rider.req.post(`${API_BASE}/api/rider/orders/${orderId}/confirm-receive`)).status()).toBe(200);
      for (const s of ["picked_up", "on_the_way", "delivered"]) expect((await setStatus(rider.req, orderId, s)).status(), s).toBe(200);
      expect((await orderFor(customer.req)).rider_phone).toBeNull();
      expect((await orderFor(rider.req)).customer_phone).toBe("");
      expect(await contactKinds(customer.req)).toEqual(["branch"]);
      expect(await contactKinds(rider.req)).toEqual(["branch"]);

      // The branch manager's view is unchanged by any of this.
      const bmView = await orderFor(bm.req);
      expect(bmView.customer_phone).toBe(c.phone);
      expect(bmView.rider_phone).toBe(r.phone);
    } finally {
      await setStatus(bm.req, orderId, "cancelled", "e2e cleanup"); // no-op if delivered
      await offDuty(rider.req);
    }
  });
});

test.describe("Order chat — read-only after the order ends", () => {
  test("a cancelled order's chat stays open for 2 hours, then goes read-only", async ({ browser }) => {
    const customer = await login(browser, "customer");
    const bm = await login(browser, "branch_manager");
    const main = await branchIdByName(customer.req, "Main Branch");
    const orderId = await placeOrder(customer.req, main, "delivery");
    expect((await setStatus(bm.req, orderId, "cancelled", "out of dough")).status()).toBe(200);

    expect((await say(customer.req, orderId, "Why was it cancelled?")).status(), "just ended: still open").toBe(201);
    await backdateChatEnd(orderId, 1);
    expect((await say(bm.req, orderId, "We ran out of dough, sorry.")).status(), "1 h later: still open").toBe(201);

    await backdateChatEnd(orderId, 3);
    expect((await say(customer.req, orderId, "ok")).status(), "3 h later: customer").toBe(409);
    expect((await say(bm.req, orderId, "ok")).status(), "3 h later: manager").toBe(409);
    const view = await chatOf(customer.req, orderId);
    expect(view.chat.read_only).toBe(true);
    expect(view.chat.can_send).toBe(false);
    expect(view.messages.map((m) => m.body)).toEqual(expect.arrayContaining(["Why was it cancelled?", "We ran out of dough, sorry."]));
  });

  test("a delivered order's chat goes read-only 2 hours after delivery", async ({ browser }) => {
    const customer = await login(browser, "customer");
    const bm = await login(browser, "branch_manager");
    const main = await branchIdByName(customer.req, "Main Branch");
    const orderId = await placeOrder(customer.req, main, "pickup");
    await toReady(bm.req, orderId);
    expect((await setStatus(bm.req, orderId, "delivered")).status()).toBe(200);

    expect((await say(customer.req, orderId, "Thanks!")).status()).toBe(201);
    await backdateChatEnd(orderId, 2.01);
    expect((await say(customer.req, orderId, "One more thing")).status()).toBe(409);
    expect((await chatOf(bm.req, orderId)).chat.read_only).toBe(true);
  });
});

test.describe("Order chat — photos and notifications", () => {
  test("a chat photo is served only to people in the chat, never through /api/uploads", async ({ browser }) => {
    const customer = await login(browser, "customer");
    const bm = await login(browser, "branch_manager");
    const other = await login(browser, "qa_upload_1");
    const main = await branchIdByName(customer.req, "Main Branch");
    const orderId = await placeOrder(customer.req, main, "delivery");

    const png = fs.readFileSync(path.join(__dirname, "fixtures", "avatar.png"));
    const upload = await customer.req.post(`${API_BASE}/api/orders/${orderId}/chat/messages`, {
      multipart: { image: { name: "gate.png", mimeType: "image/png", buffer: png }, body: "This is our gate" },
    });
    expect(upload.status(), await upload.text()).toBe(201);
    const message = (await upload.json()) as { id: number; kind: string; image: string };
    expect(message.kind).toBe("image");

    const asCustomer = await customer.req.get(`${API_BASE}${message.image}`);
    expect(asCustomer.status()).toBe(200);
    expect(asCustomer.headers()["content-type"]).toBe("image/webp");
    expect((await bm.req.get(`${API_BASE}${message.image}?w=320`)).status()).toBe(200);
    expect((await other.req.get(`${API_BASE}${message.image}`)).status(), "another customer").toBe(403);

    const key = await chatPhotoKey(message.id);
    expect((await customer.req.get(`${API_BASE}/api/uploads/${key}`)).status(), "generic uploads route").toBe(404);

    // Over the chat photo limit (10 MB) is refused before it is processed.
    const huge = Buffer.concat([png, Buffer.alloc(11 * 1024 * 1024)]);
    const tooBig = await customer.req.post(`${API_BASE}/api/orders/${orderId}/chat/messages`, {
      multipart: { image: { name: "huge.png", mimeType: "image/png", buffer: huge } },
    });
    expect(tooBig.status()).toBe(400);

    await setStatus(bm.req, orderId, "cancelled", "e2e cleanup");
  });

  test("absent participants get one chat notification; someone viewing the chat gets none", async ({ browser }) => {
    const customer = await login(browser, "customer");
    const bm = await login(browser, "branch_manager");
    const main = await branchIdByName(customer.req, "Main Branch");
    const orderId = await placeOrder(customer.req, main, "delivery");
    const link = `/branch-manager/orders/${orderId}#order-chat`;
    const unread = async () =>
      (await (await bm.req.get(`${API_BASE}/api/notifications/?page_size=100`)).json()).results as {
        type: string;
        link: string | null;
        is_read: boolean;
      }[];
    const chatRows = async () => (await unread()).filter((n) => n.type === "chat" && n.link === link);

    // The manager has not opened this chat: one inbox row, however many messages.
    expect((await say(customer.req, orderId, "first")).status()).toBe(201);
    expect((await say(customer.req, orderId, "second")).status()).toBe(201);
    const rows = await chatRows();
    expect(rows.length).toBe(1);
    expect(rows[0].is_read).toBe(false);

    // Opening the chat reads it; while they are looking, no new row is written.
    await chatOf(bm.req, orderId);
    expect((await chatRows()).every((n) => n.is_read)).toBe(true);
    expect((await say(customer.req, orderId, "third")).status()).toBe(201);
    expect((await chatRows()).filter((n) => !n.is_read).length).toBe(0);

    await setStatus(bm.req, orderId, "cancelled", "e2e cleanup");
  });
});
