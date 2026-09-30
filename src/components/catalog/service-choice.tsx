"use client";

import { useEffect, useState } from "react";
import { OrderPicker } from "@/components/orders/order-form-parts";
import type { CatalogItem } from "@/server/catalog/repository";
import type { ObjectServiceProfile } from "@/server/catalog/object-service-profiles";

export type ServiceChoiceItem = Pick<CatalogItem, "id" | "kind" | "name" | "unit" | "priceMode" | "defaultPriceMinor">;

export function resolveServiceChoice(item: ServiceChoiceItem, profile?: ObjectServiceProfile | null) {
  const rate = profile?.rates.find((entry) => entry.lineKind === "contract" && entry.catalogItemId === item.id);
  const area = profile?.areaSquareMeters ?? profile?.objectAreaSquareMeters;
  const quantity = rate?.billingBasis === "area" ? area || "" : rate?.billingBasis === "quantity" ? rate.quantity || "1" : "1";
  const priceMinor = rate?.unitPriceMinor ?? item.defaultPriceMinor;
  return {
    catalogItemId: item.id,
    name: rate?.name ?? item.name,
    quantity,
    unitPrice: priceMinor === null || priceMinor === undefined ? "" : (priceMinor / 100).toFixed(2),
    priceSource: rate?.unitPriceMinor !== null && rate?.unitPriceMinor !== undefined ? "contract" as const : item.defaultPriceMinor !== null ? "catalog" as const : "pending" as const,
    billingBasis: rate?.billingBasis ?? null,
  };
}

export function ServiceChoice({
  label = "Из перечня товаров и услуг",
  value,
  items,
  profile,
  organizationId,
  onChange,
  disabled,
}: {
  label?: string;
  value: string;
  items: ServiceChoiceItem[];
  profile?: ObjectServiceProfile | null;
  organizationId?: string;
  onChange: (id: string, item: ServiceChoiceItem | null) => void;
  disabled?: boolean;
}) {
  const [resolved, setResolved] = useState<{ value: string; item: ServiceChoiceItem } | null>(null);
  const objectId = profile?.objectId;
  useEffect(() => {
    if (!value || items.some((item) => item.id === value) || resolved?.value === value) return;
    const controller = new AbortController();
    const url = new URL("/api/v1/services/options", window.location.origin);
    url.searchParams.set("id", value);
    if (objectId) url.searchParams.set("objectId", objectId);
    if (organizationId) url.searchParams.set("organizationId", organizationId);
    void fetch(url, { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        const item = payload?.data?.items?.[0]?.catalogItem as ServiceChoiceItem | undefined;
        if (!controller.signal.aborted && item?.id === value) setResolved({ value, item });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [items, objectId, organizationId, resolved?.value, value]);
  const visibleItems = resolved?.value === value && !items.some((item) => item.id === value)
    ? [resolved.item, ...items]
    : items;
  return <OrderPicker
    label={label}
    value={value}
    options={[
      { value: "", label: "Своя позиция" },
      ...visibleItems.map((item) => {
        const choice = resolveServiceChoice(item, profile);
        return {
          value: item.id,
          label: choice.name,
          detail: `${choice.name !== item.name ? `Каталог: ${item.name} · ` : ""}${item.kind === "product" ? "Товар" : "Услуга"} · ${choice.priceSource === "pending" ? "цена уточняется" : `${choice.unitPrice} ₽/${choice.billingBasis === "area" ? "м²" : item.unit}`}${choice.priceSource === "contract" ? " · по договору" : ""}`,
          catalogItem: item,
        };
      }),
    ]}
    onChange={(id, option) => onChange(id, option?.catalogItem ?? visibleItems.find((item) => item.id === id) ?? null)}
    placeholder="Выберите или найдите услугу"
    searchPlaceholder="Название услуги или товара"
    searchable
    remoteUrl={`/api/v1/services/options${profile?.objectId || organizationId ? `?${new URLSearchParams({ ...(profile?.objectId ? { objectId: profile.objectId } : {}), ...(organizationId ? { organizationId } : {}) })}` : ""}`}
    disabled={disabled}
  />;
}
