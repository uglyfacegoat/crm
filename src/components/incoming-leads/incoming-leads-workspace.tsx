"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Ban,
  CircleAlert,
  ExternalLink,
  Inbox,
  LoaderCircle,
  Mail,
  Phone,
  Search,
  UserRoundSearch,
} from "lucide-react";
import { useActionState, useCallback, useEffect, useState, type ReactNode } from "react";
import { prepareIncomingLeadOrderAction, rejectIncomingLeadAction, type IncomingLeadMutationState } from "@/app/(workspace)/inbox/actions";
import { Dialog } from "@/components/ui/dialog";
import { QuickOrderWorkspace } from "@/components/quick-order/quick-order-workspace";
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

const tabs: Array<{ value: IncomingLeadListFilter["status"]; label: string }> = [
  { value: "active", label: "В работе" },
  { value: "new", label: "Новые" },
  { value: "reviewing", label: "На проверке" },
  { value: "accepted", label: "Принятые" },
  { value: "rejected", label: "Отклонённые" },
  { value: "all", label: "Все" },
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

function inboxHref(status: IncomingLeadListFilter["status"], query: string) {
  const params = new URLSearchParams();
  if (status !== "active") params.set("status", status);
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

function RejectLeadDialog({ lead, open, onClose, onRejected }: { lead: IncomingLead; open: boolean; onClose: () => void; onRejected: () => void }) {
  const [state, action, pending] = useActionState(rejectIncomingLeadAction, initialMutationState);
  useEffect(() => {
    if (state.status === "success") onRejected();
  }, [onRejected, state]);

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
  onAccept,
}: {
  lead: IncomingLead;
  canWrite: boolean;
  onReject: () => void;
  onAccept: () => void;
}) {
  const actionable = canWrite && (lead.status === "new" || lead.status === "reviewing");
  const landingUrl = safeExternalUrl(lead.landingUrl);
  const referrerUrl = safeExternalUrl(lead.referrerUrl);

  return (
    <article id="incoming-lead-details" aria-live="polite" className="flex min-h-full min-w-0 flex-col">
      <header className="px-5 pb-2 pt-5 sm:px-7 sm:pt-7">
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
            <button type="button" onClick={onAccept} className="focus-ring flex h-12 items-center justify-center rounded-[14px] bg-[var(--accent)] px-4 text-xs font-semibold text-[var(--on-accent)] transition-transform hover:bg-[var(--accent-strong)] active:translate-y-px">Уточнить и принять</button>
          </div>
        </footer>
      ) : null}
    </article>
  );
}

function LeadOrderDialog({ lead, onClose, onCompleted }: { lead: IncomingLead; onClose: () => void; onCompleted: () => void }) {
  type Prepared = NonNullable<Awaited<ReturnType<typeof prepareIncomingLeadOrderAction>>["data"]>;
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    prepareIncomingLeadOrderAction(lead.id).then((result) => {
      if (!active) return;
      if (result.data) { setPrepared(result.data); setError(null); }
      else setError(result.error ?? "Не удалось открыть оформление.");
    }).catch(() => { if (active) setError("Не удалось открыть оформление. Попробуйте ещё раз."); });
    return () => { active = false; };
  }, [lead.id, retry]);
  return <Dialog open onClose={onClose} title="Оформление заявки" bodyClassName="p-5 sm:p-7">
    {prepared ? <QuickOrderWorkspace {...prepared} embedded onCompleted={onCompleted} /> : error ? <div role="alert" className="space-y-4"><p className="text-sm">{error}</p><button type="button" onClick={() => { setError(null); setRetry((value) => value + 1); }} className="focus-ring min-h-11 rounded-xl border border-[var(--line)] px-4 text-sm">Повторить</button></div> : <p role="status" className="flex items-center gap-2 py-8 text-sm text-[var(--muted)]"><LoaderCircle className="size-4 animate-spin" />Загружаем оформление…</p>}
  </Dialog>;
}

export function IncomingLeadsWorkspace({ snapshot, filter, canWrite, preview, initialSelectedId }: {
  snapshot: IncomingLeadSnapshot; filter: IncomingLeadListFilter; canWrite: boolean; preview: boolean; initialSelectedId: string | null;
}) {
  const router = useRouter();
  const [selectedLead, setSelectedLead] = useState<IncomingLead | null>(() => snapshot.leads.find((lead) => lead.id === initialSelectedId) ?? null);
  const [mode, setMode] = useState<"details" | "reject" | "accept">("details");
  const [notice, setNotice] = useState("");
  const [visibleCount, setVisibleCount] = useState(24);
  const closeDetails = useCallback(() => {
    setSelectedLead(null);
    setMode("details");
    if (initialSelectedId) router.replace(inboxHref(filter.status, filter.query), { scroll: false });
  }, [filter.query, filter.status, initialSelectedId, router]);
  const closeAction = useCallback(() => setMode("details"), []);
  const onRejected = useCallback(() => { closeDetails(); setNotice("Заявка перенесена в отклонённые. Причина сохранена."); router.refresh(); }, [closeDetails, router]);
  const onAccepted = useCallback(() => { closeDetails(); setNotice("Заказ создан. Заявка перенесена в принятые."); router.refresh(); }, [closeDetails, router]);
  const countFor = (status: IncomingLeadListFilter["status"]) => status === "active" ? snapshot.counts.new + snapshot.counts.reviewing : snapshot.counts[status];
  const leads = snapshot.leads.filter((lead) => filter.status === "all" || (filter.status === "active" ? lead.status === "new" || lead.status === "reviewing" : lead.status === filter.status));
  const cards = leads.slice(0, visibleCount);

  return <div>
    <PageHeading eyebrow="Первичный разбор" title="Входящие заявки" description="Откройте карточку, уточните данные и примите решение. Обработанные заявки сохраняются в истории." />
    <section className="mt-6">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <nav aria-label="Статусы входящих заявок" className="scrollbar-hidden flex max-w-full min-w-0 gap-1 overflow-x-auto rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-1">
          {tabs.map((tab) => <Link key={tab.value} href={inboxHref(tab.value, filter.query)} aria-current={filter.status === tab.value ? "page" : undefined} className={"focus-ring flex min-h-10 shrink-0 items-center gap-2 rounded-[10px] px-3 text-xs transition-colors " + (filter.status === tab.value ? "bg-[var(--accent)] font-semibold text-[var(--on-accent)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-soft)]")}><span>{tab.label}</span><span className="opacity-70">{countFor(tab.value)}</span></Link>)}
        </nav>
        <form action="/inbox" method="get" className="flex min-w-0 gap-2">
          {filter.status !== "active" ? <input type="hidden" name="status" value={filter.status} /> : null}
          <label className="relative min-w-0 flex-1 xl:w-80 xl:flex-none"><Search className="pointer-events-none absolute left-3.5 top-3.5 size-4 text-[var(--muted)]" /><span className="sr-only">Поиск во входящих заявках</span><input name="query" defaultValue={filter.query} maxLength={200} placeholder="Имя, телефон, сайт, услуга…" className="focus-ring min-h-11 w-full rounded-[13px] border border-[var(--line)] bg-[var(--surface)] pl-10 pr-3.5 text-sm" /></label>
          <button type="submit" className="focus-ring min-h-11 rounded-[13px] border border-[var(--line)] px-4 text-sm">Найти</button>
        </form>
      </header>
      {notice ? <p role="status" className="mt-4 rounded-xl bg-[var(--success-bg)] p-4 text-sm text-[var(--success)]">{notice}</p> : null}
      <p className="mt-5 text-xs text-[var(--muted)]">Показано {cards.length}{filter.query ? "" : ` из ${countFor(filter.status)}`}</p>
      <section aria-label="Карточки входящих заявок" className="mt-3 grid min-w-0 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {cards.map((lead) => <button key={lead.id} type="button" aria-label={`Открыть заявку ${lead.contactName || lead.phone || lead.email || "Без имени"}`} onClick={() => { setSelectedLead(lead); setMode("details"); }} className="focus-ring flex min-w-0 flex-col rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 text-left transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-raised)]">
          <div className="flex flex-wrap items-center justify-between gap-2"><StatusPill status={lead.status} /><time dateTime={lead.receivedAt} className="text-xs text-[var(--muted)]">{dateFormatter.format(new Date(lead.receivedAt))}</time></div>
          <h2 className="mt-4 break-words text-lg font-semibold text-[var(--text)]">{lead.contactName || lead.phone || lead.email || "Без имени"}</h2>
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-[var(--text-secondary)]">{lead.serviceInterest || "Услуга не указана"}</p>
          {lead.objectAddress ? <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--muted)]">{lead.objectAddress}</p> : null}
          <div className="my-4 grid min-w-0 gap-2">{lead.phone ? <ContactLine icon={Phone}>{lead.phone}</ContactLine> : null}{lead.email ? <ContactLine icon={Mail}>{lead.email}</ContactLine> : null}</div>
          <div className="mt-auto flex min-w-0 items-center justify-between gap-3 border-t border-[var(--line)] pt-3"><span className="truncate text-xs text-[var(--muted)]">{lead.websiteName}</span><span className="shrink-0 text-xs font-medium">Открыть</span></div>
        </button>)}
      </section>
      {leads.length > cards.length ? <button type="button" onClick={() => setVisibleCount((count) => count + 24)} className="focus-ring mt-5 min-h-11 rounded-xl border border-[var(--line)] px-5 text-sm">Показать ещё</button> : null}
      {!leads.length ? <div className="mt-4 grid justify-items-center rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface)] px-6 py-16 text-center"><Inbox className="size-6 text-[var(--muted)]" /><h2 className="mt-4 font-medium">{filter.query ? "Заявки не найдены" : filter.status === "active" ? "Все заявки обработаны" : "В этом списке пока нет заявок"}</h2><p className="mt-2 max-w-sm text-sm leading-6 text-[var(--muted)]">{filter.query ? "Попробуйте другое имя, телефон, сайт или услугу." : preview ? "Заявки появятся после подключения сайта." : "Новые обращения появятся здесь, принятые и отклонённые доступны в отдельных списках."}</p></div> : null}
    </section>
    {selectedLead && mode === "details" ? <Dialog open onClose={closeDetails} title="Заявка"><LeadDetails lead={selectedLead} canWrite={canWrite} onReject={() => setMode("reject")} onAccept={() => setMode("accept")} /></Dialog> : null}
    {selectedLead && mode === "reject" ? <RejectLeadDialog key={selectedLead.id} lead={selectedLead} open onClose={closeAction} onRejected={onRejected} /> : null}
    {selectedLead && mode === "accept" ? <LeadOrderDialog key={selectedLead.id} lead={selectedLead} onClose={closeAction} onCompleted={onAccepted} /> : null}
  </div>;
}
