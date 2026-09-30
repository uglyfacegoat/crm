import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth/page-access";
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

function dueLabel(value: string | null) {
  if (!value) return "Дата не указана";
  const days = Math.ceil((Date.parse(`${value}T00:00:00Z`) - Date.now()) / 86_400_000);
  if (days < 0) return "Срок истёк";
  if (days === 0) return "Сегодня";
  return `Через ${days} дн.`;
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
  requirePagePermission(member, "sites.read");
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
  const memoryCapacityMb = health?.memoryCapacityMb ?? site.hosting?.memoryCapacityMb ?? null;
  const diskCapacityMb = health?.diskCapacityMb ?? site.hosting?.diskCapacityMb ?? null;
  const memoryPercent = health && memoryCapacityMb ? usagePercent(health.memoryUsedMb, memoryCapacityMb) : 0;
  const diskPercent = health && diskCapacityMb ? usagePercent(health.diskUsedMb, diskCapacityMb) : 0;
  const sslExpiresOn = health?.sslExpiresOn ?? site.hosting?.sslExpiresOn ?? null;
  const hasTrafficData = site.trafficHistory.some((value) => value !== null);

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
            canWrite={hasPermission(member, "sites.write") && !preview && (!site.organizationId || site.organizationId === member.organizationId)}
          />
        </div>
      </header>

      <div className="site-detail-period"><time>{healthPeriod}</time></div>

      <section className="site-detail-outcomes" aria-label="Бизнес-результаты">
        {[
          ["Посетители", hasTrafficData ? integerFormatter.format(site.visitors) : "—", `Просмотры: ${hasTrafficData ? integerFormatter.format(site.pageviews) : "нет счётчика"}`],
          ["Заявки", integerFormatter.format(site.leads), `Конверсия: ${hasTrafficData ? `${site.conversionPercent}%` : "нет данных о трафике"}`],
          ["Заказы с оплатой", integerFormatter.format(site.paidOrders), `Всего заказов: ${integerFormatter.format(site.orders)}`],
          ["Получено", formatMoneyMinor(site.paidRevenueMinor), "По оплаченным заказам"],
        ].map(([label, value, detail]) => (
          <article key={label}>
            <p>{label}</p>
            <strong>{value}</strong>
            <small>{detail}</small>
          </article>
        ))}
      </section>

      {health ? (
        <div className="site-detail-layout">
          <section className="figma-report-panel site-detail-resources">
            <header>
              <h2 className="figma-card-heading">Ресурсы сервера</h2>
              <p className="figma-card-caption">
                {health.source === "monitor" ? "Автоматический замер" : "Ручной замер"} · {formatDateTime(health.measuredAt)}
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
                value={`${formatStorage(health.memoryUsedMb)}${memoryCapacityMb ? ` / ${formatStorage(memoryCapacityMb)}` : ""}`}
                percent={memoryPercent}
                tone="gray"
              />
              <CapacityGauge
                label="Диск"
                value={`${formatStorage(health.diskUsedMb)}${diskCapacityMb ? ` / ${formatStorage(diskCapacityMb)}` : ""}`}
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
                  {site.healthHistory.length} контрольных замеров · доступность по проверкам {health.uptimePercent}%
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
                Договор и оплата заполняются отдельно
              </p>
            </header>
            {site.hosting ? <dl>
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
            </dl> : <p>Тариф, регион, стоимость и дата оплаты ещё не внесены. Замеры выше получены с рабочего VPS и не зависят от этого профиля.</p>}
          </section>

          <section className="figma-report-panel site-detail-dates">
            <header>
              <h2 className="figma-card-heading">
                Ближайшие контрольные даты
              </h2>
              <p className="figma-card-caption">
                Фактические и внесённые сроки
              </p>
            </header>
            <div>
              <article>
                <span>Оплата хостинга</span>
                <strong>{site.hosting ? formatDate(site.hosting.renewalOn) : "—"}</strong>
                <small>{dueLabel(site.hosting?.renewalOn ?? null)}</small>
              </article>
              <article>
                <span>Срок SSL</span>
                <strong>{sslExpiresOn ? formatDate(sslExpiresOn) : "—"}</strong>
                <small>{dueLabel(sslExpiresOn)}</small>
              </article>
            </div>
            <p>{health.sslExpiresOn ? "Срок SSL считан с действующего сертификата сайта." : "Дата SSL берётся из профиля хостинга."}</p>
          </section>
        </div>
      ) : (
        <section className="figma-report-panel site-detail-empty">
          <CalendarClock />
          <h2>Контрольные замеры ещё не настроены</h2>
          <p>
            Автоматический мониторинг ещё не передал замеры. Параметры договора
            и оплаты хостинга можно внести отдельно.
          </p>
        </section>
      )}
    </div>
  );
}
