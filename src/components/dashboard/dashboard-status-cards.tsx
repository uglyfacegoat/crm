import { Clock3 } from "lucide-react";

export function TeamOnlineCard({ active, total }: { active: number; total: number }) {
  const share = total ? Math.round((active / total) * 100) : 0;
  return (
    <article className="surface-panel animate-rise flex min-h-[9rem] min-w-0 flex-col justify-between p-4 2xl:min-h-[9.5rem]" style={{ animationDelay: "260ms" }}>
      <p className="text-[11px] font-medium text-[#c8ced1]">Мастера на линии</p>
      <div className="relative mx-auto grid size-[4.7rem] place-items-center rounded-full" style={{ background: `conic-gradient(#b8f7e4 0 ${share}%, rgba(255,255,255,0.06) ${share}% 100%)` }}>
        <div className="grid size-[3.7rem] place-items-center rounded-full bg-[#2b2e34] text-center">
          <div><strong className="block font-display text-xl text-white">{active}</strong><span className="block text-[9px] text-[#717b81]">из {total}</span></div>
        </div>
      </div>
      <p className="text-center text-[9px] text-[#69737a]">{share}% команды</p>
    </article>
  );
}

export function UpdatedCard() {
  return (
    <article className="surface-panel animate-rise flex min-h-[9rem] min-w-0 flex-col p-4 2xl:min-h-[9.5rem]" style={{ animationDelay: "300ms" }}>
      <p className="text-[11px] font-medium text-[#c8ced1]">Обновлено</p>
      <span className="mt-4 grid size-9 place-items-center rounded-xl bg-white/[0.04] text-[#68737a]"><Clock3 className="size-4" /></span>
      <p className="mt-auto font-display text-xs font-medium text-white">Сейчас</p>
      <p className="mt-1 text-[9px] leading-4 text-[#69737a]">Данные загружены</p>
    </article>
  );
}
