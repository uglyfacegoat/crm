type SummaryCardProps = {
  label: string;
  value: string;
  change: string;
  tone: "lime" | "mint" | "violet" | "amber";
};

const tones = {
  lime: "border-[#edf43b]/20 bg-[#edf43b]/[0.055] text-[#edf43b]",
  mint: "border-[#69d3a4]/20 bg-[#69d3a4]/[0.055] text-[#69d3a4]",
  violet: "border-[#9c82e8]/20 bg-[#9c82e8]/[0.055] text-[#ae98eb]",
  amber: "border-[#f2c95e]/20 bg-[#f2c95e]/[0.055] text-[#f2c95e]",
};

export function SummaryCard({ label, value, change, tone }: SummaryCardProps) {
  return (
    <article className={`min-w-0 rounded-[var(--radius-panel)] border p-[clamp(1rem,0.8rem+0.45vw,1.45rem)] ${tones[tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[clamp(0.7rem,0.66rem+0.1vw,0.8rem)] font-medium text-[#8d969b]">{label}</p>
        <span className="shrink-0 rounded-full bg-current/10 px-2 py-1 text-[10px] font-semibold">{change}</span>
      </div>
      <p className="mt-5 whitespace-nowrap font-display text-[clamp(1.4rem,1.12rem+0.68vw,2.15rem)] font-semibold leading-none tracking-[-0.05em] text-white">{value}</p>
    </article>
  );
}
