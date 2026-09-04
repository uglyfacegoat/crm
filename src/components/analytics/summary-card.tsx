type SummaryCardProps = {
  label: string;
  value: string;
  change: string;
  tone: "lime" | "mint" | "violet" | "amber";
};

const tones = {
  lime: "text-[var(--accent)]",
  mint: "text-[var(--accent)]",
  violet: "text-[#aeb7b4]",
  amber: "text-[#e7c97b]",
};

export function SummaryCard({ label, value, change, tone }: SummaryCardProps) {
  return (
    <article className={`relative min-w-0 overflow-hidden border border-white/[0.09] bg-[var(--surface)] p-[clamp(1rem,0.8rem+0.45vw,1.45rem)] ${tones[tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[clamp(0.7rem,0.66rem+0.1vw,0.8rem)] font-medium text-[#8d969b]">{label}</p>
        <span className="shrink-0 border-l border-current/30 pl-2 text-[10px] font-semibold">{change}</span>
      </div>
      <p className="mt-5 whitespace-nowrap font-display text-[clamp(1.4rem,1.12rem+0.68vw,2.15rem)] font-semibold leading-none tracking-[-0.05em] text-white">{value}</p>
    </article>
  );
}
