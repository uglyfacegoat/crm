"use client";

const durations = [60, 90, 120, 180, 240] as const;

export function VisitDurationPicker({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return <fieldset><legend className="text-[10px] text-[var(--muted)]">Длительность *</legend><input type="hidden" name="durationMinutes" value={value} /><div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">{durations.map((duration) => <button key={duration} type="button" onClick={() => onChange(duration)} className={`focus-ring h-10 rounded-[10px] border text-[10px] ${value === duration ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "border-[var(--line-strong)] text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"}`}>{duration % 60 ? `${Math.floor(duration / 60)}ч ${duration % 60}м` : `${duration / 60} ч`}</button>)}</div></fieldset>;
}
