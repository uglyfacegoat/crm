type ProgressEntry = {
  label: string;
  value: number;
  amount: string | number;
};

export function ProgressList({ entries, accent = "var(--accent)" }: { entries: ProgressEntry[]; accent?: string }) {
  return (
    <div className="space-y-5">
      {entries.map((entry) => (
        <div key={entry.label}>
          <div className="mb-2 flex items-center justify-between gap-3 text-xs">
            <span className="min-w-0 truncate text-[var(--text-secondary)]">{entry.label}</span>
            <span className="shrink-0 font-display text-[11px] font-medium text-[var(--text)]">{entry.amount}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-soft)]">
            <div className="h-full rounded-full" style={{ width: `${entry.value}%`, backgroundColor: accent }} />
          </div>
        </div>
      ))}
    </div>
  );
}
