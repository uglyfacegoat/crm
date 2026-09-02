import Link from "next/link";
import { ArrowUpRight, MapPin } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import type { DashboardVisit } from "@/components/dashboard/dashboard-calendar";

const dots = {
  lime: "bg-[var(--accent)]",
  violet: "bg-[var(--violet)]",
  mint: "bg-[var(--success)]",
  yellow: "bg-[var(--warning)]",
};

export function TodayVisits({ visits, dateLabel }: { visits: DashboardVisit[]; dateLabel: string }) {
  return (
    <section className="surface-panel animate-rise" style={{ animationDelay: "240ms" }}>
      <div className="flex items-center justify-between border-b border-white/[0.06] px-[clamp(1rem,0.75rem+0.5vw,1.5rem)] py-4 2xl:py-5">
        <div>
          <h2 className="text-sm font-semibold text-white">Ближайшие выезды</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">Ближайшие даты · {dateLabel}</p>
        </div>
        <Link href="/calendar" className="focus-ring rounded-lg p-2 text-[#737d83] transition-colors hover:bg-white/[0.05] hover:text-white" aria-label="Открыть календарь">
          <ArrowUpRight className="size-4" />
        </Link>
      </div>
      <div className="divide-y divide-white/[0.055]">
        {visits.map((visit, index) => (
          <Link key={visit.id} href={visit.orderId ? `/orders/${visit.orderId}` : `/calendar?date=${visit.date}`} className="focus-ring group grid grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-3 px-[clamp(1rem,0.75rem+0.5vw,1.5rem)] py-3.5 transition-colors duration-200 hover:bg-white/[0.035] 2xl:py-4">
            <div className="flex items-center gap-2">
              <span className={`size-1.5 rounded-full ${dots[visit.color]}`} />
              <span className="font-display text-[10px] font-medium text-white">{visit.time}</span>
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-[#e6e9e5]">{visit.client}</p>
              <p className="mt-1 flex items-center gap-1 truncate text-[10px] text-[#707980]"><MapPin className="size-3" />{visit.address}</p>
            </div>
            <div className="flex items-center gap-2">
              <Avatar name={visit.master} size="sm" tone={index % 2 ? "mint" : "violet"} />
              <span className="hidden max-w-24 truncate text-[10px] text-[#7b848a] sm:block">{visit.master.split(" ")[0]}</span>
            </div>
          </Link>
        ))}
      </div>
      {!visits.length ? <p className="px-5 py-10 text-center text-xs text-[#69737a]">Предстоящих выездов нет</p> : null}
      <Link href="/calendar" className="focus-ring block border-t border-white/[0.06] px-5 py-3.5 text-center text-[11px] font-medium text-[#8d969b] transition-colors hover:bg-white/[0.03] hover:text-white">
        Все выезды
      </Link>
    </section>
  );
}
