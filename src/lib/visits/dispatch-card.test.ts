import assert from "node:assert/strict";
import test from "node:test";
import { formatVisitDispatchCardText, visitDispatchCardSchema, type VisitDispatchCard } from "./dispatch-card.ts";

const card: VisitDispatchCard = {
  visitId: "visit-1",
  orderId: "order-1",
  orderNumber: "№1248",
  client: "ООО «Домжилсервис»",
  object: "Жилой дом",
  address: "Москва, ул. Ленина, 15",
  contactName: "Ирина Иванова",
  contactPhone: "+7 916 000-00-00",
  scheduledStartAt: "2026-08-25T06:00:00.000Z",
  scheduledEndAt: "2026-08-25T08:00:00.000Z",
  timezone: "Europe/Moscow",
  status: "Запланирован",
  master: "Алексей Смирнов",
  masterPhone: "+7 495 000-00-00",
  masterPaymentMinor: 400_000,
  notes: "Позвонить за 30 минут.",
  services: [{ name: "Дезинсекция", quantity: "2.000", note: "Подвал и подъезд" }],
};

test("dispatch card formatter includes visit-specific operational data", () => {
  const text = formatVisitDispatchCardText(card);
  assert.match(text, /вт, 25 августа 2026 г\., 09:00–11:00/);
  assert.match(text, /1\. Дезинсекция — 2 \(Подвал и подъезд\)/);
  assert.match(text, /Выплата мастеру: 4\s000\s₽/);
  assert.match(text, /Позвонить за 30 минут/);
});

test("dispatch card omits finance field when API does not authorize it", () => {
  const text = formatVisitDispatchCardText({ ...card, masterPaymentMinor: undefined });
  assert.doesNotMatch(text, /Выплата мастеру/);
});

test("dispatch card response schema rejects invalid timestamps", () => {
  assert.equal(visitDispatchCardSchema.safeParse({ ...card, scheduledStartAt: "tomorrow" }).success, false);
});
