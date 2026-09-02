import type { ContractSnapshot } from "./types";

const clientId = "00000000-0000-4000-8000-000000000101";
const objectId = "00000000-0000-4000-8000-000000000102";

export function getPreviewContracts(): ContractSnapshot {
  return {
    contracts: [{
      id: "00000000-0000-4000-8000-000000000103", contractNumber: "Д-2026/014", clientId,
      clientName: "ООО «Домжилсервис»", objectId, objectName: "ЖК на Ленина", objectAddress: "Москва, ул. Ленина, 15",
      status: "active", startsOn: "2026-01-01", endsOn: "2026-12-31", renewalNoticeDays: 30,
      notes: "Ежемесячная профилактическая обработка", version: 1, renewedFromContractId: null,
      renewedByContractId: null, daysUntilEnd: 122, nextVisitAt: "2026-09-10T07:00:00.000Z",
      schedule: { id: "00000000-0000-4000-8000-000000000104", frequencyUnit: "month", frequencyInterval: 1, localTime: "10:00", durationMinutes: 120, defaultMasterId: null, defaultMasterName: null, visitCount: 12 },
    }],
    objectOptions: [{ id: objectId, clientId, clientName: "ООО «Домжилсервис»", name: "ЖК на Ленина", address: "Москва, ул. Ленина, 15" }],
    masterOptions: [],
    summary: { total: 1, active: 1, expiring: 0, scheduledVisits: 12 },
  };
}
