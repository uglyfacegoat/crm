type SummaryCardProps = {
  label: string;
  value: string;
  change: string;
  tone: "lime" | "mint" | "violet" | "amber";
};

const tones = {
  lime: "var(--accent)",
  mint: "var(--support)",
  violet: "var(--accent-strong)",
  amber: "var(--support-strong)",
} as const;

export function SummaryCard({ label, value, change, tone }: SummaryCardProps) {
  const accent = tones[tone];
  return (
    <article className="relative min-w-0 rounded-[18px] border border-[var(--line)] bg-[var(--surface)] p-[clamp(1rem,0.8rem+0.45vw,1.45rem)] shadow-[var(--shadow-panel)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2"><span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: accent }} /><p className="truncate text-[clamp(0.7rem,0.66rem+0.1vw,0.8rem)] font-medium text-[var(--text-secondary)]">{label}</p></div>
        <span className="shrink-0 rounded-full bg-[var(--surface-soft)] px-2.5 py-1 text-[10px] font-semibold" style={{ color: accent }}>{change}</span>
      </div>
      <p className="mt-5 whitespace-nowrap font-display text-[clamp(1.4rem,1.12rem+0.68vw,2.15rem)] font-semibold leading-none tracking-[-0.05em] text-[var(--text)]">{value}</p>
    </article>
  );
}
