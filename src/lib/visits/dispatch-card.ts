import { z } from "zod";
import { formatMoneyMinor } from "../format.ts";

export const visitDispatchCardSchema = z.object({
  visitId: z.string().min(1),
  orderId: z.string().nullable(),
  orderNumber: z.string().nullable(),
  client: z.string(),
  object: z.string(),
  address: z.string(),
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
    "КАРТОЧКА ВЫЕЗДА",
    `Заказ: ${card.orderNumber ?? "без номера"}`,
    `Дата и время: ${formatVisitDispatchWindow(card)}`,
    `Статус: ${card.status}`,
    "",
    `Юр. лицо: ${card.client}`,
    `Объект: ${card.object}`,
    `Адрес: ${card.address}`,
    `Контакт: ${card.contactName ?? "не указан"}${card.contactPhone ? ` — ${card.contactPhone}` : ""}`,
    "",
    "РАБОТЫ",
    ...(card.services.length
      ? card.services.map((service, index) => `${index + 1}. ${service.name} — ${formatQuantity(service.quantity)}${service.note ? ` (${service.note})` : ""}`)
      : ["Не указаны"]),
    "",
    `Мастер: ${card.master ?? "не назначен"}`,
  ];
  if (card.masterPhone) lines.push(`Телефон мастера: ${card.masterPhone}`);
  if (card.masterPaymentMinor !== undefined) {
    lines.push(`Выплата мастеру: ${card.masterPaymentMinor === null ? "не указана" : formatMoneyMinor(card.masterPaymentMinor)}`);
  }
  if (card.notes) lines.push("", "КОММЕНТАРИЙ К ВЫЕЗДУ", card.notes);
  return lines.join("\n");
}
