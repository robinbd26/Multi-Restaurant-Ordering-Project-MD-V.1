import { Prisma } from "@prisma/client";

import { requireApiRole } from "@/lib/auth/current-user";
import { handle, sk, validationError } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { prisma } from "@/lib/db";
import {
  DEFAULT_RIDER_COMMISSION,
  branchCommissionKey,
  commissionRules,
  setSetting,
} from "@/lib/services/settings";

/** A commission rate above this is a typo, not a rule. */
const MAX_COMMISSION = 100000;

async function audit(actorId: number, key: string, detail: string) {
  await prisma.financialAuditLog.create({
    data: { actorId, action: "setting_updated", entity: "SystemSetting", entityId: key, detail },
  });
}

// GET /api/accounts/commissions/rules — the commission rule book.
//
// WS-2.8 — the per-delivery commission rule lived behind a SUPER-ADMIN-only
// route (/api/admin/settings/delivery-fees), so Accounts — the team that answers
// for every payout — could not even read the rate it was paying, let alone see
// which branch pays what.
export const GET = handle(async () => {
  await requireApiRole("accounts", "super_admin", "management");
  const rules = await commissionRules();
  return json({
    // Owned by the super admin; Accounts reads it and overrides per branch.
    default_rate: rules.defaultRate.toFixed(2),
    fallback_rate: DEFAULT_RIDER_COMMISSION,
    branches: rules.branches.map((b) => ({
      branch: b.branchId,
      branch_name: b.branchName,
      // null = inherits the default; never a copy of it, so "inherited" and
      // "deliberately set to the same number" stay distinguishable.
      override: b.override ? b.override.toFixed(2) : null,
      effective_rate: b.effective.toFixed(2),
      updated_at: b.updatedAt ? b.updatedAt.toISOString() : null,
      updated_by_name: b.updatedByName,
    })),
  });
});

// PUT /api/accounts/commissions/rules  { branch_id, rate }  (rate "" = inherit)
//
// The BRANCH rule is the piece Accounts is permitted to maintain; the global
// default stays super-admin only (PUT /api/admin/settings/delivery-fees). An
// existing RiderCommission row is never revalued — the amount was snapshotted
// when the delivery completed — so a rule change only affects future deliveries.
export const PUT = handle(async (req: Request) => {
  const me = await requireApiRole("accounts", "super_admin");
  const body = (await req.json().catch(() => ({}))) as { branch_id?: number; rate?: string | number };

  const branchId = Number(body.branch_id);
  if (!Number.isInteger(branchId) || branchId <= 0) {
    throw validationError({ branch_id: sk("errors.money.selectBranch") });
  }
  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch) throw validationError({ branch_id: sk("errors.money.selectBranch") });

  const key = branchCommissionKey(branchId);
  const raw = String(body.rate ?? "").trim();

  // An empty rate clears the override: the branch goes back to inheriting the
  // global rate. Deleting the row (rather than storing the current default) is
  // what keeps "inherits" meaningful after the default later changes.
  if (raw === "") {
    await prisma.systemSetting.deleteMany({ where: { key } });
    await audit(me.id, key, `${branch.name} · inherits the default commission`);
    const rules = await commissionRules();
    return json({ branch: branchId, override: null, effective_rate: rules.defaultRate.toFixed(2) });
  }

  // Plain Taka, at most two decimals. Deliberately stricter than Number(): "1e3"
  // and "0x10" both parse as numbers and neither is a commission rate anybody
  // typed on purpose.
  if (!/^\d+(\.\d{1,2})?$/.test(raw) || Number(raw) > MAX_COMMISSION) {
    throw validationError({ rate: sk("errors.money.enterValidCommission") });
  }
  // Store the exact Decimal string, never the float that validated it.
  const rate = new Prisma.Decimal(raw).toFixed(2);
  await setSetting(key, rate, me.id);
  await audit(me.id, key, `${branch.name} · ৳${rate} per delivery`);

  return json({ branch: branchId, override: rate, effective_rate: rate });
});
