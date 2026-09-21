"use client";

import { useId, useMemo, useState } from "react";

type ActivityPoint = { date: string; count: number };

const rows = 12;
const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

function roundCeiling(value: number) {
  if (value <= rows) return rows;
  const magnitude = 10 ** Math.max(0, String(Math.ceil(value)).length - 1);
  return Math.ceil(value / magnitude) * magnitude;
}

function activityTone(fill: number, selected: boolean) {
  if (fill <= 0) return "var(--surface)";
  if (selected) return "var(--chart-2)";
  if (fill < 0.4) return "color-mix(in srgb, var(--chart-1) 35%, var(--surface))";
  if (fill < 0.8) return "color-mix(in srgb, var(--chart-1) 68%, var(--surface))";
  return "var(--chart-1)";
}

export function ActivityChart({ points }: { points: ActivityPoint[] }) {
  const id = useId();
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const { total, average, ceiling, step } = useMemo(() => {
    const nextTotal = points.reduce((sum, point) => sum + point.count, 0);
    const nextCeiling = roundCeiling(Math.max(...points.map((point) => point.count), 0));
    return {
      total: nextTotal,
      average: points.length ? nextTotal / points.length : 0,
      ceiling: nextCeiling,
      step: nextCeiling / rows,
    };
  }, [points]);
  const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

  return (
    <section className="figma-report-panel dashboard-activity-card" aria-labelledby={`${id}-heading`}>
      <header>
        <p className="figma-report-kicker">Операционная активность</p>
        <h2 id={`${id}-heading`} className="figma-card-heading">Как движется работа</h2>
        <p className="figma-card-caption">Выезды в расписании, а не только завершённые</p>
      </header>
      <div className="dashboard-activity-summary">
        <strong>{total}</strong><span>выездов за 30 дней</span>
        <i />
        <strong>{number.format(average)}</strong><span>в среднем за день</span>
      </div>
      <div className="dashboard-activity-chart-wrap dashboard-activity-desktop">
        <div className="dashboard-activity-chart">
            <div aria-hidden="true" className="dashboard-activity-axis">
              <span>{ceiling}</span><span>{Math.round(ceiling * 0.67)}</span><span>{Math.round(ceiling * 0.33)}</span><span>0</span>
            </div>
            <div className="dashboard-activity-grid">
              {points.map((point) => {
                const selected = activeDate === point.date;
                const label = dateFormatter.format(new Date(`${point.date}T00:00:00Z`));
                return (
                  <button key={point.date} type="button" aria-pressed={selected} aria-label={`${label}: ${point.count} выездов`}
                    onPointerEnter={() => setActiveDate(point.date)} onPointerLeave={() => setActiveDate(null)} onFocus={() => setActiveDate(point.date)} onBlur={() => setActiveDate(null)}
                    className="focus-ring group relative grid shrink-0 grid-rows-[auto_1.25rem] gap-1 rounded-[4px] px-px">
                    <span aria-hidden="true" className="flex flex-col-reverse gap-[3px]">
                      {Array.from({ length: rows }, (_, index) => {
                        const fill = Math.min(1, Math.max(0, point.count / step - index));
                        return <span key={index} data-activity-cell className="block size-[13px] rounded-[2px] border border-[var(--line)] transition-colors" style={{ background: activityTone(fill, selected), opacity: fill > 0 ? 0.55 + fill * 0.45 : 1 }} />;
                      })}
                    </span>
                    <span className="text-[9px] tabular-nums text-[var(--muted)]">{Number(point.date.slice(-2))}</span>
                    {selected ? <span role="tooltip" className="pointer-events-none absolute bottom-[calc(100%+0.5rem)] left-1/2 z-20 w-max -translate-x-1/2 rounded-[9px] bg-[var(--text)] px-2.5 py-2 text-left text-[10px] leading-4 text-[var(--canvas)] shadow-lg"><strong className="block font-semibold">{point.count} выездов</strong><span className="opacity-70">{label}</span></span> : null}
                  </button>
                );
              })}
            </div>
          </div>
      </div>
      <div className="dashboard-activity-mobile" aria-label="Активность по дням">
        <div className="dashboard-activity-mobile-weekdays" aria-hidden="true">
          {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day) => <span key={day}>{day}</span>)}
        </div>
        <div className="dashboard-activity-mobile-grid">
          {points.map((point) => {
            const ratio = ceiling ? point.count / ceiling : 0;
            const label = dateFormatter.format(new Date(`${point.date}T00:00:00Z`));
            return <button key={point.date} type="button" aria-label={`${label}: ${point.count} выездов`} onClick={() => setActiveDate(point.date)} data-level={ratio >= 0.75 ? 4 : ratio >= 0.5 ? 3 : ratio >= 0.25 ? 2 : ratio > 0 ? 1 : 0} data-active={activeDate === point.date} className="focus-ring"><span>{Number(point.date.slice(-2))}</span><strong>{point.count}</strong></button>;
          })}
        </div>
      </div>
    </section>
  );
}
