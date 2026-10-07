import { BrandPills } from "@/components/brands/brand-pills";
import { brandsForRequest } from "@/lib/services/brands";

/** Server wrapper around BrandPills that loads the brand list itself. */
export async function BrandBadges({
  slugs,
  emptyLabel,
  className,
}: {
  slugs: readonly string[];
  emptyLabel?: string;
  className?: string;
}) {
  const brands = await brandsForRequest();
  return <BrandPills slugs={slugs} brands={brands} emptyLabel={emptyLabel} className={className} />;
}
