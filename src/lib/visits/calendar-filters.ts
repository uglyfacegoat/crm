import type { ServiceVisit } from "@/server/visits/types";

export type CalendarVisitFilters = {
  query: string;
  master: string;
  region: string;
  client: string;
  object: string;
  status: string;
  service: string;
};

function includesQuery(visit: ServiceVisit, query: string) {
  if (!query) return true;

  return [visit.orderNumber, visit.client, visit.object, visit.address, visit.master, visit.masterRegion, visit.serviceSummary]
    .some((value) => value?.toLocaleLowerCase("ru").includes(query));
}

function hasService(visit: ServiceVisit, service: string) {
  return service === "all" || visit.serviceSummary.split(",").some((name) => name.trim() === service);
}

export function filterCalendarVisits(visits: ServiceVisit[], filters: CalendarVisitFilters) {
  const query = filters.query.trim().toLocaleLowerCase("ru");

  return visits.filter((visit) => includesQuery(visit, query)
    && (filters.master === "all" || (filters.master === "unassigned" ? !visit.master : visit.master === filters.master))
    && (filters.region === "all" || visit.masterRegion === filters.region)
    && (filters.client === "all" || visit.client === filters.client)
    && (filters.object === "all" || visit.object === filters.object)
    && (filters.status === "all" || visit.statusCode === filters.status)
    && hasService(visit, filters.service));
}
