import { Sparkline } from "@/components/charts/sparkline";

type MetricCardProps = {
  label: string;
  value: string;
  change: string;
  tone: "warning" | "accent" | "support" | "danger";
  bars: number[];
  delay: string;
};

const tones = {
  warning: {
    detail: "text-[var(--warning)]",
    chart: "var(--chart-positive)",
  },
  accent: {
    detail: "text-[var(--accent-ink)]",
    chart: "var(--chart-positive)",
  },
  support: {
    detail: "text-[var(--support-strong)]",
    chart: "var(--chart-positive)",
  },
  danger: {
    detail: "text-[var(--danger-ink)]",
    chart: "var(--chart-negative)",
  },
};

export function MetricCard({ label, value, change, tone, bars, delay }: MetricCardProps) {
  const palette = tones[tone];
  return (
    <article style={{ animationDelay: delay }} className="surface-panel dashboard-panel animate-rise min-w-0">
      <div className="flex items-center px-3 pb-2 pt-1">
        <p className="truncate text-[clamp(0.68rem,0.64rem+0.1vw,0.78rem)] font-semibold text-[var(--muted)]">{label}</p>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_4.5rem] items-end gap-3 bg-[var(--surface)] px-3 py-5">
        <div className="min-w-0">
          <p className="truncate font-display text-[clamp(1.35rem,1.12rem+0.5vw,2rem)] font-semibold leading-none tracking-[-0.055em] text-[var(--text)]">{value}</p>
          <p className={`mt-2 truncate text-[clamp(0.62rem,0.59rem+0.07vw,0.7rem)] font-medium ${palette.detail}`}>{change}</p>
        </div>
        <Sparkline values={bars} color={palette.chart} className="h-10 w-full" />
      </div>
    </article>
  );
}
