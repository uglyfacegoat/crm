import type { OrderDisplayStatus } from "@/server/orders/types";

const styles: Record<OrderDisplayStatus, string> = {
  Новый: "bg-[var(--surface-soft)] text-[var(--text-secondary)] ring-[var(--line-strong)]",
  "В работе": "bg-[var(--info-bg)] text-[var(--info)] ring-[var(--info-border)]/55",
  "На согласовании": "bg-[var(--warning-bg)] text-[var(--warning)] ring-[var(--warning-border)]/55",
  Запланирован: "bg-[var(--support-soft)] text-[var(--support-strong)] ring-[var(--support-strong)]/45",
  Выполнен: "bg-[var(--success-bg)] text-[var(--success)] ring-[var(--success-border)]/55",
  Просрочен: "bg-[var(--danger-bg)] text-[var(--danger-ink)] ring-[var(--danger-border)]/55",
  Отменён: "bg-[var(--danger-bg)] text-[var(--danger-ink)] ring-[var(--danger-border)]/55",
};

export function StatusBadge({ status }: { status: OrderDisplayStatus }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset ${styles[status]}`}>
      {status}
    </span>
  );
}
