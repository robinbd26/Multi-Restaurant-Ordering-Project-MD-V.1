import { requireApiRole } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { handle, sk, validationError } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import {
  DEFAULT_PLATFORM_FEE,
  MAX_PLATFORM_FEE,
  SETTING_KEYS,
  branchPlatformFeeKey,
  clearBranchPlatformFee,
  platformFeeRules,
  setSetting,
} from "@/lib/services/settings";

/**
 * PHASE 4 — the platform fee: a flat amount added to every order, delivery and
 * pickup alike. Super admin only: it is platform revenue, not a branch price.
 *
 * GET  → the global fee plus every branch's rule (override or inherited).
 * PUT  { platform_fee }                      → set the global fee.
 * PUT  { branch_id, platform_fee }           → set one branch's override.
 * PUT  { branch_id, platform_fee: null }     → clear it (inherit the global fee).
 *
 * Every change is written to the financial audit log, like the other money settings.
 */

function serializeRules(rules: Awaited<ReturnType<typeof platformFeeRules>>) {
  return {
    platform_fee: rules.defaultFee.toFixed(2),
    default: DEFAULT_PLATFORM_FEE,
    updated_at: rules.updatedAt?.toISOString() ?? null,
    branches: rules.branches.map((b) => ({
      branch_id: b.branchId,
      branch_name: b.branchName,
      override: b.override?.toFixed(2) ?? null,
      effective: b.effective.toFixed(2),
      updated_at: b.updatedAt?.toISOString() ?? null,
    })),
  };
}

function parseFee(raw: unknown): number {
  const value = Number(raw);
  if (raw === undefined || raw === "" || !Number.isFinite(value) || value < 0 || value > MAX_PLATFORM_FEE) {
    throw validationError({ platform_fee: sk("errors.money.invalidPlatformFee", { max: MAX_PLATFORM_FEE }) });
  }
  return Math.round(value * 100) / 100;
}

export const GET = handle(async () => {
  await requireApiRole("super_admin");
  return json(serializeRules(await platformFeeRules()));
});

export const PUT = handle(async (req: Request) => {
  const me = await requireApiRole("super_admin");
  const body = (await req.json().catch(() => ({}))) as {
    branch_id?: unknown;
    platform_fee?: unknown;
  };

  if (body.branch_id !== undefined && body.branch_id !== null && body.branch_id !== "") {
    const branchId = Number(body.branch_id);
    const branch = Number.isSafeInteger(branchId)
      ? await prisma.branch.findFirst({ where: { id: branchId, isArchived: false }, select: { id: true, name: true } })
      : null;
    if (!branch) throw validationError({ branch_id: sk("errors.orders.selectBranch") });

    if (body.platform_fee === null) {
      await clearBranchPlatformFee(branch.id);
      await prisma.financialAuditLog.create({
        data: {
          actorId: me.id,
          action: "setting_updated",
          entity: "SystemSetting",
          entityId: branchPlatformFeeKey(branch.id),
          detail: `${branch.name}: platform fee override cleared (inherits global)`,
        },
      });
    } else {
      const fee = parseFee(body.platform_fee);
      await setSetting(branchPlatformFeeKey(branch.id), fee.toFixed(2), me.id);
      await prisma.financialAuditLog.create({
        data: {
          actorId: me.id,
          action: "setting_updated",
          entity: "SystemSetting",
          entityId: branchPlatformFeeKey(branch.id),
          detail: `${branch.name}: platform fee ৳${fee.toFixed(2)}`,
        },
      });
    }
    return json(serializeRules(await platformFeeRules()));
  }

  const fee = parseFee(body.platform_fee);
  await setSetting(SETTING_KEYS.platformFee, fee.toFixed(2), me.id);
  await prisma.financialAuditLog.create({
    data: {
      actorId: me.id,
      action: "setting_updated",
      entity: "SystemSetting",
      entityId: SETTING_KEYS.platformFee,
      detail: `Platform fee ৳${fee.toFixed(2)} per order`,
    },
  });
  return json(serializeRules(await platformFeeRules()));
});
