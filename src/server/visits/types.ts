export const visitStatuses = ["planned", "confirmed", "in_progress", "completed", "cancelled"] as const;
export type VisitStatus = (typeof visitStatuses)[number];
export type VisitDisplayStatus = "Запланирован" | "Подтверждён" | "В работе" | "Завершён" | "Отменён";

export const visitStatusLabels: Record<VisitStatus, VisitDisplayStatus> = {
  planned: "Запланирован",
  confirmed: "Подтверждён",
  in_progress: "В работе",
  completed: "Завершён",
  cancelled: "Отменён",
};

export type ServiceVisit = {
  id: string;
  seriesId: string | null;
  occurrenceNumber: number | null;
  orderId: string | null;
  orderNumber: string | null;
  client: string;
  object: string;
  address: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  timezone: string;
  statusCode: VisitStatus;
  status: VisitDisplayStatus;
  assignedMasterId: string | null;
  master: string | null;
  masterPhone: string | null;
  cancellationReason: string | null;
  notes: string | null;
  version: number;
};
