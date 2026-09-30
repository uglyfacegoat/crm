import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth/page-access";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  FileText,
  MapPin,
  Phone,
  ReceiptText,
  UserRound,
} from "lucide-react";
import { OrderActions } from "@/components/orders/order-actions";
import { UploadDocumentButton } from "@/components/documents/upload-document-dialog";
import { UploadDocumentVersionButton } from "@/components/documents/upload-document-version-dialog";
import { PersonalNotesPanel } from "@/components/personal-notes/personal-notes-panel";
import { OrderLinksCompletion } from "@/components/orders/order-links-completion";
import { OrderRelationsSection } from "@/components/orders/order-relations-section";
import { OrderVisitSection } from "@/components/orders/order-visit-section";
import { Avatar } from "@/components/ui/avatar";
import { BackLink } from "@/components/ui/back-link";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatMoneyMinor, formatShortDate } from "@/lib/format";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import { resolveCenterOrderScope } from "@/server/organizations/center-dashboard";
import { listPersonalNotes, listPersonalNoteTemplates, type NoteTarget } from "@/server/personal-notes/repository";
import { getObjectServiceProfile } from "@/server/catalog/object-service-profiles";
import { getOrderDocumentUploadOptions, listOrderDocuments } from "@/server/documents/repository";
import type { DocumentListItem, DocumentUploadOptions } from "@/server/documents/types";
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
  requirePagePermission(member, "orders.read");
  const preview = getAuthMode() === "preview";
  const parsedId = orderIdSchema.safeParse(id);
  if (!preview && !parsedId.success) notFound();
  let orderMember = member;
  if (!preview && parsedId.success && hasPermission(member, "companies.read")) {
    orderMember = await resolveCenterOrderScope(member, parsedId.data) ?? member;
  }
  const viewingAcrossCompanies = orderMember.organizationId !== member.organizationId;
  const canWrite = !viewingAcrossCompanies && hasPermission(member, "orders.write");
  const canReadVisits =
    hasPermission(member, "visits.read") && member.role !== "master";
  const canWriteVisits = !viewingAcrossCompanies && hasPermission(member, "visits.write");
  const canReadDocuments = hasPermission(member, "documents.read");
  const canReadFinance = hasPermission(member, "finance.read");
  const canWriteFinance = canWrite && hasPermission(member, "finance.write");
  const canWriteDocuments = !viewingAcrossCompanies && hasPermission(member, "documents.write");
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
  let documentUploadOptions: DocumentUploadOptions = { orders: [], visits: [], contracts: [] };

  if (preview) {
    order = getPreviewOrderDetail(id);
    options = getPreviewOrderCreationOptions();
    orderVisits = getPreviewOrderVisits(id);
    visitHistory = getPreviewOrderVisitHistory(id);
    orderRelations = getPreviewOrderRelations(id);
    if (!order) notFound();
  } else {
    const validId = orderIdSchema.parse(id);
    try {
      [
        order,
        options,
        orderVisits,
        visitHistory,
        orderRelations,
        orderDocuments,
      ] = await Promise.all([
        getOrderDetail(orderMember, validId),
        canWrite ? listOrderCreationOptions(orderMember) : Promise.resolve(options),
        canReadVisits
          ? listOrderVisits(orderMember, validId)
          : Promise.resolve(orderVisits),
        canReadVisits
          ? listOrderVisitHistory(orderMember, validId)
          : Promise.resolve(visitHistory),
        getOrderRelations(orderMember, validId),
        canReadDocuments
          ? listOrderDocuments(orderMember, validId)
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
    if (canWrite && (!order.objectId || !order.contactId)) options = await listOrderCreationOptions(orderMember, order.clientId);
  }

  if (order.assignedMasterId && order.master && !options.masters.some((master) => master.id === order.assignedMasterId)) {
    options.masters.push({ id: order.assignedMasterId, name: order.master, phone: order.masterPhone ?? "" });
  }

  if (!preview && canWriteDocuments) {
    documentUploadOptions = await getOrderDocumentUploadOptions(orderMember, order.id);
  }

  const dispatchVisit =
    orderVisits.find(
      (visit) =>
        visit.statusCode !== "completed" && visit.statusCode !== "cancelled",
    ) ??
    orderVisits.at(-1) ??
    null;
  const copyableVisits = orderVisits.filter((visit) => visit.copyable);
  const orderForActions = canReadFinance
    ? canWriteFinance ? order : { ...order, expenses: [] }
    : { ...order, expenses: [], masterPaymentMinor: null, masterPaidTotalMinor: 0,
      invoicedTotalMinor: 0, paidTotalMinor: 0, directExpensesMinor: 0,
      projectedOperatingContributionMinor: 0, realizedOperatingContributionMinor: 0, outstandingInvoiceMinor: 0 };
  const noteTarget: NoteTarget = { kind: "order", organizationId: orderMember.organizationId, id: order.id };
  const noteCalendarDate = dispatchVisit ? new Intl.DateTimeFormat("en-CA", { timeZone: dispatchVisit.timezone,
    year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(dispatchVisit.scheduledStartAt)) : null;
  const relatedNoteLinks = viewingAcrossCompanies ? undefined : {
    calendarHref: canReadVisits ? `/calendar?${noteCalendarDate ? `date=${noteCalendarDate}&` : ""}view=day&order=${order.id}` : undefined,
    tasksHref: hasPermission(member, "tasks.read") ? `/tasks?order=${order.id}` : undefined,
  };
  const [personalNotes, noteTemplates] = preview
    ? [[], []]
    : await Promise.all([listPersonalNotes(member, noteTarget), listPersonalNoteTemplates(member)]);
  const serviceProfile = !preview && order.objectId ? await getObjectServiceProfile(orderMember, order.objectId) : null;
  const contractRates = serviceProfile?.rates.filter((rate) => rate.lineKind === "contract") ?? [];
  const lizaDefaults = {
    object: order.object,
    area: (serviceProfile?.areaSquareMeters ?? serviceProfile?.objectAreaSquareMeters ?? "").replace(".", ","),
    serviceRates: contractRates.length ? contractRates.map((rate) => ({ name: rate.name,
      pricePerSquareMeter: rate.billingBasis === "area" && rate.unitPriceMinor !== null ? (rate.unitPriceMinor / 100).toFixed(2).replace(".", ",") : "" }))
      : order.services.map((line) => ({ name: line.name, pricePerSquareMeter: "" })),
    total: serviceProfile?.contractTotalMinor !== null && serviceProfile?.contractTotalMinor !== undefined ? (serviceProfile.contractTotalMinor / 100).toFixed(2).replace(".", ",") : order.agreedTotalMinor ? (order.agreedTotalMinor / 100).toFixed(2).replace(".", ",") : "",
    maintenance: serviceProfile?.serviceSchedule || (serviceProfile?.visitsPerMonth ? `${serviceProfile.visitsPerMonth} раз(а) в месяц` : ""),
  };
  const primaryContact = order.relatedContacts?.find((contact) => contact.id === order.contactId);
  const extraContacts = order.relatedContacts?.filter((contact) => contact.id !== order.contactId) ?? [];
  const extraObjects = order.relatedObjects?.filter((object) => object.id !== order.objectId) ?? [];
  const knownPhones = new Set([order.contactPhone, ...(order.relatedContacts ?? []).map((contact) => contact.phone)].map((phone) => phone.replace(/\D/g, "")));
  const extraPhones = order.relatedPhones?.filter((phone) => !knownPhones.has(phone.phone.replace(/\D/g, ""))) ?? [];

  return (
    <div>
      <header className="surface-panel animate-rise p-5 sm:p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
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
              Создан {formatShortDate(order.createdAt)}
            </p>
            {viewingAcrossCompanies ? <p className="mt-2 text-xs text-[var(--muted)]">{orderMember.organizationName} · просмотр из Центра CRM</p> : null}
          </div>
          <OrderActions
            order={orderForActions}
            options={options}
            visits={copyableVisits}
            canWrite={canWrite}
            canWriteFinance={canWriteFinance}
            dispatchVisitId={viewingAcrossCompanies ? null : dispatchVisit?.id ?? null}
          />
        </div>
      </header>

      <div className="mt-5">
        <PersonalNotesPanel target={noteTarget} initialNotes={personalNotes} initialTemplates={noteTemplates} objectName={order.object} lizaDefaults={lizaDefaults} relatedLinks={relatedNoteLinks} />
      </div>

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
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">Заказчик</p>
                <p className="break-words text-lg font-semibold text-[var(--text)]">
                  {order.client}
                </p>
              </div>
            </div>
            {order.object && order.object !== "Не указан" ? <div className="mt-5 border-t border-[var(--line)] pt-4"><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">Объект</p><p className="mt-1 text-sm font-medium text-[var(--text)]">{order.object}</p>{order.address ? <p className="mt-1 break-words text-xs leading-5 text-[var(--text-secondary)]">{order.address}</p> : null}</div> : null}
            {(order.contactName !== "Не указан" || (order.contactPhone && order.contactPhone !== "Не указан")) ? <div className="mt-5 border-t border-[var(--line)] pt-4"><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">Контакт</p><div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm"><span className="font-medium text-[var(--text)]">{order.contactName}</span>{order.contactPhone && order.contactPhone !== "Не указан" ? <a href={`tel:${order.contactPhone}`} className="focus-ring text-[var(--accent-ink)] underline">{order.contactPhone}</a> : null}{primaryContact?.email ? <a href={`mailto:${primaryContact.email}`} className="focus-ring break-all text-xs text-[var(--text-secondary)] underline">{primaryContact.email}</a> : null}</div></div> : null}
            {(extraContacts.length || extraObjects.length || extraPhones.length) ? <div className="mt-5 grid gap-4 border-t border-[var(--line)] pt-4 sm:grid-cols-2">
              {extraContacts.length ? <div><h2 className="text-xs font-semibold">Дополнительные контакты</h2><div className="mt-2 space-y-2">{extraContacts.map((contact) => <div key={contact.id} className="rounded-xl bg-[var(--surface-inset)] p-3 text-xs"><p className="font-medium">{contact.name}{contact.position ? ` · ${contact.position}` : ""}</p>{contact.phone ? <a className="mt-1 block underline" href={`tel:${contact.phone}`}>{contact.phone}</a> : null}{contact.email ? <a className="mt-1 block break-all underline" href={`mailto:${contact.email}`}>{contact.email}</a> : null}</div>)}</div></div> : null}
              {extraObjects.length ? <div><h2 className="text-xs font-semibold">Дополнительные объекты</h2><div className="mt-2 space-y-2">{extraObjects.map((object) => <div key={object.id} className="rounded-xl bg-[var(--surface-inset)] p-3 text-xs"><p className="font-medium">{object.name}</p>{object.address ? <p className="mt-1 text-[var(--muted)]">{object.address}</p> : null}</div>)}</div></div> : null}
              {extraPhones.length ? <div><h2 className="text-xs font-semibold">Другие номера</h2><div className="mt-2 space-y-2">{extraPhones.map((phone) => <a key={phone.id} href={`tel:${phone.phone}`} className="block rounded-xl bg-[var(--surface-inset)] p-3 text-xs underline">{phone.label}{phone.contactName ? ` · ${phone.contactName}` : ""}: {phone.phone}</a>)}</div></div> : null}
            </div> : null}

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

          {canWrite && (!order.objectId || !order.contactId) ? <OrderLinksCompletion order={order} options={options} /> : null}

          {!order.objectId && canReadVisits ? <p className="rounded-[13px] border border-[var(--line)] bg-[var(--surface-inset)] p-4 text-xs text-[var(--muted)]">Чтобы назначить выезд, сначала добавьте объект и адрес в карточке клиента, затем привяжите объект к заказу.</p> : null}
          {canReadVisits || preview ? (
            <OrderVisitSection
              orderId={order.id}
              visits={orderVisits}
              history={visitHistory}
              masters={options.masters}
              defaultMasterId={order.assignedMasterId}
              canWrite={canWriteVisits && Boolean(order.objectId)}
              canComplete={canWriteVisits && canWriteDocuments}
              initialCreateKey={
                openNewVisit && canWriteVisits && order.objectId ? randomUUID() : null
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
              {order.services.map((service, index) => (
                <div
                  key={service.id}
                  className="flex min-w-0 items-start justify-between gap-4 py-4 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium text-[var(--text)]">{index + 1}. {service.name}</p>
                    {Number(service.quantity) !== 1 ? <p className="mt-1 text-xs text-[var(--text-secondary)]">{Number(service.quantity).toLocaleString("ru-RU")} × {service.pricePending ? "цена уточняется" : formatMoneyMinor(service.unitPriceMinor)}</p> : null}
                    {service.note ? <p className="mt-1 text-xs text-[var(--muted)]">{service.note}</p> : null}
                  </div>
                  <span className="shrink-0 font-display text-xs text-[var(--text)]">
                    {service.pricePending ? "Цена уточняется" : formatMoneyMinor(service.lineTotalMinor)}
                  </span>
                </div>
              ))}
              {!order.services.length ? <p className="py-2 text-xs text-[var(--muted)]">Услуги пока не добавлены.</p> : null}
            </div>
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
                src={order.assignedMasterId ? `/api/v1/masters/${order.assignedMasterId}/avatar` : undefined}
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
              {canReadFinance ? <p className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                <UserRound className="size-3.5 text-[var(--muted)]" />
                Выплата:{" "}
                {order.masterPaymentMinor === null
                  ? "не указана"
                  : formatMoneyMinor(order.masterPaymentMinor)}
              </p> : null}
            </div>
          </section>

          {canReadFinance ? <section
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
          </section> : null}

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
                  <span className="text-[10px] text-[var(--muted)]">{orderDocuments.length}</span>
                </div>
                {canWriteDocuments && documentUploadOptions.orders.length ? <UploadDocumentButton options={documentUploadOptions} fixedOrderId={order.id} compact /> : null}
              </div>
              {orderDocuments.length ? (
                <div className="mt-4 space-y-2">
                  {orderDocuments.map((document) => (
                    <div key={document.id} className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
                      <div className="flex items-start gap-2">
                        <FileText className="mt-0.5 size-4 shrink-0 text-[var(--accent)]" />
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-xs font-medium text-[var(--text)]">{document.title}</p>
                          <p className="mt-1 text-[10px] text-[var(--muted)]">{document.categoryLabel} · v{document.versionNumber} · {document.extension.toUpperCase()}</p>
                          {document.description ? <p className="mt-1 line-clamp-2 text-[10px] text-[var(--text-secondary)]">{document.description}</p> : null}
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <a href={`/api/v1/documents/${document.id}/download`} className="focus-ring inline-flex min-h-9 items-center rounded-lg border border-[var(--line)] px-3 text-[10px] text-[var(--text)]">Скачать</a>
                        {canWriteDocuments ? <div className="min-w-36 flex-1"><UploadDocumentVersionButton document={document} /></div> : null}
                      </div>
                      <details className="mt-3 border-t border-[var(--line)] pt-2 text-[10px] text-[var(--text-secondary)]">
                        <summary className="focus-ring cursor-pointer rounded py-1 font-medium text-[var(--text)]">История и детали</summary>
                        <div className="mt-2 space-y-2">
                          {document.description ? <p className="whitespace-pre-wrap break-words">{document.description}</p> : null}
                          {document.versions.map((version) => (
                            <div key={version.id} className="rounded-lg bg-[var(--surface-inset)] p-2.5">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="break-all font-medium text-[var(--text)]">v{version.versionNumber} · {version.filename}{version.current ? " · текущая" : ""}</span>
                                <a className="focus-ring underline" href={`/api/v1/documents/${document.id}/versions/${version.id}/download`}>Скачать версию</a>
                              </div>
                              <p className="mt-1">{new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(version.uploadedAt))} · {version.uploadedBy}</p>
                              {version.changeNote ? <p className="mt-1 whitespace-pre-wrap break-words">{version.changeNote}</p> : null}
                            </div>
                          ))}
                          {!viewingAcrossCompanies ? <Link href={`/documents?order=${order.id}&document=${document.id}`} className="focus-ring inline-block underline">Открыть в архиве</Link> : null}
                        </div>
                      </details>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                  У заказа пока нет файлов. Добавьте договор, акт, фото или
                  карточку выезда.
                </p>
              )}
            </section>
          ) : null}
          {canReadFinance ? <section className="surface-panel animate-rise p-5" style={{ animationDelay: "280ms" }}>
            <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold text-[var(--text)]">Прямые расходы</h2><span className="font-display text-xs text-[var(--warning)]">{formatMoneyMinor(order.directExpensesMinor)}</span></div>
            {order.expenses.length ? <div className="mt-4 divide-y divide-[var(--line)]">{order.expenses.map((expense) => <div key={expense.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"><div className="min-w-0"><p className="break-words text-xs font-medium text-[var(--text)]">{expense.category}</p><p className="mt-1 text-[10px] text-[var(--muted)]">{new Intl.DateTimeFormat("ru-RU").format(new Date(`${expense.occurredOn}T12:00:00`))}{expense.note ? ` · ${expense.note}` : ""}</p></div><span className="shrink-0 font-display text-xs text-[var(--warning)]">− {formatMoneyMinor(expense.amountMinor)}</span></div>)}</div> : <p className="mt-3 text-xs text-[var(--muted)]">Расходов по заказу нет.</p>}
          </section> : null}
        </aside>
      </div>
    </div>
  );
}
