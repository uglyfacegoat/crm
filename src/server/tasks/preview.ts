import type { TaskSnapshot } from "./types";

export function getPreviewTasks(): TaskSnapshot {
  return {
    currentMemberId: "00000000-0000-0000-0000-000000000000",
    completedLast30Days: 132,
    timeZone: "Europe/Moscow",
    assigneeOptions: [{ id: "00000000-0000-0000-0000-000000000000", displayName: "Иван Петров", role: "admin" }],
    orderOptions: [
      { id: "10000000-0000-0000-0000-000000000001", orderNumber: "№1248", clientName: "ООО «Домжилсервис»" },
      { id: "10000000-0000-0000-0000-000000000002", orderNumber: "№1246", clientName: "ООО «Вектор»" },
    ],
    tasks: [
      { id: "t1", title: "Согласовать договор №1247", description: null, meta: "ТСЖ «Пруды»", due: "Просрочено на 2 дня", dueAt: "2026-08-27T09:00:00.000Z", assignee: "ИП", assignedMemberId: "00000000-0000-0000-0000-000000000000", assigneeName: "Иван Петров", column: "overdue", priority: "critical", source: "manual", relatedOrderId: null, version: 1 },
      { id: "t2", title: "Подготовить выезд №1248", description: "Проверить состав работ и контакт на объекте.", meta: "№1248 · ООО «Домжилсервис»", due: "Сегодня, 11:00", dueAt: "2026-08-29T08:00:00.000Z", assignee: "ИП", assignedMemberId: "00000000-0000-0000-0000-000000000000", assigneeName: "Иван Петров", column: "today", priority: "high", source: "visit_reminder", relatedOrderId: null, version: 1 },
      { id: "t3", title: "Проверить оплату", description: null, meta: "№1246 · ООО «Вектор»", due: "Завтра, 09:00", dueAt: "2026-08-30T06:00:00.000Z", assignee: "ИП", assignedMemberId: "00000000-0000-0000-0000-000000000000", assigneeName: "Иван Петров", column: "upcoming", priority: "normal", source: "manual", relatedOrderId: null, version: 1 },
      { id: "t4", title: "Обновить прайс-лист", description: null, meta: "Внутренняя задача", due: "Без срока", dueAt: null, assignee: "ИП", assignedMemberId: "00000000-0000-0000-0000-000000000000", assigneeName: "Иван Петров", column: "unscheduled", priority: "low", source: "manual", relatedOrderId: null, version: 1 },
    ],
    completedTasks: [
      { id: "tc1", title: "Отправить акт клиенту", description: null, meta: "№1246 · ООО «Вектор»", due: "25.08.2026, 15:00", dueAt: "2026-08-25T12:00:00.000Z", completedAt: "2026-08-25T13:20:00.000Z", assignee: "ИП", assignedMemberId: "00000000-0000-0000-0000-000000000000", assigneeName: "Иван Петров", column: "upcoming", priority: "normal", source: "manual", relatedOrderId: null, version: 2 },
    ],
  };
}
