import type { CatalogItem } from "@/server/catalog/repository";

export type ServiceChoiceItem = Pick<CatalogItem, "id" | "kind" | "name" | "unit" | "priceMode" | "defaultPriceMinor">;

export function isAreaUnit(unit: string) {
  return ["м²", "м2", "m²", "m2", "квм"].includes(unit.toLowerCase().replace(/[.\s]/g, ""));
}

export function resolveServiceChoice(item: ServiceChoiceItem, areaSquareMeters?: string | null) {
  const area = areaSquareMeters?.trim().replaceAll(" ", "").replace(",", ".");
  return {
    catalogItemId: item.id,
    name: item.name,
    quantity: isAreaUnit(item.unit) ? (area && Number(area) > 0 ? area : "") : "1",
    unitPrice: item.defaultPriceMinor === null ? "" : (item.defaultPriceMinor / 100).toFixed(2),
    priceSource: item.defaultPriceMinor === null ? "pending" as const : "catalog" as const,
  };
}
