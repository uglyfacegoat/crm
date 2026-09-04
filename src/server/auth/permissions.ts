import type { AuthenticatedMember, OrganizationRole } from "./types";

export const permissions = [
  "clients.read", "clients.write", "orders.read", "orders.write", "visits.read", "visits.write",
  "documents.read", "documents.write", "masters.read", "masters.write", "finance.read", "finance.write", "settings.write",
  "tasks.read", "tasks.write",
  "contracts.read", "contracts.write",
  "chat.read", "chat.write", "chat.manage",
  "document_templates.read", "document_templates.write",
  "sites.read", "sites.write",
  "leads.read", "leads.write",
] as const;
export type Permission = (typeof permissions)[number];

const grants: Record<OrganizationRole, ReadonlySet<Permission>> = {
  admin: new Set(permissions),
  dispatcher: new Set(["clients.read", "clients.write", "orders.read", "orders.write", "visits.read", "visits.write", "documents.read", "documents.write", "masters.read", "tasks.read", "tasks.write", "contracts.read", "contracts.write", "chat.read", "chat.write", "chat.manage", "document_templates.read", "sites.read", "leads.read", "leads.write"]),
  manager: new Set(["clients.read", "clients.write", "orders.read", "orders.write", "visits.read", "documents.read", "documents.write", "masters.read", "finance.read", "tasks.read", "tasks.write", "contracts.read", "contracts.write", "chat.read", "chat.write", "chat.manage", "document_templates.read", "sites.read", "leads.read", "leads.write"]),
  accountant: new Set(["clients.read", "orders.read", "documents.read", "documents.write", "finance.read", "finance.write", "tasks.read", "contracts.read", "chat.read", "chat.write", "sites.read", "leads.read"]),
  master: new Set(["visits.read", "visits.write", "document_templates.read"]),
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
