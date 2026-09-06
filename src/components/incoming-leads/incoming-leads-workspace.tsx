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
import { useActionState, useCallback, useEffect, useMemo, useState } from "react";
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

const statusTone: Record<IncomingLeadStatus, string> = {
  new: "border-[var(--accent)] text-[var(--accent)]",
  reviewing: "border-[#65b7ee] text-[#7bc4ef]",
  accepted: "border-[#69d3a4] text-[#7ad5ad]",
  rejected: "border-[#ef646a] text-[#e48d92]",
};

const statusMarkerTone: Record<IncomingLeadStatus, string> = {
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

function ContactLine({ icon: Icon, children }: { icon: typeof Phone; children: React.ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-2 text-xs text-[#a4adb0]">
      <Icon className="size-3.5 shrink-0 text-[#647078]" />
      <span className="truncate">{children}</span>
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
          <div className="border-l-2 border-[#ef646a] bg-[#ef646a]/[0.035] px-4 py-3">
            <p className="text-sm font-medium text-white">{lead.contactName || lead.phone || lead.email || "Заявка без имени"}</p>
            <p className="mt-1 text-xs text-[#7b858b]">{lead.websiteName} · {dateFormatter.format(new Date(lead.receivedAt))}</p>
          </div>
          <label className="grid gap-2 text-xs text-[#9aa4a9]">
            <span>Причина *</span>
            <textarea name="reason" required minLength={3} maxLength={500} rows={6} placeholder="Например: дубль заявки, спам или клиент отказался" className="focus-ring resize-none rounded-[12px] border border-white/[0.08] bg-black/15 p-3.5 text-sm leading-6 text-white outline-none placeholder:text-[#566067]" />
            {state.fieldErrors.reason?.map((error) => <span key={error} className="text-xs text-[#dd858a]">{error}</span>)}
          </label>
          {state.message ? <p role="status" className={"border-l-2 px-4 py-3 text-xs leading-5 " + (state.status === "success" ? "border-[#69d3a4] bg-[#69d3a4]/[0.05] text-[#83d4b1]" : "border-[#ef646a] bg-[#ef646a]/[0.05] text-[#d98b90]")}>{state.message}</p> : null}
        </div>
        <footer className="grid grid-cols-2 gap-2 border-t border-white/[0.07] bg-[#0d1317] p-4 sm:p-5">
          <button type="button" onClick={onClose} disabled={pending} className="focus-ring h-12 border border-white/[0.08] text-xs text-[#899399] hover:text-white">Отмена</button>
          <button type="submit" disabled={pending || state.status === "success"} className="focus-ring flex h-12 items-center justify-center gap-2 bg-[#ef646a] text-xs font-semibold text-white disabled:opacity-60">{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Ban className="size-4" />}Отклонить</button>
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
    <article id="incoming-lead-details" aria-live="polite" className="flex min-h-0 flex-col">
      <header className="border-b border-white/[0.07] px-4 py-5 sm:px-6">
        <button type="button" onClick={onBack} className="focus-ring mb-4 flex h-9 items-center gap-2 text-xs text-[#8e989d] hover:text-white lg:hidden"><ArrowLeft className="size-4" />К очереди</button>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="eyebrow">Входящее обращение</p>
            <h2 className="mt-3 break-words font-display text-2xl font-semibold tracking-[-0.04em] text-white">{lead.contactName || "Контакт не подписан"}</h2>
            <p className="mt-2 text-xs text-[#7b858b]">Получено {dateFormatter.format(new Date(lead.receivedAt))}</p>
          </div>
          <span className={"shrink-0 border-l-2 pl-2 text-[10px] font-semibold uppercase tracking-[0.12em] " + statusTone[lead.status]}>{incomingLeadStatusLabels[lead.status]}</span>
        </div>
      </header>

      <div className="divide-y divide-white/[0.07] px-4 sm:px-6">
        <section className="py-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--accent)]">Запрос клиента</p>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-[#d8ddda]">{lead.serviceInterest || "Услуга не указана — уточните перед оформлением."}</p>
        </section>

        <section className="grid gap-5 py-5 sm:grid-cols-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[#667178]">Связь</p>
            <div className="mt-3 grid gap-2.5">{lead.phone ? <ContactLine icon={Phone}>{lead.phone}</ContactLine> : null}{lead.email ? <ContactLine icon={Mail}>{lead.email}</ContactLine> : null}{!lead.phone && !lead.email ? <ContactLine icon={CircleAlert}>Контактные данные отсутствуют</ContactLine> : null}</div>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[#667178]">Источник</p>
            <dl className="mt-3 grid gap-3 text-xs">
              <div><dt className="text-[#687279]">Сайт</dt><dd className="mt-1 text-[#d1d7d3]">{lead.websiteName}</dd><dd className="mt-1 text-[11px] text-[#788288]">{lead.websiteDomain}</dd></div>
              <div><dt className="text-[#687279]">UTM</dt><dd className="mt-1 text-[#d1d7d3]">{lead.utmSource || "Без метки"}</dd><dd className="mt-1 text-[11px] text-[#788288]">{lead.utmCampaign || "Кампания не указана"}</dd></div>
            </dl>
            {landingUrl ? <a href={landingUrl} target="_blank" rel="noreferrer" className="focus-ring mt-4 inline-flex min-h-10 items-center gap-2 border-b border-white/[0.12] text-xs text-[#aeb7ba] hover:border-[var(--accent)] hover:text-white"><ExternalLink className="size-3.5" />Открыть страницу заявки</a> : null}
          </div>
        </section>

        {lead.possibleClientId ? (
          <section className="border-l-2 border-[#65b7ee] py-5 pl-4">
            <div className="flex gap-3">
              <UserRoundSearch className="mt-0.5 size-4 shrink-0 text-[#65b7ee]" />
              <div>
                <p className="text-xs font-semibold text-[#cbdde8]">В CRM найден возможный клиент</p>
                <Link href={"/clients/" + lead.possibleClientId} className="focus-ring mt-2 inline-flex items-center gap-1 text-xs text-[#8fcbed] hover:text-white">{lead.possibleClientName}<ArrowRight className="size-3.5" /></Link>
                <p className="mt-2 text-[11px] leading-5 text-[#718996]">При оформлении он будет выбран автоматически. Проверьте совпадение контакта.</p>
              </div>
            </div>
          </section>
        ) : null}

        {lead.reviewNote ? (
          <section className="border-l-2 border-white/[0.16] py-5 pl-4">
            <p className="text-[10px] uppercase tracking-[0.15em] text-[#667178]">Решение</p>
            <p className="mt-2 text-sm leading-6 text-[#b9c1c4]">{lead.reviewNote}</p>
            {lead.reviewerName ? <p className="mt-2 text-[11px] text-[#748087]">{lead.reviewerName}{lead.reviewedAt ? " · " + dateFormatter.format(new Date(lead.reviewedAt)) : ""}</p> : null}
          </section>
        ) : null}

        {lead.orderId ? (
          <section className="py-5">
            <Link href={"/orders/" + lead.orderId} className="focus-ring flex min-h-12 items-center justify-between border-l-2 border-[#69d3a4] bg-[#69d3a4]/[0.035] px-4 text-xs font-medium text-[#9addbd] hover:bg-[#69d3a4]/[0.08]"><span>Открыть созданный заказ {lead.orderNumber}</span><ArrowRight className="size-4" /></Link>
          </section>
        ) : null}
      </div>

      {actionable ? (
        <footer className="mt-auto grid gap-2 border-t border-white/[0.08] bg-black/[0.08] p-4 sm:grid-cols-[0.7fr_1.3fr] sm:p-5">
          <button type="button" onClick={onReject} className="focus-ring h-12 border border-white/[0.09] text-xs text-[#a5adb1] hover:border-[#ef646a]/25 hover:text-[#df8a8f]">Отклонить</button>
          <Link href={"/quick-order?sourceLead=" + lead.id} className="focus-ring flex h-12 items-center justify-center gap-2 bg-[var(--accent)] text-xs font-semibold text-[#111509]">Уточнить и принять<ArrowRight className="size-4" /></Link>
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
    <div className="divide-y divide-white/[0.055]">
      {leads.map((lead) => {
        const selected = selectedId === lead.id;
        return (
          <button
            key={lead.id}
            type="button"
            onClick={() => onSelect(lead.id)}
            aria-current={selected ? "true" : undefined}
            aria-controls="incoming-lead-details"
            className={"focus-ring relative block min-h-[6.5rem] w-full px-4 py-4 text-left transition-colors sm:px-5 " + (selected ? "bg-white/[0.045]" : "hover:bg-white/[0.025]")}
          >
            <span className={"absolute inset-y-3 left-0 w-0.5 " + statusMarkerTone[lead.status]} />
            <span className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <strong className="block truncate text-sm font-medium text-[#e2e6e2]">{lead.contactName || lead.phone || lead.email || "Без имени"}</strong>
                <span className="mt-1.5 block truncate text-xs text-[#7b858b]">{lead.serviceInterest || "Услуга не указана"}</span>
              </span>
              <time dateTime={lead.receivedAt} className="shrink-0 text-[11px] text-[#69747a]">{dateFormatter.format(new Date(lead.receivedAt))}</time>
            </span>
            <span className="mt-3 flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-1.5 truncate text-[11px] text-[#6f7a80]"><Globe2 className="size-3 shrink-0" />{lead.websiteDomain}</span>
              {lead.possibleClientId ? <span className="shrink-0 text-[11px] text-[#7fbfe4]">Есть совпадение</span> : null}
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
      <PageHeading eyebrow="Первичный разбор" title="Входящие заявки" description="Новые обращения с сайтов сначала проверяются здесь. Только подтверждённая заявка создаёт клиента, объект, заказ и первый выезд." />

      <section className="surface-panel mt-[clamp(1.5rem,1.1rem+0.8vw,2.25rem)]">
        <div className="border-b border-white/[0.07]">
          <div className="flex flex-col gap-3 p-3 sm:p-4 xl:flex-row xl:items-end xl:justify-between">
            <nav aria-label="Статусы входящих заявок" className="flex min-w-0 overflow-x-auto">
              {tabs.map((tab) => {
                const active = filter.status === tab.value;
                return (
                  <Link
                    key={tab.value}
                    href={inboxHref(tab.value, filter.query)}
                    aria-current={active ? "page" : undefined}
                    className={"focus-ring flex h-10 shrink-0 items-center gap-2 border-b-2 px-3 text-xs transition-colors " + (active ? "border-[var(--accent)] text-white" : "border-transparent text-[#7b858b] hover:border-white/[0.15] hover:text-white")}
                  >
                    <span>{tab.label}</span>
                    <span className={active ? "text-[var(--accent)]" : "text-[#5d686e]"}>{snapshot.counts[tab.value]}</span>
                  </Link>
                );
              })}
            </nav>
            <form action="/inbox" method="get" className="flex min-w-0 gap-2">
              {filter.status !== "all" ? <input type="hidden" name="status" value={filter.status} /> : null}
              <label className="relative min-w-0 flex-1 xl:w-80 xl:flex-none">
                <Search className="pointer-events-none absolute left-3 top-3 size-4 text-[#5e6970]" />
                <span className="sr-only">Поиск во входящих заявках</span>
                <input name="query" defaultValue={filter.query} maxLength={200} placeholder="Имя, телефон, сайт, услуга…" className="focus-ring h-10 w-full border border-white/[0.075] bg-black/15 pl-9 pr-3 text-xs text-white outline-none placeholder:text-[#566168]" />
              </label>
              <button type="submit" className="focus-ring h-10 border border-white/[0.075] px-3 text-xs text-[#a3adb1] hover:bg-white/[0.04] hover:text-white">Найти</button>
            </form>
          </div>
        </div>

        <div className="grid lg:min-h-[35rem] lg:grid-cols-[minmax(18rem,0.72fr)_minmax(0,1.28fr)]">
          <section aria-label="Список входящих заявок" className={(mobileDetailOpen ? "hidden lg:block " : "") + "min-h-0 border-b border-white/[0.07] lg:border-b-0 lg:border-r"}>
            <div className="flex items-center justify-between border-b border-white/[0.055] px-4 py-3 sm:px-5">
              <span className="flex items-center gap-2 text-xs text-[#8b959a]"><Inbox className="size-3.5 text-[var(--accent)]" />Очередь проверки</span>
              <span className="text-[11px] text-[#657078]">{snapshot.leads.length} из {snapshot.counts[filter.status]}</span>
            </div>
            {snapshot.leads.length ? <div className="lg:max-h-[42rem] lg:overflow-y-auto"><LeadQueue leads={snapshot.leads} selectedId={selectedLead?.id ?? null} onSelect={selectLead} /></div> : <div className="grid min-h-72 place-items-center p-8 text-center"><div><Inbox className="mx-auto size-6 text-[#657078]" /><h2 className="mt-4 text-sm font-medium text-white">{filter.query || filter.status !== "all" ? "Заявки не найдены" : "Очередь пуста"}</h2><p className="mx-auto mt-2 max-w-xs text-xs leading-5 text-[#778187]">{preview ? "В рабочем режиме обращения появятся после подключения webhook сайта." : "Новые обращения появятся автоматически после отправки формы на подключённом сайте."}</p></div></div>}
          </section>

          <section className={(mobileDetailOpen ? "" : "hidden lg:block ") + "min-w-0"}>
            {selectedLead ? <LeadDetails lead={selectedLead} canWrite={canWrite} onReject={() => setRejectingLead(selectedLead)} onBack={() => setMobileDetailOpen(false)} /> : <div className="grid min-h-[20rem] place-items-center px-8 text-center"><div><Link2 className="mx-auto size-7 text-[#59656b]" /><p className="mt-3 text-sm text-[#7c878d]">Выберите заявку в очереди</p></div></div>}
          </section>
        </div>
      </section>

      {rejectingLead ? <RejectLeadDialog key={rejectingLead.id} lead={rejectingLead} open onClose={closeRejectDialog} /> : null}
    </div>
  );
}
