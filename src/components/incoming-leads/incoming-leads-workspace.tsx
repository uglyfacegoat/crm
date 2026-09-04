"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
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
  Sparkles,
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
  new: "border-[var(--accent)]/20 bg-[var(--accent)]/[0.07] text-[var(--accent)]",
  reviewing: "border-[#65b7ee]/20 bg-[#65b7ee]/[0.07] text-[#7bc4ef]",
  accepted: "border-[#69d3a4]/20 bg-[#69d3a4]/[0.07] text-[#7ad5ad]",
  rejected: "border-[#ef646a]/20 bg-[#ef646a]/[0.07] text-[#e48d92]",
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

function ContactLine({ icon: Icon, children }: { icon: typeof Phone; children: React.ReactNode }) {
  return <span className="flex min-w-0 items-center gap-2 text-[11px] text-[#8a9499]"><Icon className="size-3.5 shrink-0 text-[#59656b]" /><span className="truncate">{children}</span></span>;
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
  return <Dialog open={open} onClose={onClose} title="Отклонить заявку" description="Она останется в истории и не превратится в заказ.">
    <form action={action} className="flex min-h-full flex-1 flex-col">
      <input type="hidden" name="leadId" value={lead.id} />
      <input type="hidden" name="expectedVersion" value={lead.version} />
      <div className="flex-1 space-y-5 p-5 sm:p-7">
        <div className="rounded-[15px] border border-white/[0.07] bg-black/15 p-4">
          <p className="text-xs font-medium text-white">{lead.contactName || lead.phone || lead.email || "Заявка без имени"}</p>
          <p className="mt-1 text-[10px] text-[#69747a]">{lead.websiteName} · {dateFormatter.format(new Date(lead.receivedAt))}</p>
        </div>
        <label className="grid gap-2 text-[10px] text-[#7b858b]">
          <span>Причина *</span>
          <textarea name="reason" required minLength={3} maxLength={500} rows={6} placeholder="Например: дубль заявки, спам или клиент отказался" className="focus-ring resize-none rounded-[13px] border border-white/[0.08] bg-black/15 p-3.5 text-sm leading-6 text-white outline-none placeholder:text-[#566067]" />
          {state.fieldErrors.reason?.map((error) => <span key={error} className="text-[10px] text-[#dd858a]">{error}</span>)}
        </label>
        {state.message ? <p role="status" className={`rounded-[12px] border p-3 text-xs leading-5 ${state.status === "success" ? "border-[#69d3a4]/20 bg-[#69d3a4]/[0.05] text-[#83d4b1]" : "border-[#ef646a]/20 bg-[#ef646a]/[0.05] text-[#d98b90]"}`}>{state.message}</p> : null}
      </div>
      <footer className="sticky bottom-0 mt-auto grid grid-cols-2 gap-2 border-t border-white/[0.07] bg-[#0d1317]/95 p-4 backdrop-blur-xl sm:p-5">
        <button type="button" onClick={onClose} disabled={pending} className="focus-ring h-12 rounded-[13px] border border-white/[0.08] text-xs text-[#899399]">Отмена</button>
        <button type="submit" disabled={pending || state.status === "success"} className="focus-ring flex h-12 items-center justify-center gap-2 rounded-[13px] bg-[#ef646a] text-xs font-semibold text-white disabled:opacity-60">{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Ban className="size-4" />}Отклонить</button>
      </footer>
    </form>
  </Dialog>;
}

function LeadDetails({ lead, canWrite, onReject }: { lead: IncomingLead; canWrite: boolean; onReject: () => void }) {
  const actionable = canWrite && (lead.status === "new" || lead.status === "reviewing");
  const landingUrl = safeExternalUrl(lead.landingUrl);
  return <article className="flex min-h-[33rem] flex-col overflow-hidden rounded-[18px] border border-white/[0.075] bg-[#10171b]">
    <header className="border-b border-white/[0.06] p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0"><p className="eyebrow">Карточка входящего обращения</p><h2 className="mt-2 break-words font-display text-xl font-semibold tracking-[-0.035em] text-white">{lead.contactName || "Контакт не подписан"}</h2><p className="mt-2 text-[10px] text-[#647077]">Получено {dateFormatter.format(new Date(lead.receivedAt))}</p></div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[9px] ${statusTone[lead.status]}`}>{incomingLeadStatusLabels[lead.status]}</span>
      </div>
    </header>
    <div className="grid flex-1 content-start gap-6 p-5 sm:p-6">
      <section><p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-[#5f6b72]">Связь</p><div className="mt-3 grid gap-2.5">{lead.phone ? <ContactLine icon={Phone}>{lead.phone}</ContactLine> : null}{lead.email ? <ContactLine icon={Mail}>{lead.email}</ContactLine> : null}{!lead.phone && !lead.email ? <ContactLine icon={CircleAlert}>Контактные данные отсутствуют</ContactLine> : null}</div></section>
      <section className="rounded-[15px] border border-[var(--accent)]/10 bg-[var(--accent)]/[0.035] p-4"><div className="flex items-start gap-3"><Sparkles className="mt-0.5 size-4 shrink-0 text-[var(--accent)]" /><div><p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">Запрос клиента</p><p className="mt-2 text-sm leading-6 text-[#d6dbd8]">{lead.serviceInterest || "Услуга не указана — уточните перед оформлением."}</p></div></div></section>
      <section><p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-[#5f6b72]">Источник</p><dl className="mt-3 grid gap-3 text-[10px] sm:grid-cols-2"><div><dt className="text-[#5f6a71]">Сайт</dt><dd className="mt-1 text-[#cbd1ce]">{lead.websiteName}</dd><dd className="mt-0.5 text-[#6f7a80]">{lead.websiteDomain}</dd></div><div><dt className="text-[#5f6a71]">UTM</dt><dd className="mt-1 text-[#cbd1ce]">{lead.utmSource || "Без метки"}</dd><dd className="mt-0.5 text-[#6f7a80]">{lead.utmCampaign || "Кампания не указана"}</dd></div></dl>{landingUrl ? <a href={landingUrl} target="_blank" rel="noreferrer" className="focus-ring mt-4 inline-flex items-center gap-2 rounded-[10px] border border-white/[0.07] px-3 py-2 text-[10px] text-[#869197] hover:text-white"><ExternalLink className="size-3.5" />Открыть страницу заявки</a> : null}</section>
      {lead.possibleClientId ? <section className="rounded-[14px] border border-[#65b7ee]/15 bg-[#65b7ee]/[0.045] p-4"><div className="flex gap-3"><UserRoundSearch className="size-4 shrink-0 text-[#65b7ee]" /><div><p className="text-xs font-medium text-[#cbdde8]">В CRM найден возможный клиент</p><Link href={`/clients/${lead.possibleClientId}`} className="focus-ring mt-1 inline-flex items-center gap-1 text-[10px] text-[#7fbfe4] hover:text-white">{lead.possibleClientName}<ArrowRight className="size-3" /></Link><p className="mt-2 text-[9px] leading-4 text-[#68808d]">При оформлении он будет выбран автоматически. Проверьте совпадение контакта.</p></div></div></section> : null}
      {lead.reviewNote ? <section className="border-l border-white/[0.12] pl-4"><p className="text-[9px] uppercase tracking-[0.13em] text-[#5f6a70]">Решение</p><p className="mt-2 text-xs leading-5 text-[#a6afb3]">{lead.reviewNote}</p>{lead.reviewerName ? <p className="mt-2 text-[9px] text-[#616c72]">{lead.reviewerName}{lead.reviewedAt ? ` · ${dateFormatter.format(new Date(lead.reviewedAt))}` : ""}</p> : null}</section> : null}
      {lead.orderId ? <Link href={`/orders/${lead.orderId}`} className="focus-ring flex min-h-12 items-center justify-between rounded-[13px] border border-[#69d3a4]/16 bg-[#69d3a4]/[0.045] px-4 text-xs text-[#8cd5b7]"><span>Открыть созданный заказ {lead.orderNumber}</span><ArrowRight className="size-4" /></Link> : null}
    </div>
    {actionable ? <footer className="grid gap-2 border-t border-white/[0.07] bg-black/10 p-4 sm:grid-cols-[0.7fr_1.3fr] sm:p-5"><button type="button" onClick={onReject} className="focus-ring h-12 rounded-[13px] border border-white/[0.09] text-xs text-[#a5adb1] hover:border-[#ef646a]/25 hover:text-[#df8a8f]">Отклонить</button><Link href={`/quick-order?sourceLead=${lead.id}`} className="focus-ring flex h-12 items-center justify-center gap-2 rounded-[13px] bg-[var(--accent)] text-xs font-semibold text-[#111509]">Уточнить и принять<ArrowRight className="size-4" /></Link></footer> : null}
  </article>;
}

export function IncomingLeadsWorkspace({ snapshot, filter, canWrite, preview }: { snapshot: IncomingLeadSnapshot; filter: IncomingLeadListFilter; canWrite: boolean; preview: boolean }) {
  const [selectedId, setSelectedId] = useState(snapshot.leads[0]?.id ?? null);
  const [rejectingLead, setRejectingLead] = useState<IncomingLead | null>(null);
  const closeRejectDialog = useCallback(() => setRejectingLead(null), []);
  const selectedLead = useMemo(() => snapshot.leads.find((lead) => lead.id === selectedId) ?? snapshot.leads[0] ?? null, [selectedId, snapshot.leads]);
  return <div><PageHeading eyebrow="Первичный разбор" title="Входящие заявки" description="Новые обращения с сайтов сначала проверяются здесь. Только подтверждённая заявка создаёт клиента, объект, заказ и первый выезд." />
    <section className="mt-[clamp(1.5rem,1.1rem+0.8vw,2.25rem)] overflow-hidden rounded-[18px] border border-white/[0.075] bg-[linear-gradient(110deg,rgba(237,244,59,0.045),rgba(101,183,238,0.025)_48%,rgba(156,130,232,0.03))]">
      <div className="flex flex-col gap-3 border-b border-white/[0.06] p-3 xl:flex-row xl:items-center xl:justify-between">
        <nav aria-label="Статусы входящих заявок" className="flex min-w-0 gap-1 overflow-x-auto">{tabs.map((tab) => { const active = filter.status === tab.value; const href = tab.value === "all" ? "/inbox" : `/inbox?status=${tab.value}`; return <Link key={tab.value} href={href} aria-current={active ? "page" : undefined} className={`focus-ring flex h-10 shrink-0 items-center gap-2 rounded-[11px] px-3 text-xs ${active ? "bg-[var(--accent)] text-[#111509]" : "text-[#79838a] hover:bg-white/[0.035] hover:text-white"}`}><span>{tab.label}</span><span className={`rounded-full px-1.5 py-0.5 text-[9px] ${active ? "bg-black/12" : "bg-white/[0.045]"}`}>{snapshot.counts[tab.value]}</span></Link>; })}</nav>
        <form action="/inbox" method="get" className="flex min-w-0 gap-2">{filter.status !== "all" ? <input type="hidden" name="status" value={filter.status} /> : null}<label className="relative min-w-0 flex-1 xl:w-80 xl:flex-none"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-[#5e6970]" /><span className="sr-only">Поиск во входящих заявках</span><input name="query" defaultValue={filter.query} maxLength={200} placeholder="Имя, телефон, сайт, услуга…" className="focus-ring h-10 w-full rounded-[11px] border border-white/[0.075] bg-black/15 pl-9 pr-3 text-xs text-white outline-none placeholder:text-[#566168]" /></label><button type="submit" className="focus-ring h-10 rounded-[11px] border border-white/[0.075] px-3 text-xs text-[#909a9f] hover:text-white">Найти</button></form>
      </div>
      <div className="grid min-h-[38rem] lg:grid-cols-[minmax(18rem,0.7fr)_minmax(0,1.3fr)]">
        <section aria-label="Список входящих заявок" className="min-h-0 border-b border-white/[0.06] lg:border-b-0 lg:border-r"><div className="flex items-center justify-between border-b border-white/[0.055] px-4 py-3"><span className="flex items-center gap-2 text-[10px] text-[#69747a]"><Inbox className="size-3.5 text-[var(--accent)]" />Очередь проверки</span><span className="text-[9px] text-[#58636a]">до 250 записей</span></div>{snapshot.leads.length ? <div className="divide-y divide-white/[0.05] lg:max-h-[42rem] lg:overflow-y-auto">{snapshot.leads.map((lead) => { const selected = selectedLead?.id === lead.id; return <button key={lead.id} type="button" onClick={() => setSelectedId(lead.id)} aria-pressed={selected} className={`focus-ring relative block w-full px-4 py-4 text-left transition-colors ${selected ? "bg-white/[0.045]" : "hover:bg-white/[0.025]"}`}><span className={`absolute inset-y-3 left-0 w-0.5 rounded-r-full ${lead.status === "new" ? "bg-[var(--accent)]" : lead.status === "accepted" ? "bg-[#69d3a4]" : lead.status === "rejected" ? "bg-[#ef646a]" : "bg-[#65b7ee]"}`} /><span className="flex items-start justify-between gap-3"><span className="min-w-0"><strong className="block truncate text-xs font-medium text-[#e2e6e2]">{lead.contactName || lead.phone || lead.email || "Без имени"}</strong><span className="mt-1.5 block truncate text-[10px] text-[#747f85]">{lead.serviceInterest || "Услуга не указана"}</span></span><time dateTime={lead.receivedAt} className="shrink-0 text-[9px] text-[#59646b]">{dateFormatter.format(new Date(lead.receivedAt))}</time></span><span className="mt-3 flex items-center justify-between gap-3"><span className="flex min-w-0 items-center gap-1.5 truncate text-[9px] text-[#5f6a71]"><Globe2 className="size-3 shrink-0" />{lead.websiteDomain}</span>{lead.possibleClientId ? <span className="shrink-0 text-[9px] text-[#65b7ee]">Есть совпадение</span> : null}</span></button>; })}</div> : <div className="grid min-h-72 place-items-center p-8 text-center"><div><span className="mx-auto grid size-12 place-items-center rounded-[15px] border border-white/[0.07] bg-white/[0.025]"><Inbox className="size-5 text-[#5d696f]" /></span><h2 className="mt-4 text-sm font-medium text-white">{filter.query || filter.status !== "all" ? "Заявки не найдены" : "Очередь пуста"}</h2><p className="mx-auto mt-2 max-w-xs text-[10px] leading-5 text-[#69747a]">{preview ? "В рабочем режиме обращения появятся после подключения webhook сайта." : "Новые обращения появятся автоматически после отправки формы на подключённом сайте."}</p></div></div>}</section>
        <section className="p-3 sm:p-4">{selectedLead ? <LeadDetails lead={selectedLead} canWrite={canWrite} onReject={() => setRejectingLead(selectedLead)} /> : <div className="grid min-h-[30rem] place-items-center text-center"><div><Link2 className="mx-auto size-7 text-[#4f5b62]" /><p className="mt-3 text-xs text-[#727d83]">Выберите заявку в очереди</p></div></div>}</section>
      </div>
    </section>
    {rejectingLead ? <RejectLeadDialog key={rejectingLead.id} lead={rejectingLead} open onClose={closeRejectDialog} /> : null}
  </div>;
}
