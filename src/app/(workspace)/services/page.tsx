import type { Metadata } from "next";
import { ServicesWorkspace } from "@/components/catalog/services-workspace";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthMode } from "@/server/auth/config";
import { requirePagePermission } from "@/server/auth/page-access";
import { requireOfficeSession } from "@/server/auth/session";
import { listCatalogItems, listCatalogUnits, searchCatalogInventory } from "@/server/catalog/repository";
import { searchObjectServiceProfiles } from "@/server/catalog/object-service-profiles";
import { listReadableCatalogScopes } from "@/server/catalog/scopes";
import { hasPermission } from "@/server/auth/permissions";

export const metadata: Metadata = { title: "Услуги" };

export default async function ServicesPage() {
  const member = await requireOfficeSession();
  requirePagePermission(member, "orders.read");
  const preview = getAuthMode() === "preview";
  const readable = preview ? [member] : await listReadableCatalogScopes(member);
  const [items, profiles, units, inventory] = preview ? [[], { items: [], hasMore: false, configuredCount: 0 }, [], { items: [], hasMore: false, activeServiceCount: 0 }] : await Promise.all([
    Promise.all(readable.map(async (scope) => (await listCatalogItems(scope, 20)).map((item) =>
      ({ ...item, organizationId: scope.organizationId, organizationName: scope.organizationName })))).then((pages) => pages.flat()),
    searchObjectServiceProfiles(readable, { q: "", page: 0 }),
    Promise.all(readable.map(async (scope) => (await listCatalogUnits(scope)).map((unit) =>
      ({ ...unit, organizationId: scope.organizationId, organizationName: scope.organizationName })))).then((pages) => pages.flat()),
    searchCatalogInventory(readable, { q: "", filter: "service", page: 0 }),
  ]);
  const destinations = readable.filter((scope) => hasPermission(scope, "orders.write"))
    .map((scope) => ({ id: scope.organizationId, name: scope.organizationName }));
  return <div>
    <PageHeading eyebrow="Заказы / справочник" title="Услуги" description="Общая база услуг и условия по каждому объекту. Названия выбираются при оформлении заказа, а площадь, цены и обслуживание хранятся в карточке объекта." />
    <ServicesWorkspace items={items} initialInventory={inventory} units={units} profiles={profiles} destinations={destinations} currentOrganizationId={member.organizationId} canWrite={!preview && destinations.length > 0} showOrganizations={readable.length > 1} remoteEnabled={!preview} />
  </div>;
}
