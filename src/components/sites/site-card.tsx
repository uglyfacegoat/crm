import { ArrowUpRight, Settings2 } from "lucide-react";
import Link from "next/link";
import { formatMoneyMinor } from "@/lib/format";
import type { WebsiteListItem, WebsiteProvider } from "@/server/sites/types";

export const providerLabels: Record<WebsiteProvider, string> = {
  yandex_metrica: "Яндекс Метрика",
  ga4: "GA4",
  google_search_console: "Search Console",
  yandex_webmaster: "Яндекс Вебмастер",
};

const integerFormatter = new Intl.NumberFormat("ru-RU");

function Sparkline({ values }: { values: Array<number | null> }) {
  const measured = values.filter((value): value is number => value !== null);
  if (!measured.length) return <span className="text-xs text-[var(--muted)]">Нет данных</span>;
  const maximum = Math.max(...measured);
  const minimum = Math.min(...measured);
  const range = Math.max(1, maximum - minimum);
  const points = values
    .map(
      (value, index) => value === null ? "" :
        `${index === 0 || values[index - 1] === null ? "M" : "L"}${(index / Math.max(1, values.length - 1)) * 108},${26 - ((value - minimum) / range) * 20}`,
    )
    .join(" ");

  return (
    <svg viewBox="0 0 108 30" role="img" aria-label="Динамика трафика">
      <path
        d={points}
        fill="none"
        stroke="#25272c"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {values.map((value, index) => value === null ? null : <circle key={index} cx={(index / Math.max(1, values.length - 1)) * 108} cy={26 - ((value - minimum) / range) * 20} r={1.5} fill="#25272c" />)}
    </svg>
  );
}

export function SiteCard({
  site,
  index,
  onConfigure,
  canWrite,
}: {
  site: WebsiteListItem;
  index: number;
  onConfigure: (site: WebsiteListItem) => void;
  canWrite: boolean;
}) {
  return (
    <article
      className="sites-register-row animate-rise"
      style={{ animationDelay: `${60 + index * 35}ms` }}
    >
      <div className="sites-register-domain">
        <Link href={`/sites/${site.id}`}>{site.name}</Link>
        <span>{site.domain}</span>
      </div>
      <Sparkline values={site.trafficHistory} />
      <strong>{site.trafficHistory.some((value) => value !== null) ? integerFormatter.format(site.visitors) : "—"}</strong>
      <strong>{integerFormatter.format(site.leads)}</strong>
      <strong>{integerFormatter.format(site.paidOrders)}</strong>
      <strong>{formatMoneyMinor(site.paidRevenueMinor)}</strong>
      <div className="sites-register-actions">
        <Link href={`/sites/${site.id}`} aria-label={`Открыть ${site.name}`}>
          <ArrowUpRight />
        </Link>
        <button
          type="button"
          disabled={!canWrite || site.status === "disabled"}
          onClick={() => onConfigure(site)}
          aria-label={`Настроить подключения ${site.name}`}
        >
          <Settings2 />
        </button>
      </div>
    </article>
  );
}
