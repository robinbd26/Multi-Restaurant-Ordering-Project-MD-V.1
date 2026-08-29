import "server-only";

/**
 * SMS delivery seam for the auth flows (login OTP, password-reset link).
 *
 * The app must run with NO gateway credentials — that is the repo's
 * demo-fallback rule — so this module resolves a driver at call time:
 *
 *   SMS_PROVIDER unset/blank        → `demo` driver: logs the message, sends nothing.
 *   SMS_PROVIDER set + SMS_API_KEY  → the matching gateway adapter.
 *   SMS_PROVIDER set, key missing   → `demo` driver + a loud server-side warning,
 *                                     so a half-configured production deploy is
 *                                     visible in the logs instead of silently
 *                                     swallowing every code.
 *
 * A driver NEVER throws: a gateway outage must degrade the flow (the user is
 * told to retry), not crash the request. Callers read `result.ok`.
 *
 * The endpoint of each adapter is overridable with SMS_API_URL because the BD
 * gateways move theirs between plans/versions; verify yours against its current
 * documentation before going live.
 */

export type SmsProviderName = "demo" | "bulksmsbd" | "ssl_wireless" | "twilio";

export interface SmsMessage {
  /** Canonical BD mobile number, `01XXXXXXXXX` (see lib/auth/phone). */
  to: string;
  body: string;
  /** What the message is for — logged locally, never transmitted. */
  purpose: string;
}

export interface SmsResult {
  ok: boolean;
  provider: SmsProviderName;
  /** True when nothing actually left the server (demo driver). */
  simulated: boolean;
  /** Gateway message id, when one came back. */
  messageId?: string;
  /** Server-side only — never surface a gateway error to the client. */
  error?: string;
}

export interface SmsDriver {
  readonly name: SmsProviderName;
  /** True when the driver only pretends to send (local/demo mode). */
  readonly simulated: boolean;
  send(message: SmsMessage): Promise<SmsResult>;
}

/** BD gateways expect the international MSISDN without a leading `+`. */
function msisdn(local: string): string {
  return local.startsWith("0") ? `880${local.slice(1)}` : local;
}

// ── Drivers ─────────────────────────────────────────────────────────────

/**
 * Local/demo driver. Prints the message server-side so the flow is fully
 * testable without a gateway; the CODE ITSELF is only ever echoed back to the
 * caller in non-production (see the `demoHint` handling in the services).
 */
const demoDriver: SmsDriver = {
  name: "demo",
  simulated: true,
  async send({ to, body, purpose }) {
    console.info(`[sms:demo] purpose=${purpose} to=${to}\n${body}`);
    return { ok: true, provider: "demo", simulated: true };
  },
};

/** bulksmsbd.net — GET/POST form API keyed by api_key + senderid. */
function bulkSmsBdDriver(apiKey: string, senderId: string): SmsDriver {
  const url = process.env.SMS_API_URL || "https://bulksmsbd.net/api/smsapi";
  return {
    name: "bulksmsbd",
    simulated: false,
    async send({ to, body }) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            api_key: apiKey,
            senderid: senderId,
            number: msisdn(to),
            message: body,
          }),
          cache: "no-store",
        });
        const text = await res.text();
        if (!res.ok) return { ok: false, provider: "bulksmsbd", simulated: false, error: text.slice(0, 300) };
        return { ok: true, provider: "bulksmsbd", simulated: false, messageId: text.slice(0, 120) };
      } catch (err) {
        return { ok: false, provider: "bulksmsbd", simulated: false, error: String(err) };
      }
    },
  };
}

/** SSL Wireless SMS Plus — JSON API keyed by api_token + sid. */
function sslWirelessDriver(apiToken: string, sid: string): SmsDriver {
  const url = process.env.SMS_API_URL || "https://smsplus.sslwireless.com/api/v3/send-sms";
  return {
    name: "ssl_wireless",
    simulated: false,
    async send({ to, body }) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            api_token: apiToken,
            sid,
            msisdn: msisdn(to),
            sms: body,
            // Gateway-side de-duplication key; must be unique per message.
            csms_id: `mad${Date.now()}${Math.floor(Math.random() * 1000)}`,
          }),
          cache: "no-store",
        });
        const text = await res.text();
        if (!res.ok) return { ok: false, provider: "ssl_wireless", simulated: false, error: text.slice(0, 300) };
        return { ok: true, provider: "ssl_wireless", simulated: false, messageId: text.slice(0, 120) };
      } catch (err) {
        return { ok: false, provider: "ssl_wireless", simulated: false, error: String(err) };
      }
    },
  };
}

/**
 * Twilio — Basic-auth REST API. SMS_API_KEY carries the Auth Token and
 * TWILIO_ACCOUNT_SID the account; SMS_SENDER_ID is the `From` number.
 */
function twilioDriver(authToken: string, from: string): SmsDriver | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID || "";
  if (!accountSid) return null;
  const url =
    process.env.SMS_API_URL ||
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  return {
    name: "twilio",
    simulated: false,
    async send({ to, body }) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
          },
          body: new URLSearchParams({ To: `+${msisdn(to)}`, From: from, Body: body }),
          cache: "no-store",
        });
        const text = await res.text();
        if (!res.ok) return { ok: false, provider: "twilio", simulated: false, error: text.slice(0, 300) };
        const sid = (JSON.parse(text) as { sid?: string }).sid;
        return { ok: true, provider: "twilio", simulated: false, messageId: sid };
      } catch (err) {
        return { ok: false, provider: "twilio", simulated: false, error: String(err) };
      }
    },
  };
}

// ── Resolution ──────────────────────────────────────────────────────────

/** True when a real gateway is configured — drives the "can we deliver?" checks. */
export function isSmsConfigured(): boolean {
  return resolveSmsDriver().simulated === false;
}

/** Pick the driver for the current environment. Never throws, never returns null. */
export function resolveSmsDriver(): SmsDriver {
  const provider = (process.env.SMS_PROVIDER || "").trim().toLowerCase();
  if (!provider || provider === "demo") return demoDriver;

  const apiKey = (process.env.SMS_API_KEY || "").trim();
  const senderId = (process.env.SMS_SENDER_ID || "").trim();
  if (!apiKey) {
    console.warn(`[sms] SMS_PROVIDER="${provider}" is set but SMS_API_KEY is empty — falling back to the demo driver.`);
    return demoDriver;
  }

  switch (provider) {
    case "bulksmsbd":
      return bulkSmsBdDriver(apiKey, senderId);
    case "ssl_wireless":
      return sslWirelessDriver(apiKey, senderId);
    case "twilio": {
      const driver = twilioDriver(apiKey, senderId);
      if (driver) return driver;
      console.warn("[sms] SMS_PROVIDER=twilio requires TWILIO_ACCOUNT_SID — falling back to the demo driver.");
      return demoDriver;
    }
    default:
      console.warn(`[sms] unknown SMS_PROVIDER="${provider}" — falling back to the demo driver.`);
      return demoDriver;
  }
}

/** Send through the resolved driver. */
export function sendSms(message: SmsMessage): Promise<SmsResult> {
  return resolveSmsDriver().send(message);
}
