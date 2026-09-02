import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Banknote, CalendarClock, CheckCircle2, ClipboardList, MapPin, MessageCircle, Phone, Route, UserRound } from "lucide-react";
import { EditMasterButton } from "@/components/masters/master-dialog";
import { WorkspaceStatCard } from "@/components/ui/workspace-stat-card";
import { formatMoneyMinor, getInitials } from "@/lib/format";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import { getPreviewMasterDetail } from "@/server/masters/preview";
import { getMasterDetail, MasterNotFoundError } from "@/server/masters/repository";
import { masterIdSchema } from "@/server/masters/schemas";
import type { MasterDetailVisit } from "@/server/masters/types";

export const metadata: Metadata = { title: "Карточка мастера" };

const visitStatusStyle: Record<MasterDetailVisit["statusCode"], string> = {
  planned: "bg-[var(--accent)]/10 text-[var(--accent)]",
  confirmed: "bg-[#55d5ca]/10 text-[#75d8ce]",
  in_progress: "bg-[#9c82e8]/12 text-[#bcaaf2]",
  completed: "bg-[#63c99d]/10 text-[#74d9ac]",
  cancelled: "bg-[#ef646a]/10 text-[#ef858a]",
};

function formatVisitDate(visit: MasterDetailVisit) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: visit.timezone, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(visit.scheduledStartAt));
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
  const canWrite = hasPermission(member.role, "masters.write");
  const canReadFinance = master.paidMinor !== undefined;

  return <div>
    <div className="flex flex-col gap-5 min-[640px]:flex-row min-[640px]:items-start min-[640px]:justify-between">
      <div><Link href="/masters" className="focus-ring mb-4 inline-flex items-center gap-2 rounded-lg text-xs text-[#7f888e] hover:text-white"><ArrowLeft className="size-4" />К мастерам</Link><div className="flex items-center gap-4"><span className="grid size-14 shrink-0 place-items-center rounded-[18px] bg-[#9c82e8]/12 font-display text-sm text-[#c7b8f3]">{getInitials(master.fullName)}</span><div><div className="flex flex-wrap items-center gap-3"><h1 className="display-title text-white">{master.fullName}</h1><span className={`rounded-full px-2.5 py-1 text-[10px] ${master.active ? "bg-[#63c99d]/10 text-[#74d9ac]" : "bg-white/[0.05] text-[#79838a]"}`}>{master.statusLabel}</span></div><p className="mt-2 flex items-center gap-1.5 text-sm text-[var(--muted)]"><MapPin className="size-3.5" />{master.serviceRegion} · {master.serviceZone}</p></div></div></div>
      {canWrite ? <EditMasterButton master={master} /> : null}
    </div>

    <section className={`mt-6 grid gap-3 min-[440px]:grid-cols-2 ${canReadFinance ? "xl:grid-cols-6" : "xl:grid-cols-4"}`}>
      <WorkspaceStatCard label="Всего выездов" value={String(master.totalVisits)} note="За всё время" icon={Route} color="#58a6ff" />
      <WorkspaceStatCard label="Завершено" value={String(master.completedVisits)} note={master.totalVisits ? `${Math.round(master.completedVisits / master.totalVisits * 100)}% выполнения` : "История пока пуста"} icon={CheckCircle2} color="#63c99d" />
      <WorkspaceStatCard label="Предстоящие" value={String(master.upcomingVisits)} note={`${master.todayVisitCount} сегодня`} icon={CalendarClock} color="#dce63c" />
      <WorkspaceStatCard label="Заказов" value={String(master.totalOrders)} note="Уникальных заказов" icon={ClipboardList} color="#9c82e8" />
      {canReadFinance ? <WorkspaceStatCard label="Начислено" value={formatMoneyMinor(master.accruedMinor ?? 0)} note="По назначенным заказам" icon={Banknote} color="#f0ad55" /> : null}
      {canReadFinance ? <WorkspaceStatCard label="Выплачено" value={formatMoneyMinor(master.paidMinor ?? 0)} note="Фактический заработок" icon={Banknote} color="#55d5ca" /> : null}
    </section>

    <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(18rem,0.72fr)_minmax(0,1.6fr)]">
      <aside className="surface-panel p-5"><h2 className="text-sm font-semibold text-white">Контакты и условия</h2><dl className="mt-5 space-y-4 text-xs"><div><dt className="text-[10px] uppercase tracking-[0.1em] text-[#687279]">Телефон</dt><dd className="mt-1.5"><a href={`tel:${master.phone}`} className="inline-flex items-center gap-2 text-[#dfe3df] hover:text-white"><Phone className="size-3.5" />{master.phone}</a></dd></div><div><dt className="text-[10px] uppercase tracking-[0.1em] text-[#687279]">Мессенджер</dt><dd className="mt-1.5 flex items-center gap-2 text-[#dfe3df]"><MessageCircle className="size-3.5" />{master.messenger ?? "Не указан"}</dd></div><div><dt className="text-[10px] uppercase tracking-[0.1em] text-[#687279]">Лимит нагрузки</dt><dd className="mt-1.5 text-[#dfe3df]">До {master.dailyCapacity} выездов в день</dd></div>{master.basePaymentMinor !== undefined ? <div><dt className="text-[10px] uppercase tracking-[0.1em] text-[#687279]">Базовая выплата</dt><dd className="mt-1.5 text-[#dfe3df]">{master.basePaymentMinor === null ? "Не указана" : formatMoneyMinor(master.basePaymentMinor)}</dd></div> : null}</dl>{master.skills.length ? <div className="mt-5 border-t border-white/[0.06] pt-5"><p className="text-[10px] uppercase tracking-[0.1em] text-[#687279]">Специализации</p><div className="mt-3 flex flex-wrap gap-2">{master.skills.map((skill) => <span key={skill} className="rounded-lg bg-[#9c82e8]/10 px-2.5 py-1.5 text-[10px] text-[#bcaaf2]">{skill}</span>)}</div></div> : null}{master.notes ? <div className="mt-5 border-t border-white/[0.06] pt-5"><p className="text-[10px] uppercase tracking-[0.1em] text-[#687279]">Заметка для офиса</p><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[#929ba0]">{master.notes}</p></div> : null}</aside>

      <section className="surface-panel overflow-hidden"><header className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-4 sm:px-5"><div><h2 className="text-sm font-semibold text-white">Последние выезды</h2><p className="mt-1 text-xs text-[#69737a]">Последние 30 событий мастера</p></div><UserRound className="size-5 text-[#9c82e8]" /></header>{master.recentVisits.length ? <div className="divide-y divide-white/[0.055]">{master.recentVisits.map((visit) => <Link key={visit.id} href={`/orders/${visit.orderId}`} className="focus-ring grid gap-3 px-4 py-4 hover:bg-white/[0.025] sm:px-5 md:grid-cols-[10rem_minmax(0,1fr)_9rem] md:items-center"><div><p className="font-display text-xs text-white">{formatVisitDate(visit)}</p><p className="mt-1 text-[9px] text-[var(--accent)]">{visit.orderNumber}</p></div><div className="min-w-0"><p className="truncate text-sm font-medium text-[#dce1dd]">{visit.clientName}</p><p className="mt-1 truncate text-[10px] text-[#6d777d]">{visit.objectName} · {visit.objectAddress}</p></div><span className={`w-fit rounded-full px-2.5 py-1 text-[9px] md:justify-self-end ${visitStatusStyle[visit.statusCode]}`}>{visit.status}</span></Link>)}</div> : <div className="grid min-h-72 place-items-center text-center"><div><Route className="mx-auto size-8 text-[#4f595f]" /><p className="mt-3 text-sm text-[#7e888e]">Выездов пока нет</p></div></div>}</section>
    </div>
  </div>;
}
