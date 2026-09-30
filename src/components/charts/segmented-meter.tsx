export function SegmentedMeter({ value, label }: { value: number; label: string }) {
  const percentage = Math.min(100, Math.max(0, value));
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage}
      className="grid w-36 grid-cols-10 gap-1">
      {Array.from({ length: 10 }, (_, index) => (
        <span key={index} aria-hidden="true" className="aspect-square overflow-hidden rounded-[1px] bg-[var(--surface-soft)]">
          <span className="block h-full bg-[var(--chart-1)]" style={{ width: `${Math.min(100, Math.max(0, percentage * 10 - index * 100))}%` }} />
        </span>
      ))}
    </div>
  );
}
