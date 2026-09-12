import type { ServiceVisit } from "@/server/visits/types";
import { matchesSearchText } from "../search-normalization.ts";

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
  return matchesSearchText(query, [visit.orderNumber, visit.client, visit.object, visit.address, visit.master, visit.masterRegion, visit.serviceSummary]);
}

function hasService(visit: ServiceVisit, service: string) {
  return service === "all" || visit.serviceSummary.split(",").some((name) => name.trim() === service);
}

export function filterCalendarVisits(visits: ServiceVisit[], filters: CalendarVisitFilters) {
  return visits.filter((visit) => includesQuery(visit, filters.query)
    && (filters.master === "all" || (filters.master === "unassigned" ? !visit.master : visit.master === filters.master))
    && (filters.region === "all" || visit.masterRegion === filters.region)
    && (filters.client === "all" || visit.client === filters.client)
    && (filters.object === "all" || visit.object === filters.object)
    && (filters.status === "all" || visit.statusCode === filters.status)
    && hasService(visit, filters.service));
}
