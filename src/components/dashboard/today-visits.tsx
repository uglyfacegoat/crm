import Link from "next/link";
import { ArrowRight, ArrowUpRight, MapPin } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import type { DashboardVisit, DashboardVisitTone } from "@/components/dashboard/dashboard-calendar";

const dots: Record<DashboardVisitTone, string> = {
  warning: "bg-[var(--warning)]",
  support: "bg-[var(--support)]",
  accent: "bg-[var(--accent)]",
  success: "bg-[var(--success)]",
  danger: "bg-[var(--danger)]",
};

export function TodayVisits({ visits, dateLabel, title = "Ближайшие выезды" }: { visits: DashboardVisit[]; dateLabel: string; title?: string }) {
  return (
    <section aria-labelledby="dashboard-route-heading" className="surface-panel dashboard-panel animate-rise" style={{ animationDelay: "240ms" }}>
      <div className="flex items-center justify-between border-b border-[var(--line)] px-[clamp(1rem,0.75rem+0.5vw,1.5rem)] py-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--accent)]">Оперативный маршрут</p>
          <h2 id="dashboard-route-heading" className="mt-2 text-[clamp(1rem,0.9rem+0.23vw,1.2rem)] font-semibold tracking-[-0.025em] text-[var(--text)]">{title}</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">{dateLabel}</p>
        </div>
        <Link href="/calendar" className="focus-ring grid size-9 place-items-center rounded-full border border-[var(--line)] text-[var(--muted)] transition-[background-color,border-color,transform] hover:-translate-y-px hover:border-[var(--line-strong)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)] active:translate-y-0" aria-label="Открыть календарь">
          <ArrowUpRight className="size-4" />
        </Link>
      </div>
      <ol className="divide-y divide-[var(--line)]">
        {visits.map((visit, index) => (
          <li key={visit.id}>
            <Link href={visit.orderId ? `/orders/${visit.orderId}` : `/calendar?date=${visit.date}`} className="focus-ring group grid grid-cols-[3.55rem_minmax(0,1fr)_auto] items-center gap-3 px-[clamp(1rem,0.75rem+0.5vw,1.5rem)] py-3.5 transition-colors duration-200 hover:bg-[var(--surface-soft)] sm:grid-cols-[4.75rem_minmax(0,1fr)_auto]">
              <div className="flex items-center gap-2">
                <span className={`size-1.5 rounded-full ${dots[visit.tone]}`} />
                <span className="font-display text-[11px] font-semibold text-[var(--text)]">{visit.time}</span>
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-[var(--text-secondary)]">{visit.client}</p>
                <p className="mt-1 flex items-center gap-1 truncate text-[10px] text-[var(--muted)]"><MapPin className="size-3 shrink-0" />{visit.address}</p>
              </div>
              <div className="flex items-center gap-2">
                <Avatar name={visit.master} size="sm" tone={index % 2 ? "mint" : "violet"} />
                <span className="hidden max-w-24 truncate text-[10px] text-[var(--muted)] sm:block">{visit.master.split(" ")[0]}</span>
              </div>
            </Link>
          </li>
        ))}
      </ol>
      {!visits.length ? <p className="px-5 py-9 text-center text-xs text-[var(--muted)]">Предстоящих выездов нет</p> : null}
      <Link href="/calendar" className="focus-ring flex items-center justify-center gap-2 border-t border-[var(--line)] px-5 py-3.5 text-[11px] font-semibold text-[var(--accent-ink)] transition-colors hover:bg-[var(--surface-soft)]">
        Все выезды <ArrowRight className="size-3.5" />
      </Link>
    </section>
  );
}
