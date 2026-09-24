import type { FinanceSnapshot } from "./types";

export function getPreviewFinanceSnapshot(): FinanceSnapshot {
  return {
    today: "2026-08-31",
    orders: [
      {
        id: "00000000-0000-4000-8000-000000000201", number: "№1248", client: "ООО «Домжилсервис»", object: "ЖК на Ленина", status: "in_progress",
        agreedMinor: 2500000, invoicedMinor: 2500000, paidMinor: 1500000, receivableMinor: 1000000,
        masterId: "00000000-0000-4000-8000-000000000202", masterName: "Алексей Смирнов", masterAccruedMinor: 400000, masterPaidMinor: 200000, masterDueMinor: 200000,
        invoices: [{
          id: "00000000-0000-4000-8000-000000000203", number: "СЧ-1248", amountMinor: 2500000, paidMinor: 1500000, outstandingMinor: 1000000,
          issuedOn: "2026-08-20", dueOn: "2026-08-28", status: "issued", overdue: true, note: "Оплата по договору", voidReason: null, version: 1,
          payments: [{ id: "00000000-0000-4000-8000-000000000204", amountMinor: 1500000, receivedOn: "2026-08-25", method: "bank_transfer", reference: "ПП-401", note: null, status: "posted", reversalReason: null, receiptDocumentId: null, version: 1 }],
        }],
      },
      {
        id: "00000000-0000-4000-8000-000000000205", number: "№1247", client: "ТСЖ «Пруды»", object: "Корпус Б", status: "scheduled",
        agreedMinor: 1850000, invoicedMinor: 1850000, paidMinor: 1850000, receivableMinor: 0,
        masterId: "00000000-0000-4000-8000-000000000206", masterName: "Дмитрий Кузнецов", masterAccruedMinor: 350000, masterPaidMinor: 350000, masterDueMinor: 0,
        invoices: [{ id: "00000000-0000-4000-8000-000000000207", number: "СЧ-1247", amountMinor: 1850000, paidMinor: 1850000, outstandingMinor: 0, issuedOn: "2026-08-18", dueOn: "2026-08-25", status: "issued", overdue: false, note: null, voidReason: null, version: 1, payments: [] }],
      },
    ],
    payouts: [
      { id: "00000000-0000-4000-8000-000000000208", orderId: "00000000-0000-4000-8000-000000000205", orderNumber: "№1247", masterId: "00000000-0000-4000-8000-000000000206", masterName: "Дмитрий Кузнецов", amountMinor: 350000, paidOn: "2026-08-26", method: "bank_transfer", reference: "ВЕД-88", note: null, status: "posted", reversalReason: null, receiptDocumentId: null, version: 1 },
      { id: "00000000-0000-4000-8000-000000000209", orderId: "00000000-0000-4000-8000-000000000201", orderNumber: "№1248", masterId: "00000000-0000-4000-8000-000000000202", masterName: "Алексей Смирнов", amountMinor: 200000, paidOn: "2026-08-25", method: "cash", reference: null, note: "Аванс", status: "posted", reversalReason: null, receiptDocumentId: null, version: 1 },
    ],
    summary: { agreedMinor: 4350000, invoicedMinor: 4350000, receivedMinor: 3350000, receivableMinor: 1000000, overdueMinor: 1000000, masterAccruedMinor: 750000, masterPaidMinor: 550000, masterDueMinor: 200000 },
  };
}
