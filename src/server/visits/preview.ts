import "server-only";
import { visits } from "@/lib/mock-data";
import type { VisitHistoryFeed } from "./history";
import type { ServiceVisit } from "./types";

export function getPreviewVisits(): ServiceVisit[] {
  return visits.map((visit, index) => {
    const scheduledStartAt = new Date(`2026-08-${String(25 + index).padStart(2, "0")}T${visit.time}:00+03:00`);
    return {
      id: visit.id,
      seriesId: index < 2 ? "preview-series" : null,
      occurrenceNumber: index < 2 ? index + 1 : null,
      orderId: visit.orderId,
      orderNumber: visit.orderId.replace("ord-", "№"),
      client: visit.client,
      object: "Объект заказа",
      address: visit.address,
      scheduledStartAt: scheduledStartAt.toISOString(),
      scheduledEndAt: new Date(scheduledStartAt.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      timezone: "Europe/Moscow",
      statusCode: visit.status === "Подтверждён" ? "confirmed" : visit.status === "В работе" ? "in_progress" : "planned",
      status: visit.status,
      copyable: visit.status !== "В работе",
      assignedMasterId: `master-${index + 1}`,
      master: visit.master,
      masterPhone: null,
      masterRegion: "Москва",
      serviceSummary: index % 2 === 0 ? "Дезинсекция" : "Дератизация",
      cancellationReason: null,
      notes: null,
      completionNotes: null,
      completionDocumentId: null,
      completionDocumentTitle: null,
      completedAt: null,
      version: 1,
    };
  });
}

export function getPreviewOrderVisits(orderId: string): ServiceVisit[] {
  return getPreviewVisits().filter((visit) => visit.orderId === orderId);
}

export function getPreviewOrderVisitHistory(orderId: string): VisitHistoryFeed {
  const orderVisits = getPreviewOrderVisits(orderId);
  const events = orderVisits.map((visit, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    visitId: visit.id,
    eventType: "created" as const,
    actorName: "Иван Петров",
    reason: null,
    occurredAt: new Date(new Date(visit.scheduledStartAt).getTime() - 86_400_000).toISOString(),
    beforeState: null,
    afterState: {
      scheduledStartAt: visit.scheduledStartAt,
      scheduledEndAt: visit.scheduledEndAt,
      status: visit.statusCode,
      assignedMasterId: visit.assignedMasterId,
      cancellationReason: null,
      notes: visit.notes,
    },
  }));
  return { events, totalCount: events.length, hasMore: false };
}
