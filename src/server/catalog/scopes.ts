import "server-only";
import { hasPermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { listAccessibleOrganizations } from "@/server/organizations/repository";
import { listCenterCompanyScopes } from "@/server/organizations/center-dashboard";

export async function listReadableCatalogScopes(member: AuthenticatedMember) {
  const isCenter = hasPermission(member, "companies.read") &&
    (await listAccessibleOrganizations(member)).some((organization) => organization.current && organization.kind === "center");
  return [member, ...(isCenter ? await listCenterCompanyScopes(member) : [])]
    .filter((scope) => hasPermission(scope, "orders.read"));
}
