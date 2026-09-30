import "server-only";
import { z } from "zod";
import { hasPermission, requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
import { listOrders } from "@/server/orders/repository";
import type { OrderListItem } from "@/server/orders/types";
import { getTaskDashboardSummary, listTasks } from "@/server/tasks/repository";
import type { TaskCard, TaskDashboardSummary } from "@/server/tasks/types";
import { listVisits } from "@/server/visits/repository";
import type { ServiceVisit } from "@/server/visits/types";

const scopeRow = z.object({
  organization_id: z.string().uuid(),
  organization_name: z.string(),
  member_id: z.string().uuid(),
});

export type CenterDashboardData = {
  orders: Array<OrderListItem & { organizationId: string; organizationName: string }>;
  visits: Array<ServiceVisit & { organizationId: string; organizationName: string }>;
  tasks: Array<TaskCard & { organizationId: string; organizationName: string }>;
  timeZone: string;
};

export async function listCenterCompanyScopes(member: AuthenticatedMember): Promise<AuthenticatedMember[]> {
  requirePermission(member, "companies.read");
  const rows = await getDatabase()`
    SELECT companies.id AS organization_id, companies.name AS organization_name,
      target.id AS member_id
    FROM auth_sessions sessions
    JOIN organizations center ON center.id = sessions.organization_id AND center.organization_kind = 'center'
    JOIN organization_access_grants grants
      ON grants.principal_organization_id = sessions.organization_id
      AND grants.principal_member_id = sessions.member_id
    JOIN organizations companies ON companies.id = grants.target_organization_id
      AND companies.organization_kind = 'company'
    JOIN organization_members target ON target.organization_id = companies.id
      AND target.id = grants.target_member_id AND target.active AND target.deleted_at IS NULL
    WHERE sessions.id = ${member.sessionId}
      AND sessions.revoked_at IS NULL AND sessions.expires_at > now()
      AND COALESCE(sessions.active_organization_id, sessions.organization_id) = center.id
    ORDER BY companies.name, companies.id`;

  return rows.map((value) => {
    const row = scopeRow.parse(value);
    const target: AuthenticatedMember = {
      ...member,
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      memberId: row.member_id,
    };
    return target;
  });
}

export async function listCenterOrders(member: AuthenticatedMember) {
  const scopes = [member, ...(await listCenterCompanyScopes(member))];
  const results = await Promise.all(scopes.map(async (scope) => {
    if (!hasPermission(scope, "orders.read")) return [];
    const orders = await listOrders(scope);
    return orders.map((order) => ({ ...order, organizationId: scope.organizationId, organizationName: scope.organizationName }));
  }));
  return results.flat().toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function resolveCenterOrderScope(member: AuthenticatedMember, orderId: string): Promise<AuthenticatedMember | null> {
  requirePermission(member, "orders.read");
  const scopes = await listCenterCompanyScopes(member);
  if (!scopes.length) return null;
  const [row] = await getDatabase()`SELECT organization_id FROM orders WHERE id = ${orderId} LIMIT 1`;
  if (!row) return null;
  const organizationId = z.string().uuid().parse(row.organization_id);
  return scopes.find((scope) => scope.organizationId === organizationId) ?? null;
}

export async function resolveCenterDocumentScope(member: AuthenticatedMember, documentId: string): Promise<AuthenticatedMember | null> {
  requirePermission(member, "documents.read");
  if (!hasPermission(member, "companies.read")) return null;
  const scopes = await listCenterCompanyScopes(member);
  if (!scopes.length) return null;
  const [row] = await getDatabase()`SELECT organization_id FROM documents WHERE id = ${documentId} AND archived_at IS NULL LIMIT 1`;
  if (!row) return null;
  const organizationId = z.string().uuid().parse(row.organization_id);
  return scopes.find((scope) => scope.organizationId === organizationId) ?? null;
}

export async function getCenterDashboardData(
  member: AuthenticatedMember,
  rangeStart: string,
  rangeEnd: string,
): Promise<CenterDashboardData> {
  const scopes = [member, ...(await listCenterCompanyScopes(member))];
  const results = await Promise.all(scopes.map(async (scope) => {
    const [orders, visits, tasks] = await Promise.all([
      hasPermission(scope, "orders.read") ? listOrders(scope) : Promise.resolve([]),
      hasPermission(scope, "visits.read") ? listVisits(scope, rangeStart, rangeEnd) : Promise.resolve([]),
      hasPermission(scope, "tasks.read") ? listTasks(scope) : Promise.resolve(null),
    ]);
    return {
      orders: orders.map((order) => ({ ...order, organizationId: scope.organizationId, organizationName: scope.organizationName })),
      visits: visits.map((visit) => ({ ...visit, organizationId: scope.organizationId, organizationName: scope.organizationName })),
      tasks: (tasks?.tasks ?? []).map((task) => ({ ...task, organizationId: scope.organizationId, organizationName: scope.organizationName })),
      timeZone: tasks?.timeZone ?? visits[0]?.timezone ?? null,
    };
  }));
  return {
    orders: results.flatMap((result) => result.orders).toSorted((left, right) => right.createdAt.localeCompare(left.createdAt)),
    visits: results.flatMap((result) => result.visits).toSorted((left, right) => left.scheduledStartAt.localeCompare(right.scheduledStartAt)),
    tasks: results.flatMap((result) => result.tasks),
    timeZone: results.find((result) => result.timeZone)?.timeZone ?? "Europe/Moscow",
  };
}

export async function getCenterTaskDashboardSummary(member: AuthenticatedMember,
  timeZone: string, endDate: string): Promise<TaskDashboardSummary> {
  const scopes = [member, ...(await listCenterCompanyScopes(member))]
    .filter((scope) => hasPermission(scope, "tasks.read"));
  const summaries = await Promise.all(scopes.map((scope) => getTaskDashboardSummary(scope, timeZone, endDate)));
  return {
    overdueCount: summaries.reduce((total, summary) => total + summary.overdueCount, 0),
    dailyCounts: Array.from({ length: 7 }, (_, index) =>
      summaries.reduce((total, summary) => total + summary.dailyCounts[index], 0)),
  };
}
