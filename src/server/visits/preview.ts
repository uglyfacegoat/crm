import "server-only";
import { visits } from "@/lib/mock-data";
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
      assignedMasterId: `master-${index + 1}`,
      master: visit.master,
      masterPhone: null,
      cancellationReason: null,
      notes: null,
      version: 1,
    };
  });
}

export function getPreviewOrderVisits(orderId: string): ServiceVisit[] {
  return getPreviewVisits().filter((visit) => visit.orderId === orderId);
}
