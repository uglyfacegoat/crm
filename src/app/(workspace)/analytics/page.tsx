import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AnalyticsOverview } from "@/components/analytics/analytics-report";
import { getAnalyticsSnapshot } from "@/server/analytics/repository";
import { getPreviewAnalytics } from "@/server/analytics/preview";
import { analyticsRanges, type AnalyticsRange, type AnalyticsSnapshot } from "@/server/analytics/types";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";

export const metadata: Metadata = { title: "Аналитика" };

function parseRange(value: string | undefined): AnalyticsRange {
  const parsed = Number(value);
  return analyticsRanges.includes(parsed as AnalyticsRange) ? parsed as AnalyticsRange : 30;
}

const periodDateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const periodDateWithYearFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function parseDateOnly(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function formatAnalyticsPeriod(snapshot: AnalyticsSnapshot) {
  const startDate = parseDateOnly(snapshot.range.startDate);
  const endDate = parseDateOnly(snapshot.range.endDate);
  const spansYears = startDate.getUTCFullYear() !== endDate.getUTCFullYear();
  const start = (spansYears ? periodDateWithYearFormatter : periodDateFormatter).format(startDate);
  return `${start} — ${periodDateWithYearFormatter.format(endDate)}`;
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const member = await requireOfficeSession();
  if (!hasPermission(member, "analytics.read")) redirect("/");
  const params = await searchParams;
  const range = parseRange(params.range);
  const preview = getAuthMode() === "preview";
  const snapshot = preview ? getPreviewAnalytics(range) : await getAnalyticsSnapshot(member, range);
  const periodLabel = formatAnalyticsPeriod(snapshot);

  return <div className="figma-report-page analytics-page">
    <header className="analytics-page-header">
      <p className="figma-report-kicker">Управленческий контур</p>
      <h1 className="figma-report-title mt-[9px]">Обзор бизнеса</h1>
      <p className="figma-report-description mt-[6px] hidden md:block">Деньги, работа и клиенты — каждый показатель в своей визуальной форме.</p>
      <p className="analytics-mobile-period">{periodLabel} · {range === 365 ? "год" : `${range} дней`}</p>
      <a href={`/api/v1/analytics/export?range=${range}`} className="figma-report-control analytics-export focus-ring">Экспорт CSV</a>
    </header>

    <div className="analytics-controls">
      <div className="analytics-range-controls"><span>{periodLabel}</span>{analyticsRanges.map((days) => <Link key={days} href={`/analytics?range=${days}`} aria-current={range === days ? "true" : undefined} data-active={range === days} className="figma-report-control focus-ring">{days === 365 ? "Год" : days === 90 ? "90" : `${days} дней`}</Link>)}</div>
    </div>

    <AnalyticsOverview snapshot={snapshot} />
    <a href={`/api/v1/analytics/export?range=${range}`} className="figma-report-control analytics-export-mobile focus-ring">Экспорт CSV</a>
  </div>;
}
