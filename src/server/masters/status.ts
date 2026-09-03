import type { MasterOperationalStatus, MasterStatusCode } from "./types";

export function getMasterStatus(operationalStatus: MasterOperationalStatus, visitCount: number, dailyCapacity: number): { code: MasterStatusCode; label: string } {
  if (operationalStatus === "terminated") return { code: "terminated", label: "Уволен" };
  if (operationalStatus === "vacation") return { code: "vacation", label: "В отпуске" };
  if (operationalStatus === "unavailable") return { code: "unavailable", label: "Не работает" };
  if (visitCount > dailyCapacity) return { code: "overloaded", label: "Перегружен" };
  if (visitCount > 0) return { code: "scheduled", label: "С выездами" };
  return { code: "available", label: "Свободен" };
}
