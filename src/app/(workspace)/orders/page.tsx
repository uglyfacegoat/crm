import type { Metadata } from "next";
import { CreateOrderButton } from "@/components/orders/create-order-dialog";
import { OrdersTable } from "@/components/orders/orders-table";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthMode } from "@/server/auth/config";
import { requireSession } from "@/server/auth/session";
import { listOrderCreationOptions, listOrders } from "@/server/orders/repository";
import { getPreviewOrderCreationOptions, getPreviewOrders } from "@/server/orders/preview";

export const metadata: Metadata = { title: "Заказы" };

export default async function OrdersPage() {
  const member = await requireSession();
  const [orders, creationOptions] = getAuthMode() === "preview"
    ? [getPreviewOrders(), getPreviewOrderCreationOptions()]
    : await Promise.all([listOrders(member), listOrderCreationOptions(member)]);
  return (
    <div>
      <PageHeading
        eyebrow="Операционная работа"
        title="Заказы"
        description="Все обращения, работы и назначения в одном потоке."
        action={<CreateOrderButton options={creationOptions} />}
      />
      <div className="mt-[clamp(1.5rem,1.1rem+0.8vw,2.25rem)]"><OrdersTable orders={orders} /></div>
    </div>
  );
}
