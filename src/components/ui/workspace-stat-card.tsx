import type { LucideIcon } from "lucide-react";
import { Sparkline } from "@/components/charts/sparkline";

type WorkspaceStatCardProps = {
  label: string;
  value: string;
  note: string;
  icon: LucideIcon;
  color: string;
  values?: number[];
};

export function WorkspaceStatCard({ label, value, note, icon: Icon, color, values = [18, 24, 21, 35, 30, 42, 39, 54] }: WorkspaceStatCardProps) {
  return (
    <article className="surface-panel min-w-0 p-[clamp(0.9rem,0.75rem+0.32vw,1.2rem)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><p className="truncate text-[10px] font-medium text-[#8d969c]">{label}</p><p className="mt-3 font-display text-[clamp(1.25rem,1rem+0.5vw,1.75rem)] font-semibold tracking-[-0.045em] text-white">{value}</p></div>
        <span className="grid size-8 shrink-0 place-items-center rounded-[10px]" style={{ color, backgroundColor: `color-mix(in srgb, ${color} 11%, transparent)` }}><Icon className="size-4" /></span>
      </div>
      <div className="mt-3 flex min-w-0 items-end gap-3"><p className="min-w-0 flex-1 truncate text-[9px]" style={{ color }}>{note}</p><Sparkline values={values} color={color} className="h-8 w-24 shrink-0" /></div>
    </article>
  );
}
