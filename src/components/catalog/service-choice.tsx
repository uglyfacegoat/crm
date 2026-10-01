"use client";

import { useEffect, useState } from "react";
import { OrderPicker } from "@/components/orders/order-form-parts";
import { resolveServiceChoice, type ServiceChoiceItem } from "@/lib/service-choice";
export { resolveServiceChoice } from "@/lib/service-choice";
export type { ServiceChoiceItem } from "@/lib/service-choice";

export function ServiceChoice({
  label = "Из перечня товаров и услуг",
  value,
  items,
  organizationId,
  onChange,
  disabled,
  allowCustom = true,
}: {
  label?: string;
  value: string;
  items: ServiceChoiceItem[];
  organizationId?: string;
  onChange: (id: string, item: ServiceChoiceItem | null) => void;
  disabled?: boolean;
  allowCustom?: boolean;
}) {
  const [resolved, setResolved] = useState<{ value: string; item: ServiceChoiceItem } | null>(null);
  useEffect(() => {
    if (!value || items.some((item) => item.id === value) || resolved?.value === value) return;
    const controller = new AbortController();
    const url = new URL("/api/v1/services/options", window.location.origin);
    url.searchParams.set("id", value);
    if (organizationId) url.searchParams.set("organizationId", organizationId);
    void fetch(url, { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        const item = payload?.data?.items?.[0]?.catalogItem as ServiceChoiceItem | undefined;
        if (!controller.signal.aborted && item?.id === value) setResolved({ value, item });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [items, organizationId, resolved?.value, value]);
  const visibleItems = resolved?.value === value && !items.some((item) => item.id === value)
    ? [resolved.item, ...items]
    : items;
  return <OrderPicker
    label={label}
    value={value}
    options={[
      ...(allowCustom ? [{ value: "", label: "Своя позиция" }] : []),
      ...visibleItems.map((item) => {
        const choice = resolveServiceChoice(item);
        return {
          value: item.id,
          label: choice.name,
          detail: `${choice.name !== item.name ? `Каталог: ${item.name} · ` : ""}${item.kind === "product" ? "Товар" : "Услуга"} · ${choice.priceSource === "pending" ? "цена уточняется" : `${choice.unitPrice} ₽/${item.unit}`}`,
          catalogItem: item,
        };
      }),
    ]}
    onChange={(id, option) => onChange(id, option?.catalogItem ?? visibleItems.find((item) => item.id === id) ?? null)}
    placeholder="Выберите или найдите услугу"
    searchPlaceholder="Название услуги или товара"
    searchable
    remoteUrl={`/api/v1/services/options${organizationId ? `?${new URLSearchParams({ organizationId })}` : ""}`}
    disabled={disabled}
  />;
}
