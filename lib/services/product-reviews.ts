import "server-only";

import type { Prisma, User } from "@prisma/client";

import { prisma } from "@/lib/db";
import { forbidden, notFound, sk, validationError } from "@/lib/http/errors";
import { deleteUpload, saveUpload } from "@/lib/http/upload";
import {
  canFlagReview,
  canModerateReviews,
  eligibleOrderFor,
  parseRating,
  REVIEW_COMMENT_MAX,
  REVIEW_REASON_MAX,
  reviewListScope,
  summarize,
} from "@/lib/reviews/policy";
import { branchForManager } from "@/lib/selectors";
import { logAdminAction } from "@/lib/services/audit";
import { createNotification, notifyRole } from "@/lib/services/notifications";
import {
  parsePhotoKeys,
  PHOTO_MAX_BYTES,
  PHOTO_MAX_MB,
  PHOTO_THUMB_WIDTH,
  REVIEW_PHOTO_MAX,
  REVIEW_PHOTO_SUBDIR,
} from "@/lib/upload/photos";

/**
 * Product reviews (rules in lib/reviews/policy.ts).
 *
 * PRIVACY: what leaves this module for the public is the reviewer's FIRST NAME,
 * a link to their avatar (served only while the review is visible), the stars,
 * the text, the photos and the dates. Never an email, phone, address, surname
 * or user id.
 */

// ── serialization ─────────────────────────────────────────────────────────

type ReviewWithAuthor = Prisma.FoodReviewGetPayload<{
  include: { customer: { select: { firstName: true; username: true; profilePhoto: true; updatedAt: true } } };
}>;

/** Public photo urls (the route refuses hidden reviews). */
function photoUrls(review: { id: number; photos: string; updatedAt: Date }) {
  const v = review.updatedAt.getTime();
  return parsePhotoKeys(review.photos).map((_, index) => ({
    url: `/api/reviews/${review.id}/photos/${index}?v=${v}`,
    thumb: `/api/reviews/${review.id}/photos/${index}?w=${PHOTO_THUMB_WIDTH}&v=${v}`,
  }));
}

/** First name only; a username is shown as a fallback only if no name is set. */
function firstName(user: { firstName: string; username: string }): string {
  const first = user.firstName.trim().split(/\s+/)[0] ?? "";
  return first || user.username.split(/[@\s]/)[0] || "";
}

export interface PublicReviewRow {
  id: number;
  rating: number;
  comment: string;
  photos: { url: string; thumb: string }[];
  author: { first_name: string; avatar_url: string | null };
  created_at: string;
  updated_at: string;
  edited: boolean;
}

export function serializePublicReview(r: ReviewWithAuthor): PublicReviewRow {
  return {
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    photos: photoUrls(r),
    author: {
      first_name: firstName(r.customer),
      avatar_url: r.customer.profilePhoto ? `/api/reviews/${r.id}/avatar?v=${r.customer.updatedAt.getTime()}` : null,
    },
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
    // "Edited" once it changed after the first day it was written.
    edited: r.updatedAt.getTime() - r.createdAt.getTime() > 60_000,
  };
}

const AUTHOR_SELECT = { select: { firstName: true, username: true, profilePhoto: true, updatedAt: true } } as const;

// ── reading (public) ──────────────────────────────────────────────────────

/** Average and count of VISIBLE reviews per product, for the grid cards. */
export async function ratingSummaries(productIds: number[]): Promise<Map<number, { average: number; count: number }>> {
  const out = new Map<number, { average: number; count: number }>();
  if (productIds.length === 0) return out;
  const rows = await prisma.foodReview.groupBy({
    by: ["productId"],
    where: { productId: { in: productIds }, isHidden: false },
    _avg: { rating: true },
    _count: { _all: true },
  });
  for (const row of rows) {
    out.set(row.productId, {
      average: Math.round((row._avg.rating ?? 0) * 10) / 10,
      count: row._count._all,
    });
  }
  return out;
}

/** The modal's reviews: summary + a page of visible reviews, newest first. */
export async function productReviewsPage(productId: number, page = 1, pageSize = 5) {
  const size = Math.min(Math.max(1, pageSize), 20);
  const current = Math.max(1, page);
  const where: Prisma.FoodReviewWhereInput = { productId, isHidden: false };
  const [ratings, rows] = await Promise.all([
    prisma.foodReview.findMany({ where, select: { rating: true } }),
    prisma.foodReview.findMany({
      where,
      include: { customer: AUTHOR_SELECT },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: (current - 1) * size,
      take: size + 1,
    }),
  ]);
  const summary = summarize(ratings.map((r) => r.rating));
  return {
    summary,
    results: rows.slice(0, size).map(serializePublicReview),
    has_more: rows.length > size,
    page: current,
  };
}

// ── writing (customer) ────────────────────────────────────────────────────

/** Finished orders of this customer that contain the product. */
async function eligibilityFor(customerId: number, productId: number): Promise<number | null> {
  const orders = await prisma.order.findMany({
    where: { customerId, status: "delivered", items: { some: { productId } } },
    select: { id: true, status: true, updatedAt: true, items: { select: { productId: true } } },
  });
  return eligibleOrderFor(
    orders.map((o) => ({ id: o.id, status: o.status, at: o.updatedAt, productIds: o.items.map((i) => i.productId ?? -1) })),
    productId,
  );
}

/** The customer's own review of a product (any visibility) and whether they may write one. */
export async function myReview(user: User, productId: number) {
  if (user.role !== "customer") throw forbidden(sk("errors.reviews.customersOnly"));
  const [orderId, review] = await Promise.all([
    eligibilityFor(user.id, productId),
    prisma.foodReview.findUnique({
      where: { customerId_productId: { customerId: user.id, productId } },
      include: { customer: AUTHOR_SELECT },
    }),
  ]);
  return {
    eligible: orderId != null,
    review: review ? { ...serializePublicReview(review), is_hidden: review.isHidden } : null,
  };
}

export interface ReviewInput {
  rating: unknown;
  comment?: unknown;
  /** New photo files to add. */
  photos?: File[];
  /** Indexes of the CURRENT photos to keep (edit); absent = keep all. */
  keep?: number[] | null;
}

/**
 * Create or edit the customer's review of a product.
 *
 * Server-enforced: customer role, a Delivered/Collected order containing the
 * product, rating 1..5, text length, at most 3 photos in total, each through
 * the shared photo pipeline. The review is snapshotted to the product's branch
 * and brand. Publishes immediately (no approval step).
 */
export async function saveReview(user: User, productId: number, input: ReviewInput) {
  if (user.role !== "customer") throw forbidden(sk("errors.reviews.customersOnly"));
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, branchId: true, brand: true } });
  if (!product) throw notFound(sk("errors.reviews.productNotFound"));

  const orderId = await eligibilityFor(user.id, productId);
  if (orderId == null) throw forbidden(sk("errors.reviews.notEligible"));

  const rating = parseRating(input.rating);
  if (rating == null) throw validationError({ rating: sk("errors.ops.ratingRange") });
  const comment = String(input.comment ?? "").trim();
  if (comment.length > REVIEW_COMMENT_MAX) {
    throw validationError({ comment: sk("validation.maxLength", { n: REVIEW_COMMENT_MAX }) });
  }

  const existing = await prisma.foodReview.findUnique({
    where: { customerId_productId: { customerId: user.id, productId } },
  });
  const current = parsePhotoKeys(existing?.photos);
  const keepIdx = input.keep == null ? current.map((_, i) => i) : input.keep;
  const kept = current.filter((_, i) => keepIdx.includes(i));
  const removed = current.filter((_, i) => !keepIdx.includes(i));
  const files = (input.photos ?? []).filter((f) => f && f.size > 0);
  if (kept.length + files.length > REVIEW_PHOTO_MAX) {
    throw validationError({ photos: sk("errors.reviews.tooManyPhotos", { max: REVIEW_PHOTO_MAX }) });
  }
  for (const file of files) {
    if (file.size > PHOTO_MAX_BYTES) throw validationError({ photos: sk("errors.orderChat.photoTooLarge", { mb: PHOTO_MAX_MB }) });
  }
  const added: string[] = [];
  try {
    for (const file of files) added.push(await saveUpload(file, REVIEW_PHOTO_SUBDIR, "photos"));
  } catch (error) {
    for (const key of added) await deleteUpload(key);
    throw error;
  }

  // The brand it was sold under on the order (a brand-less product sold by a
  // multi-brand branch), else the product's own brand.
  const line = await prisma.orderItem.findFirst({ where: { orderId, productId }, select: { brand: true } });
  const brand = line?.brand || product.brand || "";
  const data = {
    rating,
    comment,
    photos: JSON.stringify([...kept, ...added]),
    orderId,
    branchId: product.branchId,
    brand,
  };
  const review = existing
    ? await prisma.foodReview.update({ where: { id: existing.id }, data, include: { customer: AUTHOR_SELECT } })
    : await prisma.foodReview.create({
        data: { ...data, productId, customerId: user.id },
        include: { customer: AUTHOR_SELECT },
      });
  for (const key of removed) await deleteUpload(key);
  return { review: serializePublicReview(review), created: !existing };
}

// ── photos & avatar ───────────────────────────────────────────────────────

/** Visible to anyone while the review is shown; hidden ones only to staff and the author. */
async function reviewForMedia(viewer: User | null, reviewId: number) {
  const review = await prisma.foodReview.findUnique({
    where: { id: reviewId },
    include: { customer: { select: { profilePhoto: true } } },
  });
  if (!review) throw notFound();
  if (review.isHidden) {
    const staff = viewer && (canModerateReviews(viewer.role) || viewer.role === "branch_manager");
    const author = viewer && viewer.id === review.customerId;
    if (!staff && !author) throw notFound();
    if (viewer?.role === "branch_manager") {
      const branch = await branchForManager(viewer.id);
      if (branch?.id !== review.branchId) throw notFound();
    }
  }
  return review;
}

export async function reviewPhotoKey(viewer: User | null, reviewId: number, index: number): Promise<string> {
  const review = await reviewForMedia(viewer, reviewId);
  const key = parsePhotoKeys(review.photos)[index];
  if (!key) throw notFound();
  return key;
}

export async function reviewAvatarKey(viewer: User | null, reviewId: number): Promise<string> {
  const review = await reviewForMedia(viewer, reviewId);
  if (!review.customer.profilePhoto) throw notFound();
  return review.customer.profilePhoto;
}

// ── staff: listing, moderation, flagging ──────────────────────────────────

export interface ReviewFilters {
  branchId?: number;
  brand?: string;
  rating?: number;
  hidden?: "yes" | "no";
  flagged?: "yes" | "no";
  page?: number;
}

export const STAFF_PAGE_SIZE = 20;

export async function reviewsForStaff(user: User, filters: ReviewFilters) {
  const managerBranch = user.role === "branch_manager" ? await branchForManager(user.id) : null;
  const scope = reviewListScope(user.role, managerBranch?.id ?? null);
  if (scope.kind === "none") throw forbidden(sk("errors.reviews.forbidden"));

  const and: Prisma.FoodReviewWhereInput[] = [];
  if (scope.kind === "branch") and.push({ branchId: scope.branchId });
  else if (filters.branchId) and.push({ branchId: filters.branchId });
  if (filters.brand) and.push({ brand: filters.brand });
  if (filters.rating && filters.rating >= 1 && filters.rating <= 5) and.push({ rating: filters.rating });
  if (filters.hidden) and.push({ isHidden: filters.hidden === "yes" });
  if (filters.flagged) and.push({ flaggedAt: filters.flagged === "yes" ? { not: null } : null });
  const where: Prisma.FoodReviewWhereInput = { AND: and };

  const count = await prisma.foodReview.count({ where });
  const pages = Math.max(1, Math.ceil(count / STAFF_PAGE_SIZE));
  const page = Math.min(Math.max(1, filters.page ?? 1), pages);
  const rows = await prisma.foodReview.findMany({
    where,
    include: {
      customer: { select: { id: true, firstName: true, username: true, profilePhoto: true, updatedAt: true } },
      product: { select: { id: true, name: true, branch: { select: { id: true, name: true } } } },
    },
    orderBy: [{ flaggedAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * STAFF_PAGE_SIZE,
    take: STAFF_PAGE_SIZE,
  });
  return {
    count,
    page,
    pages,
    scope,
    results: rows.map((r) => ({
      ...serializePublicReview(r),
      customer_ref: `#${r.customer.id}`,
      product: { id: r.product.id, name: r.product.name },
      branch: { id: r.product.branch.id, name: r.product.branch.name },
      brand: r.brand,
      is_hidden: r.isHidden,
      hidden_reason: r.hiddenReason,
      hidden_at: r.hiddenAt?.toISOString() ?? null,
      flagged: r.flaggedAt != null,
      flag_reason: r.flagReason,
      flagged_at: r.flaggedAt?.toISOString() ?? null,
    })),
  };
}

function reasonOf(value: unknown): string {
  const reason = String(value ?? "").trim();
  if (reason.length > REVIEW_REASON_MAX) {
    throw validationError({ reason: sk("validation.maxLength", { n: REVIEW_REASON_MAX }) });
  }
  return reason;
}

async function loadForStaff(reviewId: number) {
  const review = await prisma.foodReview.findUnique({
    where: { id: reviewId },
    include: { product: { select: { name: true } } },
  });
  if (!review) throw notFound(sk("errors.reviews.notFound"));
  return review;
}

/** Hide (spam, abuse, irrelevant). Marketing / super admin only; logged. */
export async function hideReview(user: User, reviewId: number, reasonInput: unknown) {
  if (!canModerateReviews(user.role)) throw forbidden(sk("errors.reviews.forbidden"));
  const review = await loadForStaff(reviewId);
  const reason = reasonOf(reasonInput);
  const updated = await prisma.foodReview.update({
    where: { id: review.id },
    // Hiding settles any flag: marketing has looked at it.
    data: {
      isHidden: true,
      hiddenAt: new Date(),
      hiddenById: user.id,
      hiddenReason: reason,
      flaggedAt: null,
      flaggedById: null,
      flagReason: "",
      // Moderation is not an edit by the customer: keep their timestamp, so a
      // restored review is not shown as "edited" or bumped to the top.
      updatedAt: review.updatedAt,
    },
  });
  await logAdminAction(
    user.id,
    "action",
    `Hid review #${review.id} of "${review.product.name}" (${review.rating}★)${reason ? `. Reason: ${reason}` : ""}`,
    { branchId: review.branchId },
  );
  return updated;
}

/** Restore a hidden review. Marketing / super admin only; logged. */
export async function restoreReview(user: User, reviewId: number) {
  if (!canModerateReviews(user.role)) throw forbidden(sk("errors.reviews.forbidden"));
  const review = await loadForStaff(reviewId);
  const updated = await prisma.foodReview.update({
    where: { id: review.id },
    data: {
      isHidden: false,
      hiddenAt: null,
      hiddenById: null,
      hiddenReason: "",
      flaggedAt: null,
      flaggedById: null,
      flagReason: "",
      updatedAt: review.updatedAt,
    },
  });
  await logAdminAction(user.id, "action", `Restored review #${review.id} of "${review.product.name}" (${review.rating}★)`, {
    branchId: review.branchId,
  });
  return updated;
}

/**
 * A branch manager asks marketing to look at a review of their own branch's
 * product. It stays published; marketing decides. Marketing is notified.
 */
export async function flagReview(user: User, reviewId: number, reasonInput: unknown) {
  const review = await loadForStaff(reviewId);
  const branch = user.role === "branch_manager" ? await branchForManager(user.id) : null;
  if (!canFlagReview(user.role, branch?.id ?? null, review.branchId)) throw forbidden(sk("errors.reviews.flagForbidden"));
  const reason = reasonOf(reasonInput);
  const updated = await prisma.foodReview.update({
    where: { id: review.id },
    data: { flaggedAt: new Date(), flaggedById: user.id, flagReason: reason, updatedAt: review.updatedAt },
  });
  await logAdminAction(
    user.id,
    "action",
    `Flagged review #${review.id} of "${review.product.name}" for marketing${reason ? `. Reason: ${reason}` : ""}`,
    { branchId: review.branchId },
  );
  await notifyRole("marketing", {
    type: "review",
    titleKey: "notifications.review.flagged.title",
    bodyKey: "notifications.review.flagged.body",
    params: { product: review.product.name, branch: branch?.name ?? "" },
    link: "/marketing/reviews?flagged=yes",
  });
  return updated;
}

// ── invitation ────────────────────────────────────────────────────────────

/** "Rate your items" once an order is Delivered / Collected. */
export async function inviteToReview(order: { id: number; customerId: number }) {
  await createNotification(order.customerId, {
    type: "review",
    titleKey: "notifications.review.invite.title",
    bodyKey: "notifications.review.invite.body",
    params: { id: order.id },
    link: `/customer/orders/${order.id}#rate-items`,
  });
}
