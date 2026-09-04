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

export const permissionSections = [
  { label: "Клиенты", permissions: [["clients.read", "Просматривать"], ["clients.write", "Создавать и изменять"]] },
  { label: "Заказы", permissions: [["orders.read", "Просматривать"], ["orders.write", "Создавать и изменять"]] },
  { label: "Выезды", permissions: [["visits.read", "Просматривать"], ["visits.write", "Назначать и изменять"]] },
  { label: "Мастера", permissions: [["masters.read", "Просматривать"], ["masters.write", "Создавать и изменять"]] },
  { label: "Документы", permissions: [["documents.read", "Просматривать"], ["documents.write", "Загружать и изменять"], ["document_templates.read", "Скачивать шаблоны"], ["document_templates.write", "Управлять шаблонами"]] },
  { label: "Договоры", permissions: [["contracts.read", "Просматривать"], ["contracts.write", "Создавать и изменять"]] },
  { label: "Финансы", permissions: [["finance.read", "Просматривать"], ["finance.write", "Проводить операции"]] },
  { label: "Задачи", permissions: [["tasks.read", "Просматривать"], ["tasks.write", "Создавать и изменять"]] },
  { label: "Входящие", permissions: [["leads.read", "Просматривать"], ["leads.write", "Принимать и отклонять"]] },
  { label: "Чат", permissions: [["chat.read", "Читать"], ["chat.write", "Отправлять"], ["chat.manage", "Управлять группами"]] },
  { label: "Сайты", permissions: [["sites.read", "Просматривать"], ["sites.write", "Настраивать"]] },
  { label: "Система", permissions: [["settings.write", "Управлять настройками"]] },
] as const satisfies ReadonlyArray<{ label: string; permissions: ReadonlyArray<readonly [Permission, string]> }>;

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

export function hasPermission(subject: OrganizationRole | Pick<AuthenticatedMember, "role" | "permissionOverrides">, permission: Permission) {
  if (typeof subject === "string") return grants[subject].has(permission);
  return subject.permissionOverrides[permission] ?? grants[subject.role].has(permission);
}

export function requirePermission(member: AuthenticatedMember, permission: Permission) {
  if (!hasPermission(member, permission)) throw new AuthorizationError();
}

export function requireSameOrganization(member: AuthenticatedMember, resourceOrganizationId: string) {
  if (member.organizationId !== resourceOrganizationId) throw new AuthorizationError();
}
