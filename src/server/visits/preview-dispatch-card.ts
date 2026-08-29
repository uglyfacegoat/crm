import "server-only";
import type { VisitDispatchCard } from "@/lib/visits/dispatch-card";
import { getPreviewOrderDetail } from "@/server/orders/preview";
import { getPreviewVisits } from "./preview";

export function getPreviewVisitDispatchCard(visitId: string, canViewFinance: boolean): VisitDispatchCard | null {
  const visit = getPreviewVisits().find((entry) => entry.id === visitId);
  if (!visit) return null;
  const order = visit.orderId ? getPreviewOrderDetail(visit.orderId) : null;
  return {
    visitId: visit.id,
    orderId: visit.orderId,
    orderNumber: visit.orderNumber,
    client: visit.client,
    object: visit.object,
    address: visit.address,
    contactName: order?.contactName ?? null,
    contactPhone: order?.contactPhone ?? null,
    scheduledStartAt: visit.scheduledStartAt,
    scheduledEndAt: visit.scheduledEndAt,
    timezone: visit.timezone,
    status: visit.status,
    master: visit.master,
    masterPhone: visit.masterPhone ?? order?.masterPhone ?? null,
    ...(canViewFinance ? { masterPaymentMinor: visit.assignedMasterId === order?.assignedMasterId ? order.masterPaymentMinor : null } : {}),
    notes: visit.notes,
    services: order?.services.map((service) => ({ name: service.name, quantity: service.quantity, note: service.note })) ?? [],
  };
}
