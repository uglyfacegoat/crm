export const orderStatuses = ["new", "approval", "scheduled", "in_progress", "completed", "overdue", "cancelled"] as const;
export type OrderStatus = (typeof orderStatuses)[number];

export type OrderDisplayStatus = "Новый" | "На согласовании" | "Запланирован" | "В работе" | "Выполнен" | "Просрочен" | "Отменён";

export const orderStatusLabels: Record<OrderStatus, OrderDisplayStatus> = {
  new: "Новый",
  approval: "На согласовании",
  scheduled: "Запланирован",
  in_progress: "В работе",
  completed: "Выполнен",
  overdue: "Просрочен",
  cancelled: "Отменён",
};

export type OrderListItem = {
  id: string;
  number: string;
  client: string;
  object: string;
  address: string;
  serviceSummary: string;
  agreedTotalMinor: number;
  createdAt: string;
  status: OrderDisplayStatus;
  master: string | null;
};

export type OrderServiceLine = {
  id: string;
  name: string;
  quantity: string;
  unitPriceMinor: number;
  lineTotalMinor: number;
  note: string | null;
};

export type OrderExpense = {
  id: string;
  category: string;
  amountMinor: number;
  occurredOn: string;
  note: string | null;
};

export type OrderDetail = OrderListItem & {
  clientId: string;
  objectId: string;
  contactId: string | null;
  contactName: string;
  contactPhone: string;
  statusCode: OrderStatus;
  statusReason: string | null;
  currency: "RUB";
  invoicedTotalMinor: number;
  paidTotalMinor: number;
  assignedMasterId: string | null;
  masterPhone: string | null;
  masterPaymentMinor: number | null;
  masterPaidTotalMinor: number;
  directExpensesMinor: number;
  projectedOperatingContributionMinor: number;
  realizedOperatingContributionMinor: number;
  outstandingInvoiceMinor: number;
  notes: string | null;
  version: number;
  services: OrderServiceLine[];
  expenses: OrderExpense[];
};

export type OrderCreationOptions = {
  clients: Array<{ id: string; name: string }>;
  objects: Array<{ id: string; clientId: string; name: string; address: string }>;
  contacts: Array<{ id: string; clientId: string; name: string; phone: string; isPrimary: boolean }>;
  masters: Array<{ id: string; name: string; phone: string }>;
};

export type RelatedOrderVisit = {
  id: string;
  orderId: string;
  scheduledStartAt: string;
  timezone: string;
  status: "Запланирован" | "Подтверждён" | "В работе" | "Завершён" | "Отменён";
};

export type RelatedOrderSummary = {
  id: string;
  number: string;
  object: string;
  address: string;
  status: OrderDisplayStatus;
  current: boolean;
  visits: RelatedOrderVisit[];
};

export type OrderLinkCandidate = {
  id: string;
  number: string;
  object: string;
  address: string;
  status: OrderDisplayStatus;
  visitCount: number;
};

export type OrderRelations = {
  groupId: string | null;
  orders: RelatedOrderSummary[];
  candidates: OrderLinkCandidate[];
};
