"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  CircleAlert,
  ExternalLink,
  Inbox,
  Link2,
  LoaderCircle,
  Mail,
  Phone,
  Search,
  UserRoundSearch,
} from "lucide-react";
import { useActionState, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { rejectIncomingLeadAction, type IncomingLeadMutationState } from "@/app/(workspace)/inbox/actions";
import { Dialog } from "@/components/ui/dialog";
import { OrderPicker } from "@/components/orders/order-form-parts";
import { PageHeading } from "@/components/ui/page-heading";
import type { IncomingLeadListFilter } from "@/server/incoming-leads/schemas";
import { incomingLeadStatusLabels, type IncomingLead, type IncomingLeadSnapshot, type IncomingLeadStatus } from "@/server/incoming-leads/types";

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Moscow",
});

const tabs: Array<{ value: IncomingLeadStatus | "all"; label: string }> = [
  { value: "all", label: "Все" },
  { value: "new", label: "Новые" },
  { value: "reviewing", label: "На проверке" },
  { value: "accepted", label: "Принятые" },
  { value: "rejected", label: "Отклонённые" },
];

const statusPillTone: Record<IncomingLeadStatus, string> = {
  new: "border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent-ink)]",
  reviewing: "border-[var(--info-border)] bg-[var(--info-bg)] text-[var(--info)]",
  accepted: "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]",
  rejected: "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-ink)]",
};

const statusDotTone: Record<IncomingLeadStatus, string> = {
  new: "bg-[var(--accent)]",
  reviewing: "bg-[var(--info)]",
  accepted: "bg-[var(--success)]",
  rejected: "bg-[var(--danger)]",
};

const initialMutationState: IncomingLeadMutationState = { status: "idle", message: null, fieldErrors: {} };

function safeExternalUrl(value: string | null) {
  if (!value) return null;

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function inboxHref(status: IncomingLeadStatus | "all", query: string) {
  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  if (query.trim()) params.set("query", query.trim());
  const search = params.toString();
  return search ? "/inbox?" + search : "/inbox";
}

function ContactLine({ icon: Icon, children }: { icon: typeof Phone; children: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5 text-sm text-[var(--text-secondary)]">
      <Icon className="size-4 shrink-0 text-[var(--muted)]" />
      <span className="truncate">{children}</span>
    </span>
  );
}

function DetailLabel({ children }: { children: ReactNode }) {
  return <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">{children}</p>;
}

function StatusPill({ status }: { status: IncomingLeadStatus }) {
  return (
    <span className={"inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] " + statusPillTone[status]}>
      <span className={"size-1.5 rounded-full " + statusDotTone[status]} />
      {incomingLeadStatusLabels[status]}
    </span>
  );
}

function RejectLeadDialog({ lead, open, onClose }: { lead: IncomingLead; open: boolean; onClose: () => void }) {
  const [state, action, pending] = useActionState(rejectIncomingLeadAction, initialMutationState);
  const router = useRouter();

  useEffect(() => {
    if (state.status !== "success") return;
    router.refresh();
    const timeout = window.setTimeout(onClose, 500);
    return () => window.clearTimeout(timeout);
  }, [onClose, router, state.status]);

  return (
    <Dialog open={open} onClose={onClose} title="Отклонить заявку" description="Она останется в истории и не превратится в заказ.">
      <form action={action} className="flex min-h-full flex-1 flex-col">
        <input type="hidden" name="leadId" value={lead.id} />
        <input type="hidden" name="expectedVersion" value={lead.version} />
        <div className="flex-1 space-y-5 p-5 sm:p-7">
          <div className="rounded-[18px] border border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-3.5">
            <p className="text-sm font-medium text-[var(--text)]">{lead.contactName || lead.phone || lead.email || "Заявка без имени"}</p>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">{lead.websiteName} · {dateFormatter.format(new Date(lead.receivedAt))}</p>
          </div>
          <label className="grid gap-2 text-xs text-[var(--text-secondary)]">
            <span>Причина *</span>
            <textarea name="reason" required minLength={3} maxLength={500} rows={6} placeholder="Например: дубль заявки, спам или клиент отказался" className="focus-ring resize-none rounded-[16px] border border-[var(--line-strong)] bg-[var(--surface-inset)] p-3.5 text-sm leading-6 text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)]" />
            {state.fieldErrors.reason?.map((error) => <span key={error} className="text-xs text-[var(--danger-ink)]">{error}</span>)}
          </label>
          {state.message ? <p role="status" className={"rounded-[14px] px-4 py-3 text-xs leading-5 " + (state.status === "success" ? "bg-[var(--success-bg)] text-[var(--success)]" : "bg-[var(--danger-bg)] text-[var(--danger-ink)]")}>{state.message}</p> : null}
        </div>
        <footer className="grid grid-cols-2 gap-2 border-t border-[var(--line)] bg-[var(--surface-raised)] p-4 sm:p-5">
          <button type="button" onClick={onClose} disabled={pending} className="focus-ring h-12 rounded-[14px] border border-[var(--line-strong)] text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-soft)] hover:text-[var(--text)]">Отмена</button>
          <button type="submit" disabled={pending || state.status === "success"} className="focus-ring flex h-12 items-center justify-center gap-2 rounded-[14px] bg-[var(--danger)] text-xs font-semibold text-[var(--on-accent)] transition-transform active:translate-y-px disabled:opacity-60">{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Ban className="size-4" />}Отклонить</button>
        </footer>
      </form>
    </Dialog>
  );
}

function LeadDetails({
  lead,
  canWrite,
  onReject,
  onBack,
}: {
  lead: IncomingLead;
  canWrite: boolean;
  onReject: () => void;
  onBack: () => void;
}) {
  const actionable = canWrite && (lead.status === "new" || lead.status === "reviewing");
  const landingUrl = safeExternalUrl(lead.landingUrl);
  const referrerUrl = safeExternalUrl(lead.referrerUrl);

  return (
    <article id="incoming-lead-details" aria-live="polite" className="flex min-h-full min-w-0 flex-col">
      <header className="px-5 pb-2 pt-5 sm:px-7 sm:pt-7">
        <button type="button" onClick={onBack} className="back-link mb-5 lg:hidden"><ArrowLeft className="size-3.5" />Все обращения</button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="eyebrow">Текущая заявка</p>
            <h2 className="mt-3 break-words font-display text-[clamp(1.6rem,1.2rem+1vw,2.35rem)] font-semibold tracking-[-0.05em] text-[var(--text)]">{lead.contactName || lead.phone || lead.email || "Контакт не подписан"}</h2>
            <p className="mt-2 text-xs text-[var(--muted)]">Получена {dateFormatter.format(new Date(lead.receivedAt))}</p>
          </div>
          <StatusPill status={lead.status} />
        </div>
      </header>

      <div className="grid flex-1 content-start gap-6 px-5 py-6 sm:px-7">
        <div className="min-w-0 space-y-8">
          <section>
            <DetailLabel>Запрос клиента</DetailLabel>
            <p className="mt-3 max-w-2xl text-[clamp(1rem,0.96rem+0.15vw,1.12rem)] leading-7 text-[var(--text-secondary)]">{lead.serviceInterest || "Услуга не указана — уточните перед оформлением."}</p>
            {lead.objectAddress || lead.objectSize || lead.comment ? <dl className="mt-5 grid gap-3 text-sm text-[var(--text-secondary)]">
              {lead.objectAddress ? <div><dt className="text-xs text-[var(--muted)]">Адрес объекта</dt><dd className="mt-1 whitespace-pre-wrap">{lead.objectAddress}</dd></div> : null}
              {lead.objectSize ? <div><dt className="text-xs text-[var(--muted)]">Площадь / объём</dt><dd className="mt-1 whitespace-pre-wrap">{lead.objectSize}</dd></div> : null}
              {lead.comment ? <div><dt className="text-xs text-[var(--muted)]">Комментарий</dt><dd className="mt-1 whitespace-pre-wrap">{lead.comment}</dd></div> : null}
            </dl> : null}
          </section>

          <section className="grid gap-7 sm:grid-cols-2 sm:gap-8">
            <div>
              <DetailLabel>Связь</DetailLabel>
              <div className="mt-3 grid gap-3">
                {lead.phone ? <ContactLine icon={Phone}>{lead.phone}</ContactLine> : null}
                {lead.email ? <ContactLine icon={Mail}>{lead.email}</ContactLine> : null}
                {!lead.phone && !lead.email ? <ContactLine icon={CircleAlert}>Контактные данные отсутствуют</ContactLine> : null}
              </div>
            </div>
            <div>
              <DetailLabel>Источник</DetailLabel>
              <dl className="mt-3 grid gap-3 text-sm">
                <div>
                  <dt className="text-[var(--muted)]">Сайт</dt>
                  <dd className="mt-1 text-[var(--text-secondary)]">{lead.websiteName}</dd>
                  <dd className="mt-1 text-xs text-[var(--muted)]">{lead.websiteDomain}</dd>
                </div>
                {lead.utmSource || lead.utmMedium || lead.utmCampaign || lead.utmContent || lead.utmTerm ? <div>
                  <dt className="text-[var(--muted)]">Метки перехода</dt>
                  <dd className="mt-1 break-words text-[var(--text-secondary)]">{[
                    ["Источник", lead.utmSource], ["Канал", lead.utmMedium], ["Кампания", lead.utmCampaign],
                    ["Объявление", lead.utmContent], ["Запрос", lead.utmTerm],
                  ].filter((item) => item[1]).map((item) => `${item[0]}: ${item[1]}`).join(" · ")}</dd>
                </div> : <div className="text-[var(--muted)]">Без UTM-меток</div>}
              </dl>
              {landingUrl ? <a href={landingUrl} target="_blank" rel="noreferrer" className="focus-ring mt-5 inline-flex min-h-10 items-center gap-2 rounded-full px-1 text-xs text-[var(--accent-ink)] transition-colors hover:text-[var(--accent)]"><ExternalLink className="size-3.5" />Открыть страницу заявки</a> : null}
              {referrerUrl ? <a href={referrerUrl} target="_blank" rel="noreferrer" className="focus-ring mt-2 inline-flex min-h-10 items-center gap-2 rounded-full px-1 text-xs text-[var(--accent-ink)] transition-colors hover:text-[var(--accent)]"><ExternalLink className="size-3.5" />Страница перехода</a> : null}
            </div>
          </section>

          {lead.possibleClientId ? (
            <section className="rounded-[20px] border border-[var(--support-strong)]/30 bg-[var(--support-soft)] p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <UserRoundSearch className="mt-0.5 size-4 shrink-0 text-[var(--support-strong)]" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[var(--support-strong)]">В CRM найден возможный клиент</p>
                  <Link href={"/clients/" + lead.possibleClientId} className="focus-ring mt-2 inline-flex items-center gap-1.5 rounded-full text-sm text-[var(--text)] transition-colors hover:text-[var(--accent)]">{lead.possibleClientName}<ArrowRight className="size-3.5" /></Link>
                  <p className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">При оформлении он будет выбран автоматически. Проверьте совпадение контакта.</p>
                </div>
              </div>
            </section>
          ) : null}

          {lead.reviewNote ? (
            <section className="inset-panel px-4 py-4 sm:px-5">
              <DetailLabel>Решение</DetailLabel>
              <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{lead.reviewNote}</p>
              {lead.reviewerName ? <p className="mt-3 text-xs text-[var(--muted)]">{lead.reviewerName}{lead.reviewedAt ? " · " + dateFormatter.format(new Date(lead.reviewedAt)) : ""}</p> : null}
            </section>
          ) : null}
        </div>

        <aside className="border-t border-[var(--line)] pt-5">
          <DetailLabel>{actionable ? "Что произойдёт дальше" : "Статус обработки"}</DetailLabel>
          {actionable ? (
            <>
            <ol className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {["Клиент", "Объект", "Заказ", "Выезд"].map((label, index) => (
                <li key={label} className="flex items-center gap-2 rounded-[10px] bg-[var(--surface-inset)] p-3 text-xs text-[var(--text-secondary)]">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full border border-[var(--line-strong)] text-[10px]">{index + 1}</span>{label}
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs leading-5 text-[var(--muted)]">Данные сохранятся после подтверждения всех шагов оформления.</p>
            </>
          ) : (
            <div className="mt-5">
              <StatusPill status={lead.status} />
              <p className="mt-4 text-sm leading-6 text-[var(--text-secondary)]">{lead.status === "accepted" ? "Заявка уже стала частью рабочего процесса." : lead.status === "rejected" ? "Решение сохранено в истории. Заявка не будет превращена в заказ." : "Заявка ожидает следующего действия."}</p>
            </div>
          )}

          {lead.orderId ? (
            <Link href={"/orders/" + lead.orderId} className="focus-ring mt-7 flex min-h-12 items-center justify-between rounded-[15px] bg-[var(--success-bg)] px-4 text-xs font-medium text-[var(--success)] transition-colors hover:bg-[var(--support-soft)]">
              <span>Открыть созданный заказ {lead.orderNumber}</span>
              <ArrowRight className="size-4" />
            </Link>
          ) : null}
        </aside>
      </div>

      {actionable ? (
        <footer className="mt-auto border-t border-[var(--line)] px-5 pb-5 pt-4 sm:px-7 sm:pb-7">
          <div className="flex flex-wrap items-center justify-end gap-3">
            <button type="button" onClick={onReject} className="focus-ring h-12 rounded-[14px] border border-transparent px-4 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--danger-border)] hover:bg-[var(--danger-bg)] hover:text-[var(--danger-ink)]">Отклонить</button>
            <Link href={"/quick-order?sourceLead=" + lead.id} className="focus-ring flex h-12 items-center justify-center gap-2 rounded-[14px] bg-[var(--accent)] px-4 text-xs font-semibold text-[var(--on-accent)] transition-transform hover:bg-[var(--accent-strong)] active:translate-y-px">Уточнить и принять<ArrowRight className="size-4" /></Link>
          </div>
        </footer>
      ) : null}
    </article>
  );
}

export function IncomingLeadsWorkspace({
  snapshot,
  filter,
  canWrite,
  preview,
  initialSelectedId,
}: {
  snapshot: IncomingLeadSnapshot;
  filter: IncomingLeadListFilter;
  canWrite: boolean;
  preview: boolean;
  initialSelectedId: string | null;
}) {
  const [selectedId, setSelectedId] = useState(
    snapshot.leads.find((lead) => lead.id === initialSelectedId)?.id ?? snapshot.leads[0]?.id ?? null,
  );
  const router = useRouter();
  const [rejectingLead, setRejectingLead] = useState<IncomingLead | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(Boolean(initialSelectedId && snapshot.leads.some((lead) => lead.id === initialSelectedId)));
  const closeRejectDialog = useCallback(() => setRejectingLead(null), []);
  const selectedLead = useMemo(() => snapshot.leads.find((lead) => lead.id === selectedId) ?? (selectedId ? null : snapshot.leads[0] ?? null), [selectedId, snapshot.leads]);

  function selectLead(leadId: string) {
    setSelectedId(leadId);
    setMobileDetailOpen(true);
    if (!snapshot.leads.some((lead) => lead.id === leadId)) {
      const url = new URL(inboxHref(filter.status, filter.query), window.location.origin);
      url.searchParams.set("lead", leadId);
      router.push(`${url.pathname}${url.search}`);
    }
  }

  return (
    <div>
      <PageHeading eyebrow="Первичный разбор" title="Входящие заявки" description="Новые обращения с сайтов проверяются здесь до создания клиента, объекта, заказа и первого выезда." />

      <section className="mt-6">
        <header className="flex flex-col gap-4 border-b border-[var(--line)] pb-4 xl:flex-row xl:items-end xl:justify-between">
          <nav aria-label="Статусы входящих заявок" className="scrollbar-hidden flex max-w-full min-w-0 gap-1 overflow-x-auto rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-1">
            {tabs.map((tab) => {
              const active = filter.status === tab.value;
              return (
                <Link
                  key={tab.value}
                  href={inboxHref(tab.value, filter.query)}
                  aria-current={active ? "page" : undefined}
                  className={"focus-ring flex h-9 shrink-0 items-center gap-2 rounded-[10px] px-3 text-xs transition-colors " + (active ? "bg-[var(--accent)] font-semibold text-[var(--on-accent)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]")}
                >
                  <span>{tab.label}</span>
                  <span className={active ? "text-[var(--on-accent)]/75" : "text-[var(--muted)]"}>{snapshot.counts[tab.value]}</span>
                </Link>
              );
            })}
          </nav>
          <form action="/inbox" method="get" className="flex min-w-0 gap-2">
            {filter.status !== "all" ? <input type="hidden" name="status" value={filter.status} /> : null}
            <label className="relative min-w-0 flex-1 xl:w-80 xl:flex-none">
              <Search className="pointer-events-none absolute left-3.5 top-3 size-4 text-[var(--muted)]" />
              <span className="sr-only">Поиск во входящих заявках</span>
              <input name="query" defaultValue={filter.query} maxLength={200} placeholder="Имя, телефон, сайт, услуга…" className="focus-ring h-10 w-full rounded-[13px] border border-[var(--line-strong)] bg-[var(--surface-raised)] pl-10 pr-3.5 text-xs text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)]" />
            </label>
            <button type="submit" className="focus-ring h-10 rounded-[13px] border border-[var(--line-strong)] px-4 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-soft)] hover:text-[var(--text)]">Найти</button>
          </form>
        </header>

        {snapshot.leads.length ? (
          <div className="mt-5 grid min-w-0 items-start gap-4 lg:grid-cols-[18rem_minmax(0,1fr)] 2xl:grid-cols-[20rem_minmax(0,1fr)]">
            <section aria-label="Выбор входящей заявки" className={(mobileDetailOpen ? "hidden lg:flex " : "flex ") + "surface-panel relative z-20 min-w-0 flex-col overflow-visible"}>
              <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4 sm:px-6">
                <div>
                  <p className="text-sm font-semibold text-[var(--text)]">Очередь проверки</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">Выберите обращение для разбора</p>
                </div>
                <span className="inline-flex min-h-8 shrink-0 items-center whitespace-nowrap rounded-full bg-[var(--surface-inset)] px-3 text-[11px] text-[var(--text-secondary)]">Показано {snapshot.leads.length}{filter.query ? "" : ` из ${snapshot.counts[filter.status]}`}</span>
              </div>
              <div className="min-w-0 p-4 sm:p-5">
                <OrderPicker
                  label="Обращение"
                  value={selectedLead?.id ?? ""}
                  onChange={selectLead}
                  options={snapshot.leads.map((lead) => ({
                    value: lead.id,
                    label: lead.contactName || lead.phone || lead.email || "Без имени",
                    detail: `${lead.websiteName} · ${lead.serviceInterest || incomingLeadStatusLabels[lead.status]} · ${dateFormatter.format(new Date(lead.receivedAt))}`,
                  }))}
                  placeholder="Выберите заявку"
                  searchable
                  searchPlaceholder="Имя, телефон, сайт или услуга"
                  remoteUrl={`/api/v1/inbox/options?status=${filter.status}`}
                />
                <p className="mt-3 text-xs leading-5 text-[var(--muted)]">Поиск в списке находит заявки за пределами показанной очереди.</p>
              </div>
            </section>

            <section className={(mobileDetailOpen ? "flex " : "hidden lg:flex ") + "surface-panel min-h-[32rem] min-w-0 flex-col overflow-hidden"}>
              {selectedLead ? <LeadDetails lead={selectedLead} canWrite={canWrite} onReject={() => setRejectingLead(selectedLead)} onBack={() => setMobileDetailOpen(false)} /> : <div className="grid min-h-[20rem] flex-1 place-items-center px-8 text-center"><div><Link2 className="mx-auto size-7 text-[var(--muted)]" /><p className="mt-3 text-sm text-[var(--muted)]">{selectedId ? "Загружаем заявку…" : "Выберите заявку в очереди"}</p><button type="button" onClick={() => setMobileDetailOpen(false)} className="focus-ring mt-5 rounded-[12px] border border-[var(--line)] px-4 py-2 text-xs text-[var(--text-secondary)] lg:hidden">К списку заявок</button></div></div>}
            </section>
          </div>
        ) : (
          <div className="mt-4 grid justify-items-center rounded-[18px] border border-[var(--line)] bg-[var(--surface-raised)] px-8 py-16 text-center sm:py-20">
            <div><Inbox className="mx-auto size-6 text-[var(--muted)]" /><h2 className="mt-4 text-sm font-medium text-[var(--text)]">{filter.query || filter.status !== "all" ? "Заявки не найдены" : "Очередь пуста"}</h2><p className="mx-auto mt-2 max-w-xs text-xs leading-5 text-[var(--muted)]">{preview ? "В рабочем режиме обращения появятся после подключения webhook сайта." : "Новые обращения появятся автоматически после отправки формы на подключённом сайте."}</p></div>
          </div>
        )}
      </section>

      {rejectingLead ? <RejectLeadDialog key={rejectingLead.id} lead={rejectingLead} open onClose={closeRejectDialog} /> : null}
    </div>
  );
}
