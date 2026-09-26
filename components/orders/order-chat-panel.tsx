"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { UserAvatar } from "@/components/common/user-avatar";
import { Icon } from "@/components/layout/icons";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/lib/i18n/use-translation";
import { CHAT_PHOTO_MAX_MB } from "@/lib/order-chat/policy";
import { announce } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { parseFieldErrors } from "@/lib/validation/contract";
import { LIMITS, imageFileProblem } from "@/lib/validation/limits";

/**
 * The order chat (docs/order-chat-plan.md), one component for every order page:
 * customer, rider, branch manager, and the super admin's read-only view.
 *
 * Everything that matters is decided by the server (GET /api/orders/[id]/chat):
 * whether the viewer may post, whether the chat is read-only yet, which numbers
 * they may call. This only renders what it is given.
 *
 * Real time is a poll: every few seconds while the tab is visible, fetching only
 * messages newer than the last one seen. A backgrounded tab stops polling and is
 * reached by push instead; coming back (or a push relayed by the service
 * worker) refreshes at once. A message from someone else plays the shared
 * "message" tone (lib/sound).
 */

const POLL_MS = 4_000;
const CHAT_PHOTO_MAX_BYTES = CHAT_PHOTO_MAX_MB * 1024 * 1024;

type Role = "customer" | "branch_manager" | "rider";

interface ChatMessage {
  id: number;
  kind: "text" | "image" | "quick" | "system";
  sender: number | null;
  sender_name: string;
  sender_role: Role | "system";
  sender_photo: string | null;
  sender_photo_version: string | null;
  body: string;
  params: Record<string, string> | null;
  image: string | null;
  image_thumb: string | null;
  created_at: string;
}

interface ChatState {
  chat: {
    id: number;
    order: number;
    branch_name: string;
    fulfillment_type: string;
    viewer_role: Role | "observer";
    can_send: boolean;
    read_only: boolean;
    read_only_at: string | null;
  };
  participants: { user: number; role: Role; name: string; photo: string | null; photo_version: string }[];
  contacts: { kind: "branch" | "customer" | "rider"; name: string; phone: string }[];
  quick_replies: string[];
}

interface ChatResponse extends ChatState {
  messages: ChatMessage[];
}

const BADGE_CLASS: Record<Role, string> = {
  customer: "bg-surface-muted text-fg-muted ring-border-base",
  branch_manager: "bg-brand-100 text-brand-700 ring-brand-500/20",
  rider: "bg-rider-50 text-rider-700 ring-rider-600/20",
};

export function OrderChatPanel({ orderId, viewerId }: { orderId: number; viewerId: number }) {
  const { t, fmt } = useTranslation();
  const [state, setState] = useState<ChatState | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [lostAccess, setLostAccess] = useState(false);
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const lastId = useRef(0);
  const firstLoadDone = useRef(false);
  const inFlight = useRef(false);
  const stopped = useRef(false);
  const listRef = useRef<HTMLUListElement>(null);
  const stickToBottom = useRef(true);
  const fileRef = useRef<HTMLInputElement>(null);

  /** Append rows not seen yet (a poll and a send can both return the same one). */
  const merge = useCallback((rows: ChatMessage[]) => {
    const fresh = rows.filter((m) => m.id > lastId.current);
    if (fresh.length === 0) return [];
    lastId.current = Math.max(lastId.current, ...fresh.map((m) => m.id));
    setMessages((prev) => {
      const known = new Set(prev.map((m) => m.id));
      return [...prev, ...fresh.filter((m) => !known.has(m.id))];
    });
    return fresh;
  }, []);

  const load = useCallback(async () => {
    if (inFlight.current || stopped.current) return;
    inFlight.current = true;
    try {
      const res = await fetch(`/api/orders/${orderId}/chat?after=${lastId.current}`, { cache: "no-store" });
      if (res.status === 403 || res.status === 404) {
        // A rider replaced on the order: access ends at once, so the panel stops.
        stopped.current = true;
        setLostAccess(true);
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as ChatResponse;
      const { messages: rows, ...rest } = data;
      setState(rest);
      const fresh = merge(rows);
      if (firstLoadDone.current) {
        const incoming = fresh.filter((m) => m.kind !== "system" && m.sender !== viewerId);
        const newest = incoming.at(-1);
        if (newest) announce(`chat-message:${newest.id}`, "message");
      }
      firstLoadDone.current = true;
      // A read-only chat cannot change any more: no point polling it.
      if (rest.chat.read_only) stopped.current = true;
    } catch {
      /* transient network error — the next tick retries */
    } finally {
      inFlight.current = false;
    }
  }, [orderId, viewerId, merge]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    function onVisible() {
      if (document.visibilityState === "visible") void load();
    }
    function onPush(event: MessageEvent) {
      if ((event.data as { source?: string } | null)?.source === "mad-push") void load();
    }
    document.addEventListener("visibilitychange", onVisible);
    navigator.serviceWorker?.addEventListener("message", onPush);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      navigator.serviceWorker?.removeEventListener("message", onPush);
    };
  }, [load]);

  // Follow new messages when the reader is already at the bottom.
  const followBottom = useCallback(() => {
    const list = listRef.current;
    if (list && stickToBottom.current) list.scrollTop = list.scrollHeight;
  }, []);
  useEffect(followBottom, [messages, followBottom]);

  const photoPreview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
  }, [photoPreview]);

  function pickPhoto(file: File | null) {
    setFieldError(null);
    if (!file) return;
    const problem = imageFileProblem({ name: file.name, type: file.type, size: file.size });
    if (problem === "type") {
      setFieldError(t("errors.upload.imageTypeInvalid"));
      return;
    }
    if (problem === "size" || file.size > CHAT_PHOTO_MAX_BYTES) {
      setFieldError(t("errors.orderChat.photoTooLarge", { mb: CHAT_PHOTO_MAX_MB }));
      return;
    }
    setPhoto(file);
  }

  function clearPhoto() {
    setPhoto(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function post(init: RequestInit, sentText: boolean) {
    setPending(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/chat/messages`, init);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const { fieldErrors, formError: message } = parseFieldErrors(data, t("errors.generic"));
        const inline = fieldErrors.body ?? fieldErrors.image ?? fieldErrors.quick ?? null;
        setFieldError(inline);
        setFormError(inline ? null : message);
        // 409 = the chat just went read-only; 403 = access ended. Refresh state.
        if (res.status === 409 || res.status === 403) {
          stopped.current = false;
          void load();
        }
        return;
      }
      stickToBottom.current = true;
      merge([data as ChatMessage]);
      if (sentText) {
        setText(""); // cleared only once the server accepted it
        clearPhoto();
      }
    } catch {
      setFormError(t("errors.generic"));
    } finally {
      setPending(false);
    }
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    const body = text.trim();
    if (!body && !photo) {
      setFieldError(t("errors.orderChat.messageRequired"));
      return;
    }
    if (body.length > LIMITS.longTextMax) {
      setFieldError(t("validation.maxLength", { n: LIMITS.longTextMax }));
      return;
    }
    setFieldError(null);
    if (photo) {
      const form = new FormData();
      form.append("image", photo);
      if (body) form.append("body", body);
      void post({ method: "POST", body: form }, true);
    } else {
      void post({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) }, true);
    }
  }

  function sendQuick(key: string) {
    if (pending) return;
    setFieldError(null);
    // A quick reply never touches what the rider has typed.
    void post({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quick: key }) }, false);
  }

  function roleLabel(role: Role): string {
    if (role === "branch_manager") return t("orderChat.role.branchManager", { branch: state?.chat.branch_name ?? "" });
    return role === "rider" ? t("orderChat.role.rider") : t("orderChat.role.customer");
  }

  function roleBadge(role: Role) {
    return (
      <span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1", BADGE_CLASS[role])} data-testid="chat-role-badge">
        {roleLabel(role)}
      </span>
    );
  }

  function messageText(m: ChatMessage): string {
    if (m.kind === "quick") return t(`orderChat.quick.${m.body}`);
    return m.body;
  }

  const contactLabel = (kind: "branch" | "customer" | "rider") =>
    kind === "branch" ? t("orderChat.call.branch") : kind === "rider" ? t("orderChat.call.rider") : t("orderChat.call.customer");

  const calls = state?.contacts.length ? (
    <div className="flex flex-wrap gap-2">
      {state.contacts.map((c) => (
        <a
          key={c.kind}
          href={`tel:${c.phone}`}
          aria-label={t("orderChat.call.aria", { name: c.name })}
          data-testid={`chat-call-${c.kind}`}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-strong bg-surface-card px-3 text-sm font-medium text-fg-base hover:bg-surface-hover"
        >
          <Icon name="phone" className="size-4" /> {contactLabel(c.kind)}
        </a>
      ))}
    </div>
  ) : null;

  return (
    <div id="order-chat" className="scroll-mt-24">
      <Card testId="order-chat">
        <CardHeader title={t("orderChat.title")} action={calls} className="flex-wrap" />
        <CardContent className="space-y-3">
          {state ? (
            <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap" aria-label={t("orderChat.participants")}>
              {state.participants.map((p) => (
                <li key={`${p.role}-${p.user}`} className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-surface-muted py-1 pl-1 pr-2.5 text-xs">
                  <UserAvatar name={p.name} photo={p.photo} version={p.photo_version} className="size-6 text-[10px]" />
                  <span className="font-medium text-fg-base">{p.name}</span>
                  {roleBadge(p.role)}
                </li>
              ))}
            </ul>
          ) : null}

          {lostAccess ? <Alert tone="info" message={t("orderChat.noLongerAccess")} /> : null}
          <Alert tone="error" message={formError} />

          <ul
            ref={listRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            }}
            className="max-h-[28rem] min-h-40 space-y-3 overflow-y-auto rounded-xl border border-border-strong p-3"
            data-testid="chat-messages"
            aria-live="polite"
          >
            {state && messages.length === 0 ? (
              <li className="py-8 text-center text-sm text-fg-subtle">{t("orderChat.empty")}</li>
            ) : null}
            {messages.map((m) => {
              if (m.kind === "system") {
                return (
                  <li key={m.id} className="text-center text-xs text-fg-subtle" data-testid="chat-system-message">
                    {t(`orderChat.system.${m.body}`, { name: m.params?.name ?? "" })} · {fmt.time(m.created_at)}
                  </li>
                );
              }
              const mine = m.sender === viewerId;
              const name = m.sender_name || t("orderChat.unknownSender");
              return (
                <li key={m.id} className={cn("flex items-end gap-2", mine && "flex-row-reverse")} data-testid="chat-message">
                  <UserAvatar name={name} photo={m.sender_photo} version={m.sender_photo_version} className="size-8 text-xs" />
                  <div className={cn("flex max-w-[80%] flex-col gap-1", mine ? "items-end" : "items-start")}>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="font-semibold text-fg-base">{name}</span>
                      {m.sender_role !== "system" ? roleBadge(m.sender_role) : null}
                    </div>
                    <div
                      className={cn(
                        "rounded-2xl px-3.5 py-2 text-sm",
                        mine ? "bg-brand-500 text-white" : "bg-surface-card text-fg-base ring-1 ring-border-base",
                      )}
                    >
                      {m.kind === "image" && m.image && m.image_thumb ? (
                        <a href={m.image} target="_blank" rel="noreferrer" className="block">
                          {/* eslint-disable-next-line @next/next/no-img-element -- private, access-checked media: never through the optimizer */}
                          <img
                            src={m.image_thumb}
                            alt={t("orderChat.photoAlt", { name })}
                            loading="lazy"
                            onLoad={followBottom}
                            className="max-h-60 rounded-lg object-cover"
                            data-testid="chat-photo"
                          />
                        </a>
                      ) : null}
                      {messageText(m) ? <p className={cn("whitespace-pre-line break-words", m.kind === "image" && "mt-1.5")}>{messageText(m)}</p> : null}
                    </div>
                    <time className="text-[11px] text-fg-subtle" dateTime={m.created_at}>
                      {fmt.time(m.created_at)}
                    </time>
                  </div>
                </li>
              );
            })}
          </ul>

          {state?.chat.viewer_role === "observer" ? (
            <p className="rounded-lg bg-surface-muted px-3 py-2 text-center text-xs text-fg-muted" data-testid="chat-observer-note">
              {t("orderChat.observerNote")}
            </p>
          ) : state?.chat.read_only ? (
            <p className="rounded-lg bg-surface-muted px-3 py-2 text-center text-xs text-fg-muted" data-testid="chat-read-only">
              {t("orderChat.readOnly")}
            </p>
          ) : state?.chat.can_send && !lostAccess ? (
            <form onSubmit={send} noValidate className="space-y-2">
              {state.quick_replies.length ? (
                <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:flex-wrap" role="group" aria-label={t("orderChat.quickRepliesLabel")}>
                  {state.quick_replies.map((key) => (
                    <button
                      key={key}
                      type="button"
                      disabled={pending}
                      onClick={() => sendQuick(key)}
                      data-testid={`chat-quick-${key}`}
                      className="shrink-0 whitespace-nowrap rounded-full border border-rider-600/30 bg-rider-50 px-3 py-1.5 text-sm font-medium text-rider-700 hover:bg-rider-600/10 disabled:opacity-50"
                    >
                      {t(`orderChat.quick.${key}`)}
                    </button>
                  ))}
                </div>
              ) : null}
              {photoPreview ? (
                <div className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- local preview of a file not uploaded yet */}
                  <img src={photoPreview} alt="" className="size-14 rounded-lg object-cover ring-1 ring-border-base" />
                  <Button type="button" variant="ghost" size="sm" onClick={clearPhoto}>
                    <Icon name="x" className="size-4" /> {t("orderChat.removePhoto")}
                  </Button>
                </div>
              ) : null}
              <div className="flex items-end gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  data-testid="chat-photo-input"
                  onChange={(e) => pickPhoto(e.target.files?.[0] ?? null)}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0 px-3"
                  aria-label={t("orderChat.attachPhoto")}
                  title={t("orderChat.attachPhoto")}
                  onClick={() => fileRef.current?.click()}
                  disabled={pending}
                >
                  <Icon name="camera" className="size-4.5" />
                </Button>
                <Input
                  name="body"
                  className="flex-1"
                  placeholder={t("orderChat.placeholder")}
                  aria-label={t("orderChat.placeholder")}
                  aria-invalid={Boolean(fieldError)}
                  aria-describedby={fieldError ? "order-chat-error" : undefined}
                  value={text}
                  maxLength={LIMITS.longTextMax}
                  onChange={(e) => {
                    setText(e.target.value);
                    if (fieldError) setFieldError(null);
                  }}
                  data-testid="chat-input"
                />
                <Button type="submit" disabled={pending} className="shrink-0" data-testid="chat-send" aria-label={t("orderChat.send")}>
                  <Icon name="send" className="size-4" />
                  <span className="hidden sm:inline">{t("orderChat.send")}</span>
                </Button>
              </div>
              <FieldError id="order-chat-error" message={fieldError} />
            </form>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
