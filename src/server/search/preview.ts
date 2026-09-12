import { globalSearchResultSchema, parseSearchDate, type GlobalSearchResult } from "@/lib/global-search";
import { clients, orders, visits } from "@/lib/mock-data";
import { matchesSearchText } from "@/lib/search-normalization";

export function searchPreview(query: string): GlobalSearchResult[] {
  const date = parseSearchDate(query);
  return [
    ...orders.filter((order) => matchesSearchText(query, [order.number, order.client, order.object, order.address, order.contactPhone, order.master ?? ""])).map((order) => ({
      id: order.id, entityType: "order" as const, title: `Заказ №${order.number}`, subtitle: order.client, detail: order.address, href: `/orders/${order.id}`, matchedBy: "Заказ, клиент или адрес",
    })),
    ...clients.filter((client) => matchesSearchText(query, [client.name, client.taxId ?? "", client.phone, client.email, client.contact])).map((client) => ({
      id: client.id, entityType: "client" as const, title: client.name, subtitle: client.phone, detail: client.email, href: "/clients", matchedBy: "Клиент или контакт",
    })),
    ...visits.filter((visit) => date === "2026-08-25" || matchesSearchText(query, [visit.client, visit.address, visit.master])).map((visit) => ({
      id: visit.id, entityType: "visit" as const, title: `Выезд · ${visit.client}`, subtitle: `25.08.2026 ${visit.time}`, detail: visit.address, href: "/calendar", matchedBy: date ? "Дата выезда" : "Выезд",
    })),
  ].slice(0, 18).map((result) => globalSearchResultSchema.parse(result));
}
