import type { MasterVisitSummary } from "@/server/masters/types";

// Calendar reads the granted company scope without changing the current session.
export function masterVisitHref(visit: MasterVisitSummary) {
  if (visit.orderId) return `/orders/${visit.orderId}`;
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: visit.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(visit.scheduledStartAt));
  return `/calendar?${new URLSearchParams({ date, view: "list" })}`;
}
