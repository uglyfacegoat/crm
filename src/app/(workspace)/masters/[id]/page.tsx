import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays, MapPin, MessageCircle, Phone, Route } from "lucide-react";
import { EditMasterButton } from "@/components/masters/master-dialog";
import { formatMoneyMinor, getInitials } from "@/lib/format";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import { getPreviewMasterDetail } from "@/server/masters/preview";
import { getMasterDetail, MasterNotFoundError } from "@/server/masters/repository";
import { masterIdSchema } from "@/server/masters/schemas";
import type { MasterDetailVisit, MasterOperationalStatus } from "@/server/masters/types";

export const metadata: Metadata = { title: "Карточка мастера" };

const visitStatusStyle: Record<MasterDetailVisit["statusCode"], string> = {
  planned: "bg-[var(--accent-soft)] text-[var(--accent-ink)]",
  confirmed: "bg-[var(--info-bg)] text-[var(--info)]",
  in_progress: "bg-[var(--support-soft)] text-[var(--support-strong)]",
  completed: "bg-[var(--success-bg)] text-[var(--success)]",
  cancelled: "bg-[var(--danger-bg)] text-[var(--danger-ink)]",
};

const operationalStatusStyle: Record<MasterOperationalStatus, { dot: string; label: string }> = {
  working: { dot: "bg-[var(--success)]", label: "Доступен для назначений" },
  vacation: { dot: "bg-[var(--support)]", label: "Временно недоступен" },
  unavailable: { dot: "bg-[var(--warning)]", label: "Временно недоступен" },
  terminated: { dot: "bg-[var(--danger)]", label: "Не участвует в новых назначениях" },
};

const weekDays = [
  { value: 1, label: "Пн", fullLabel: "Понедельник" },
  { value: 2, label: "Вт", fullLabel: "Вторник" },
  { value: 3, label: "Ср", fullLabel: "Среда" },
  { value: 4, label: "Чт", fullLabel: "Четверг" },
  { value: 5, label: "Пт", fullLabel: "Пятница" },
  { value: 6, label: "Сб", fullLabel: "Суббота" },
  { value: 7, label: "Вс", fullLabel: "Воскресенье" },
] as const;

function formatVisitDate(visit: MasterDetailVisit) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: visit.timezone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(visit.scheduledStartAt));
}

function formatStatusUntil(statusUntil: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(new Date(`${statusUntil}T12:00:00Z`));
}

function DetailValue({ label, children, accent }: { label: string; children: React.ReactNode; accent?: boolean }) {
  return <div>
    <dt className="text-[9px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">{label}</dt>
    <dd className={`mt-1.5 text-xs font-medium ${accent ? "text-[var(--success)]" : "text-[var(--text-secondary)]"}`}>{children}</dd>
  </div>;
}

export default async function MasterDetailPage({ params }: PageProps<"/masters/[id]">) {
  const { id } = await params;
  const parsedId = masterIdSchema.safeParse(id);
  if (!parsedId.success) notFound();

  const member = await requireOfficeSession();
  const preview = getAuthMode() === "preview";
  let master;

  try {
    master = preview ? getPreviewMasterDetail(parsedId.data) : await getMasterDetail(member, parsedId.data);
  } catch (error) {
    if (error instanceof MasterNotFoundError) notFound();
    throw error;
  }

  if (!master) notFound();

  const canWrite = hasPermission(member, "masters.write");
  const canReadFinance = master.paidMinor !== undefined;
  const operationalStatus = operationalStatusStyle[master.operationalStatus];

  return <div className="mx-auto max-w-[1720px]">
    <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <Link href="/masters" className="focus-ring inline-flex items-center gap-2 rounded-full px-1 text-xs text-[var(--muted)] transition-colors hover:text-[var(--text)]">
          <ArrowLeft className="size-4" />
          К списку мастеров
        </Link>
        <div className="mt-4 flex min-w-0 items-center gap-3 sm:gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-full border border-[var(--support)]/30 bg-[var(--support-soft)] font-display text-xs text-[var(--support-strong)] sm:size-14 sm:text-sm">
            {getInitials(master.fullName)}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="display-title min-w-0 text-[var(--text)]">{master.fullName}</h1>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface-raised)] px-2.5 py-1 text-[10px] text-[var(--text-secondary)]">
                <span className={`size-1.5 rounded-full ${operationalStatus.dot}`} />
                {master.statusLabel}
              </span>
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-sm text-[var(--muted)]">
              <MapPin className="size-3.5" />
              {master.serviceRegion} · {master.serviceZone}
            </p>
          </div>
        </div>
      </div>
      {canWrite ? <div className="sm:pt-1"><EditMasterButton master={master} /></div> : null}
    </header>

    <section aria-label="Доступность мастера" className="surface-panel mt-6 p-4 sm:p-5 lg:p-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(16rem,0.72fr)_minmax(0,1.28fr)] xl:items-center">
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-[var(--muted)]">Доступность</p>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="font-display text-xl text-[var(--text)] sm:text-2xl">{master.statusLabel}</h2>
            {master.statusUntil ? <span className="rounded-full border border-[var(--line)] px-2.5 py-1 text-[10px] text-[var(--text-secondary)]">до {formatStatusUntil(master.statusUntil)}</span> : null}
          </div>
          <p className="mt-2 max-w-md text-xs leading-5 text-[var(--text-secondary)]">{master.statusNote ?? operationalStatus.label}</p>
          <p className="mt-4 inline-flex items-center gap-2 text-[10px] text-[var(--text-secondary)]">
            <span className="size-1.5 rounded-full bg-[var(--success)]" />
            Сегодня: {master.todayVisitCount} из {master.dailyCapacity} выездов
          </p>
        </div>

        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-[var(--muted)]">Рабочая неделя</p>
            <span className="hidden items-center gap-1.5 text-[10px] text-[var(--muted)] sm:inline-flex"><CalendarDays className="size-3.5" />График назначений</span>
          </div>
          <ul className="mt-3 grid grid-cols-7 gap-1.5 sm:gap-2" aria-label="Рабочие дни мастера">
            {weekDays.map((day) => {
              const isWorking = master.workingDays.includes(day.value);
              return <li key={day.value} className={`min-w-0 rounded-[12px] border px-1 py-2.5 text-center sm:rounded-[14px] sm:px-2 ${isWorking ? "border-[var(--accent)]/40 bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "border-[var(--line)] bg-[var(--surface-raised)] text-[var(--muted)]"}`}>
                <span className="block text-[11px] font-semibold">{day.label}</span>
                <span className="mt-1.5 flex items-center justify-center gap-1 text-[8px] leading-none text-current/75">
                  <span className={`size-1 rounded-full ${isWorking ? "bg-[var(--accent)]" : "bg-[var(--line-strong)]"}`} />
                  <span className="sr-only">{day.fullLabel}: </span>
                  <span className="hidden sm:inline">{isWorking ? "Работа" : "Выходной"}</span>
                </span>
              </li>;
            })}
          </ul>
        </div>
      </div>
    </section>

    <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(18rem,0.68fr)_minmax(0,1.32fr)]">
      <aside className="surface-panel p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-[var(--text)]">Профиль мастера</h2>
          <span className="rounded-full bg-[var(--surface-inset)] px-2.5 py-1 text-[9px] text-[var(--muted)]">{master.active ? "Активная карточка" : "Архивная карточка"}</span>
        </div>

        <dl className="mt-5 grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-1">
          <DetailValue label="Телефон"><a href={`tel:${master.phone}`} className="inline-flex items-center gap-2 transition-colors hover:text-[var(--text)]"><Phone className="size-3.5" />{master.phone}</a></DetailValue>
          <DetailValue label="Мессенджер"><span className="inline-flex items-center gap-2"><MessageCircle className="size-3.5" />{master.messenger ?? "Не указан"}</span></DetailValue>
          <DetailValue label="Лимит нагрузки">До {master.dailyCapacity} выездов в день</DetailValue>
          {master.basePaymentMinor !== undefined ? <DetailValue label="Базовая выплата">{master.basePaymentMinor === null ? "Не указана" : formatMoneyMinor(master.basePaymentMinor)}</DetailValue> : null}
        </dl>

        <div className="mt-6 border-t border-[var(--line)] pt-5">
          <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-[var(--muted)]">Рабочая история</p>
          <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4">
            <DetailValue label="Выезды">{master.completedVisits} из {master.totalVisits}</DetailValue>
            <DetailValue label="Предстоящие">{master.upcomingVisits}</DetailValue>
            <DetailValue label="Заказы">{master.totalOrders}</DetailValue>
            {canReadFinance ? <DetailValue label="Выплачено" accent>{formatMoneyMinor(master.paidMinor ?? 0)}</DetailValue> : null}
          </dl>
        </div>

        {master.skills.length ? <div className="mt-6 border-t border-[var(--line)] pt-5">
          <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-[var(--muted)]">Специализации</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {master.skills.map((skill) => <li key={skill} className="rounded-full border border-[var(--support)]/30 bg-[var(--support-soft)] px-2.5 py-1 text-[10px] text-[var(--support-strong)]">{skill}</li>)}
          </ul>
        </div> : null}

        {master.notes ? <div className="mt-6 border-t border-[var(--line)] pt-5">
          <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-[var(--muted)]">Заметка для офиса</p>
          <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[var(--text-secondary)]">{master.notes}</p>
        </div> : null}
      </aside>

      <section className="surface-panel overflow-hidden">
        <header className="flex items-start justify-between gap-4 px-5 py-5 sm:px-6">
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-[var(--muted)]">Журнал работы</p>
            <h2 className="mt-2 text-base font-semibold text-[var(--text)]">Последние выезды</h2>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">Последние 30 событий мастера</p>
          </div>
          <span className="rounded-full border border-[var(--line)] bg-[var(--surface-raised)] px-2.5 py-1 text-[10px] text-[var(--muted)]">{master.recentVisits.length}</span>
        </header>

        {master.recentVisits.length ? <div className="divide-y divide-[var(--line)] border-t border-[var(--line)]">
          {master.recentVisits.map((visit) => <Link key={visit.id} href={`/orders/${visit.orderId}`} className="focus-ring grid gap-3 px-5 py-4 transition-colors hover:bg-[var(--surface-raised)] sm:px-6 md:grid-cols-[10rem_minmax(0,1fr)_9rem] md:items-center">
            <div>
              <p className="font-display text-xs text-[var(--text)]">{formatVisitDate(visit)}</p>
              <p className="mt-1 text-[9px] text-[var(--accent)]">{visit.orderNumber}</p>
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-[var(--text-secondary)]">{visit.clientName}</p>
              <p className="mt-1 truncate text-[10px] text-[var(--muted)]">{visit.objectName} · {visit.objectAddress}</p>
            </div>
            <span className={`w-fit rounded-full px-2.5 py-1 text-[9px] md:justify-self-end ${visitStatusStyle[visit.statusCode]}`}>{visit.status}</span>
          </Link>)}
        </div> : <div className="border-t border-[var(--line)] px-5 py-8 sm:px-6 sm:py-10">
          <div className="flex max-w-sm items-center gap-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-full border border-[var(--line)] bg-[var(--surface-raised)] text-[var(--muted)]"><Route className="size-5" /></span>
            <div>
              <p className="text-sm font-medium text-[var(--text-secondary)]">Выездов пока нет</p>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Когда мастер завершит или получит первый выезд, он появится в журнале.</p>
            </div>
          </div>
        </div>}
      </section>
    </div>
  </div>;
}
