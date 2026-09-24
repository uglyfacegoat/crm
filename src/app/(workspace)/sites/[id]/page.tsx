import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarClock, ExternalLink } from "lucide-react";
import { z } from "zod";
import { SiteHealthChart } from "@/components/sites/site-health-chart";
import { SiteInfrastructureDialog } from "@/components/sites/site-infrastructure-dialog";
import { BackLink } from "@/components/ui/back-link";
import { formatMoneyMinor } from "@/lib/format";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import { getPreviewWebsiteDetail } from "@/server/sites/preview";
import {
  getWebsiteDetail,
  WebsiteNotFoundError,
} from "@/server/sites/repository";

export const metadata: Metadata = { title: "Карточка сайта" };
const integerFormatter = new Intl.NumberFormat("ru-RU");
const shortDateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/Moscow",
});
const statusLabels = {
  active: "Подключено",
  setup: "Настройка",
  attention: "Нужна проверка",
  disabled: "Отключён",
} as const;

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
}

function usagePercent(used: number, capacity: number) {
  return capacity ? Math.min(100, Math.round((used / capacity) * 100)) : 0;
}

function formatStorage(megabytes: number) {
  return megabytes >= 1024
    ? `${(megabytes / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} ГБ`
    : `${integerFormatter.format(megabytes)} МБ`;
}

function CapacityGauge({
  label,
  value,
  percent,
  tone,
}: {
  label: string;
  value: string;
  percent: number;
  tone: "dark" | "gray" | "blue";
}) {
  const filled = Math.ceil(percent / 20);
  return (
    <article className="site-detail-gauge">
      <span>{label}</span>
      <strong>{percent}%</strong>
      <div aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <i
            key={index}
            data-filled={5 - index <= filled}
            data-tone={tone}
          />
        ))}
      </div>
      <small>{value}</small>
    </article>
  );
}

export default async function WebsiteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const member = await requireOfficeSession();
  const { id } = await params;
  const preview = getAuthMode() === "preview";
  let site;
  if (preview) site = getPreviewWebsiteDetail(id);
  else {
    const parsedId = z.string().uuid().safeParse(id);
    if (!parsedId.success) notFound();
    try {
      site = await getWebsiteDetail(member, parsedId.data);
    } catch (error) {
      if (error instanceof WebsiteNotFoundError) notFound();
      throw error;
    }
  }
  if (!site) notFound();

  const health = site.health;
  const healthDates = site.healthHistory.map((entry) => new Date(entry.measuredAt)).toSorted((left, right) => left.getTime() - right.getTime());
  const healthPeriod = healthDates.length
    ? `${shortDateFormatter.format(healthDates[0]).replaceAll(".", "")} — ${shortDateFormatter.format(healthDates[healthDates.length - 1]).replaceAll(".", "")}`
    : "Контрольных замеров нет";
  const memoryPercent =
    site.hosting && health
      ? usagePercent(health.memoryUsedMb, site.hosting.memoryCapacityMb)
      : 0;
  const diskPercent =
    site.hosting && health
      ? usagePercent(health.diskUsedMb, site.hosting.diskCapacityMb)
      : 0;

  return (
    <div className="figma-report-page site-detail-page">
      <header className="site-detail-header">
        <BackLink href="/sites">К сайтам</BackLink>
        <div className="site-detail-title-row">
          <h1 className="figma-report-title">{site.name}</h1>
          <span data-status={site.status}><i aria-hidden="true" />{statusLabels[site.status]}</span>
        </div>
        <p className="figma-report-description">
          {site.domain} · технический паспорт
        </p>
        <div className="site-detail-actions">
          <a
            href={`https://${site.domain}`}
            target="_blank"
            rel="noreferrer"
            className="figma-report-control"
          >
            Открыть сайт <ExternalLink />
          </a>
          <SiteInfrastructureDialog
            site={site}
            canWrite={hasPermission(member, "sites.write") && !preview}
          />
        </div>
      </header>

      <div className="site-detail-period"><time>{healthPeriod}</time></div>

      <section className="site-detail-outcomes" aria-label="Бизнес-результаты">
        {[
          ["Посетители", integerFormatter.format(site.visitors)],
          ["Заявки", integerFormatter.format(site.leads)],
          ["Заказы с оплатой", integerFormatter.format(site.paidOrders)],
          ["Получено", formatMoneyMinor(site.paidRevenueMinor)],
        ].map(([label, value]) => (
          <article key={label}>
            <p>{label}</p>
            <strong>{value}</strong>
          </article>
        ))}
      </section>

      {site.hosting && health ? (
        <div className="site-detail-layout">
          <section className="figma-report-panel site-detail-resources">
            <header>
              <h2 className="figma-card-heading">Ресурсы сервера</h2>
              <p className="figma-card-caption">
                Ручной замер · {formatDateTime(health.measuredAt)}
              </p>
            </header>
            <div>
              <CapacityGauge
                label="CPU"
                value={`${health.cpuLoadPercent}%`}
                percent={health.cpuLoadPercent}
                tone="dark"
              />
              <CapacityGauge
                label="Память"
                value={`${formatStorage(health.memoryUsedMb)} / ${formatStorage(site.hosting.memoryCapacityMb)}`}
                percent={memoryPercent}
                tone="gray"
              />
              <CapacityGauge
                label="Диск"
                value={`${formatStorage(health.diskUsedMb)} / ${formatStorage(site.hosting.diskCapacityMb)}`}
                percent={diskPercent}
                tone="blue"
              />
            </div>
          </section>

          <section className="figma-report-panel site-detail-response">
            <header>
              <div>
                <h2 className="figma-card-heading">Время ответа</h2>
                <p className="figma-card-caption">
                  {site.healthHistory.length} контрольных замеров · миллисекунды
                </p>
              </div>
              <strong>{health.responseTimeMs} мс</strong>
            </header>
            <SiteHealthChart entries={site.healthHistory} />
          </section>

          <section className="figma-report-panel site-detail-history">
            <header>
              <h2 className="figma-card-heading">История контрольных замеров</h2>
              <p className="figma-card-caption">
                Отдельные наблюдения, а не непрерывный uptime
              </p>
            </header>
            <div>
              {site.healthHistory.slice(0, 14).toReversed().map((entry) => (
                <article key={entry.id}>
                  <strong>{entry.healthStatus === "healthy" ? "✓" : "!"}</strong>
                  <span>
                    {new Intl.DateTimeFormat("ru-RU", {
                      day: "numeric",
                      month: "short",
                      timeZone: "Europe/Moscow",
                    }).format(new Date(entry.measuredAt))}
                  </span>
                  <small>{entry.responseTimeMs} мс</small>
                </article>
              ))}
            </div>
            <small>
              {site.healthHistory.filter((entry) => entry.healthStatus === "healthy").length} штатных ·{" "}
              {site.healthHistory.filter((entry) => entry.healthStatus !== "healthy").length} отклонения
            </small>
          </section>

          <section className="figma-report-panel site-detail-passport">
            <header>
              <h2 className="figma-card-heading">Паспорт хостинга</h2>
              <p className="figma-card-caption">
                Профиль без реальных реквизитов
              </p>
            </header>
            <dl>
              {[
                ["Провайдер", site.hosting.provider],
                ["Тариф", site.hosting.planName],
                ["Регион", site.hosting.serverRegion],
                ["Стоимость", `${formatMoneyMinor(site.hosting.monthlyCostMinor)} / месяц`],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <p>Ручной профиль не подключает автоматический мониторинг.</p>
          </section>

          <section className="figma-report-panel site-detail-dates">
            <header>
              <h2 className="figma-card-heading">
                Ближайшие контрольные даты
              </h2>
              <p className="figma-card-caption">
                Сегодня · рабочий горизонт
              </p>
            </header>
            <div>
              <article>
                <span>Оплата хостинга</span>
                <strong>{formatDate(site.hosting.renewalOn)}</strong>
                <small>через 14 дней</small>
              </article>
              <article>
                <span>Срок SSL</span>
                <strong>{formatDate(site.hosting.sslExpiresOn)}</strong>
                <small>через 91 день</small>
              </article>
            </div>
            <div className="site-detail-timeline" aria-hidden="true">
              <i /><i /><i />
            </div>
            <p>Длина шкалы = дни до окончания SSL</p>
          </section>
          <section className="site-detail-mobile-state">
            <article className="figma-report-panel">
              <h2>Нет замеров — нет графика.</h2>
              <p>Текущий рабочий статус: мониторинг не настроен.</p>
            </article>
            <button
              type="button"
              className="figma-report-control"
              disabled
              title="Ручные замеры будут доступны после подключения мониторинга"
            >
              Добавить ручной замер
            </button>
          </section>
        </div>
      ) : (
        <section className="figma-report-panel site-detail-empty">
          <CalendarClock />
          <h2>Контрольные замеры ещё не настроены</h2>
          <p>
            Добавьте параметры хостинга и первый фактический замер, чтобы
            сформировать технический паспорт.
          </p>
        </section>
      )}
    </div>
  );
}
