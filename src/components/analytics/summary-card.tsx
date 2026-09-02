type SummaryCardProps = {
  label: string;
  value: string;
  change: string;
  tone: "lime" | "mint" | "violet" | "amber";
};

const tones = {
  lime: "border-[#edf43b]/20 bg-[radial-gradient(circle_at_100%_0%,rgba(237,244,59,0.1),transparent_55%),rgba(237,244,59,0.045)] text-[#edf43b]",
  mint: "border-[#69d3a4]/20 bg-[radial-gradient(circle_at_100%_0%,rgba(105,211,164,0.11),transparent_55%),rgba(105,211,164,0.04)] text-[#69d3a4]",
  violet: "border-[#9c82e8]/20 bg-[radial-gradient(circle_at_100%_0%,rgba(156,130,232,0.13),transparent_55%),rgba(156,130,232,0.045)] text-[#ae98eb]",
  amber: "border-[#f2c95e]/20 bg-[radial-gradient(circle_at_100%_0%,rgba(242,201,94,0.11),transparent_55%),rgba(242,201,94,0.04)] text-[#f2c95e]",
};

export function SummaryCard({ label, value, change, tone }: SummaryCardProps) {
  return (
    <article className={`relative min-w-0 overflow-hidden rounded-[var(--radius-panel)] border p-[clamp(1rem,0.8rem+0.45vw,1.45rem)] shadow-[0_1px_0_rgba(255,255,255,0.025)_inset] ${tones[tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[clamp(0.7rem,0.66rem+0.1vw,0.8rem)] font-medium text-[#8d969b]">{label}</p>
        <span className="shrink-0 rounded-full bg-current/10 px-2 py-1 text-[10px] font-semibold">{change}</span>
      </div>
      <p className="mt-5 whitespace-nowrap font-display text-[clamp(1.4rem,1.12rem+0.68vw,2.15rem)] font-semibold leading-none tracking-[-0.05em] text-white">{value}</p>
    </article>
  );
}
