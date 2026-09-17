"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  Globe2,
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

function OverviewMetric({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: number;
  detail: string;
  icon: typeof Inbox;
}) {
  return (
    <article className="surface-panel flex min-w-0 items-center gap-3 p-4 sm:p-5">
      <span className="grid size-10 shrink-0 place-items-center rounded-[12px] border border-[var(--accent)]/25 bg-[var(--accent-soft)] text-[var(--accent-ink)]">
        <Icon className="size-4.5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.11em] text-[var(--muted)]">
          {label}
        </p>
        <div className="mt-1.5 flex min-w-0 items-baseline gap-2">
          <strong className="font-display text-2xl font-semibold text-[var(--text)]">
            {value}
          </strong>
          <span className="truncate text-[10px] text-[var(--muted)]">
            {detail}
          </span>
        </div>
      </div>
    </article>
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

  return (
    <article id="incoming-lead-details" aria-live="polite" className="flex min-h-full min-w-0 flex-col">
      <header className="px-5 pb-2 pt-5 sm:px-7 sm:pt-7">
        <button type="button" onClick={onBack} className="focus-ring mb-5 inline-flex h-9 items-center gap-2 rounded-full bg-[var(--surface-soft)] px-3 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-inset)] hover:text-[var(--text)] lg:hidden"><ArrowLeft className="size-3.5" />К очереди</button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="eyebrow">Текущая заявка</p>
            <h2 className="mt-3 break-words font-display text-[clamp(1.6rem,1.2rem+1vw,2.35rem)] font-semibold tracking-[-0.05em] text-[var(--text)]">{lead.contactName || lead.phone || lead.email || "Контакт не подписан"}</h2>
            <p className="mt-2 text-xs text-[var(--muted)]">Получена {dateFormatter.format(new Date(lead.receivedAt))}</p>
          </div>
          <StatusPill status={lead.status} />
        </div>
      </header>

      <div className="grid flex-1 content-start gap-7 px-5 py-7 sm:px-7 sm:py-8 xl:grid-cols-[minmax(0,1.1fr)_minmax(17rem,0.9fr)] xl:gap-10">
        <div className="min-w-0 space-y-8">
          <section>
            <DetailLabel>Запрос клиента</DetailLabel>
            <p className="mt-3 max-w-2xl text-[clamp(1rem,0.96rem+0.15vw,1.12rem)] leading-7 text-[var(--text-secondary)]">{lead.serviceInterest || "Услуга не указана — уточните перед оформлением."}</p>
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
                <div>
                  <dt className="text-[var(--muted)]">UTM</dt>
                  <dd className="mt-1 text-[var(--text-secondary)]">{lead.utmSource || "Без метки"}</dd>
                  <dd className="mt-1 text-xs text-[var(--muted)]">{lead.utmCampaign || "Кампания не указана"}</dd>
                </div>
              </dl>
              {landingUrl ? <a href={landingUrl} target="_blank" rel="noreferrer" className="focus-ring mt-5 inline-flex min-h-10 items-center gap-2 rounded-full px-1 text-xs text-[var(--accent-ink)] transition-colors hover:text-[var(--accent)]"><ExternalLink className="size-3.5" />Открыть страницу заявки</a> : null}
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
            <section className="rounded-[20px] bg-[var(--surface-raised)] px-4 py-4 sm:px-5">
              <DetailLabel>Решение</DetailLabel>
              <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{lead.reviewNote}</p>
              {lead.reviewerName ? <p className="mt-3 text-xs text-[var(--muted)]">{lead.reviewerName}{lead.reviewedAt ? " · " + dateFormatter.format(new Date(lead.reviewedAt)) : ""}</p> : null}
            </section>
          ) : null}
        </div>

        <aside className="border-t border-[var(--line)] pt-6 xl:border-l xl:border-t-0 xl:pl-10 xl:pt-0">
          <DetailLabel>{actionable ? "Что произойдёт дальше" : "Статус обработки"}</DetailLabel>
          {actionable ? (
            <ol className="mt-5 space-y-5">
              <li className="flex gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--accent)]/[0.11] font-display text-[10px] font-semibold text-[var(--accent)]">01</span>
                <div><p className="text-sm text-[var(--text-secondary)]">Уточнить данные</p><p className="mt-1 text-xs leading-5 text-[var(--muted)]">Проверьте клиента, адрес и состав работ.</p></div>
              </li>
              <li className="flex gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--surface-inset)] font-display text-[10px] font-semibold text-[var(--muted)]">02</span>
                <div><p className="text-sm text-[var(--text-secondary)]">Создать рабочий заказ</p><p className="mt-1 text-xs leading-5 text-[var(--muted)]">CRM свяжет обращение с клиентом и объектом.</p></div>
              </li>
              <li className="flex gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--surface-inset)] font-display text-[10px] font-semibold text-[var(--muted)]">03</span>
                <div><p className="text-sm text-[var(--text-secondary)]">Запланировать выезд</p><p className="mt-1 text-xs leading-5 text-[var(--muted)]">После подтверждения заявка попадёт в расписание.</p></div>
              </li>
            </ol>
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
          <div className="grid gap-2 sm:grid-cols-[minmax(10rem,0.7fr)_minmax(16rem,1.3fr)]">
            <button type="button" onClick={onReject} className="focus-ring h-12 rounded-[14px] border border-transparent px-4 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--danger-border)] hover:bg-[var(--danger-bg)] hover:text-[var(--danger-ink)]">Отклонить</button>
            <Link href={"/quick-order?sourceLead=" + lead.id} className="focus-ring flex h-12 items-center justify-center gap-2 rounded-[14px] bg-[var(--accent)] px-4 text-xs font-semibold text-[var(--on-accent)] transition-transform hover:bg-[var(--accent-strong)] active:translate-y-px">Уточнить и принять<ArrowRight className="size-4" /></Link>
          </div>
        </footer>
      ) : null}
    </article>
  );
}

function LeadQueue({
  leads,
  selectedId,
  onSelect,
}: {
  leads: IncomingLead[];
  selectedId: string | null;
  onSelect: (leadId: string) => void;
}) {
  return (
    <div className="grid gap-2.5 p-3 sm:grid-cols-2 sm:p-4 2xl:grid-cols-3">
      {leads.map((lead) => {
        const selected = selectedId === lead.id;
        return (
          <button
            key={lead.id}
            type="button"
            onClick={() => onSelect(lead.id)}
            aria-current={selected ? "true" : undefined}
            aria-controls="incoming-lead-details"
            className={"focus-ring block min-h-36 w-full rounded-[15px] border p-4 text-left transition-[background-color,border-color,transform] active:translate-y-px " + (selected ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line)] bg-[var(--surface)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-soft)]")}
          >
            <span className="flex min-h-20 items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className={"size-1.5 shrink-0 rounded-full " + statusDotTone[lead.status]} />
                  <strong className="line-clamp-2 text-sm font-medium leading-5 text-[var(--text)]">{lead.contactName || lead.phone || lead.email || "Без имени"}</strong>
                </span>
                <span className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--text-secondary)]">{lead.serviceInterest || "Услуга не указана"}</span>
              </span>
              <time dateTime={lead.receivedAt} className="shrink-0 text-[11px] text-[var(--muted)]">{dateFormatter.format(new Date(lead.receivedAt))}</time>
            </span>
            <span className="mt-3 flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-1.5 truncate text-[11px] text-[var(--muted)]"><Globe2 className="size-3 shrink-0" />{lead.websiteDomain}</span>
              {lead.possibleClientId ? <span className="shrink-0 rounded-full bg-[var(--support-soft)] px-2 py-1 text-[10px] text-[var(--support-strong)]">Совпадение</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function IncomingLeadsWorkspace({
  snapshot,
  filter,
  canWrite,
  preview,
}: {
  snapshot: IncomingLeadSnapshot;
  filter: IncomingLeadListFilter;
  canWrite: boolean;
  preview: boolean;
}) {
  const [selectedId, setSelectedId] = useState(snapshot.leads[0]?.id ?? null);
  const [rejectingLead, setRejectingLead] = useState<IncomingLead | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const closeRejectDialog = useCallback(() => setRejectingLead(null), []);
  const selectedLead = useMemo(() => snapshot.leads.find((lead) => lead.id === selectedId) ?? snapshot.leads[0] ?? null, [selectedId, snapshot.leads]);

  function selectLead(leadId: string) {
    setSelectedId(leadId);
    setMobileDetailOpen(true);
  }

  return (
    <div>
      <PageHeading eyebrow="Первичный разбор" title="Входящие заявки" description="Новые обращения с сайтов проверяются здесь до создания клиента, объекта, заказа и первого выезда." />

      <section aria-labelledby="incoming-overview-heading" className="mt-[clamp(1.5rem,1.1rem+0.8vw,2.25rem)]">
        <h2 id="incoming-overview-heading" className="eyebrow">
          Обзор данных
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <OverviewMetric label="Всего заявок" value={snapshot.counts.all} detail="за всё время" icon={Inbox} />
          <OverviewMetric label="Требуют решения" value={snapshot.counts.new + snapshot.counts.reviewing} detail={`${snapshot.counts.new} новых`} icon={CircleAlert} />
          <OverviewMetric label="Принятые" value={snapshot.counts.accepted} detail="переданы в работу" icon={CheckCircle2} />
          <OverviewMetric label="Отклонённые" value={snapshot.counts.rejected} detail="сохранены в истории" icon={Ban} />
        </div>
      </section>

      <section className="surface-panel mt-5 overflow-hidden p-4 sm:p-5">
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
          <div className="mt-4 grid min-w-0 gap-4">
            <section aria-label="Список входящих заявок" className={(mobileDetailOpen ? "hidden lg:flex " : "flex ") + "min-w-0 flex-col overflow-hidden rounded-[18px] border border-[var(--line)] bg-[var(--surface-raised)]"}>
              <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4 sm:px-6">
                <div>
                  <p className="text-sm font-semibold text-[var(--text)]">Очередь проверки</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">Выберите обращение для разбора</p>
                </div>
                <span className="inline-flex min-h-8 items-center rounded-full bg-[var(--surface-inset)] px-3 text-[11px] text-[var(--text-secondary)]">{snapshot.leads.length} из {snapshot.counts[filter.status]}</span>
              </div>
              <div className="scrollbar-hidden min-h-0 overflow-y-auto lg:max-h-[34rem]"><LeadQueue leads={snapshot.leads} selectedId={selectedLead?.id ?? null} onSelect={selectLead} /></div>
            </section>

            <section className={(mobileDetailOpen ? "flex " : "hidden lg:flex ") + "min-h-[32rem] min-w-0 flex-col overflow-hidden rounded-[18px] border border-[var(--line)] bg-[var(--surface-raised)]"}>
              {selectedLead ? <LeadDetails lead={selectedLead} canWrite={canWrite} onReject={() => setRejectingLead(selectedLead)} onBack={() => setMobileDetailOpen(false)} /> : <div className="grid min-h-[20rem] flex-1 place-items-center px-8 text-center"><div><Link2 className="mx-auto size-7 text-[var(--muted)]" /><p className="mt-3 text-sm text-[var(--muted)]">Выберите заявку в очереди</p></div></div>}
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
