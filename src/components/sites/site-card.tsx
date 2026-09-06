import { Activity, ArrowUpRight, CircleAlert, CircleCheck, Clock3, Globe2, Power } from "lucide-react";
import Link from "next/link";
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
  return <article className="animate-rise min-w-0 overflow-hidden border border-white/[0.09] bg-[var(--surface)]" style={{ animationDelay: `${80 + index * 45}ms` }}>
    <div className="border-b border-white/[0.08] px-[clamp(1rem,0.8rem+0.5vw,1.5rem)] py-3"><span className="font-display text-[10px] text-[#6f7876]">САЙТ {String(index + 1).padStart(2, "0")}</span></div>
    <div className="p-[clamp(1rem,0.8rem+0.5vw,1.5rem)]"><div className="flex min-w-0 items-start gap-3"><Globe2 className="mt-1 size-5 shrink-0 text-[var(--accent)]" strokeWidth={1.8} /><div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold text-white">{site.name}</h2><a href={`https://${site.domain}`} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs text-[#7d8684] hover:text-[var(--accent)]">{site.domain}</a></div><span className={`hidden shrink-0 items-center gap-1.5 border-l border-white/[0.1] pl-3 text-[10px] font-semibold min-[360px]:flex ${status.className}`}><StatusIcon className="size-3.5" />{status.label}</span></div>
      <div className="mt-6 grid grid-cols-3 gap-2 border-y border-white/[0.06] py-4">{[["Посетители", integerFormatter.format(site.visitors)], ["Заявки", integerFormatter.format(site.leads)], ["Конверсия", `${site.conversionPercent.toLocaleString("ru-RU")}%`]].map(([label, value]) => <div key={label} className="min-w-0"><p className="truncate text-[9px] uppercase tracking-[0.1em] text-[#667077]">{label}</p><p className="mt-2 truncate font-display text-[clamp(0.8rem,0.7rem+0.3vw,1.05rem)] font-semibold text-white">{value}</p></div>)}</div>
      <div className="mt-4 flex min-h-8 min-w-0 flex-wrap items-center gap-2">{site.integrations.length ? site.integrations.map((integration) => <span key={integration.id} title={integration.lastErrorCode ?? undefined} className={`truncate rounded-lg px-2 py-1.5 text-[9px] ${integration.status === "error" ? "bg-[#ef646a]/[0.08] text-[#d9797d]" : integration.status === "connected" ? "bg-[#69d3a4]/[0.07] text-[#75bfa0]" : "bg-white/[0.04] text-[#8d969b]"}`}>{providerLabels[integration.provider]}</span>) : <span className="text-[10px] text-[#6f797f]">Источники ещё не настроены</span>}</div>
      <div className="mt-4 flex items-center justify-between gap-3"><span className="flex min-w-0 items-center gap-2 truncate text-[10px] text-[#707a80]"><Activity className="size-3.5 shrink-0" />{errors ? `${errors} с ошибкой` : connected ? `${connected} синхронизируется` : "Ожидает настройки"}</span><div className="flex shrink-0 items-center gap-1"><Link href={`/sites/${site.id}`} className="focus-ring rounded-lg px-2 py-1.5 text-[10px] text-[var(--accent)] hover:bg-[var(--accent)]/[0.055]">Карточка</Link><button type="button" disabled={!canWrite || site.status === "disabled"} onClick={() => onConfigure(site)} className="focus-ring flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[10px] text-[#899399] hover:bg-white/[0.04] hover:text-white disabled:cursor-not-allowed disabled:opacity-45">Подключения<ArrowUpRight className="size-3" /></button></div></div>
    </div>
  </article>;
}
