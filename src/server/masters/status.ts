import type { MasterStatusCode } from "./types";

export function getMasterStatus(active: boolean, visitCount: number, dailyCapacity: number): { code: MasterStatusCode; label: string } {
  if (!active) return { code: "inactive", label: "Неактивен" };
  if (visitCount > dailyCapacity) return { code: "overloaded", label: "Перегружен" };
  if (visitCount > 0) return { code: "scheduled", label: "С выездами" };
  return { code: "available", label: "Свободен" };
}
