"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Ban,
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
  new: "border-[var(--accent)]/25 bg-[var(--accent)]/[0.09] text-[var(--accent)]",
  reviewing: "border-[#65b7ee]/25 bg-[#65b7ee]/[0.08] text-[#95d2f1]",
  accepted: "border-[#69d3a4]/25 bg-[#69d3a4]/[0.08] text-[#91ddb9]",
  rejected: "border-[#ef646a]/25 bg-[#ef646a]/[0.08] text-[#ea999e]",
};

const statusDotTone: Record<IncomingLeadStatus, string> = {
  new: "bg-[var(--accent)]",
  reviewing: "bg-[#65b7ee]",
  accepted: "bg-[#69d3a4]",
  rejected: "bg-[#ef646a]",
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
    <span className="flex min-w-0 items-center gap-2.5 text-sm text-[#c4ccca]">
      <Icon className="size-4 shrink-0 text-[#738086]" />
      <span className="truncate">{children}</span>
    </span>
  );
}

function DetailLabel({ children }: { children: ReactNode }) {
  return <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#69757b]">{children}</p>;
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
          <div className="rounded-[18px] border border-[#ef646a]/15 bg-[#ef646a]/[0.045] px-4 py-3.5">
            <p className="text-sm font-medium text-white">{lead.contactName || lead.phone || lead.email || "Заявка без имени"}</p>
            <p className="mt-1 text-xs text-[#8d989d]">{lead.websiteName} · {dateFormatter.format(new Date(lead.receivedAt))}</p>
          </div>
          <label className="grid gap-2 text-xs text-[#9aa4a9]">
            <span>Причина *</span>
            <textarea name="reason" required minLength={3} maxLength={500} rows={6} placeholder="Например: дубль заявки, спам или клиент отказался" className="focus-ring resize-none rounded-[16px] border border-white/[0.08] bg-black/15 p-3.5 text-sm leading-6 text-white outline-none placeholder:text-[#566067]" />
            {state.fieldErrors.reason?.map((error) => <span key={error} className="text-xs text-[#dd858a]">{error}</span>)}
          </label>
          {state.message ? <p role="status" className={"rounded-[14px] px-4 py-3 text-xs leading-5 " + (state.status === "success" ? "bg-[#69d3a4]/[0.09] text-[#83d4b1]" : "bg-[#ef646a]/[0.09] text-[#d98b90]")}>{state.message}</p> : null}
        </div>
        <footer className="grid grid-cols-2 gap-2 border-t border-white/[0.06] bg-[#0d1317] p-4 sm:p-5">
          <button type="button" onClick={onClose} disabled={pending} className="focus-ring h-12 rounded-[14px] border border-white/[0.08] text-xs text-[#899399] transition-colors hover:bg-white/[0.04] hover:text-white">Отмена</button>
          <button type="submit" disabled={pending || state.status === "success"} className="focus-ring flex h-12 items-center justify-center gap-2 rounded-[14px] bg-[#ef646a] text-xs font-semibold text-white transition-transform active:translate-y-px disabled:opacity-60">{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Ban className="size-4" />}Отклонить</button>
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
        <button type="button" onClick={onBack} className="focus-ring mb-5 inline-flex h-9 items-center gap-2 rounded-full bg-white/[0.045] px-3 text-xs text-[#9aa4a8] transition-colors hover:bg-white/[0.08] hover:text-white lg:hidden"><ArrowLeft className="size-3.5" />К очереди</button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="eyebrow">Текущая заявка</p>
            <h2 className="mt-3 break-words font-display text-[clamp(1.6rem,1.2rem+1vw,2.35rem)] font-semibold tracking-[-0.05em] text-white">{lead.contactName || lead.phone || lead.email || "Контакт не подписан"}</h2>
            <p className="mt-2 text-xs text-[#7a858a]">Получена {dateFormatter.format(new Date(lead.receivedAt))}</p>
          </div>
          <StatusPill status={lead.status} />
        </div>
      </header>

      <div className="grid flex-1 content-start gap-7 px-5 py-7 sm:px-7 sm:py-8 xl:grid-cols-[minmax(0,1.1fr)_minmax(17rem,0.9fr)] xl:gap-10">
        <div className="min-w-0 space-y-8">
          <section>
            <DetailLabel>Запрос клиента</DetailLabel>
            <p className="mt-3 max-w-2xl text-[clamp(1rem,0.96rem+0.15vw,1.12rem)] leading-7 text-[#e0e4e0]">{lead.serviceInterest || "Услуга не указана — уточните перед оформлением."}</p>
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
                  <dt className="text-[#717d83]">Сайт</dt>
                  <dd className="mt-1 text-[#d2d8d4]">{lead.websiteName}</dd>
                  <dd className="mt-1 text-xs text-[#788389]">{lead.websiteDomain}</dd>
                </div>
                <div>
                  <dt className="text-[#717d83]">UTM</dt>
                  <dd className="mt-1 text-[#d2d8d4]">{lead.utmSource || "Без метки"}</dd>
                  <dd className="mt-1 text-xs text-[#788389]">{lead.utmCampaign || "Кампания не указана"}</dd>
                </div>
              </dl>
              {landingUrl ? <a href={landingUrl} target="_blank" rel="noreferrer" className="focus-ring mt-5 inline-flex min-h-10 items-center gap-2 rounded-full px-1 text-xs text-[#aeb8b9] transition-colors hover:text-white"><ExternalLink className="size-3.5" />Открыть страницу заявки</a> : null}
            </div>
          </section>

          {lead.possibleClientId ? (
            <section className="rounded-[20px] border border-[#65b7ee]/15 bg-[#65b7ee]/[0.045] p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <UserRoundSearch className="mt-0.5 size-4 shrink-0 text-[#7bc4ef]" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#d7e8f0]">В CRM найден возможный клиент</p>
                  <Link href={"/clients/" + lead.possibleClientId} className="focus-ring mt-2 inline-flex items-center gap-1.5 rounded-full text-sm text-[#9bd1ee] transition-colors hover:text-white">{lead.possibleClientName}<ArrowRight className="size-3.5" /></Link>
                  <p className="mt-2 text-xs leading-5 text-[#91a2aa]">При оформлении он будет выбран автоматически. Проверьте совпадение контакта.</p>
                </div>
              </div>
            </section>
          ) : null}

          {lead.reviewNote ? (
            <section className="rounded-[20px] bg-white/[0.035] px-4 py-4 sm:px-5">
              <DetailLabel>Решение</DetailLabel>
              <p className="mt-2 text-sm leading-6 text-[#c1c8c7]">{lead.reviewNote}</p>
              {lead.reviewerName ? <p className="mt-3 text-xs text-[#758087]">{lead.reviewerName}{lead.reviewedAt ? " · " + dateFormatter.format(new Date(lead.reviewedAt)) : ""}</p> : null}
            </section>
          ) : null}
        </div>

        <aside className="rounded-[24px] border border-white/[0.07] bg-black/[0.12] p-5 sm:p-6">
          <DetailLabel>{actionable ? "Что произойдёт дальше" : "Статус обработки"}</DetailLabel>
          {actionable ? (
            <ol className="mt-5 space-y-5">
              <li className="flex gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--accent)]/[0.11] font-display text-[10px] font-semibold text-[var(--accent)]">01</span>
                <div><p className="text-sm text-[#d9ded9]">Уточнить данные</p><p className="mt-1 text-xs leading-5 text-[#7d888d]">Проверьте клиента, адрес и состав работ.</p></div>
              </li>
              <li className="flex gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-white/[0.055] font-display text-[10px] font-semibold text-[#a7b0b1]">02</span>
                <div><p className="text-sm text-[#d9ded9]">Создать рабочий заказ</p><p className="mt-1 text-xs leading-5 text-[#7d888d]">CRM свяжет обращение с клиентом и объектом.</p></div>
              </li>
              <li className="flex gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-white/[0.055] font-display text-[10px] font-semibold text-[#a7b0b1]">03</span>
                <div><p className="text-sm text-[#d9ded9]">Запланировать выезд</p><p className="mt-1 text-xs leading-5 text-[#7d888d]">После подтверждения заявка попадёт в расписание.</p></div>
              </li>
            </ol>
          ) : (
            <div className="mt-5">
              <StatusPill status={lead.status} />
              <p className="mt-4 text-sm leading-6 text-[#aab3b5]">{lead.status === "accepted" ? "Заявка уже стала частью рабочего процесса." : lead.status === "rejected" ? "Решение сохранено в истории. Заявка не будет превращена в заказ." : "Заявка ожидает следующего действия."}</p>
            </div>
          )}

          {lead.orderId ? (
            <Link href={"/orders/" + lead.orderId} className="focus-ring mt-7 flex min-h-12 items-center justify-between rounded-[15px] bg-[#69d3a4]/[0.09] px-4 text-xs font-medium text-[#9addbd] transition-colors hover:bg-[#69d3a4]/[0.14]">
              <span>Открыть созданный заказ {lead.orderNumber}</span>
              <ArrowRight className="size-4" />
            </Link>
          ) : null}
        </aside>
      </div>

      {actionable ? (
        <footer className="mt-auto px-5 pb-5 sm:px-7 sm:pb-7">
          <div className="grid gap-2 rounded-[20px] border border-white/[0.07] bg-[#10171a] p-2 sm:grid-cols-[minmax(10rem,0.7fr)_minmax(16rem,1.3fr)]">
            <button type="button" onClick={onReject} className="focus-ring h-12 rounded-[14px] px-4 text-xs text-[#abb3b6] transition-colors hover:bg-[#ef646a]/[0.08] hover:text-[#ed9ca0]">Отклонить</button>
            <Link href={"/quick-order?sourceLead=" + lead.id} className="focus-ring flex h-12 items-center justify-center gap-2 rounded-[14px] bg-[var(--accent)] px-4 text-xs font-semibold text-[#111509] transition-transform hover:bg-[var(--accent-strong)] active:translate-y-px">Уточнить и принять<ArrowRight className="size-4" /></Link>
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
    <div className="grid content-start gap-2.5 p-3 sm:p-4">
      {leads.map((lead) => {
        const selected = selectedId === lead.id;
        return (
          <button
            key={lead.id}
            type="button"
            onClick={() => onSelect(lead.id)}
            aria-current={selected ? "true" : undefined}
            aria-controls="incoming-lead-details"
            className={"focus-ring block w-full rounded-[18px] border px-4 py-4 text-left transition-[background-color,border-color,transform] active:translate-y-px " + (selected ? "border-[var(--accent)]/25 bg-[var(--accent)]/[0.08]" : "border-transparent bg-white/[0.018] hover:border-white/[0.08] hover:bg-white/[0.045]")}
          >
            <span className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className={"size-1.5 shrink-0 rounded-full " + statusDotTone[lead.status]} />
                  <strong className="truncate text-sm font-medium text-[#e2e6e2]">{lead.contactName || lead.phone || lead.email || "Без имени"}</strong>
                </span>
                <span className="mt-2 block truncate text-xs text-[#8a959a]">{lead.serviceInterest || "Услуга не указана"}</span>
              </span>
              <time dateTime={lead.receivedAt} className="shrink-0 text-[11px] text-[#6f7a80]">{dateFormatter.format(new Date(lead.receivedAt))}</time>
            </span>
            <span className="mt-3 flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-1.5 truncate text-[11px] text-[#778288]"><Globe2 className="size-3 shrink-0" />{lead.websiteDomain}</span>
              {lead.possibleClientId ? <span className="shrink-0 rounded-full bg-[#65b7ee]/[0.09] px-2 py-1 text-[10px] text-[#8acbed]">Совпадение</span> : null}
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

      <section className="surface-panel mt-[clamp(1.5rem,1.1rem+0.8vw,2.25rem)] overflow-hidden rounded-[30px] p-3 sm:p-4">
        <div className="flex flex-col gap-3 rounded-[22px] bg-black/[0.1] p-3 sm:p-4 xl:flex-row xl:items-center xl:justify-between">
          <nav aria-label="Статусы входящих заявок" className="scrollbar-hidden flex min-w-0 gap-1 overflow-x-auto rounded-[15px] bg-white/[0.035] p-1">
            {tabs.map((tab) => {
              const active = filter.status === tab.value;
              return (
                <Link
                  key={tab.value}
                  href={inboxHref(tab.value, filter.query)}
                  aria-current={active ? "page" : undefined}
                  className={"focus-ring flex h-9 shrink-0 items-center gap-2 rounded-[11px] px-3 text-xs transition-colors " + (active ? "bg-[var(--accent)] text-[#111509]" : "text-[#879298] hover:bg-white/[0.05] hover:text-white")}
                >
                  <span>{tab.label}</span>
                  <span className={active ? "text-[#495015]" : "text-[#667279]"}>{snapshot.counts[tab.value]}</span>
                </Link>
              );
            })}
          </nav>
          <form action="/inbox" method="get" className="flex min-w-0 gap-2">
            {filter.status !== "all" ? <input type="hidden" name="status" value={filter.status} /> : null}
            <label className="relative min-w-0 flex-1 xl:w-80 xl:flex-none">
              <Search className="pointer-events-none absolute left-3.5 top-3 size-4 text-[#67737a]" />
              <span className="sr-only">Поиск во входящих заявках</span>
              <input name="query" defaultValue={filter.query} maxLength={200} placeholder="Имя, телефон, сайт, услуга…" className="focus-ring h-10 w-full rounded-[13px] border border-white/[0.07] bg-[#0a0f12] pl-10 pr-3.5 text-xs text-white outline-none placeholder:text-[#59646a]" />
            </label>
            <button type="submit" className="focus-ring h-10 rounded-[13px] border border-white/[0.08] px-4 text-xs text-[#abb4b7] transition-colors hover:bg-white/[0.055] hover:text-white">Найти</button>
          </form>
        </div>

        <div className="mt-3 grid gap-3 lg:min-h-[42rem] lg:grid-cols-[minmax(20rem,0.76fr)_minmax(0,1.24fr)]">
          <section aria-label="Список входящих заявок" className={(mobileDetailOpen ? "hidden lg:flex " : "flex ") + "min-h-0 flex-col overflow-hidden rounded-[24px] border border-white/[0.06] bg-[#0d1417]"}>
            <div className="flex items-center justify-between px-5 pb-2 pt-5 sm:px-6">
              <div>
                <p className="text-sm font-semibold text-white">Очередь проверки</p>
                <p className="mt-1 text-xs text-[#778288]">Выберите обращение для разбора</p>
              </div>
              <span className="inline-flex min-h-8 items-center rounded-full bg-white/[0.05] px-3 text-[11px] text-[#9aa4a7]">{snapshot.leads.length} из {snapshot.counts[filter.status]}</span>
            </div>
            {snapshot.leads.length ? <div className="min-h-0 flex-1 overflow-y-auto"><LeadQueue leads={snapshot.leads} selectedId={selectedLead?.id ?? null} onSelect={selectLead} /></div> : <div className="grid min-h-72 flex-1 place-items-center p-8 text-center"><div><Inbox className="mx-auto size-6 text-[#657078]" /><h2 className="mt-4 text-sm font-medium text-white">{filter.query || filter.status !== "all" ? "Заявки не найдены" : "Очередь пуста"}</h2><p className="mx-auto mt-2 max-w-xs text-xs leading-5 text-[#778187]">{preview ? "В рабочем режиме обращения появятся после подключения webhook сайта." : "Новые обращения появятся автоматически после отправки формы на подключённом сайте."}</p></div></div>}
          </section>

          <section className={(mobileDetailOpen ? "flex " : "hidden lg:flex ") + "min-w-0 flex-col overflow-hidden rounded-[24px] border border-white/[0.06] bg-[#10171a]"}>
            {selectedLead ? <LeadDetails lead={selectedLead} canWrite={canWrite} onReject={() => setRejectingLead(selectedLead)} onBack={() => setMobileDetailOpen(false)} /> : <div className="grid min-h-[20rem] flex-1 place-items-center px-8 text-center"><div><Link2 className="mx-auto size-7 text-[#59656b]" /><p className="mt-3 text-sm text-[#7c878d]">Выберите заявку в очереди</p></div></div>}
          </section>
        </div>
      </section>

      {rejectingLead ? <RejectLeadDialog key={rejectingLead.id} lead={rejectingLead} open onClose={closeRejectDialog} /> : null}
    </div>
  );
}
