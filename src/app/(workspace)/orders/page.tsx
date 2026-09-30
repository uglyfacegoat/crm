import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth/page-access";
import { OrdersTable } from "@/components/orders/orders-table";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import { listOrders } from "@/server/orders/repository";
import { getPreviewOrders } from "@/server/orders/preview";
import { listAccessibleOrganizations } from "@/server/organizations/repository";
import { listCenterOrders } from "@/server/organizations/center-dashboard";

export const metadata: Metadata = { title: "Заказы" };

export default async function OrdersPage() {
  const member = await requireOfficeSession();
  requirePagePermission(member, "orders.read");
  const preview = getAuthMode() === "preview";
  const isCenter = !preview && hasPermission(member, "companies.read") &&
    (await listAccessibleOrganizations(member)).some((organization) => organization.current && organization.kind === "center");
  const orders = preview ? getPreviewOrders() : isCenter ? await listCenterOrders(member) : await listOrders(member);
  return (
    <div>
      <PageHeading
        eyebrow="Операционная работа"
        title="Заказы"
        description="Все обращения, работы и назначения в одном потоке."
      />
      <div className="mt-[clamp(1.5rem,1.1rem+0.8vw,2.25rem)]"><OrdersTable orders={orders} /></div>
    </div>
  );
}
