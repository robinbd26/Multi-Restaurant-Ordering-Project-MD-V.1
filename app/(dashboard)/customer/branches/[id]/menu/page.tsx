import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { MenuProductCard } from "@/components/catalog/menu-product-card";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button";
import { ApiError, getJSON } from "@/lib/api/client";
import { requireRole } from "@/lib/auth/session";
import { browsesWithoutLocation, resolveCustomerBranch } from "@/lib/services/customer-branch";
import { getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import type { Branch, Category, Paginated, Product } from "@/types";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("customer.menuTitle") };
}

export default async function BranchMenuPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cat?: string; search?: string }>;
}) {
  const me = await requireRole("customer");
  const { t, fmt } = await getT();
  const { id } = await params;
  const { cat, search } = await searchParams;

  // A customer may browse any branch that covers their trusted location
  // (Foodpanda model). WS-8.14 — with NO usable location at all, browsing is
  // open like the public homepage (any active branch's menu), and the location
  // gate below is an invitation rather than a wall; coverage is still enforced
  // server-side at checkout. An out-of-zone or wrong-branch request keeps the
  // existing 404, because there the scoping is the truth, not a missing fix.
  const branchIdNum = Number(id);
  const context = await resolveCustomerBranch(me.id, branchIdNum);
  const browsing = browsesWithoutLocation(context);
  if (!browsing && context.branchId !== branchIdNum) notFound();

  let branch: Branch;
  try {
    branch = await getJSON<Branch>(`/branches/${id}/`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  const productQuery = new URLSearchParams({ branch: id, page_size: "100" });
  if (cat) productQuery.set("category", cat);
  if (search) productQuery.set("search", search);

  const [categories, products] = await Promise.all([
    getJSON<Paginated<Category>>(`/categories/?branch=${id}&page_size=100`),
    getJSON<Paginated<Product>>(`/products/?${productQuery.toString()}`),
  ]);

  const chip = (active: boolean) =>
    cn(
      "rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
      active ? "bg-brand-500 text-white" : "bg-surface-card text-fg-muted ring-1 ring-slate-200 hover:bg-surface-hover",
    );

  return (
    <>
      <PageHeader
        title={branch.name}
        subtitle={`📍 ${branch.address}`}
        breadcrumbs={[
          { label: t("customer.restaurantsTitle"), href: "/customer/branches" },
          { label: branch.name },
        ]}
        action={
          <Link href="/customer/cart" className="text-sm font-medium text-brand-600 hover:underline">
            {t("customer.viewCart")}
          </Link>
        }
      />

      {/* WS-8.14 — browsing without a location: say so, and invite the fix.
          The full location card + map picker live on the branches/addresses
          pages; this strip mirrors the explainer there. */}
      {browsing ? (
        <div
          className="mb-4 rounded-xl bg-brand-50 px-4 py-2.5 text-sm text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
          data-testid="menu-browse-no-location"
        >
          {t("customer.browseNoLocation")}
          <span className="ml-2 inline-block">
            <ButtonLink href="/customer/addresses" size="sm" variant="outline">
              {t("nearestBranch.setLocation")}
            </ButtonLink>
          </span>
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
        <Link href={`/customer/branches/${id}/menu`} className={chip(!cat)}>
          {t("customer.allWithCount", { count: fmt.num(products.count) })}
        </Link>
        {categories.results.map((category) => (
          <Link
            key={category.id}
            href={`/customer/branches/${id}/menu?cat=${category.id}`}
            className={chip(cat === String(category.id))}
          >
            {category.name}
          </Link>
        ))}
      </div>

      <form className="mb-5" action={`/customer/branches/${id}/menu`} method="get" noValidate>
        {cat ? <input type="hidden" name="cat" value={cat} /> : null}
        <input
          name="search"
          defaultValue={search}
          placeholder={t("customer.searchFood")}
          className="w-full max-w-md rounded-xl border border-border-strong bg-surface-card px-4 py-2.5 text-sm placeholder:text-fg-subtle focus:border-brand-500 focus:outline-2 focus:outline-brand-500/20"
        />
      </form>

      {products.results.length === 0 ? (
        <EmptyState title={t("customer.noFoodFound")} description={t("customer.noFoodFoundDesc")} />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {products.results.map((product) => (
            <MenuProductCard
              key={product.id}
              product={product}
              branchId={branch.id}
              branchName={branch.name}
            />
          ))}
        </div>
      )}
    </>
  );
}
