import { Prisma } from "@prisma/client";

import { requireApiRole } from "@/lib/auth/current-user";
import { handle, sk, validationError } from "@/lib/http/errors";
import { json } from "@/lib/http/respond";
import { prisma } from "@/lib/db";
import {
  DEFAULT_SERVICE_CHARGE_PERCENT,
  DEFAULT_TAX_RATE_PERCENT,
  MAX_CHARGE_PERCENT,
  SETTING_KEYS,
  chargeRates,
  setSetting,
} from "@/lib/services/settings";

/** A percentage: whole or up to two decimals, nothing exotic. */
const PERCENT = /^\d+(\.\d{1,2})?$/;

function parsePercent(raw: unknown, field: string): Prisma.Decimal {
  const value = String(raw ?? "").trim();
  if (!PERCENT.test(value) || Number(value) > MAX_CHARGE_PERCENT) {
    throw validationError({ [field]: sk("errors.money.enterValidRate") });
  }
  return new Prisma.Decimal(value);
}

// GET /api/admin/settings/charges — the configured tax and service-charge rates.
//
// WS-2.3 — tax and service charge are part of every deductions figure Accounts
// reports, but there was nowhere to configure them, so the report had no rates
// to work from. Readable by accounts and management (they read the report and
// need to see which rates produced it); only the super admin may change them.
export const GET = handle(async () => {
  await requireApiRole("accounts", "super_admin", "management");
  const rates = await chargeRates();
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: [SETTING_KEYS.taxRatePercent, SETTING_KEYS.serviceChargePercent] } },
    include: { updatedBy: true },
  });
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const meta = (key: string) => {
    const row = byKey.get(key);
    return {
      updated_at: row?.updatedAt.toISOString() ?? null,
      updated_by_name: row?.updatedBy
        ? `${row.updatedBy.firstName} ${row.updatedBy.lastName}`.trim() || row.updatedBy.username
        : null,
    };
  };

  return json({
    tax_percent: rates.taxPercent.toFixed(2),
    service_charge_percent: rates.servicePercent.toFixed(2),
    defaults: {
      tax_percent: DEFAULT_TAX_RATE_PERCENT,
      service_charge_percent: DEFAULT_SERVICE_CHARGE_PERCENT,
    },
    max_percent: MAX_CHARGE_PERCENT,
    tax: meta(SETTING_KEYS.taxRatePercent),
    service_charge: meta(SETTING_KEYS.serviceChargePercent),
  });
});

// PUT /api/admin/settings/charges  { tax_percent, service_charge_percent }
//
// Both rates are EXTRACTION rates: the order pipeline never adds tax or a
// service charge on top of a total, so these say what proportion of money
// already recorded is tax and service charge (see splitCharges() in
// lib/services/financials.ts). Changing them re-cuts how past takings are
// PRESENTED; it never changes a single recorded amount.
export const PUT = handle(async (req: Request) => {
  const me = await requireApiRole("super_admin");
  const body = (await req.json().catch(() => ({}))) as {
    tax_percent?: string | number;
    service_charge_percent?: string | number;
  };

  const tax = parsePercent(body.tax_percent, "tax_percent");
  const service = parsePercent(body.service_charge_percent, "service_charge_percent");
  // The two are extracted from the same inclusive base, so together they must
  // still leave something behind — 100% of a price cannot be charges.
  if (tax.plus(service).greaterThanOrEqualTo(MAX_CHARGE_PERCENT)) {
    throw validationError({ tax_percent: sk("errors.money.chargeRatesTooHigh") });
  }

  await setSetting(SETTING_KEYS.taxRatePercent, tax.toFixed(2), me.id);
  await setSetting(SETTING_KEYS.serviceChargePercent, service.toFixed(2), me.id);
  await prisma.financialAuditLog.create({
    data: {
      actorId: me.id,
      action: "setting_updated",
      entity: "SystemSetting",
      entityId: `${SETTING_KEYS.taxRatePercent}+${SETTING_KEYS.serviceChargePercent}`,
      detail: `tax ${tax.toFixed(2)}% · service charge ${service.toFixed(2)}%`,
    },
  });

  return json({
    tax_percent: tax.toFixed(2),
    service_charge_percent: service.toFixed(2),
  });
});
