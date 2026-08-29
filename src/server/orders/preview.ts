import "server-only";
import { clients, orders } from "@/lib/mock-data";
import { getPreviewOrderVisits } from "@/server/visits/preview";
import type { OrderCreationOptions, OrderDetail, OrderListItem, OrderRelations, OrderStatus } from "./types";

const statusCodes: Record<(typeof orders)[number]["status"], OrderStatus> = {
  Новый: "new",
  "На согласовании": "approval",
  Запланирован: "scheduled",
  "В работе": "in_progress",
  Выполнен: "completed",
  Просрочен: "overdue",
};

export function getPreviewOrders(): OrderListItem[] {
  return orders.map((order) => ({
    id: order.id,
    number: `№${order.number}`,
    client: order.client,
    object: order.object,
    address: order.address,
    serviceSummary: order.service,
    agreedTotalMinor: order.amount * 100,
    createdAt: order.createdAt,
    status: order.status,
    master: order.master,
  }));
}

export function getPreviewOrderCreationOptions(): OrderCreationOptions {
  const clientOptions = clients.map((client) => ({ id: client.id, name: client.name }));
  const objectOptions = orders.map((order) => ({
    id: `${order.id}-object`,
    clientId: clients.find((client) => client.name === order.client)?.id ?? clients[0].id,
    name: order.object,
    address: order.address,
  }));
  const contactOptions = orders.map((order) => ({
    id: `${order.id}-contact`,
    clientId: clients.find((client) => client.name === order.client)?.id ?? clients[0].id,
    name: order.contact,
    phone: order.contactPhone,
    isPrimary: true,
  }));
  const masterNames = new Map<string, string>();
  for (const order of orders) {
    if (order.master && order.masterPhone) masterNames.set(order.master, order.masterPhone);
  }
  return {
    clients: clientOptions,
    objects: objectOptions,
    contacts: contactOptions,
    masters: Array.from(masterNames, ([name, phone], index) => ({ id: `master-${index + 1}`, name, phone })),
  };
}

export function getPreviewOrderDetail(orderId: string): OrderDetail | null {
  const source = orders.find((order) => order.id === orderId);
  if (!source) return null;
  const clientId = clients.find((client) => client.name === source.client)?.id ?? clients[0].id;
  const directExpensesMinor = source.additionalExpenses * 100;
  const masterPaymentMinor = source.masterPayment === null ? null : source.masterPayment * 100;
  return {
    id: source.id,
    number: `№${source.number}`,
    client: source.client,
    object: source.object,
    address: source.address,
    serviceSummary: source.service,
    agreedTotalMinor: source.amount * 100,
    createdAt: source.createdAt,
    status: source.status,
    master: source.master,
    clientId,
    objectId: `${source.id}-object`,
    contactId: `${source.id}-contact`,
    contactName: source.contact,
    contactPhone: source.contactPhone,
    statusCode: statusCodes[source.status],
    statusReason: null,
    currency: "RUB",
    invoicedTotalMinor: source.amount * 100,
    paidTotalMinor: source.status === "Выполнен" ? source.amount * 100 : 0,
    assignedMasterId: source.master ? `master-${Math.max(1, orders.findIndex((order) => order.master === source.master) + 1)}` : null,
    masterPhone: source.masterPhone,
    masterPaymentMinor,
    directExpensesMinor,
    projectedOperatingContributionMinor: source.amount * 100 - (masterPaymentMinor ?? 0) - directExpensesMinor,
    realizedOperatingContributionMinor: (source.status === "Выполнен" ? source.amount * 100 : 0) - (masterPaymentMinor ?? 0) - directExpensesMinor,
    outstandingInvoiceMinor: source.status === "Выполнен" ? 0 : source.amount * 100,
    notes: null,
    version: 1,
    services: [{ id: `${source.id}-service`, name: source.service, quantity: "1.000", unitPriceMinor: source.amount * 100, lineTotalMinor: source.amount * 100, note: null }],
    expenses: source.additionalExpenses > 0 ? [{ id: `${source.id}-expense`, category: "Дополнительные расходы", amountMinor: directExpensesMinor, occurredOn: source.createdAt, note: null }] : [],
  };
}

export function getPreviewOrderRelations(orderId: string): OrderRelations {
  const source = orders.find((order) => order.id === orderId);
  if (!source) return { groupId: null, orders: [], candidates: [] };
  const visits = getPreviewOrderVisits(orderId);
  return {
    groupId: null,
    orders: [{
      id: source.id,
      number: `№${source.number}`,
      object: source.object,
      address: source.address,
      status: source.status,
      current: true,
      visits: visits.map((visit) => ({ id: visit.id, orderId: source.id, scheduledStartAt: visit.scheduledStartAt, timezone: visit.timezone, status: visit.status })),
    }],
    candidates: orders.filter((order) => order.id !== orderId && order.client === source.client).map((order) => ({
      id: order.id,
      number: `№${order.number}`,
      object: order.object,
      address: order.address,
      status: order.status,
      visitCount: getPreviewOrderVisits(order.id).length,
    })),
  };
}
