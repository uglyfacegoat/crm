import type { ReactNode } from "react";
import { formatMoneyMinor } from "@/lib/format";
import type { AnalyticsMetric, AnalyticsSnapshot, ChartSeries } from "@/server/analytics/types";

const integerFormatter = new Intl.NumberFormat("ru-RU");
const moneyFormatter = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const statusColors = ["#25272c", "#9fa2aa", "#e7e7e2", "#9dbbff", "#5d626a", "#f6f5f0"];

function formatMetric(metric: AnalyticsMetric) {
  return metric.format === "money" ? formatMoneyMinor(metric.value) : integerFormatter.format(metric.value);
}

function ReportCard({ title, description, children, className = "" }: { title: string; description: string; children: ReactNode; className?: string }) {
  return <section className={`figma-report-panel p-[21px] ${className}`}>
    <header>
      <h2 className="figma-card-heading">{title}</h2>
      <p className="figma-card-caption mt-1">{description}</p>
    </header>
    {children}
  </section>;
}

export function AnalyticsMetricStrip({ metrics }: { metrics: AnalyticsMetric[] }) {
  const agreedValue = metrics.find((metric) => metric.id === "agreed")?.value ?? 0;

  return <section aria-label="Ключевые показатели" className="analytics-metric-strip" data-count={metrics.length}>
    {metrics.map((metric, index) => <article key={metric.id} className="analytics-open-metric">
      <p>{metric.id === "orders" ? "ЗАКАЗОВ" : metric.label.toUpperCase()}</p>
      <strong>{formatMetric(metric)}</strong>
      <span>{metric.id === "agreed" ? "Сумма заказов, не прибыль" : metric.id === "paid" ? `${Math.round(metric.value / Math.max(agreedValue, 1) * 100)}% от согласованного` : metric.change}</span>
      {index < metrics.length - 1 ? <i aria-hidden="true" /> : null}
    </article>)}
  </section>;
}

function aggregateSeries(labels: string[], series: ChartSeries[], groups: number) {
  const size = Math.max(1, Math.ceil(labels.length / groups));
  return Array.from({ length: groups }, (_, groupIndex) => {
    const start = groupIndex * size;
    const end = Math.min(labels.length, start + size);
    const values = series.map((entry) => entry.values.slice(start, end).reduce((sum, value) => sum + value, 0));
    const first = labels[start] ?? "";
    const last = labels[Math.max(start, end - 1)] ?? first;
    return { label: first === last ? first : `${first}–${last}`, values };
  }).filter((entry) => entry.values.length && entry.label);
}

function MoneyBars({ labels, series }: { labels: string[]; series: ChartSeries[] }) {
  const visibleSeries = series.slice(0, 2);
  const points = labels.map((label, index) => ({ label, values: visibleSeries.map((entry) => entry.values[index] ?? 0) }));
  const mobilePoints = aggregateSeries(labels, visibleSeries, 5);
  const maximum = Math.max(1, ...points.flatMap((point) => point.values), ...mobilePoints.flatMap((point) => point.values));
  const renderBars = (entries: typeof points, mobile: boolean) => <div className={mobile ? "analytics-bars analytics-bars-mobile" : "analytics-bars analytics-bars-desktop"}>
    {entries.map((entry, entryIndex) => {
      const tooltip = `${entry.label}: ${entry.values.map((value, index) => `${visibleSeries[index]?.label ?? ""} ${moneyFormatter.format(value)}`).join(", ")}`;
      const showLabel = mobile || entryIndex === 0 || entryIndex === Math.floor(entries.length / 2) || entryIndex === entries.length - 1;
      return <div key={entry.label} className="analytics-bar-group analytics-tooltip-target" data-edge={entryIndex === 0 ? "start" : entryIndex === entries.length - 1 ? "end" : undefined} data-tooltip={tooltip} tabIndex={0} aria-label={tooltip}>
      <div className="analytics-bar-pair">{entry.values.map((value, index) => <span key={index} style={{ height: `${Math.max(value ? 4 : 0, value / maximum * 100)}%`, background: index ? "#9dbbff" : "#25272c" }} />)}</div>
      <small>{showLabel ? entry.label : ""}</small>
    </div>;
    })}
  </div>;
  return <div className="analytics-money-plot">
    <div className="analytics-axis"><span>{formatAxisValue(maximum)}</span><span>{formatAxisValue(maximum / 2)}</span><span>0</span></div>
    {renderBars(points, false)}
    {renderBars(mobilePoints, true)}
  </div>;
}

function formatAxisValue(value: number) {
  if (value >= 1_000_000) return `${moneyFormatter.format(value / 1_000_000)} млн`;
  if (value >= 1_000) return `${moneyFormatter.format(value / 1_000)} тыс.`;
  return moneyFormatter.format(value);
}

export function MoneyChart({ snapshot }: { snapshot: AnalyticsSnapshot }) {
  const series = snapshot.financialTrend.series.filter((entry) => entry.label !== "Плановый опер. остаток");
  return <ReportCard title="Деньги по дням" description="Согласовано и получено · тыс. ₽" className="analytics-money-card">
    <div className="analytics-legend"><span><i className="bg-[#25272c]" />Согласовано</span><span><i className="bg-[#9dbbff]" />Получено</span></div>
    <MoneyBars labels={snapshot.financialTrend.labels} series={series} />
  </ReportCard>;
}

export function ServiceTreemap({ entries }: { entries: AnalyticsSnapshot["serviceMix"] }) {
  const total = entries.reduce((sum, entry) => sum + entry.amountMinor, 0);
  const normalized = entries.slice(0, 4);
  return <ReportCard title="Из чего складывается сумма" description="Доля согласованной стоимости по услугам" className="analytics-service-card">
    {normalized.length ? <div className="analytics-treemap" data-count={normalized.length} role="group" aria-label={`Распределение ${formatMoneyMinor(total)} по услугам`}>
      {normalized.map((entry, index) => <article key={`${entry.label}-${index}`} className={`analytics-tree-cell analytics-tree-cell-${index} analytics-tooltip-target`} data-tooltip={`${entry.label}: ${entry.percent}%`} tabIndex={0} aria-label={`${entry.label}: ${entry.percent}%`}>
        <span>{entry.label}{index ? ` · ${entry.percent}%` : null}</span>
        {index < 2 ? <strong>{index === 0 ? `${entry.percent}%` : formatMoneyMinor(entry.amountMinor)}</strong> : null}
      </article>)}
    </div> : <p className="mt-6 text-sm text-[#70737b]">За выбранный период нет согласованных услуг.</p>}
    <p className="mt-3 text-[10px] leading-[14px] text-[#70737b]">Площадь = сумма · всего {formatMoneyMinor(total)}</p>
  </ReportCard>;
}

function heatTone(value: number, maximum: number) {
  const ratio = value / maximum;
  if (ratio >= 0.85) return "#25272c";
  if (ratio >= 0.65) return "#9fa2aa";
  if (ratio >= 0.4) return "#d5d6d4";
  return "#f6f5f0";
}

export function VisitHeatmap({ entries }: { entries: AnalyticsSnapshot["visitActivity"] }) {
  const maximum = Math.max(1, ...entries.map((entry) => entry.value));
  const cells = [null, null, ...entries.slice(0, 30)];
  const rangeLabel = entries.length ? `${entries[0].label} — ${entries[entries.length - 1].label}` : "нет данных";
  return <ReportCard title="Когда было больше выездов" description={`${entries.reduce((sum, entry) => sum + entry.value, 0)} выездов · ${rangeLabel}`} className="analytics-heat-card">
    <div className="analytics-weekdays">{["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => <span key={day}>{day}</span>)}</div>
    <div className="analytics-heat-grid">{cells.map((entry, index) => {
      const tooltip = entry ? `${entry.label}: ${entry.value} выездов` : "Вне выбранного периода";
      return <span key={entry?.key ?? `empty-${index}`} className="analytics-tooltip-target" data-dark={entry ? entry.value / maximum >= 0.85 : undefined} data-tooltip={tooltip} tabIndex={0} aria-label={tooltip} style={{ background: entry ? heatTone(entry.value, maximum) : "#f6f5f0" }}>{entry?.value ?? ""}</span>;
    })}</div>
    <div className="analytics-heat-legend"><span>Меньше</span>{["#f6f5f0", "#d5d6d4", "#9fa2aa", "#25272c"].map((color) => <i key={color} style={{ background: color }} />)}<span>Больше</span></div>
  </ReportCard>;
}

export function TeamComparison({ members }: { members: AnalyticsSnapshot["teamPerformance"] }) {
  const normalized = members.slice(0, 4);
  const maximum = Math.max(1, ...normalized.map((member) => member.visits));
  const completedTotal = normalized.reduce((sum, member) => sum + Math.round(member.visits * member.completion / 100), 0);
  const visitTotal = normalized.reduce((sum, member) => sum + member.visits, 0);
  return <ReportCard title="Выезды по мастерам" description="Завершено / всего выездов" className="analytics-team-card">
    <div className="analytics-legend"><span><i className="bg-[#25272c]" />Всего</span><span><i className="bg-[#9dbbff]" />Завершено</span></div>
    <div className="analytics-team-list">{normalized.map((member) => {
      const completed = Math.round(member.visits * member.completion / 100);
      return <article key={member.id}>
        <div><span>{member.name}</span><strong>{completed} / {member.visits}</strong></div>
        <i><span style={{ width: `${member.visits / maximum * 100}%` }} /></i>
        <i><span style={{ width: `${completed / maximum * 100}%` }} /></i>
      </article>;
    })}</div>
    <p className="analytics-card-foot">{completedTotal} завершено из {visitTotal} · {visitTotal ? Math.round(completedTotal / visitTotal * 100) : 0}%</p>
  </ReportCard>;
}

export function RepeatClients({ rate, counts }: { rate: number; counts: AnalyticsSnapshot["repeatClientCounts"] }) {
  return <ReportCard title="Клиенты возвращаются" description="Доля клиентов с несколькими заказами" className="analytics-repeat-card">
    <strong className="analytics-big-percent">{rate}%</strong>
    <div className="analytics-waffle" role="img" aria-label={`${rate}% клиентов обращались повторно`}>{Array.from({ length: 100 }, (_, index) => <span key={index} className={index < rate ? "is-filled" : ""} />)}</div>
    <div className="analytics-repeat-legend"><span><i className="bg-[#25272c]" />{counts.repeat} повторных</span><span><i />{counts.firstTime} впервые</span></div>
    <p className="analytics-card-foot">1 квадрат = 1 процентный пункт</p>
  </ReportCard>;
}

export function OrderStatusStrip({ entries }: { entries: AnalyticsSnapshot["orderStatusBreakdown"] }) {
  const total = entries.reduce((sum, entry) => sum + entry.value, 0);
  const units = entries.flatMap((entry, index) => Array.from({ length: entry.value }, (_, unit) => ({ key: `${entry.id}-${unit}`, color: statusColors[index], label: entry.label })));
  return <ReportCard title="Заказы по состояниям" description={`${total} заказов`} className="analytics-status-card">
    <div className="analytics-status-units" role="img" aria-label={entries.map((entry) => `${entry.label}: ${entry.value}`).join(", ")}>{units.slice(0, 40).map((unit) => <span key={unit.key} aria-hidden="true" style={{ background: unit.color }} />)}</div>
    <div className="analytics-status-legend">{entries.map((entry, index) => <span key={entry.id}><i style={{ background: statusColors[index] }} />{entry.label} {entry.value}</span>)}</div>
  </ReportCard>;
}

export function AnalyticsOverview({ snapshot }: { snapshot: AnalyticsSnapshot }) {
  const metricIds: AnalyticsMetric["id"][] = ["agreed", "paid", "orders", "visits"];
  const metrics = metricIds.map((id) => snapshot.metrics.find((metric) => metric.id === id)).filter((metric): metric is AnalyticsMetric => Boolean(metric));
  return <div className="analytics-figma-layout">
    <AnalyticsMetricStrip metrics={metrics} />
    <div className="analytics-top-row"><MoneyChart snapshot={snapshot} /><ServiceTreemap entries={snapshot.serviceMix} /></div>
    <div className="analytics-bottom-row"><VisitHeatmap entries={snapshot.visitActivity} /><TeamComparison members={snapshot.teamPerformance} /><RepeatClients rate={snapshot.repeatClientRate} counts={snapshot.repeatClientCounts} /></div>
    <OrderStatusStrip entries={snapshot.orderStatusBreakdown} />
  </div>;
}
