import type { AuthenticatedMember, OrganizationRole } from "./types";

export const permissions = [
  "clients.read", "clients.write", "orders.read", "orders.write", "visits.read", "visits.write",
  "documents.read", "documents.write", "masters.read", "masters.write", "finance.read", "settings.write",
  "tasks.read", "tasks.write",
  "chat.read", "chat.write", "chat.manage",
] as const;
export type Permission = (typeof permissions)[number];

const grants: Record<OrganizationRole, ReadonlySet<Permission>> = {
  admin: new Set(permissions),
  dispatcher: new Set(["clients.read", "clients.write", "orders.read", "orders.write", "visits.read", "visits.write", "documents.read", "documents.write", "masters.read", "tasks.read", "tasks.write", "chat.read", "chat.write", "chat.manage"]),
  manager: new Set(["clients.read", "clients.write", "orders.read", "orders.write", "visits.read", "documents.read", "documents.write", "masters.read", "finance.read", "tasks.read", "tasks.write", "chat.read", "chat.write", "chat.manage"]),
  accountant: new Set(["clients.read", "orders.read", "documents.read", "documents.write", "finance.read", "tasks.read", "chat.read", "chat.write"]),
  master: new Set(["orders.read", "visits.read", "visits.write"]),
};

export class AuthorizationError extends Error {
  constructor() {
    super("The current member is not allowed to perform this operation.");
    this.name = "AuthorizationError";
  }
}

export function hasPermission(role: OrganizationRole, permission: Permission) {
  return grants[role].has(permission);
}

export function requirePermission(member: AuthenticatedMember, permission: Permission) {
  if (!hasPermission(member.role, permission)) throw new AuthorizationError();
}

export function requireSameOrganization(member: AuthenticatedMember, resourceOrganizationId: string) {
  if (member.organizationId !== resourceOrganizationId) throw new AuthorizationError();
}
