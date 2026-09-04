import type { OrderDisplayStatus } from "@/server/orders/types";

const styles: Record<OrderDisplayStatus, string> = {
  Новый: "bg-white/[0.07] text-[#c8ced1] ring-white/10",
  "В работе": "bg-[#b8f7e4]/12 text-[#b8f7e4] ring-[#b8f7e4]/20",
  "На согласовании": "bg-[#efc85d]/10 text-[#efc85d] ring-[#efc85d]/20",
  Запланирован: "bg-[#b8f7e4]/10 text-[#b8f7e4] ring-[#b8f7e4]/20",
  Выполнен: "bg-[#b8f7e4]/10 text-[#74d9ac] ring-[#b8f7e4]/20",
  Просрочен: "bg-[#ef646a]/10 text-[#f27a80] ring-[#ef646a]/20",
  Отменён: "bg-[#ef646a]/10 text-[#f27a80] ring-[#ef646a]/20",
};

export function StatusBadge({ status }: { status: OrderDisplayStatus }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset ${styles[status]}`}>
      {status}
    </span>
  );
}
