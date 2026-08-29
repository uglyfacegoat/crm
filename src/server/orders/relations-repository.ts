import "server-only";

import { z } from "zod";
import { AuthorizationError, requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
import { visitStatusLabels } from "@/server/visits/types";
import type { LinkOrderInput } from "./relation-schemas";
import { orderStatusLabels, type OrderLinkCandidate, type OrderRelations, type RelatedOrderSummary } from "./types";

const uuidSchema = z.string().uuid();
const orderStatusSchema = z.enum(["new", "approval", "scheduled", "in_progress", "completed", "overdue", "cancelled"]);
const visitStatusSchema = z.enum(["planned", "confirmed", "in_progress", "completed", "cancelled"]);
const relationOrderRowSchema = z.object({
  id: uuidSchema,
  order_number: z.string(),
  object_name_snapshot: z.string(),
  object_address_snapshot: z.string(),
  status: orderStatusSchema,
});
const relationVisitRowSchema = z.object({
  id: uuidSchema,
  order_id: uuidSchema,
  scheduled_start_at: z.coerce.date(),
  timezone: z.string(),
  status: visitStatusSchema,
});
const candidateRowSchema = relationOrderRowSchema.extend({ visit_count: z.number().int().nonnegative() });

export class OrderRelationNotFoundError extends Error {
  constructor() { super("One of the orders was not found."); this.name = "OrderRelationNotFoundError"; }
}

export class OrderRelationClientMismatchError extends Error {
  constructor() { super("Related orders must belong to the same client."); this.name = "OrderRelationClientMismatchError"; }
}

function requireRelationRead(member: AuthenticatedMember) {
  requirePermission(member, "orders.read");
  if (member.role === "master") throw new AuthorizationError();
}

export async function getOrderRelations(member: AuthenticatedMember, orderId: string): Promise<OrderRelations> {
  requireRelationRead(member);
  const sql = getDatabase();
  const [baseRows, groupRows, orderRows, visitRows, candidateRows] = await Promise.all([
    sql`SELECT id FROM orders WHERE organization_id = ${member.organizationId} AND id = ${orderId}`,
    sql`SELECT group_id FROM order_group_members WHERE organization_id = ${member.organizationId} AND order_id = ${orderId}`,
    sql`SELECT orders.id, orders.order_number, orders.object_name_snapshot, orders.object_address_snapshot, orders.status
      FROM orders
      WHERE orders.organization_id = ${member.organizationId} AND (
        orders.id = ${orderId} OR EXISTS (
          SELECT 1 FROM order_group_members requested
          JOIN order_group_members sibling
            ON sibling.organization_id = requested.organization_id AND sibling.group_id = requested.group_id
          WHERE requested.organization_id = ${member.organizationId}
            AND requested.order_id = ${orderId} AND sibling.order_id = orders.id
        )
      ) ORDER BY orders.created_at, orders.order_number`,
    sql`SELECT service_visits.id, service_visits.order_id, service_visits.scheduled_start_at,
        organizations.timezone, service_visits.status
      FROM service_visits
      JOIN organizations ON organizations.id = service_visits.organization_id
      WHERE service_visits.organization_id = ${member.organizationId} AND service_visits.order_id IS NOT NULL AND (
        service_visits.order_id = ${orderId} OR EXISTS (
          SELECT 1 FROM order_group_members requested
          JOIN order_group_members sibling
            ON sibling.organization_id = requested.organization_id AND sibling.group_id = requested.group_id
          WHERE requested.organization_id = ${member.organizationId}
            AND requested.order_id = ${orderId} AND sibling.order_id = service_visits.order_id
        )
      ) ORDER BY service_visits.scheduled_start_at`,
    sql`SELECT orders.id, orders.order_number, orders.object_name_snapshot, orders.object_address_snapshot,
        orders.status, count(service_visits.id)::integer AS visit_count
      FROM orders
      LEFT JOIN service_visits ON service_visits.organization_id = orders.organization_id AND service_visits.order_id = orders.id
      WHERE orders.organization_id = ${member.organizationId}
        AND orders.client_id = (SELECT client_id FROM orders WHERE organization_id = ${member.organizationId} AND id = ${orderId})
        AND orders.id <> ${orderId}
        AND NOT EXISTS (
          SELECT 1 FROM order_group_members requested
          JOIN order_group_members sibling
            ON sibling.organization_id = requested.organization_id AND sibling.group_id = requested.group_id
          WHERE requested.organization_id = ${member.organizationId}
            AND requested.order_id = ${orderId} AND sibling.order_id = orders.id
        )
      GROUP BY orders.id
      ORDER BY orders.created_at DESC, orders.order_number`,
  ]);
  if (!baseRows.length) throw new OrderRelationNotFoundError();

  const visitsByOrder = new Map<string, RelatedOrderSummary["visits"]>();
  for (const row of visitRows) {
    const visit = relationVisitRowSchema.parse(row);
    const visits = visitsByOrder.get(visit.order_id) ?? [];
    visits.push({
      id: visit.id,
      orderId: visit.order_id,
      scheduledStartAt: visit.scheduled_start_at.toISOString(),
      timezone: visit.timezone,
      status: visitStatusLabels[visit.status],
    });
    visitsByOrder.set(visit.order_id, visits);
  }
  const orders = orderRows.map((row): RelatedOrderSummary => {
    const order = relationOrderRowSchema.parse(row);
    return {
      id: order.id,
      number: order.order_number,
      object: order.object_name_snapshot,
      address: order.object_address_snapshot,
      status: orderStatusLabels[order.status],
      current: order.id === orderId,
      visits: visitsByOrder.get(order.id) ?? [],
    };
  });
  const candidates = candidateRows.map((row): OrderLinkCandidate => {
    const candidate = candidateRowSchema.parse(row);
    return {
      id: candidate.id,
      number: candidate.order_number,
      object: candidate.object_name_snapshot,
      address: candidate.object_address_snapshot,
      status: orderStatusLabels[candidate.status],
      visitCount: candidate.visit_count,
    };
  });
  return { groupId: groupRows.length ? uuidSchema.parse(groupRows[0].group_id) : null, orders, candidates };
}

export async function linkOrders(member: AuthenticatedMember, input: LinkOrderInput) {
  requirePermission(member, "orders.write");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const orders = await transaction`SELECT id, client_id FROM orders
      WHERE organization_id = ${member.organizationId} AND id IN (${input.orderId}, ${input.relatedOrderId})
      ORDER BY id FOR UPDATE`;
    if (orders.length !== 2) throw new OrderRelationNotFoundError();
    const clientIds = new Set(orders.map((order) => uuidSchema.parse(order.client_id)));
    if (clientIds.size !== 1) throw new OrderRelationClientMismatchError();
    const clientId = [...clientIds][0];
    const memberships = await transaction`SELECT order_id, group_id FROM order_group_members
      WHERE organization_id = ${member.organizationId} AND order_id IN (${input.orderId}, ${input.relatedOrderId})
      ORDER BY order_id FOR UPDATE`;
    const groupsByOrder = new Map(memberships.map((membership) => [uuidSchema.parse(membership.order_id), uuidSchema.parse(membership.group_id)]));
    const firstGroupId = groupsByOrder.get(input.orderId) ?? null;
    const secondGroupId = groupsByOrder.get(input.relatedOrderId) ?? null;
    let groupId: string;

    if (!firstGroupId && !secondGroupId) {
      const [group] = await transaction`INSERT INTO order_groups (organization_id, client_id, created_by)
        VALUES (${member.organizationId}, ${clientId}, ${member.memberId}) RETURNING id`;
      groupId = uuidSchema.parse(group.id);
      await transaction`INSERT INTO order_group_members (organization_id, group_id, client_id, order_id, created_by)
        VALUES (${member.organizationId}, ${groupId}, ${clientId}, ${input.orderId}, ${member.memberId}),
          (${member.organizationId}, ${groupId}, ${clientId}, ${input.relatedOrderId}, ${member.memberId})`;
    } else if (firstGroupId && secondGroupId && firstGroupId === secondGroupId) {
      return firstGroupId;
    } else if (firstGroupId && secondGroupId) {
      const [targetGroupId, sourceGroupId] = [firstGroupId, secondGroupId].sort();
      await transaction`SELECT id FROM order_groups WHERE organization_id = ${member.organizationId}
        AND id IN (${targetGroupId}, ${sourceGroupId}) ORDER BY id FOR UPDATE`;
      await transaction`UPDATE order_group_members SET group_id = ${targetGroupId}
        WHERE organization_id = ${member.organizationId} AND group_id = ${sourceGroupId}`;
      await transaction`DELETE FROM order_groups WHERE organization_id = ${member.organizationId} AND id = ${sourceGroupId}`;
      groupId = targetGroupId;
    } else {
      groupId = firstGroupId ?? secondGroupId!;
      const orderToAdd = firstGroupId ? input.relatedOrderId : input.orderId;
      await transaction`INSERT INTO order_group_members (organization_id, group_id, client_id, order_id, created_by)
        VALUES (${member.organizationId}, ${groupId}, ${clientId}, ${orderToAdd}, ${member.memberId})`;
    }

    await transaction`UPDATE order_groups SET updated_at = now()
      WHERE organization_id = ${member.organizationId} AND id = ${groupId}`;
    await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'order_group.link', 'order_group', ${groupId},
        ${transaction.json({ orderId: input.orderId, relatedOrderId: input.relatedOrderId })})`;
    return groupId;
  });
}
