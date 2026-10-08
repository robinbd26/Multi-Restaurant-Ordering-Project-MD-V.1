import { PageHeader } from "@/components/layout/page-header";
import { ReviewModerationActions } from "@/components/reviews/review-moderation-actions";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/input";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { canModerateReviews } from "@/lib/reviews/policy";
import { reviewsForStaff, type ReviewFilters } from "@/lib/services/product-reviews";

type Search = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** Read the filter query string (unknown values are ignored, never trusted). */
export function parseReviewFilters(search: Search): ReviewFilters {
  const branch = Number(one(search.branch));
  const rating = Number(one(search.rating));
  const hidden = one(search.hidden);
  const flagged = one(search.flagged);
  const page = Number(one(search.page));
  return {
    branchId: Number.isSafeInteger(branch) && branch > 0 ? branch : undefined,
    brand: one(search.brand) || undefined,
    rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : undefined,
    hidden: hidden === "yes" || hidden === "no" ? hidden : undefined,
    flagged: flagged === "yes" || flagged === "no" ? flagged : undefined,
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  };
}

/**
 * The reviews management screen, shared by marketing, the super admin and the
 * branch manager. What each sees and may do comes from the server:
 *   - marketing / super admin: every branch, filters for branch, brand,
 *     rating, hidden and flagged, and Hide / Restore;
 *   - branch manager: own branch only (no branch filter), Flag for marketing.
 */
export async function ReviewsAdminPage({ user, search, basePath }: { user: User; search: Search; basePath: string }) {
  const { t, fmt } = await getT();
  const filters = parseReviewFilters(search);
  const moderator = canModerateReviews(user.role);
  const [data, branches, brands] = await Promise.all([
    reviewsForStaff(user, filters),
    moderator
      ? prisma.branch.findMany({ where: { isArchived: false }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
    prisma.brand.findMany({ where: { isArchived: false }, select: { slug: true, name: true }, orderBy: { sortOrder: "asc" } }),
  ]);

  const query = (patch: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    const merged = { ...filters, branch: filters.branchId, ...patch } as Record<string, unknown>;
    for (const key of ["branch", "brand", "rating", "hidden", "flagged", "page"]) {
      const v = merged[key];
      if (v !== undefined && v !== "" && !(key === "page" && v === 1)) params.set(key, String(v));
    }
    const s = params.toString();
    return s ? `${basePath}?${s}` : basePath;
  };

  return (
    <>
      <PageHeader
        title={t("reviews.adminTitle")}
        subtitle={moderator ? t("reviews.adminSubModerator") : t("reviews.adminSubManager")}
      />

      <Card className="mb-5">
        <CardContent className="pt-4">
          <form method="get" action={basePath} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6" data-testid="review-filters">
            {moderator ? (
              <Select name="branch" defaultValue={filters.branchId ? String(filters.branchId) : ""} aria-label={t("reviews.filterBranch")}>
                <option value="">{t("reviews.allBranches")}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            ) : null}
            <Select name="brand" defaultValue={filters.brand ?? ""} aria-label={t("reviews.filterBrand")}>
              <option value="">{t("reviews.allBrands")}</option>
              {brands.map((b) => (
                <option key={b.slug} value={b.slug}>
                  {b.name}
                </option>
              ))}
            </Select>
            <Select name="rating" defaultValue={filters.rating ? String(filters.rating) : ""} aria-label={t("reviews.filterRating")}>
              <option value="">{t("reviews.allRatings")}</option>
              {[5, 4, 3, 2, 1].map((r) => (
                <option key={r} value={r}>
                  {t("reviews.nStars", { n: r })}
                </option>
              ))}
            </Select>
            <Select name="hidden" defaultValue={filters.hidden ?? ""} aria-label={t("reviews.filterHidden")}>
              <option value="">{t("reviews.visibleAndHidden")}</option>
              <option value="no">{t("reviews.visibleOnly")}</option>
              <option value="yes">{t("reviews.hiddenOnly")}</option>
            </Select>
            <Select name="flagged" defaultValue={filters.flagged ?? ""} aria-label={t("reviews.filterFlagged")}>
              <option value="">{t("reviews.flaggedAny")}</option>
              <option value="yes">{t("reviews.flaggedOnly")}</option>
              <option value="no">{t("reviews.notFlagged")}</option>
            </Select>
            <div className="flex gap-2">
              <Button type="submit" className="flex-1">
                {t("reviews.applyFilters")}
              </Button>
              <ButtonLink href={basePath} variant="outline">
                {t("reviews.clear")}
              </ButtonLink>
            </div>
          </form>
        </CardContent>
      </Card>

      <p className="mb-3 text-sm text-fg-muted" data-testid="review-count">
        {data.count === 1 ? t("reviews.countOne") : t("reviews.countN", { n: fmt.num(data.count) })}
      </p>

      {data.results.length === 0 ? (
        <Card>
          <EmptyState title={t("reviews.adminEmpty")} description={t("reviews.adminEmptyDesc")} />
        </Card>
      ) : (
        <ul className="space-y-3" data-testid="review-admin-list">
          {data.results.map((r) => (
            <li key={r.id}>
              <Card testId={`review-row-${r.id}`} className={r.is_hidden ? "opacity-75" : undefined}>
                <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-fg-base">{r.product.name}</span>
                      <span className="text-amber-500">
                        {"★".repeat(r.rating)}
                        <span className="text-slate-300 dark:text-white/20">{"★".repeat(5 - r.rating)}</span>
                      </span>
                      {r.is_hidden ? <Badge tone="slate">{t("reviews.hiddenBadge")}</Badge> : null}
                      {r.flagged ? <Badge tone="amber">{t("reviews.flaggedBadge")}</Badge> : null}
                    </div>
                    <p className="text-xs text-fg-subtle">
                      {r.branch.name}
                      {r.brand ? ` · ${brands.find((b) => b.slug === r.brand)?.name ?? r.brand}` : ""} · {r.author.first_name} ({r.customer_ref}) ·{" "}
                      {fmt.dateTime(r.updated_at)}
                    </p>
                    {r.comment ? <p className="whitespace-pre-line text-sm text-fg-base">{r.comment}</p> : null}
                    {r.photos.length > 0 ? (
                      <div className="flex gap-2 pt-1">
                        {r.photos.map((p, i) => (
                          <a key={p.url} href={p.url} target="_blank" rel="noreferrer" aria-label={t("reviews.openPhoto", { n: i + 1 })}>
                            {/* eslint-disable-next-line @next/next/no-img-element -- access-checked route */}
                            <img src={p.thumb} alt="" className="size-14 rounded-lg object-cover ring-1 ring-border-base" />
                          </a>
                        ))}
                      </div>
                    ) : null}
                    {r.flagged && r.flag_reason ? (
                      <p className="text-xs text-amber-700 dark:text-amber-300">
                        {t("reviews.flagReasonShown", { reason: r.flag_reason })}
                      </p>
                    ) : null}
                    {r.is_hidden && r.hidden_reason ? (
                      <p className="text-xs text-fg-muted">{t("reviews.hiddenReasonShown", { reason: r.hidden_reason })}</p>
                    ) : null}
                  </div>
                  <div className="shrink-0">
                    <ReviewModerationActions reviewId={r.id} mode={moderator ? "moderate" : "flag"} isHidden={r.is_hidden} flagged={r.flagged} />
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {data.pages > 1 ? (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label={t("reviews.pagination")}>
          {data.page > 1 ? (
            <ButtonLink href={query({ page: data.page - 1 })} variant="outline" size="sm">
              {t("deliveryArea.previous")}
            </ButtonLink>
          ) : (
            <span />
          )}
          <span className="text-fg-muted">{t("reviews.pageOf", { page: fmt.num(data.page), pages: fmt.num(data.pages) })}</span>
          {data.page < data.pages ? (
            <ButtonLink href={query({ page: data.page + 1 })} variant="outline" size="sm">
              {t("deliveryArea.next")}
            </ButtonLink>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </>
  );
}
