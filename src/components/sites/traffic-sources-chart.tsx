const colors = ["#25272c", "#6f8fcb", "#a2beff", "#9eb8a7", "#c7a56c", "#a7a9ae"];

export function TrafficSourcesChart({ entries }: { entries: Array<{ label: string; value: number; amount: number }> }) {
  if (!entries.length) return <div className="grid min-h-56 place-items-center rounded-[14px] border border-dashed border-[var(--line)] text-center text-[10px] leading-5 text-[var(--muted)]">UTM-источники появятся после приёма первых заявок.</div>;
  const maximum = Math.max(...entries.map((entry) => entry.amount));
  return <div className="space-y-4" role="img" aria-label="Рейтинг источников заявок">{entries.map((entry, index) => <div key={entry.label} className="grid grid-cols-[minmax(7rem,0.7fr)_minmax(0,1.5fr)_auto] items-center gap-3">
    <span className="truncate text-[10px] text-[var(--text-secondary)]">{entry.label}</span>
    <span className="relative block h-px bg-[var(--line-strong)]"><span className="absolute left-0 top-1/2 h-px -translate-y-1/2" style={{ width: `${entry.amount / maximum * 100}%`, backgroundColor: colors[index % colors.length] }} /><span className="absolute top-1/2 size-3 -translate-y-1/2 rounded-full border-2 border-[var(--surface)]" style={{ left: `calc(${entry.amount / maximum * 100}% - 6px)`, backgroundColor: colors[index % colors.length] }} /></span>
    <strong className="font-display text-xs text-[var(--text)]">{entry.amount} <span className="font-sans text-[9px] font-normal text-[var(--muted)]">· {entry.value}%</span></strong>
  </div>)}</div>;
}
