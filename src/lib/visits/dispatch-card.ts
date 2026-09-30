import { z } from "zod";
import { formatMoneyMinor } from "../format.ts";

export const visitDispatchCardSchema = z.object({
  visitId: z.string().min(1),
  orderId: z.string().nullable(),
  orderNumber: z.string().nullable(),
  client: z.string(),
  clientKind: z.enum(["legal_entity", "individual"]).nullable(),
  object: z.string(),
  address: z.string(),
  areaSquareMeters: z.number().positive().nullable(),
  contactName: z.string().nullable(),
  contactPhone: z.string().nullable(),
  scheduledStartAt: z.iso.datetime(),
  scheduledEndAt: z.iso.datetime(),
  timezone: z.string(),
  status: z.string(),
  master: z.string().nullable(),
  masterPhone: z.string().nullable(),
  masterPaymentMinor: z.number().int().nonnegative().nullable().optional(),
  notes: z.string().nullable(),
  services: z.array(z.object({
    name: z.string(),
    quantity: z.string(),
    note: z.string().nullable(),
  })),
});

export type VisitDispatchCard = z.infer<typeof visitDispatchCardSchema>;

function formatQuantity(quantity: string) {
  const numeric = Number(quantity);
  return Number.isFinite(numeric) ? numeric.toLocaleString("ru-RU", { maximumFractionDigits: 3 }) : quantity;
}

export function formatDispatchArea(area: number | null) {
  return area === null ? "не указана" : `${area.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} м²`;
}

export function formatDispatchClientKind(kind: VisitDispatchCard["clientKind"]) {
  return kind === "legal_entity" ? "Юридическое лицо" : kind === "individual" ? "Физическое лицо" : "Не указан";
}

export function formatVisitDispatchWindow(card: Pick<VisitDispatchCard, "scheduledStartAt" | "scheduledEndAt" | "timezone">) {
  const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
    timeZone: card.timezone,
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const timeFormatter = new Intl.DateTimeFormat("ru-RU", {
    timeZone: card.timezone,
    hour: "2-digit",
    minute: "2-digit",
  });
  const start = new Date(card.scheduledStartAt);
  const end = new Date(card.scheduledEndAt);
  const startDate = dateFormatter.format(start);
  const endDate = dateFormatter.format(end);
  const window = startDate === endDate
    ? `${startDate}, ${timeFormatter.format(start)}–${timeFormatter.format(end)}`
    : `${startDate}, ${timeFormatter.format(start)} — ${endDate}, ${timeFormatter.format(end)}`;
  return `${window} (${card.timezone})`;
}

export function formatVisitDispatchCardText(card: VisitDispatchCard) {
  const lines = [
    `ЗАКАЗ ${card.orderNumber ?? "без номера"}`,
    `Тип заказа: ${formatDispatchClientKind(card.clientKind)}`,
    "",
    "ПОКУПАТЕЛЬ",
    `Заказчик: ${card.client}`,
    `Название объекта: ${card.object}`,
    `Имя: ${card.contactName || "не указано"}`,
    `Телефон: ${card.contactPhone || "не указан"}`,
    "",
    "СОСТАВ ЗАКАЗА",
    ...(card.services.length
      ? card.services.map((service, index) => `${index + 1}. ${service.name} — ${formatQuantity(service.quantity)}${service.note ? ` (${service.note})` : ""}`)
      : ["Состав не указан"]),
    `Площадь объекта: ${formatDispatchArea(card.areaSquareMeters)}`,
    "",
    "ДОСТАВКА",
    `Адрес доставки: ${card.address || "не указан"}`,
    `Имя мастера: ${card.master || "не назначен"}`,
    `Номер мастера: ${card.masterPhone || "не указан"}`,
  ];
  if (card.masterPaymentMinor !== undefined) {
    lines.push(`Зарплата: ${card.masterPaymentMinor === null ? "не указана" : formatMoneyMinor(card.masterPaymentMinor)}`);
  }
  lines.push("", "ДАТА ДОСТАВКИ", formatVisitDispatchWindow(card), "", `Примечание: ${card.notes || "нет"}`, "", "ОБЯЗАТЕЛЬНО: фотографии подписанных актов и журнала обработки.");
  return lines.join("\n");
}
