type SummaryCardProps = {
  label: string;
  value: string;
  change: string;
  tone: "lime" | "mint" | "violet" | "amber";
};

const tones = {
  lime: { card: "from-[#3f4915] to-[#18200e] border-[#dce63c]/18", detail: "text-[#cbd198]" },
  mint: { card: "from-[#125b57] to-[#092c2b] border-[#69d3a4]/18", detail: "text-[#9bc9bd]" },
  violet: { card: "from-[#403260] to-[#201a31] border-[#9c82e8]/18", detail: "text-[#c6b9e7]" },
  amber: { card: "from-[#674b1f] to-[#2e2111] border-[#f2c95e]/18", detail: "text-[#dfc58e]" },
};

export function SummaryCard({ label, value, change, tone }: SummaryCardProps) {
  const palette = tones[tone];
  return (
    <article className={`relative min-w-0 rounded-[18px] border bg-gradient-to-br p-[clamp(1rem,0.8rem+0.45vw,1.45rem)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_12px_30px_rgba(0,0,0,0.1)] ${palette.card}`}>
      <div className="flex items-start justify-between gap-3">
        <p className={`text-[clamp(0.7rem,0.66rem+0.1vw,0.8rem)] font-medium ${palette.detail}`}>{label}</p>
        <span className={`shrink-0 rounded-full bg-black/[0.12] px-2.5 py-1 text-[10px] font-semibold ${palette.detail}`}>{change}</span>
      </div>
      <p className="mt-5 whitespace-nowrap font-display text-[clamp(1.4rem,1.12rem+0.68vw,2.15rem)] font-semibold leading-none tracking-[-0.05em] text-white">{value}</p>
    </article>
  );
}
