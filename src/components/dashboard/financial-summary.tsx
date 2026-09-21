import { DashboardPanelLink } from "@/components/dashboard/dashboard-panel-link";
import { formatMoneyMinor } from "@/lib/format";
import type { OrderListItem } from "@/server/orders/types";

export function FinancialSummary({ orders }: { orders: OrderListItem[] }) {
  const validOrders = orders.filter((order) => order.status !== "Отменён");
  const total = validOrders.reduce((sum, order) => sum + order.agreedTotalMinor, 0);
  const completed = validOrders.filter((order) => order.status === "Выполнен");
  const completedTotal = completed.reduce((sum, order) => sum + order.agreedTotalMinor, 0);
  const average = validOrders.length ? Math.round(total / validOrders.length) : 0;
  const completedShare = validOrders.length ? Math.round(completed.length / validOrders.length * 100) : 0;

  return (
    <section aria-labelledby="dashboard-finance-heading" className="surface-panel dashboard-panel dashboard-finance-panel animate-rise">
      <header className="dashboard-card-header">
        <div>
          <p className="dashboard-card-kicker">Деньги</p>
          <h2 id="dashboard-finance-heading">Финансовый пульс</h2>
          <p>Текущий месяц · {validOrders.length} новых заказов</p>
        </div>
        <span>Текущий месяц</span>
      </header>

      <div className="dashboard-finance-body">
        <p>Согласовано</p>
        <strong className="dashboard-finance-total">{formatMoneyMinor(total)}</strong>
        <div className="dashboard-finance-progress"><i style={{ width: `${Math.min(100, total / 750_000)}%` }} /></div>
        <div className="dashboard-finance-scale"><span>0 ₽</span><span>750 тыс. ₽</span></div>
        <div className="dashboard-finance-metrics">
          <article><span>Выполнено</span><strong>{formatMoneyMinor(completedTotal)}</strong><small>{completed.length} завершено</small></article>
          <article><span>Средний чек</span><strong>{formatMoneyMinor(average)}</strong><small>По заказам месяца</small></article>
        </div>
        <div className="dashboard-finance-share"><span>Доля завершённых</span><strong>{completedShare}%</strong></div>
        <div className="dashboard-finance-units" aria-hidden="true">{Array.from({ length: 10 }, (_, index) => <i key={index} data-filled={index < Math.ceil(completedShare / 10)} />)}</div>
        <small>Один сегмент = один заказ</small>
      </div>
      <DashboardPanelLink href="/analytics">Открыть аналитику</DashboardPanelLink>
    </section>
  );
}
