import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { QuickOrderWorkspace } from "@/components/quick-order/quick-order-workspace";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import { getIncomingLeadPrefill, IncomingLeadNotFoundError } from "@/server/incoming-leads/repository";
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

export default async function QuickOrderPage({ searchParams }: PageProps<"/quick-order">) {
  const member = await requireOfficeSession();
  const query = await searchParams;
  const sourceLeadId = z.string().uuid().safeParse(query.sourceLead).data;
  const canCreate = hasPermission(member, "clients.write")
    && hasPermission(member, "orders.write")
    && hasPermission(member, "visits.write");
  const preview = getAuthMode() === "preview";
  const optionsPromise = preview ? Promise.resolve(getPreviewOrderCreationOptions()) : canCreate ? listOrderCreationOptions(member) : Promise.resolve(null);
  const prefillPromise = sourceLeadId && !preview && canCreate ? getIncomingLeadPrefill(member, sourceLeadId) : Promise.resolve(undefined);
  const [options, prefill] = await Promise.all([optionsPromise, prefillPromise]).catch((error: unknown) => {
    if (error instanceof IncomingLeadNotFoundError) notFound();
    throw error;
  });

  return (
    <div>
      <PageHeading
        eyebrow={prefill ? "Проверка входящей заявки" : "Единый сценарий оформления"}
        title={prefill ? "Уточнить и принять заявку" : "Создать заказ"}
        description={prefill ? "Данные с сайта уже подставлены. Проверьте клиента, объект, работы и первый выезд перед сохранением." : "Клиент, объект, работы и первый выезд — в одном понятном потоке без повторного ввода."}
      />
      <div className="mt-[clamp(1.5rem,1.1rem+0.8vw,2.25rem)]">
        {canCreate && options ? (
          <QuickOrderWorkspace options={options} idempotencyKey={randomUUID()} defaultVisitDate={dateInMoscow()} prefill={prefill} />
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
