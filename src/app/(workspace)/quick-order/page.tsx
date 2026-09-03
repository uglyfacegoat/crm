import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { QuickOrderWorkspace } from "@/components/quick-order/quick-order-workspace";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import { getPreviewOrderCreationOptions } from "@/server/orders/preview";
import { listOrderCreationOptions } from "@/server/orders/repository";

export const metadata: Metadata = { title: "Быстрое оформление" };

function dateInMoscow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export default async function QuickOrderPage() {
  const member = await requireOfficeSession();
  const canCreate = hasPermission(member.role, "clients.write")
    && hasPermission(member.role, "orders.write")
    && hasPermission(member.role, "visits.write");
  const options = getAuthMode() === "preview"
    ? getPreviewOrderCreationOptions()
    : canCreate ? await listOrderCreationOptions(member) : null;

  return (
    <div>
      <PageHeading
        eyebrow="Единый сценарий оформления"
        title="Создать заказ"
        description="Клиент, объект, работы и первый выезд — в одном понятном потоке без повторного ввода."
      />
      <div className="mt-[clamp(1.5rem,1.1rem+0.8vw,2.25rem)]">
        {canCreate && options ? (
          <QuickOrderWorkspace options={options} idempotencyKey={randomUUID()} defaultVisitDate={dateInMoscow()} />
        ) : (
          <section className="surface-panel max-w-2xl p-6">
            <p className="eyebrow">Доступ ограничен</p>
            <h2 className="mt-3 font-display text-xl font-semibold text-white">Нужны права на клиентов, заказы и выезды</h2>
            <p className="mt-3 text-sm leading-6 text-[#7d878d]">Полный сценарий доступен администраторам и диспетчерам. Это защищает CRM от частично созданных заказов.</p>
          </section>
        )}
      </div>
    </div>
  );
}
