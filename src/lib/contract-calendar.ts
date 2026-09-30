import type { ContractListItem } from "@/server/contracts/types";

export function contractCalendarHref(contract: ContractListItem) {
  const date = contract.nextVisitAt
    ? new Intl.DateTimeFormat("en-CA", { timeZone: contract.organizationTimezone ?? "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(contract.nextVisitAt))
    : contract.startsOn;
  return `/calendar?${new URLSearchParams({ contract: contract.id, date, view: "list" })}`;
}
