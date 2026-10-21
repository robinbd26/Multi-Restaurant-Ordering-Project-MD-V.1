import type { OrderItem } from "@/types";

/**
 * The size/crust an order line was sold as, from its own snapshot: "14 inch –
 * Thick Crust", or for a line written before sizes named their crust, "12 inch
 * · Thin". Empty for a product with no sizes.
 */
export function orderLineVariant(item: Pick<OrderItem, "variation_name" | "variation_type">, t: (key: string) => string): string {
  const name = item.variation_name ?? "";
  const crust = item.variation_type === "THICK" || item.variation_type === "THIN" ? item.variation_type : "";
  const crustLabel = crust && !/thick|thin/i.test(name) ? t(`variationType.${crust}`) : "";
  return [name, crustLabel].filter(Boolean).join(" · ");
}
