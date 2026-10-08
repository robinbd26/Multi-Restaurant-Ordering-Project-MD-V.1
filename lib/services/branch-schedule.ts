import "server-only";

import type { User } from "@prisma/client";

import { revalidatePath } from "next/cache";

import { revalidateCatalog } from "@/lib/cache/catalog";
import { prisma } from "@/lib/db";
import { forbidden, notFound, sk, validationError } from "@/lib/http/errors";
import { formatClock } from "@/lib/i18n/format";
import { logAdminAction } from "@/lib/services/audit";
import { serializeBrand } from "@/lib/services/brands";
import { BRANCH_HOURS_INCLUDE, brandsWithoutHours } from "@/lib/hours/availability";
import {
  normaliseBrandHours,
  normaliseDineInHours,
  parseBrandHours,
  parseDineInHours,
  type BrandHours,
  type DineInHours,
  type HoursSlot,
} from "@/lib/hours/schedule";
import type { BrandInfo } from "@/lib/brands/shared";

/**
 * Reading and saving a branch's hours: per-brand ordering schedules (with
 * Delivery / Pickup per slot) plus display-only dine-in hours.
 *
 * WHO: the branch manager of THIS branch, or the super admin for any branch.
 * Enforced here, server-side — the hours editor being hidden from other roles
 * is a convenience, never the guarantee. Every save is written to Activity Logs.
 */

export interface BranchScheduleView {
  branch: { id: number; name: string; business_type: string };
  brands: { brand: BrandInfo; hours: BrandHours | null }[];
  dine_in: DineInHours | null;
}

async function loadBranch(branchId: number) {
  if (!Number.isSafeInteger(branchId) || branchId <= 0) throw notFound(sk("errors.catalog.branchNotFound"));
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, include: BRANCH_HOURS_INCLUDE });
  if (!branch) throw notFound(sk("errors.catalog.branchNotFound"));
  return branch;
}

/** Super admin: any branch. Branch manager: only the branch they manage. */
async function assertCanManageHours(user: User, branchId: number): Promise<void> {
  if (user.role === "super_admin") return;
  if (user.role === "branch_manager") {
    const own = await prisma.branch.findFirst({ where: { managerId: user.id, isArchived: false }, select: { id: true } });
    if (own && own.id === branchId) return;
  }
  throw forbidden(sk("errors.hours.notYourBranch"));
}

export async function branchSchedule(user: User, branchId: number): Promise<BranchScheduleView> {
  await assertCanManageHours(user, branchId);
  const branch = await loadBranch(branchId);
  return {
    branch: { id: branch.id, name: branch.name, business_type: branch.businessType },
    brands: branch.brands
      .filter((b) => !b.brand.isArchived)
      .sort((a, b) => a.brand.sortOrder - b.brand.sortOrder || a.brand.id - b.brand.id)
      .map((b) => ({ brand: serializeBrand(b.brand), hours: parseBrandHours(b.hours) })),
    dine_in: parseDineInHours(branch.dineInHours),
  };
}

/** "11:00 AM–4:00 AM (delivery)" — a compact slot list for the activity log. */
function describeSlots(slots: HoursSlot[]): string {
  if (!slots.length) return "closed";
  return slots
    .map((s) => {
      const ch = [s.delivery ? "delivery" : "", s.pickup ? "pickup" : ""].filter(Boolean).join("+") || "no channel";
      return `${formatClock(s.start)}–${formatClock(s.end)} (${ch})`;
    })
    .join(", ");
}

function describeHours(h: BrandHours | null): string {
  if (!h) return "not set";
  const days = Object.entries(h.days)
    .map(([d, slots]) => `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][Number(d)]}: ${describeSlots(slots ?? [])}`)
    .join("; ");
  return `every day ${describeSlots(h.everyDay)}${days ? `; ${days}` : ""}`;
}

export interface ScheduleInput {
  /** Brand slug → schedule (null clears it back to "not set"). */
  brands?: Record<string, unknown>;
  dine_in?: unknown;
}

export async function saveBranchSchedule(user: User, branchId: number, input: ScheduleInput): Promise<BranchScheduleView> {
  await assertCanManageHours(user, branchId);
  const branch = await loadBranch(branchId);

  const updates: { id: number; slug: string; name: string; before: BrandHours | null; after: BrandHours | null }[] = [];
  const errors: Record<string, string> = {};
  for (const [slug, raw] of Object.entries(input.brands ?? {})) {
    const row = branch.brands.find((b) => b.brand.slug === slug && !b.brand.isArchived);
    if (!row) {
      errors[`brands.${slug}`] = sk("errors.hours.brandNotServed");
      continue;
    }
    const { hours, problems } = normaliseBrandHours(raw);
    if (problems.length) {
      errors[`brands.${slug}.${problems[0].at}`] = sk(problems[0].key);
      continue;
    }
    updates.push({ id: row.id, slug, name: row.brand.name, before: parseBrandHours(row.hours), after: hours });
  }
  let dineIn: { changed: boolean; value: DineInHours | null } = { changed: false, value: null };
  if (input.dine_in !== undefined) {
    const { hours, problems } = normaliseDineInHours(input.dine_in);
    if (problems.length) errors[problems[0].at] = sk(problems[0].key);
    else dineIn = { changed: JSON.stringify(hours) !== JSON.stringify(parseDineInHours(branch.dineInHours)), value: hours };
  }
  if (Object.keys(errors).length) throw validationError(errors);

  const changed = updates.filter((u) => JSON.stringify(u.before) !== JSON.stringify(u.after));
  if (changed.length || dineIn.changed) {
    await prisma.$transaction(async (tx) => {
      for (const u of changed) {
        await tx.branchBrand.update({ where: { id: u.id }, data: { hours: u.after ? JSON.stringify(u.after) : "" } });
        await logAdminAction(
          user.id,
          "action",
          `Changed ${u.name} hours at "${branch.name}": ${describeHours(u.before)} → ${describeHours(u.after)}`,
          { tx, branchId: branch.id },
        );
      }
      if (dineIn.changed) {
        await tx.branch.update({ where: { id: branch.id }, data: { dineInHours: dineIn.value ? JSON.stringify(dineIn.value) : "" } });
        await logAdminAction(
          user.id,
          "action",
          `Changed dine-in hours at "${branch.name}": ${
            dineIn.value
              ? dineIn.value.everyDay.map((s) => `${formatClock(s.start)}–${formatClock(s.end)}`).join(", ") || "closed"
              : "hidden"
          }`,
          { tx, branchId: branch.id },
        );
      }
    });
    // Open/closed shows on the storefront, branch lists and checkout.
    revalidateCatalog({ branchId: branch.id });
    revalidatePath("/branch-manager/delivery-hours");
    revalidatePath(`/admin/branches/${branch.id}`);
  }
  return branchSchedule(user, branchId);
}

/**
 * Names of the live brands at this branch that have NO hours, so they are
 * closed to customers until hours are set ("No hours set" warnings).
 * Empty for an archived or deactivated branch: it takes no orders anyway.
 */
export async function brandNamesWithoutHours(branchId: number): Promise<string[]> {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    include: { brands: { include: { brand: true } } },
  });
  if (!branch || branch.isArchived || !branch.isActive) return [];
  const slugs = new Set(brandsWithoutHours(branch));
  return branch.brands.filter((r) => slugs.has(r.brand.slug)).map((r) => r.brand.name);
}
