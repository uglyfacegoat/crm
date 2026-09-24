import type { ContractSnapshot } from "./types";

const clientId = "00000000-0000-4000-8000-000000000101";
const objectId = "00000000-0000-4000-8000-000000000102";

export function getPreviewContracts(): ContractSnapshot {
  const primaryId = "00000000-0000-4000-8000-000000000103";
  const relatedId = "00000000-0000-4000-8000-000000000105";
  return {
    contracts: [{
      id: primaryId, contractNumber: "Д-2026/014", clientId,
      clientName: "ООО «Домжилсервис»", objectId, objectName: "ЖК на Ленина", objectAddress: "Москва, ул. Ленина, 15",
      status: "active", startsOn: "2026-01-01", endsOn: "2026-12-31", renewalNoticeDays: 30,
      notes: "Ежемесячная профилактическая обработка", version: 1, renewedFromContractId: null,
      renewedByContractId: null, relations: [{ contractId: relatedId, contractNumber: "ДС-2026/014-1", relationType: "supplement", note: "Дополнительный объём сезонных работ" }], daysUntilEnd: 122, nextVisitAt: "2026-09-10T07:00:00.000Z",
      schedule: { id: "00000000-0000-4000-8000-000000000104", frequencyUnit: "month", frequencyInterval: 1, localTime: "10:00", durationMinutes: 120, defaultMasterId: null, defaultMasterName: null, visitCount: 12 },
    }, {
      id: relatedId, contractNumber: "ДС-2026/014-1", clientId,
      clientName: "ООО «Домжилсервис»", objectId, objectName: "ЖК на Ленина", objectAddress: "Москва, ул. Ленина, 15",
      status: "draft", startsOn: "2026-10-01", endsOn: "2026-12-31", renewalNoticeDays: 14,
      notes: "Дополнительный объём сезонных работ", version: 1, renewedFromContractId: null,
      renewedByContractId: null, relations: [{ contractId: primaryId, contractNumber: "Д-2026/014", relationType: "supplement", note: "Дополнительный объём сезонных работ" }], daysUntilEnd: 104, nextVisitAt: null,
      schedule: null,
    }],
    objectOptions: [{ id: objectId, clientId, clientName: "ООО «Домжилсервис»", name: "ЖК на Ленина", address: "Москва, ул. Ленина, 15" }],
    masterOptions: [],
    summary: { total: 2, active: 1, expiring: 0, scheduledVisits: 12 },
  };
}
