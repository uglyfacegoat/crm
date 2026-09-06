import { Sparkline } from "@/components/charts/sparkline";

type MetricCardProps = {
  label: string;
  value: string;
  change: string;
  tone: "yellow" | "violet" | "mint" | "red";
  bars: number[];
  delay: string;
};

const tones = {
  yellow: {
    card: "from-[#566017] to-[#22290d] text-white border-[#dce63c]/20",
    subtle: "text-[#c9cf9e]",
    chart: "#dfe944",
  },
  violet: {
    card: "from-[#4b386a] to-[#211a33] text-white border-[#9c82e8]/20",
    subtle: "text-[#c8bde8]",
    chart: "#a88cef",
  },
  mint: {
    card: "from-[#12676a] to-[#082e33] text-white border-[#55d5ca]/20",
    subtle: "text-[#9bc9c6]",
    chart: "#55d5ca",
  },
  red: {
    card: "from-[#812d39] to-[#3e171e] text-white border-[#ef646a]/20",
    subtle: "text-[#ffd0d2]",
    chart: "#ef646a",
  },
};

export function MetricCard({ label, value, change, tone, bars, delay }: MetricCardProps) {
  const palette = tones[tone];
  return (
    <article style={{ animationDelay: delay }} className={`noise animate-rise relative flex min-h-[9rem] flex-col overflow-hidden rounded-[var(--radius-panel)] border bg-gradient-to-br p-[clamp(1rem,0.8rem+0.45vw,1.45rem)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_18px_50px_rgba(0,0,0,0.12)] 2xl:min-h-[9.5rem] ${palette.card}`}>
      <div className="relative z-10">
        <p className={`text-[clamp(0.7rem,0.66rem+0.12vw,0.82rem)] font-semibold ${palette.subtle}`}>{label}</p>
        <p className="mt-4 whitespace-nowrap font-display text-[clamp(1.65rem,1.3rem+0.75vw,2.55rem)] font-semibold leading-none tracking-[-0.055em]">{value}</p>
      </div>
      <div className="relative z-10 mt-auto grid grid-cols-[minmax(0,1fr)_6.5rem] items-end gap-4 pt-5">
        <p className={`min-w-0 text-[clamp(0.64rem,0.61rem+0.08vw,0.73rem)] font-medium ${palette.subtle}`}>{change}</p>
        <Sparkline values={bars} color={palette.chart} className="h-9 w-full" />
      </div>
    </article>
  );
}
