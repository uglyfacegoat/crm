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
  organizationId?: string;
  organizationName?: string;
  seriesId: string | null;
  occurrenceNumber: number | null;
  orderId: string | null;
  contractId?: string | null;
  orderNumber: string | null;
  client: string;
  object: string;
  address: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  arrivalMode: "fixed" | "window";
  timezone: string;
  statusCode: VisitStatus;
  status: VisitDisplayStatus;
  copyable: boolean;
  assignedMasterId: string | null;
  master: string | null;
  masterPhone: string | null;
  masterRegion: string | null;
  serviceSummary: string;
  serviceLines?: Array<{ name: string; quantity: string; unit: string; note: string | null }> | null;
  cancellationReason: string | null;
  notes: string | null;
  completionNotes: string | null;
  completionDocumentId: string | null;
  completionDocumentTitle: string | null;
  completedAt: string | null;
  version: number;
};
