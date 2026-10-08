"use client";

import { useCallback, useEffect, useState } from "react";

import { Stars } from "@/components/reviews/stars";
import { useTranslation } from "@/lib/i18n/use-translation";

export interface PublicReview {
  id: number;
  rating: number;
  comment: string;
  photos: { url: string; thumb: string }[];
  author: { first_name: string; avatar_url: string | null };
  created_at: string;
  updated_at: string;
  edited: boolean;
}

interface ReviewsPayload {
  summary: { average: number; count: number; breakdown: Record<string, number> };
  results: PublicReview[];
  has_more: boolean;
  page: number;
}

const FIRST_PAGE = 3;
const MORE_PAGE = 10;

/**
 * The product modal's reviews: average, a 5→1 breakdown, the latest few
 * reviews and "See all reviews". Full width under the photo and details, on
 * the storefront's dark modal palette. Public data only: first name, avatar,
 * stars, text, photos, date.
 */
export function ProductReviewsSection({ productId }: { productId: string }) {
  const { t, fmt } = useTranslation();
  const [data, setData] = useState<ReviewsPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [extra, setExtra] = useState<PublicReview[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/products/${productId}/reviews?page_size=${FIRST_PAGE}`)
      .then((r) => (r.ok ? (r.json() as Promise<ReviewsPayload>) : Promise.reject()))
      .then((payload) => {
        if (alive) setData(payload);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [productId]);

  // "See all": page through in bigger pages, skipping the three already shown.
  const loadMore = useCallback(async () => {
    if (!data) return;
    setLoadingMore(true);
    try {
      const shown = FIRST_PAGE + extra.length;
      const page = nextPage ?? Math.floor(shown / MORE_PAGE) + 1;
      const res = await fetch(`/api/products/${productId}/reviews?page=${page}&page_size=${MORE_PAGE}`);
      if (!res.ok) return;
      const payload = (await res.json()) as ReviewsPayload;
      const seen = new Set([...data.results, ...extra].map((r) => r.id));
      setExtra((prev) => [...prev, ...payload.results.filter((r) => !seen.has(r.id))]);
      setNextPage(payload.has_more ? page + 1 : -1);
    } finally {
      setLoadingMore(false);
    }
  }, [data, extra, nextPage, productId]);

  if (failed) return null;
  if (!data) {
    return (
      <section className="border-t border-white/8 px-4.5 py-5 sm:px-6" aria-busy="true">
        <div className="h-5 w-32 animate-pulse rounded bg-white/10" />
      </section>
    );
  }

  const { summary } = data;
  const reviews = [...data.results, ...extra];
  const moreAvailable = summary.count > reviews.length && nextPage !== -1;

  return (
    <section className="border-t border-white/8 px-4.5 py-5 sm:px-6" data-testid="product-reviews" aria-labelledby={`reviews-${productId}`}>
      <h3 id={`reviews-${productId}`} className="mb-3 text-[0.68rem] font-bold uppercase tracking-widest text-[#606070]">
        {t("reviews.sectionTitle")}
      </h3>

      {summary.count === 0 ? (
        <p className="text-[0.82rem] text-[#a0a0b0]" data-testid="product-reviews-empty">
          {t("reviews.noneYet")}
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
            <div className="flex items-center gap-3 sm:flex-col sm:items-start sm:gap-1">
              <p className="font-display text-[2.4rem] font-black leading-none text-white" data-testid="product-reviews-average">
                {fmt.num(summary.average.toFixed(1))}
              </p>
              <div>
                <Stars value={summary.average} size="text-base" />
                <p className="mt-0.5 text-[0.72rem] text-[#a0a0b0]">
                  {summary.count === 1 ? t("reviews.basedOnOne") : t("reviews.basedOn", { n: fmt.num(summary.count) })}
                </p>
              </div>
            </div>
            <ul className="flex-1 space-y-1" aria-label={t("reviews.breakdown")}>
              {[5, 4, 3, 2, 1].map((star) => {
                const n = summary.breakdown[String(star)] ?? 0;
                const pct = summary.count ? Math.round((n / summary.count) * 100) : 0;
                return (
                  <li key={star} className="flex items-center gap-2 text-[0.72rem] text-[#a0a0b0]">
                    <span className="w-6 shrink-0 tabular-nums">{fmt.num(star)}★</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                      <span className="block h-full rounded-full bg-[#F5A623]" style={{ width: `${pct}%` }} />
                    </span>
                    <span className="w-8 shrink-0 text-right tabular-nums">{fmt.num(n)}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          <ul className="mt-5 divide-y divide-white/8" data-testid="product-reviews-list">
            {reviews.map((review) => (
              <li key={review.id} className="py-4 first:pt-0" data-testid={`product-review-${review.id}`}>
                <div className="flex items-center gap-3">
                  {review.author.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a private, access-checked route; not optimizable
                    <img
                      src={review.author.avatar_url}
                      alt=""
                      className="size-9 shrink-0 rounded-full object-cover ring-1 ring-white/10"
                      loading="lazy"
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-bold uppercase text-white"
                    >
                      {review.author.first_name.slice(0, 1) || "?"}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.85rem] font-semibold text-white">{review.author.first_name}</p>
                    <div className="flex flex-wrap items-center gap-x-2 text-[0.7rem] text-[#a0a0b0]">
                      <Stars value={review.rating} size="text-[0.8rem]" />
                      <span className="sr-only">{t("reviews.starsOf", { n: review.rating })}</span>
                      <span>{fmt.date(review.updated_at)}</span>
                      {review.edited ? <span>· {t("reviews.edited")}</span> : null}
                    </div>
                  </div>
                </div>
                {review.comment ? (
                  <p className="mt-2 whitespace-pre-line text-[0.82rem] leading-6 text-[#d0d0d8]">{review.comment}</p>
                ) : null}
                {review.photos.length > 0 ? (
                  <div className="mt-2 flex gap-2">
                    {review.photos.map((photo, i) => (
                      <button
                        key={photo.url}
                        type="button"
                        onClick={() => setLightbox(photo.url)}
                        className="size-16 overflow-hidden rounded-lg ring-1 ring-white/10 focus-visible:outline-2 focus-visible:outline-[#F5A623] sm:size-20"
                        aria-label={t("reviews.openPhoto", { n: i + 1 })}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- access-checked route */}
                        <img src={photo.thumb} alt="" className="size-full object-cover" loading="lazy" />
                      </button>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>

          {moreAvailable ? (
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="mt-2 w-full rounded-[10px] border border-white/10 bg-surface-dark px-4 py-2.5 text-[0.8rem] font-semibold text-white hover:bg-[#23232e] disabled:opacity-60"
              data-testid="product-reviews-more"
            >
              {loadingMore
                ? t("common.loading")
                : extra.length === 0
                  ? t("reviews.seeAll", { n: fmt.num(summary.count) })
                  : t("reviews.showMore")}
            </button>
          ) : null}
        </>
      )}

      {lightbox ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={t("reviews.photo")}
          onClick={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- access-checked route */}
          <img src={lightbox} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
          <button
            type="button"
            onClick={() => setLightbox(null)}
            className="absolute right-4 top-4 flex size-10 items-center justify-center rounded-full bg-white/10 text-white"
            aria-label={t("home.modal.close")}
          >
            ✕
          </button>
        </div>
      ) : null}
    </section>
  );
}
