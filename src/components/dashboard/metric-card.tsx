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
    card: "from-[#566017] to-[#22290d] text-white border-[#dce63c]/20",
    subtle: "text-[#c9cf9e]",
    chart: "#dfe944",
    icon: "bg-[#dce63c]/10 text-[#e3ec4b] ring-[#dce63c]/10",
  },
  violet: {
    card: "from-[#4b386a] to-[#211a33] text-white border-[#9c82e8]/20",
    subtle: "text-[#c8bde8]",
    chart: "#a88cef",
    icon: "bg-[#9c82e8]/12 text-[#b49cf3] ring-[#9c82e8]/10",
  },
  mint: {
    card: "from-[#12676a] to-[#082e33] text-white border-[#55d5ca]/20",
    subtle: "text-[#9bc9c6]",
    chart: "#55d5ca",
    icon: "bg-[#55d5ca]/10 text-[#65ddd2] ring-[#55d5ca]/10",
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
    <article style={{ animationDelay: delay }} className={`noise animate-rise relative min-h-[9rem] overflow-hidden rounded-[var(--radius-panel)] border bg-gradient-to-br p-[clamp(1rem,0.8rem+0.45vw,1.45rem)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_18px_50px_rgba(0,0,0,0.12)] 2xl:min-h-[9.5rem] ${palette.card}`}>
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
