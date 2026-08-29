import { Activity, ArrowUpRight, CircleAlert, CircleCheck, Clock3, Globe2 } from "lucide-react";
import type { connectedSites } from "@/lib/analytics-data";

type Site = (typeof connectedSites)[number];

const statusPresentation = {
  connected: { label: "Подключён", icon: CircleCheck, className: "bg-[#69d3a4]/10 text-[#69d3a4]" },
  attention: { label: "Нужна проверка", icon: CircleAlert, className: "bg-[#f2c95e]/10 text-[#f2c95e]" },
  setup: { label: "Настройка", icon: Clock3, className: "bg-white/[0.055] text-[#8b9499]" },
};

export function SiteCard({ site, index }: { site: Site; index: number }) {
  const status = statusPresentation[site.status];
  const StatusIcon = status.icon;

  return (
    <article className="surface-panel animate-rise min-w-0 overflow-hidden" style={{ animationDelay: `${80 + index * 45}ms` }}>
      <div className="relative h-24 overflow-hidden border-b border-white/[0.06] bg-[radial-gradient(circle_at_75%_25%,rgba(237,244,59,0.14),transparent_28%),linear-gradient(135deg,#151d20,#0b1013)]">
        <div className="absolute inset-x-6 bottom-0 top-5 rounded-t-xl border border-white/[0.07] bg-black/25 p-3"><span className="block h-1.5 w-1/3 rounded-full bg-[var(--accent)]/55" /><span className="mt-3 block h-1 w-2/3 rounded-full bg-white/[0.09]" /><span className="mt-2 block h-1 w-1/2 rounded-full bg-white/[0.06]" /></div>
      </div>
      <div className="p-[clamp(1rem,0.8rem+0.5vw,1.5rem)]">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-[14px] border border-white/[0.07] bg-white/[0.035] text-[var(--accent)]">
          <Globe2 className="size-5" strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-white">{site.name}</h2>
          <p className="mt-1 truncate text-xs text-[#6f797f]">{site.domain}</p>
        </div>
        <span className={`hidden shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[10px] font-semibold min-[360px]:flex ${status.className}`}>
          <StatusIcon className="size-3.5" />{status.label}
        </span>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-2 border-y border-white/[0.06] py-4">
        {[
          ["Посетители", site.visitors],
          ["Лиды", site.leads],
          ["Конверсия", site.conversion],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <p className="truncate text-[9px] uppercase tracking-[0.1em] text-[#667077]">{label}</p>
            <p className="mt-2 truncate font-display text-[clamp(0.8rem,0.7rem+0.3vw,1.05rem)] font-semibold text-white">{value}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 flex min-h-8 min-w-0 items-center gap-2">
        {site.integrations.length ? site.integrations.map((integration) => (
          <span key={integration} className="truncate rounded-lg bg-white/[0.04] px-2 py-1.5 text-[9px] text-[#8d969b]">{integration}</span>
        )) : <span className="text-[10px] text-[#6f797f]">Счётчики ещё не подключены</span>}
        <span className={`ml-auto shrink-0 text-[10px] font-semibold ${site.change.startsWith("−") ? "text-[#ef7a7f]" : "text-[#69d3a4]"}`}>{site.change}</span>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-[10px] text-[#707a80]"><Activity className="size-3.5" />Доступность {site.health || "—"}%</span>
        <button disabled title="Карточка станет доступна после подключения API" className="flex cursor-not-allowed items-center gap-1.5 rounded-lg px-2 py-1.5 text-[10px] text-[#707a80] opacity-70">Подробнее<ArrowUpRight className="size-3" /></button>
      </div>
      </div>
    </article>
  );
}
