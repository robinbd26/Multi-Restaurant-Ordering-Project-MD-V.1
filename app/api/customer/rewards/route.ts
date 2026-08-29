import { requireApiRole } from "@/lib/auth/current-user";
import { handle } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { prisma } from "@/lib/db";
import {
  activeRedemptions,
  awardDailyLogin,
  coinBalance,
  redeemCoins,
  rewardConfig,
  serializeRedemption,
} from "@/lib/services/rewards";

// GET /api/customer/rewards — balance + rules + own ledger + spendable vouchers.
// Visiting the rewards hub also counts as the daily-login activity (idempotent
// per day).
//
// WS-7.1 — ?vouchers=1 is the CHECKOUT read: only the spendable vouchers, no
// ledger and no daily-login award (opening the checkout page is not a visit to
// the rewards hub, and a 3G checkout should not pay for the full payload).
export const GET = handle(async (req: Request) => {
  const me = await requireApiRole("customer");
  const vouchersOnly = new URL(req.url).searchParams.get("vouchers") === "1";
  if (vouchersOnly) {
    const [balance, vouchers] = await Promise.all([coinBalance(me.id), activeRedemptions(me.id)]);
    return json({ balance, redemptions: vouchers.map(serializeRedemption) });
  }
  await awardDailyLogin(me.id);

  const [config, balance, ledger, vouchers] = await Promise.all([
    rewardConfig(),
    coinBalance(me.id),
    prisma.rewardLedger.findMany({
      where: { userId: me.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    activeRedemptions(me.id),
  ]);

  return json({
    balance,
    balance_tk: (balance * Number(config.coinValueTk)).toFixed(2),
    coin_value_tk: config.coinValueTk,
    min_redeem_coins: config.minRedeemCoins,
    // PHASE G — customers are told plainly when rewards are paused.
    program_active: config.programActive,
    rules: config.rules.map((r) => ({ key: r.key, coins: r.coins, is_active: r.isActive })),
    ledger: ledger.map((l) => ({
      id: l.id,
      coins: l.coins,
      reason: l.reason,
      created_at: l.createdAt.toISOString(),
    })),
    // WS-7.1 — the vouchers the burned coins actually bought.
    redemptions: vouchers.map(serializeRedemption),
  });
});

// POST /api/customer/rewards  { coins } — redeem against own balance. WS-7.1:
// the response carries the MINTED voucher (code + value + expiry), because that
// row — not the notification text — is what the customer can now spend.
export const POST = handle(async (req: Request) => {
  const me = await requireApiRole("customer");
  const body = (await req.json().catch(() => ({}))) as { coins?: number | string };
  const { tkValue, redemption } = await redeemCoins(me.id, Number(body.coins ?? 0));
  const balance = await coinBalance(me.id);
  return json({
    ok: true,
    redeemed_tk: tkValue,
    balance,
    voucher: serializeRedemption(redemption),
  });
});
