import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  FileText,
  MapPin,
  Phone,
  ReceiptText,
  UserRound,
  Wrench,
} from "lucide-react";
import { OrderActions } from "@/components/orders/order-actions";
import { OrderRelationsSection } from "@/components/orders/order-relations-section";
import { OrderVisitSection } from "@/components/orders/order-visit-section";
import { Avatar } from "@/components/ui/avatar";
import { BackLink } from "@/components/ui/back-link";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatMoneyMinor, formatShortDate } from "@/lib/format";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import { listOrderDocuments } from "@/server/documents/repository";
import type { DocumentListItem } from "@/server/documents/types";
import {
  getOrderDetail,
  listOrderCreationOptions,
  OrderNotFoundError,
} from "@/server/orders/repository";
import {
  getOrderRelations,
  OrderRelationNotFoundError,
} from "@/server/orders/relations-repository";
import { orderIdSchema } from "@/server/orders/schemas";
import {
  getPreviewOrderCreationOptions,
  getPreviewOrderDetail,
  getPreviewOrderRelations,
} from "@/server/orders/preview";
import type {
  OrderCreationOptions,
  OrderRelations,
} from "@/server/orders/types";
import {
  emptyVisitHistoryFeed,
  type VisitHistoryFeed,
} from "@/server/visits/history";
import {
  listOrderVisitHistory,
  listOrderVisits,
} from "@/server/visits/repository";
import {
  getPreviewOrderVisitHistory,
  getPreviewOrderVisits,
} from "@/server/visits/preview";
import type { ServiceVisit } from "@/server/visits/types";

export const metadata: Metadata = { title: "Карточка заказа" };

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
        {label}
      </dt>
      <dd className="mt-1.5 break-words text-sm font-medium text-[var(--text)]">
        {value}
      </dd>
    </div>
  );
}

function EconomyRow({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "expense";
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-[11px] text-[var(--text-secondary)]">{label}</dt>
      <dd
        className={`shrink-0 font-display text-[11px] ${tone === "expense" ? "text-[var(--warning)]" : "text-[var(--text)]"}`}
      >
        {value}
      </dd>
    </div>
  );
}

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ newVisit?: string }>;
}) {
  const { id } = await params;
  const openNewVisit = (await searchParams).newVisit === "1";
  const member = await requireOfficeSession();
  const preview = getAuthMode() === "preview";
  const canWrite = hasPermission(member, "orders.write");
  const canReadVisits =
    hasPermission(member, "visits.read") && member.role !== "master";
  const canWriteVisits = hasPermission(member, "visits.write");
  const canReadDocuments = hasPermission(member, "documents.read");
  const canWriteDocuments = hasPermission(member, "documents.write");
  let order;
  let options: OrderCreationOptions = {
    clients: [],
    objects: [],
    contacts: [],
    masters: [],
  };
  let orderVisits: ServiceVisit[] = [];
  let visitHistory: VisitHistoryFeed = emptyVisitHistoryFeed;
  let orderRelations: OrderRelations = {
    groupId: null,
    orders: [],
    candidates: [],
  };
  let orderDocuments: DocumentListItem[] = [];

  if (preview) {
    order = getPreviewOrderDetail(id);
    options = getPreviewOrderCreationOptions();
    orderVisits = getPreviewOrderVisits(id);
    visitHistory = getPreviewOrderVisitHistory(id);
    orderRelations = getPreviewOrderRelations(id);
    if (!order) notFound();
  } else {
    const parsedId = orderIdSchema.safeParse(id);
    if (!parsedId.success) notFound();

    try {
      [
        order,
        options,
        orderVisits,
        visitHistory,
        orderRelations,
        orderDocuments,
      ] = await Promise.all([
        getOrderDetail(member, parsedId.data),
        canWrite ? listOrderCreationOptions(member) : Promise.resolve(options),
        canReadVisits
          ? listOrderVisits(member, parsedId.data)
          : Promise.resolve(orderVisits),
        canReadVisits
          ? listOrderVisitHistory(member, parsedId.data)
          : Promise.resolve(visitHistory),
        getOrderRelations(member, parsedId.data),
        canReadDocuments
          ? listOrderDocuments(member, parsedId.data)
          : Promise.resolve(orderDocuments),
      ]);
    } catch (error) {
      if (
        error instanceof OrderNotFoundError ||
        error instanceof OrderRelationNotFoundError
      )
        notFound();
      throw error;
    }
  }

  const dispatchVisit =
    orderVisits.find(
      (visit) =>
        visit.statusCode !== "completed" && visit.statusCode !== "cancelled",
    ) ??
    orderVisits.at(-1) ??
    null;
  const copyableVisits = orderVisits.filter((visit) => visit.copyable);

  return (
    <div>
      <header className="surface-panel animate-rise p-5 sm:p-6">
        <div className="flex flex-col gap-5 min-[640px]:flex-row min-[640px]:items-start min-[640px]:justify-between">
          <div>
            <BackLink href="/orders" className="mb-4">
              К заказам
            </BackLink>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="display-title text-[var(--text)]">
                Заказ {order.number}
              </h1>
              <StatusBadge status={order.status} />
            </div>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Создан {formatShortDate(order.createdAt)} · {order.serviceSummary}
            </p>
          </div>
          <OrderActions
            order={order}
            options={options}
            visits={copyableVisits}
            canWrite={canWrite}
            dispatchVisitId={dispatchVisit?.id ?? null}
          />
        </div>
      </header>

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(19rem,23rem)]">
        <section aria-label="Детали заказа" className="space-y-5">
          <section
            className="surface-panel animate-rise p-5 sm:p-6"
            style={{ animationDelay: "80ms" }}
          >
            <div className="flex min-w-0 items-start gap-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-[var(--accent-soft)] text-[var(--accent-ink)]">
                <MapPin className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="break-words text-lg font-semibold text-[var(--text)]">
                  {order.client}
                </p>
                <p className="mt-1 break-words text-sm leading-6 text-[var(--text-secondary)]">
                  {order.object} · {order.address}
                </p>
              </div>
            </div>

            <dl className="mt-6 grid gap-x-7 gap-y-5 border-t border-[var(--line)] pt-6 min-[480px]:grid-cols-2 lg:grid-cols-4">
              <InfoField
                label="Сумма"
                value={formatMoneyMinor(order.agreedTotalMinor)}
              />
              <InfoField label="Услуги" value={order.serviceSummary} />
              <InfoField label="Контакт" value={order.contactName} />
              <InfoField label="Телефон" value={order.contactPhone} />
            </dl>

            {order.notes ? (
              <div className="mt-6 border-t border-[var(--line)] pt-5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
                  Внутренняя заметка
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--text-secondary)]">
                  {order.notes}
                </p>
              </div>
            ) : null}
          </section>

          {canReadVisits || preview ? (
            <OrderVisitSection
              orderId={order.id}
              visits={orderVisits}
              history={visitHistory}
              masters={options.masters}
              defaultMasterId={order.assignedMasterId}
              canWrite={canWriteVisits}
              canComplete={canWriteVisits && canWriteDocuments}
              initialCreateKey={
                openNewVisit && canWriteVisits ? randomUUID() : null
              }
            />
          ) : null}

          <OrderRelationsSection
            orderId={order.id}
            relations={orderRelations}
            canWrite={canWrite}
          />

          <section
            className="surface-panel animate-rise p-5 sm:p-6"
            style={{ animationDelay: "200ms" }}
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-[var(--text)]">
                Состав заказа
              </h2>
              <span className="text-xs text-[var(--muted)]">
                {order.services.length} поз.
              </span>
            </div>
            <div className="mt-4 divide-y divide-[var(--line)]">
              {order.services.map((service) => (
                <div
                  key={service.id}
                  className="grid gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_6rem_8rem]"
                >
                  <div className="flex items-start gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--surface-raised)] text-[var(--muted)]">
                      <Wrench className="size-4" />
                    </span>
                    <div>
                      <p className="text-sm font-medium text-[var(--text)]">
                        {service.name}
                      </p>
                      {service.note ? (
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {service.note}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <span className="text-xs text-[var(--text-secondary)] sm:text-right">
                    {Number(service.quantity).toLocaleString("ru-RU")} ×{" "}
                    {formatMoneyMinor(service.unitPriceMinor)}
                  </span>
                  <span className="font-display text-xs text-[var(--text)] sm:text-right">
                    {formatMoneyMinor(service.lineTotalMinor)}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section
            className="surface-panel animate-rise p-5 sm:p-6"
            style={{ animationDelay: "230ms" }}
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-[var(--text)]">
                Прямые расходы
              </h2>
              <span className="font-display text-xs text-[var(--warning)]">
                {formatMoneyMinor(order.directExpensesMinor)}
              </span>
            </div>
            {order.expenses.length ? (
              <div className="mt-4 divide-y divide-[var(--line)]">
                {order.expenses.map((expense) => (
                  <div
                    key={expense.id}
                    className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
                  >
                    <div>
                      <p className="text-sm font-medium text-[var(--text)]">
                        {expense.category}
                      </p>
                      <p className="mt-1 text-[10px] text-[var(--muted)]">
                        {new Intl.DateTimeFormat("ru-RU").format(
                          new Date(`${expense.occurredOn}T12:00:00`),
                        )}
                        {expense.note ? ` · ${expense.note}` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 font-display text-xs text-[var(--warning)]">
                      − {formatMoneyMinor(expense.amountMinor)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-[var(--muted)]">
                Расходов по заказу нет.
              </p>
            )}
          </section>
        </section>

        <aside className="space-y-5">
          <section
            className="surface-panel animate-rise p-5"
            style={{ animationDelay: "180ms" }}
          >
            <div className="flex items-center gap-3">
              <Avatar
                name={order.master ?? "Не назначен"}
                tone={order.master ? "violet" : "lime"}
              />
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
                  Мастер
                </p>
                <p className="mt-1 text-sm font-medium text-[var(--text)]">
                  {order.master ?? "Не назначен"}
                </p>
              </div>
            </div>
            <div className="mt-5 space-y-3 border-t border-[var(--line)] pt-4">
              <p className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                <Phone className="size-3.5 text-[var(--muted)]" />
                {order.masterPhone ?? "Телефон не указан"}
              </p>
              <p className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                <UserRound className="size-3.5 text-[var(--muted)]" />
                Выплата:{" "}
                {order.masterPaymentMinor === null
                  ? "не указана"
                  : formatMoneyMinor(order.masterPaymentMinor)}
              </p>
            </div>
          </section>

          <section
            className="surface-panel animate-rise p-5"
            style={{ animationDelay: "220ms" }}
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-[var(--text)]">
                Экономика заказа
              </h2>
              <Link
                href="/finance"
                className="focus-ring rounded-full border border-[var(--line)] px-2.5 py-1 text-[9px] uppercase tracking-[0.1em] text-[var(--muted)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--text)]"
              >
                Открыть реестр
              </Link>
            </div>
            <dl className="mt-5 space-y-3">
              <EconomyRow
                label="Согласованный чек"
                value={formatMoneyMinor(order.agreedTotalMinor)}
              />
              <EconomyRow
                label="Начислено мастеру"
                value={`− ${formatMoneyMinor(order.masterPaymentMinor ?? 0)}`}
                tone="expense"
              />
              <EconomyRow
                label="Выплачено мастеру"
                value={formatMoneyMinor(order.masterPaidTotalMinor)}
                tone="expense"
              />
              <EconomyRow
                label="Прямые расходы"
                value={`− ${formatMoneyMinor(order.directExpensesMinor)}`}
                tone="expense"
              />
              <div className="mt-4 flex items-center justify-between gap-4 border-t border-[var(--line)] pt-4">
                <dt className="text-[11px] font-semibold text-[var(--text)]">
                  Плановый остаток
                </dt>
                <dd
                  className={`shrink-0 font-display text-sm font-semibold ${order.projectedOperatingContributionMinor >= 0 ? "text-[var(--success)]" : "text-[var(--danger)]"}`}
                >
                  {formatMoneyMinor(order.projectedOperatingContributionMinor)}
                </dd>
              </div>
              <EconomyRow
                label="Выставлено"
                value={formatMoneyMinor(order.invoicedTotalMinor)}
              />
              <EconomyRow
                label="Оплачено клиентом"
                value={formatMoneyMinor(order.paidTotalMinor)}
              />
              <EconomyRow
                label="Осталось по счетам"
                value={formatMoneyMinor(order.outstandingInvoiceMinor)}
              />
            </dl>
            <p className="mt-4 text-[10px] leading-4 text-[var(--muted)]">
              Без учёта налогов и постоянных расходов компании.
            </p>
          </section>

          {canReadDocuments ? (
            <section
              className="surface-panel animate-rise p-5"
              style={{ animationDelay: "260ms" }}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <ReceiptText className="size-4 text-[var(--muted)]" />
                  <h2 className="text-sm font-semibold text-[var(--text)]">
                    Документы
                  </h2>
                </div>
                <span className="text-[10px] text-[var(--muted)]">
                  {orderDocuments.length}
                </span>
              </div>
              {orderDocuments.length ? (
                <div className="mt-4 divide-y divide-[var(--line)]">
                  {orderDocuments.slice(0, 5).map((document) => (
                    <a
                      key={document.id}
                      href={`/api/v1/documents/${document.id}/download`}
                      className="focus-ring flex min-h-10 items-center gap-3 px-2.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-raised)] hover:text-[var(--text)]"
                    >
                      <FileText className="size-3.5 shrink-0 text-[var(--accent)]" />
                      <span className="min-w-0 flex-1 truncate">
                        {document.title}
                      </span>
                      <span className="text-[9px] text-[var(--muted)]">
                        v{document.versionNumber}
                      </span>
                    </a>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                  У заказа пока нет файлов. Добавьте договор, акт, фото или
                  карточку выезда.
                </p>
              )}
              <Link
                href={`/documents?client=${order.clientId}&object=${order.objectId}&order=${order.id}`}
                className="focus-ring mt-4 inline-flex rounded-lg text-xs text-[var(--accent)] hover:underline"
              >
                Все документы заказа
              </Link>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
