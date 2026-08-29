import "server-only";
import { randomBytes } from "node:crypto";

import { Prisma } from "@prisma/client";
import type { RewardRedemption, User } from "@prisma/client";

import { prisma } from "@/lib/db";
import { conflict, forbidden, sk, validationError } from "@/lib/http/errors";
import { createNotification } from "@/lib/services/notifications";
import { getSetting, setSetting } from "@/lib/services/settings";
import { dhakaDayKey } from "@/lib/utils/dates";

const REWARD_RULE_KEYS = ["profile_complete", "daily_login", "order_delivered"] as const;
export type RewardRuleKey = (typeof REWARD_RULE_KEYS)[number];

const REWARD_SETTING_KEYS = {
  coinValueTk: "reward_coin_value_tk", // Tk value of 1 coin
  minRedeemCoins: "reward_min_redeem_coins",
  // PHASE G — global on/off for the whole reward programme. Stored in the
  // existing SystemSetting table (which already records actor + timestamp), so
  // there is no second, competing reward engine.
  programActive: "reward_program_active",
} as const;

const DEFAULT_RULES: Record<RewardRuleKey, number> = {
  profile_complete: 50,
  daily_login: 5,
  order_delivered: 10,
};
const DEFAULT_COIN_VALUE = "0.50";
const DEFAULT_MIN_REDEEM = "100";
const DEFAULT_PROGRAM_ACTIVE = "true";

// WS-7.1 — how long a minted voucher stays spendable. A voucher that never
// expired would be an unbounded liability on the books; 90 days is long enough
// that a customer who redeems today can spend it on any normal ordering cycle.
const REDEMPTION_VALID_DAYS = 90;
// WS-7.1 — when a CANCELLED order hands a voucher back after it has already
// expired, the customer must not receive a dead instrument: it is re-dated to
// this many days from the cancellation. Only used on the restore path.
const RESTORE_GRACE_DAYS = 7;
const VOUCHER_PREFIX = "MADC";
const ZERO = new Prisma.Decimal(0);

/** All rules (auto-creating defaults on first call) + settings. */
export async function rewardConfig() {
  for (const key of REWARD_RULE_KEYS) {
    await prisma.rewardRule.upsert({
      where: { key },
      update: {},
      create: { key, coins: DEFAULT_RULES[key], isActive: true },
    });
  }
  const [rules, coinValue, minRedeem, active] = await Promise.all([
    prisma.rewardRule.findMany({ orderBy: { id: "asc" } }),
    getSetting(REWARD_SETTING_KEYS.coinValueTk),
    getSetting(REWARD_SETTING_KEYS.minRedeemCoins),
    getSetting(REWARD_SETTING_KEYS.programActive),
  ]);
  return {
    rules,
    coinValueTk: coinValue ?? DEFAULT_COIN_VALUE,
    minRedeemCoins: Number(minRedeem ?? DEFAULT_MIN_REDEEM),
    programActive: (active ?? DEFAULT_PROGRAM_ACTIVE) === "true",
  };
}

export async function updateRewardConfig(
  input: { rules: { key: string; coins: number; isActive: boolean }[]; coinValueTk: string; minRedeemCoins: number },
  actorId: number,
) {
  for (const r of input.rules) {
    if (!REWARD_RULE_KEYS.includes(r.key as RewardRuleKey)) continue;
    const coins = Math.max(0, Math.floor(Number(r.coins) || 0));
    await prisma.rewardRule.upsert({
      where: { key: r.key },
      update: { coins, isActive: Boolean(r.isActive) },
      create: { key: r.key, coins, isActive: Boolean(r.isActive) },
    });
  }
  const value = Number(input.coinValueTk);
  if (Number.isNaN(value) || value < 0) throw validationError({ coin_value_tk: sk("errors.ops.coinValueInvalid") });
  const minRedeem = Math.max(0, Math.floor(Number(input.minRedeemCoins) || 0));
  await setSetting(REWARD_SETTING_KEYS.coinValueTk, value.toFixed(2), actorId);
  await setSetting(REWARD_SETTING_KEYS.minRedeemCoins, String(minRedeem), actorId);
}

/** PHASE G — is the reward programme currently switched on? */
export async function rewardProgramActive(): Promise<boolean> {
  return (await getSetting(REWARD_SETTING_KEYS.programActive) ?? DEFAULT_PROGRAM_ACTIVE) === "true";
}

/**
 * PHASE G — activate / deactivate the whole reward programme. SUPER ADMIN ONLY.
 * Repeating the current state is a CONFLICT (409) rather than a silent no-op, so
 * a double-submit can never be mistaken for a real transition. Deactivating stops
 * FUTURE earning and redemption only — the ledger and every historical entry are
 * untouched and still readable, so balances survive a pause.
 */
export async function setRewardProgramActive(user: User, active: boolean) {
  if (user.role !== "super_admin") throw forbidden(sk("errors.rewards.forbidden"));
  const current = await rewardProgramActive();
  if (current === active) throw conflict(sk("errors.rewards.alreadyInState"));
  await setSetting(REWARD_SETTING_KEYS.programActive, active ? "true" : "false", user.id);
  return { programActive: active };
}

/** Coin balance = signed sum of the ledger. */
export async function coinBalance(userId: number): Promise<number> {
  const agg = await prisma.rewardLedger.aggregate({ where: { userId }, _sum: { coins: true } });
  return agg._sum.coins ?? 0;
}

/**
 * Award coins for a rule — idempotent via the (userId, reason, dedupeKey)
 * unique constraint. Returns coins awarded (0 if duplicate/inactive/zero).
 */
export async function awardCoins(userId: number, ruleKey: RewardRuleKey, dedupeKey: string): Promise<number> {
  // PHASE G — no new points while the programme is paused.
  if (!(await rewardProgramActive())) return 0;
  const rule = await prisma.rewardRule.findUnique({ where: { key: ruleKey } });
  if (!rule || !rule.isActive || rule.coins <= 0) return 0;
  try {
    await prisma.rewardLedger.create({
      data: { userId, coins: rule.coins, reason: ruleKey, dedupeKey },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return 0;
    throw err;
  }
  await createNotification(userId, {
    type: "system",
    titleKey: "notifications.reward.earned.title",
    bodyKey: "notifications.reward.earned.body",
    params: { coins: rule.coins },
    link: "/customer/rewards",
  });
  return rule.coins;
}

/**
 * Daily-login award (dedupe on today's date).
 *
 * The dedupe key MUST be the DHAKA day, not the UTC one. With a UTC key the
 * boundary falls at 06:00 Dhaka, so a customer who logged in at 05:00 and again
 * at 07:00 Dhaka got two "daily" awards inside one Bangladeshi day.
 */
export function awardDailyLogin(userId: number): Promise<number> {
  return awardCoins(userId, "daily_login", dhakaDayKey());
}

/** Profile-complete award — fires once when the profile has all core fields. */
export async function maybeAwardProfileComplete(user: User): Promise<number> {
  const complete = Boolean(
    user.firstName && user.phone && user.address && user.dateOfBirth && user.gender,
  );
  if (!complete) return 0;
  return awardCoins(user.id, "profile_complete", "once");
}

// ── WS-7.1 — coins → a real, spendable instrument ───────────────────────────
//
// Redeeming used to write a NEGATIVE RewardLedger row and then interpolate the
// Taka figure into a congratulatory notification. Nothing consumed it: no wallet
// credit, no coupon, no checkout field. The balance vanished and the customer
// was told how much money they had supposedly received. Burning coins now MINTS
// a RewardRedemption voucher inside the SAME transaction as the debit, so the
// value exists as a row that checkout can actually spend.

/** A candidate voucher code. 6 random bytes = 2^48 space; collisions are checked. */
function voucherCode(): string {
  return `${VOUCHER_PREFIX}-${randomBytes(6).toString("hex").toUpperCase()}`;
}

/**
 * Mint a voucher on the given client (usually an open transaction).
 *
 * The unique index on `code` is the real guarantee; the pre-check loop only
 * avoids relying on catching P2002 INSIDE a transaction, which aborts the whole
 * transaction on Postgres and would take the ledger debit down with it.
 */
async function mintRedemption(
  tx: Prisma.TransactionClient,
  input: { userId: number; coins: number; tkValue: Prisma.Decimal; expiresAt: Date | null },
): Promise<RewardRedemption> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = voucherCode();
    const clash = await tx.rewardRedemption.findUnique({ where: { code } });
    if (clash) continue;
    return tx.rewardRedemption.create({
      data: {
        userId: input.userId,
        coins: input.coins,
        tkValue: input.tkValue,
        code,
        status: "active",
        expiresAt: input.expiresAt,
      },
    });
  }
  throw conflict(sk("errors.rewards.voucherCodeUnavailable"));
}

/**
 * Redeem coins per the configured rules (min amount, positive balance).
 *
 * The ledger debit and the voucher mint are ONE transaction: a crash between
 * them would otherwise destroy the customer's balance with nothing issued in
 * return. The Tk value is frozen from the super admin's current coin value at
 * mint time, so a later rate change never revalues an already-issued voucher —
 * this is the end of the "Super Admin sets coin value (Tk)" chain, and the
 * figure below is the one that comes off a real order total at checkout.
 */
export async function redeemCoins(userId: number, coins: number) {
  const amount = Math.floor(Number(coins) || 0);
  const { minRedeemCoins, coinValueTk, programActive } = await rewardConfig();
  // PHASE G — redemption is blocked while paused; the balance itself is kept.
  if (!programActive) throw validationError({ coins: sk("errors.rewards.paused") });
  if (amount <= 0) throw validationError({ coins: sk("errors.ops.coinAmountInvalid") });
  if (amount < minRedeemCoins) {
    throw validationError({ coins: sk("errors.ops.coinMinRedeem", { min: minRedeemCoins }) });
  }
  // Exact Decimal arithmetic — a coin value like 0.05 must never drift.
  const tkValue = new Prisma.Decimal(coinValueTk).times(amount).toDecimalPlaces(2);
  // A coin priced at 0 Tk would burn the balance for a worthless voucher; that
  // is the very bug this task exists to kill, so refuse instead.
  if (tkValue.lessThanOrEqualTo(ZERO)) {
    throw validationError({ coins: sk("errors.rewards.coinValueUnset") });
  }
  const expiresAt = new Date(Date.now() + REDEMPTION_VALID_DAYS * 86_400_000);

  const { entry, redemption } = await prisma.$transaction(async (tx) => {
    // The balance is re-read INSIDE the transaction: two redemptions submitted
    // at once must not both pass a check made against a stale balance.
    const agg = await tx.rewardLedger.aggregate({ where: { userId }, _sum: { coins: true } });
    const balance = agg._sum.coins ?? 0;
    if (amount > balance) {
      throw validationError({ coins: sk("errors.ops.coinInsufficient", { balance }) });
    }
    const created = await tx.rewardLedger.create({
      data: {
        userId,
        coins: -amount,
        reason: "redeem",
        dedupeKey: `redeem:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      },
    });
    const minted = await mintRedemption(tx, { userId, coins: amount, tkValue, expiresAt });
    return { entry: created, redemption: minted };
  });

  const tk = redemption.tkValue.toFixed(2);
  await createNotification(userId, {
    type: "system",
    titleKey: "notifications.reward.redeemed.title",
    bodyKey: "notifications.reward.redeemed.body",
    params: { coins: amount, tk },
    link: "/customer/rewards",
  });
  return { entry, redemption, tkValue: tk };
}

/** The customer's spendable vouchers (newest first) — what checkout may offer. */
export async function activeRedemptions(userId: number, now = new Date()) {
  return prisma.rewardRedemption.findMany({
    where: {
      userId,
      status: "active",
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { createdAt: "desc" },
  });
}

export function serializeRedemption(r: RewardRedemption) {
  return {
    id: r.id,
    code: r.code,
    coins: r.coins,
    tk_value: r.tkValue.toFixed(2),
    status: r.status,
    consumed_order_id: r.consumedOrderId,
    consumed_at: r.consumedAt?.toISOString() ?? null,
    expires_at: r.expiresAt?.toISOString() ?? null,
    created_at: r.createdAt.toISOString(),
  };
}

/** What a voucher actually took off an order (all figures server-computed). */
export interface CoinDiscount {
  redemptionId: number;
  code: string;
  coins: number;
  amount: Prisma.Decimal;
}

/**
 * WS-7.1 — spend a voucher on an order, INSIDE that order's own transaction.
 *
 * Everything here is re-derived server-side: the client sends only a code, and
 * the Taka figure comes from the voucher ROW, never from the request. The claim
 * is a conditional UPDATE (`status: "active"` in the WHERE clause) whose
 * affected-row count decides the winner, so the same voucher submitted twice
 * concurrently can only ever pay for one order.
 *
 * SPLIT POLICY — when the voucher is worth more than the order can absorb, the
 * excess is NOT forfeited (that would be the original bug wearing a new hat).
 * The consumed row is rewritten to exactly what it paid and a "change" voucher
 * is minted for the remainder, with the same expiry. Value is conserved, and
 * because the consumed row now equals the amount applied, restoring it after a
 * cancellation gives back exactly what was spent — never the change twice.
 */
export async function consumeRedemptionForOrder(
  tx: Prisma.TransactionClient,
  input: { userId: number; code: string; orderId: number; cap: Prisma.Decimal },
): Promise<CoinDiscount | null> {
  const code = String(input.code ?? "").trim().toUpperCase();
  if (!code) return null;
  const voucher = await tx.rewardRedemption.findUnique({ where: { code } });
  // A voucher belonging to somebody else is reported exactly like a code that
  // does not exist — the response must not confirm another customer's code.
  if (!voucher || voucher.userId !== input.userId) {
    throw validationError({ reward_code: sk("errors.rewards.voucherInvalid") });
  }
  if (voucher.status !== "active") {
    throw validationError({ reward_code: sk("errors.rewards.voucherAlreadyUsed") });
  }
  if (voucher.expiresAt && voucher.expiresAt <= new Date()) {
    throw validationError({ reward_code: sk("errors.rewards.voucherExpired") });
  }
  const cap = input.cap.lessThan(ZERO) ? ZERO : input.cap;
  if (cap.lessThanOrEqualTo(ZERO)) {
    throw validationError({ reward_code: sk("errors.rewards.voucherNotApplicable") });
  }
  const applied = (voucher.tkValue.greaterThan(cap) ? cap : voucher.tkValue).toDecimalPlaces(2);
  const remainder = voucher.tkValue.minus(applied);

  const claimed = await tx.rewardRedemption.updateMany({
    where: { id: voucher.id, userId: input.userId, status: "active" },
    data: {
      status: "consumed",
      consumedOrderId: input.orderId,
      consumedAt: new Date(),
      // Rewritten to what it actually paid; the rest leaves as change below.
      tkValue: applied,
    },
  });
  if (claimed.count !== 1) {
    throw validationError({ reward_code: sk("errors.rewards.voucherAlreadyUsed") });
  }
  if (remainder.greaterThan(ZERO)) {
    // coins = 0: no NEW coins were burned to mint the change, they were already
    // debited when the original voucher was issued.
    await mintRedemption(tx, {
      userId: input.userId,
      coins: 0,
      tkValue: remainder,
      expiresAt: voucher.expiresAt,
    });
  }
  return { redemptionId: voucher.id, code: voucher.code, coins: voucher.coins, amount: applied };
}

/**
 * WS-7.1 — CANCELLATION POLICY: restore the INSTRUMENT, never re-credit coins.
 *
 * Re-crediting would need a fresh positive ledger row, which a replayed
 * cancellation could write twice (the ledger's dedupe key is per award reason,
 * not per cancellation) and which would let a customer mint a second voucher at
 * a NEW coin rate. Flipping the voucher back to `active` is a single idempotent
 * conditional update, keeps the frozen Tk value, and reconciles with the ledger
 * without touching it. An already-expired voucher is re-dated so the customer is
 * not handed back something dead through no fault of their own.
 */
export async function restoreRedemptionForOrder(orderId: number): Promise<boolean> {
  const voucher = await prisma.rewardRedemption.findFirst({
    where: { consumedOrderId: orderId, status: "consumed" },
  });
  if (!voucher) return false;
  const now = new Date();
  const expired = voucher.expiresAt != null && voucher.expiresAt <= now;
  const restored = await prisma.rewardRedemption.updateMany({
    where: { id: voucher.id, status: "consumed", consumedOrderId: orderId },
    data: {
      status: "active",
      consumedOrderId: null,
      consumedAt: null,
      ...(expired ? { expiresAt: new Date(now.getTime() + RESTORE_GRACE_DAYS * 86_400_000) } : {}),
    },
  });
  if (restored.count !== 1) return false;
  await createNotification(voucher.userId, {
    type: "system",
    titleKey: "notifications.reward.voucherRestored.title",
    bodyKey: "notifications.reward.voucherRestored.body",
    params: { code: voucher.code, tk: voucher.tkValue.toFixed(2) },
    link: "/customer/rewards",
  });
  return true;
}
