import Link from "next/link";
import { MapPin } from "lucide-react";
import { DashboardPanelLink } from "@/components/dashboard/dashboard-panel-link";
import type { DashboardVisit } from "@/components/dashboard/dashboard-calendar";

export function TodayVisits({
  visits,
  dateLabel,
  title = "Ближайшие выезды",
}: {
  visits: DashboardVisit[];
  dateLabel: string;
  title?: string;
}) {
  return (
    <section aria-labelledby="dashboard-route-heading" className="surface-panel dashboard-panel dashboard-route-panel animate-rise">
      <header className="dashboard-card-header">
        <div>
          <p className="dashboard-card-kicker">Оперативный маршрут</p>
          <h2 id="dashboard-route-heading">{title}</h2>
          <p>{dateLabel} · показаны ближайшие {visits.length}</p>
        </div>
      </header>

      <div className="dashboard-route-columns" aria-hidden="true">
        <span>Время</span><span>Клиент / объект</span><span>Мастер</span><span>Связь</span>
      </div>

      <ol className="dashboard-route-list">
        {visits.map((visit) => (
          <li key={visit.id}>
            <Link href={visit.orderId ? `/orders/${visit.orderId}` : `/calendar?date=${visit.date}`} className="focus-ring dashboard-route-row">
              <span className="dashboard-route-time"><i aria-hidden="true" />{visit.time}</span>
              <span className="dashboard-route-client"><strong>{visit.client}</strong><small><MapPin />{visit.address}</small></span>
              <span className="dashboard-route-master"><strong>{visit.master}</strong><small>Мастер</small></span>
              <span className="dashboard-route-order"><strong>{visit.orderNumber ?? "Без заказа"}</strong><small>{visit.orderId ? "Запланирован" : "—"}</small></span>
            </Link>
          </li>
        ))}
      </ol>

      {!visits.length ? <p className="dashboard-card-empty">Предстоящих выездов нет</p> : null}
      <DashboardPanelLink href="/calendar">Открыть день</DashboardPanelLink>
    </section>
  );
}
