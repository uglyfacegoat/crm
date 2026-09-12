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
    marker: "bg-[var(--warning)]",
    detail: "text-[var(--warning)]",
    chart: "var(--warning)",
  },
  accent: {
    marker: "bg-[var(--accent)]",
    detail: "text-[var(--accent-ink)]",
    chart: "var(--accent)",
  },
  support: {
    marker: "bg-[var(--support)]",
    detail: "text-[var(--support-strong)]",
    chart: "var(--support)",
  },
  danger: {
    marker: "bg-[var(--danger)]",
    detail: "text-[var(--danger-ink)]",
    chart: "var(--danger)",
  },
};

export function MetricCard({ label, value, change, tone, bars, delay }: MetricCardProps) {
  const palette = tones[tone];
  return (
    <article style={{ animationDelay: delay }} className="surface-panel dashboard-panel animate-rise min-w-0 px-[clamp(1rem,0.72rem+0.7vw,1.5rem)] py-[clamp(1rem,0.78rem+0.55vw,1.4rem)]">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className={`size-1.5 rounded-full ${palette.marker}`} />
        <p className="truncate text-[clamp(0.68rem,0.64rem+0.1vw,0.78rem)] font-semibold text-[var(--muted)]">{label}</p>
      </div>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_4.5rem] items-end gap-3">
        <div className="min-w-0">
          <p className="truncate font-display text-[clamp(1.35rem,1.12rem+0.5vw,2rem)] font-semibold leading-none tracking-[-0.055em] text-[var(--text)]">{value}</p>
          <p className={`mt-2 truncate text-[clamp(0.62rem,0.59rem+0.07vw,0.7rem)] font-medium ${palette.detail}`}>{change}</p>
        </div>
        <Sparkline values={bars} color={palette.chart} showArea={false} className="h-9 w-full" />
      </div>
    </article>
  );
}
