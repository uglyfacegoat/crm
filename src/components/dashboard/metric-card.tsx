import type { LucideIcon } from "lucide-react";
import { Sparkline } from "@/components/charts/sparkline";

type MetricCardProps = {
  label: string;
  value: string;
  change: string;
  icon: LucideIcon;
  tone: "yellow" | "violet" | "mint" | "red";
  bars: number[];
  delay: string;
};

const tones = {
  yellow: {
    card: "bg-[#29302e] text-white border-[#b8f7e4]/20",
    subtle: "text-[#a9b8b3]",
    chart: "#b8f7e4",
    icon: "bg-[#b8f7e4]/10 text-[#b8f7e4] ring-[#b8f7e4]/10",
  },
  violet: {
    card: "bg-[#2b2e34] text-white border-[#b8f7e4]/15",
    subtle: "text-[#a5aeac]",
    chart: "#91e9ce",
    icon: "bg-[#b8f7e4]/10 text-[#b8f7e4] ring-[#b8f7e4]/10",
  },
  mint: {
    card: "bg-[#24332f] text-white border-[#b8f7e4]/20",
    subtle: "text-[#a7c6bd]",
    chart: "#91e9ce",
    icon: "bg-[#b8f7e4]/10 text-[#b8f7e4] ring-[#b8f7e4]/10",
  },
  red: {
    card: "from-[#812d39] to-[#3e171e] text-white border-[#ef646a]/20",
    subtle: "text-[#ffd0d2]",
    chart: "#ef646a",
    icon: "bg-[#ef646a]/12 text-[#ff7b82] ring-[#ef646a]/10",
  },
};

export function MetricCard({ label, value, change, icon: Icon, tone, bars, delay }: MetricCardProps) {
  const palette = tones[tone];
  return (
    <article style={{ animationDelay: delay }} className={`animate-rise relative min-h-[9rem] overflow-hidden rounded-[var(--radius-panel)] border p-[clamp(1rem,0.8rem+0.45vw,1.45rem)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_18px_50px_rgba(0,0,0,0.12)] 2xl:min-h-[9.5rem] ${palette.card}`}>
      <div className="relative z-10 flex items-start justify-between gap-3">
        <div>
          <p className={`text-[clamp(0.7rem,0.66rem+0.12vw,0.82rem)] font-semibold ${palette.subtle}`}>{label}</p>
          <p className="mt-4 whitespace-nowrap font-display text-[clamp(1.65rem,1.3rem+0.75vw,2.55rem)] font-semibold leading-none tracking-[-0.055em]">{value}</p>
        </div>
        <span className={`grid size-9 shrink-0 place-items-center rounded-[12px] ring-1 ring-inset 2xl:size-10 ${palette.icon}`}>
          <Icon className="size-4" strokeWidth={2} />
        </span>
      </div>
      <div className="relative z-10 mt-5 flex items-end justify-between gap-4">
        <p className={`text-[clamp(0.64rem,0.61rem+0.08vw,0.73rem)] font-medium ${palette.subtle}`}>{change}</p>
        <Sparkline values={bars} color={palette.chart} className="h-9 w-[6.5rem] shrink-0" />
      </div>
    </article>
  );
}
