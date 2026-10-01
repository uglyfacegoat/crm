"use client";

import { useState } from "react";
import { CatalogWorkspace } from "./catalog-workspace";
import { ObjectServiceWorkspace } from "./object-service-workspace";
import type { CatalogItem, CatalogUnit, ScopedCatalogItem } from "@/server/catalog/repository";
import type { ScopedObjectServiceProfile } from "@/server/catalog/object-service-profiles";

type Item = CatalogItem & { organizationId: string; organizationName: string };
type Unit = CatalogUnit & { organizationId: string; organizationName: string };

export function ServicesWorkspace({ items, initialInventory, units, profiles, destinations, currentOrganizationId, canWrite, showOrganizations, remoteEnabled }: {
  items: Item[]; initialInventory: { items: ScopedCatalogItem[]; hasMore: boolean; activeServiceCount: number }; units: Unit[]; profiles: { items: ScopedObjectServiceProfile[]; hasMore: boolean; configuredCount: number }; destinations: Array<{ id: string; name: string }>; currentOrganizationId: string; canWrite: boolean; showOrganizations: boolean; remoteEnabled: boolean;
}) {
  const [tab, setTab] = useState<"catalog" | "objects">("catalog");
  const activeServices = initialInventory.activeServiceCount;
  const configuredObjects = profiles.configuredCount;
  return <div className="mt-6">
    <div role="tablist" aria-label="Разделы услуг" className="grid gap-2 sm:grid-cols-2">
      <button type="button" role="tab" aria-selected={tab === "catalog"} onClick={() => setTab("catalog")}
        className={`min-h-16 rounded-2xl border p-4 text-left ${tab === "catalog" ? "border-black bg-black text-white" : "border-[var(--line)] bg-white"}`}>
        <span className="block text-sm font-semibold">Справочник услуг</span><span className={`mt-1 block text-xs ${tab === "catalog" ? "text-white/70" : "text-[var(--muted)]"}`}>{activeServices} активных · доступны при оформлении заказа</span>
      </button>
      <button type="button" role="tab" aria-selected={tab === "objects"} onClick={() => setTab("objects")}
        className={`min-h-16 rounded-2xl border p-4 text-left ${tab === "objects" ? "border-black bg-black text-white" : "border-[var(--line)] bg-white"}`}>
        <span className="block text-sm font-semibold">Условия по объектам</span><span className={`mt-1 block text-xs ${tab === "objects" ? "text-white/70" : "text-[var(--muted)]"}`}>{configuredObjects} заполнено · площадь, цены и график</span>
      </button>
    </div>
    {tab === "catalog" ? <CatalogWorkspace currentOrganizationId={currentOrganizationId} initialInventory={initialInventory} units={units} destinations={destinations} canWrite={canWrite} showOrganizations={showOrganizations} remoteEnabled={remoteEnabled} />
      : <ObjectServiceWorkspace initialProfiles={profiles} catalog={items.filter((item) => item.kind === "service" && item.active)} destinations={destinations} currentOrganizationId={currentOrganizationId} canWrite={canWrite} remoteEnabled={remoteEnabled} />}
  </div>;
}
