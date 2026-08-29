import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Visit } from "@/lib/mock-data";

const eventColors = {
  lime: "border-[#dce63c]/25 bg-[#dce63c]/15 text-[#e5eb85]",
  violet: "border-[#9c82e8]/25 bg-[#9c82e8]/15 text-[#c2b3ed]",
  mint: "border-[#55d5ca]/25 bg-[#55d5ca]/15 text-[#9ae2da]",
  yellow: "border-[#f2a84b]/25 bg-[#f2a84b]/15 text-[#efc38b]",
};

export function DashboardCalendar({ visits }: { visits: Visit[] }) {
  const hours = ["08:00", "10:00", "12:00", "14:00", "16:00", "18:00"];

  return (
    <section className="surface-panel animate-rise min-w-0" style={{ animationDelay: "420ms" }}>
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-4">
        <h2 className="text-sm font-semibold text-white">Календарь выездов</h2>
        <span className="rounded-lg border border-white/[0.07] px-2.5 py-1.5 text-[10px] text-[#788289]">Неделя</span>
      </div>
      <div className="p-4">
        <div className="ml-10 grid grid-cols-7 gap-1 border-b border-white/[0.06] pb-2">
          {["Пн 24", "Вт 25", "Ср 26", "Чт 27", "Пт 28", "Сб 29", "Вс 30"].map((day, index) => (
            <span key={day} className={`rounded-lg py-2 text-center text-[9px] ${index === 1 ? "bg-[var(--accent)] font-semibold text-[#111508]" : "text-[#788289]"}`}>{day}</span>
          ))}
        </div>
        <div className="relative mt-2 h-[15.5rem]">
          {hours.map((hour, index) => (
            <div key={hour} className="absolute inset-x-0 flex items-center" style={{ top: `${index * 20}%` }}><span className="w-10 shrink-0 text-[9px] text-[#626d74]">{hour}</span><span className="h-px flex-1 bg-white/[0.055]" /></div>
          ))}
          {visits.slice(0, 5).map((visit, index) => (
            <Link key={visit.id} href={`/orders/${visit.orderId}`} className={`focus-ring absolute min-w-0 overflow-hidden rounded-lg border px-2 py-2 text-[8px] leading-3.5 ${eventColors[visit.color]}`} style={{ top: `${index * 16 + 8}%`, left: `${14 + (index % 4) * 19}%`, width: "27%" }}>
              <strong className="block truncate font-semibold">{visit.time} · {visit.client}</strong><span className="block truncate opacity-70">{visit.address}</span>
            </Link>
          ))}
        </div>
        <Link href="/calendar" className="focus-ring mt-1 flex items-center gap-2 rounded-lg text-[11px] font-semibold text-[var(--accent)]">Открыть календарь <ArrowRight className="size-3.5" /></Link>
      </div>
    </section>
  );
}
