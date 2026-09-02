import { Activity, ArrowUpRight, CircleAlert, CircleCheck, Clock3, Globe2, Power } from "lucide-react";
import type { WebsiteListItem, WebsiteProvider } from "@/server/sites/types";

const statusPresentation = {
  active: { label: "Активен", icon: CircleCheck, className: "bg-[#69d3a4]/10 text-[#69d3a4]" },
  attention: { label: "Нужна проверка", icon: CircleAlert, className: "bg-[#f2c95e]/10 text-[#f2c95e]" },
  setup: { label: "Настройка", icon: Clock3, className: "bg-white/[0.055] text-[#8b9499]" },
  disabled: { label: "Отключён", icon: Power, className: "bg-[#ef646a]/10 text-[#d9797d]" },
};

export const providerLabels: Record<WebsiteProvider, string> = {
  yandex_metrica: "Метрика", ga4: "GA4", google_search_console: "Search Console", yandex_webmaster: "Вебмастер",
};
const integerFormatter = new Intl.NumberFormat("ru-RU");

export function SiteCard({ site, index, onConfigure, canWrite }: { site: WebsiteListItem; index: number; onConfigure: (site: WebsiteListItem) => void; canWrite: boolean }) {
  const status = statusPresentation[site.status];
  const StatusIcon = status.icon;
  const connected = site.integrations.filter((integration) => integration.status === "connected").length;
  const errors = site.integrations.filter((integration) => integration.status === "error").length;
  return <article className="surface-panel animate-rise min-w-0 overflow-hidden" style={{ animationDelay: `${80 + index * 45}ms` }}>
    <div className="relative h-24 overflow-hidden border-b border-white/[0.06] bg-[linear-gradient(135deg,#151d20,#0b1013)]"><div className="absolute inset-x-6 bottom-0 top-5 rounded-t-xl border border-white/[0.07] bg-black/25 p-3"><span className="block h-1.5 w-1/3 rounded-full bg-[var(--accent)]/55" /><span className="mt-3 block h-1 w-2/3 rounded-full bg-white/[0.09]" /><span className="mt-2 block h-1 w-1/2 rounded-full bg-white/[0.06]" /></div></div>
    <div className="p-[clamp(1rem,0.8rem+0.5vw,1.5rem)]"><div className="flex min-w-0 items-start gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-[14px] border border-white/[0.07] bg-white/[0.035] text-[var(--accent)]"><Globe2 className="size-5" strokeWidth={1.8} /></span><div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold text-white">{site.name}</h2><a href={`https://${site.domain}`} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs text-[#6f797f] hover:text-[var(--accent)]">{site.domain}</a></div><span className={`hidden shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[10px] font-semibold min-[360px]:flex ${status.className}`}><StatusIcon className="size-3.5" />{status.label}</span></div>
      <div className="mt-6 grid grid-cols-3 gap-2 border-y border-white/[0.06] py-4">{[["Посетители", integerFormatter.format(site.visitors)], ["Заявки", integerFormatter.format(site.leads)], ["Конверсия", `${site.conversionPercent.toLocaleString("ru-RU")}%`]].map(([label, value]) => <div key={label} className="min-w-0"><p className="truncate text-[9px] uppercase tracking-[0.1em] text-[#667077]">{label}</p><p className="mt-2 truncate font-display text-[clamp(0.8rem,0.7rem+0.3vw,1.05rem)] font-semibold text-white">{value}</p></div>)}</div>
      <div className="mt-4 flex min-h-8 min-w-0 flex-wrap items-center gap-2">{site.integrations.length ? site.integrations.map((integration) => <span key={integration.id} title={integration.lastErrorCode ?? undefined} className={`truncate rounded-lg px-2 py-1.5 text-[9px] ${integration.status === "error" ? "bg-[#ef646a]/[0.08] text-[#d9797d]" : integration.status === "connected" ? "bg-[#69d3a4]/[0.07] text-[#75bfa0]" : "bg-white/[0.04] text-[#8d969b]"}`}>{providerLabels[integration.provider]}</span>) : <span className="text-[10px] text-[#6f797f]">Источники ещё не настроены</span>}</div>
      <div className="mt-4 flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-[10px] text-[#707a80]"><Activity className="size-3.5" />{errors ? `${errors} с ошибкой` : connected ? `${connected} синхронизируется` : "Ожидает настройки"}</span><button type="button" disabled={!canWrite || site.status === "disabled"} onClick={() => onConfigure(site)} className="focus-ring flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[10px] text-[#899399] hover:bg-white/[0.04] hover:text-white disabled:cursor-not-allowed disabled:opacity-45">Подключения<ArrowUpRight className="size-3" /></button></div>
    </div>
  </article>;
}
