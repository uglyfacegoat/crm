import type { AuthenticatedMember, OrganizationRole } from "./types";

export const configurablePermissions = [
  "clients.read", "clients.write", "orders.read", "orders.write", "visits.read", "visits.write",
  "documents.read", "documents.write", "masters.read", "masters.write", "finance.read", "finance.write", "settings.write",
  "tasks.read", "tasks.write",
  "contracts.read", "contracts.write",
  "chat.read", "chat.write", "chat.manage",
  "document_templates.read", "document_templates.write",
  "sites.read", "sites.write",
  "leads.read", "leads.write",
  "analytics.read",
  "notifications.read",
  "help.read", "support.write",
  "companies.read", "companies.write",
  "search.use", "assistant.use",
] as const;
export const permissions = [
  ...configurablePermissions,
  "support.manage",
  "developer.preview",
] as const;
export type Permission = (typeof permissions)[number];

export const permissionSections = [
  { label: "Поиск", description: "Глобальная строка в верхней панели", permissions: [["search.use", "Искать по всей CRM"]] },
  { label: "Помощник", description: "Отдельное рабочее окно", permissions: [["assistant.use", "Открывать помощника"]] },
  { label: "Компании", description: "Контуры, города и рабочие зоны", permissions: [["companies.read", "Просматривать и переключать"], ["companies.write", "Создавать компании и подразделения"]] },
  { label: "Клиенты", description: "Карточки, контакты и объекты", permissions: [["clients.read", "Просматривать"], ["clients.write", "Создавать и изменять"]] },
  { label: "Заказы", description: "Список, карточка и оформление", permissions: [["orders.read", "Просматривать"], ["orders.write", "Создавать, копировать и изменять"]] },
  { label: "Выезды", description: "Календарь, маршрут и статусы", permissions: [["visits.read", "Просматривать"], ["visits.write", "Назначать, переносить и завершать"]] },
  { label: "Мастера", description: "Реестр, график и доступность", permissions: [["masters.read", "Просматривать"], ["masters.write", "Создавать и изменять"]] },
  { label: "Документы", description: "Файлы, версии, архив и выгрузки", permissions: [["documents.read", "Просматривать и скачивать"], ["documents.write", "Загружать, архивировать и перемещать"], ["document_templates.read", "Скачивать шаблоны"], ["document_templates.write", "Управлять шаблонами"]] },
  { label: "Договоры", description: "Карточки, состояния и просмотр файлов", permissions: [["contracts.read", "Просматривать"], ["contracts.write", "Создавать и изменять"]] },
  { label: "Финансы", description: "Счета, оплаты, расходы и выплаты", permissions: [["finance.read", "Просматривать"], ["finance.write", "Проводить и сторнировать операции"]] },
  { label: "Аналитика", description: "Управленческие отчёты и CSV", permissions: [["analytics.read", "Просматривать и экспортировать"]] },
  { label: "Задачи", description: "Очереди, сроки и исполнители", permissions: [["tasks.read", "Просматривать"], ["tasks.write", "Создавать, переносить и завершать"]] },
  { label: "Входящие", description: "Обращения с подключённых сайтов", permissions: [["leads.read", "Просматривать"], ["leads.write", "Принимать и отклонять"]] },
  { label: "Чат", description: "Диалоги и рабочие группы", permissions: [["chat.read", "Читать"], ["chat.write", "Отправлять сообщения"], ["chat.manage", "Создавать группы и управлять участниками"]] },
  { label: "Уведомления", description: "Личная оперативная лента", permissions: [["notifications.read", "Просматривать и отмечать прочитанными"]] },
  { label: "Сайты", description: "Карточки, инфраструктура и трафик", permissions: [["sites.read", "Просматривать"], ["sites.write", "Настраивать"]] },
  { label: "Помощь", description: "Инструкции и обращения", permissions: [["help.read", "Открывать базу знаний"], ["support.write", "Отправлять обращения"]] },
  { label: "Система", description: "Пользователи, импорт, вид и резервные копии", permissions: [["settings.write", "Управлять настройками"]] },
] as const satisfies ReadonlyArray<{ label: string; description: string; permissions: ReadonlyArray<readonly [Permission, string]> }>;

const grants: Record<OrganizationRole, ReadonlySet<Permission>> = {
  developer: new Set(permissions),
  admin: new Set(configurablePermissions),
  dispatcher: new Set(["clients.read", "clients.write", "orders.read", "orders.write", "visits.read", "visits.write", "documents.read", "documents.write", "masters.read", "tasks.read", "tasks.write", "contracts.read", "contracts.write", "chat.read", "chat.write", "chat.manage", "document_templates.read", "sites.read", "leads.read", "leads.write", "notifications.read", "help.read", "support.write", "companies.read", "search.use", "assistant.use"]),
  manager: new Set(["clients.read", "clients.write", "orders.read", "orders.write", "visits.read", "documents.read", "documents.write", "masters.read", "finance.read", "tasks.read", "tasks.write", "contracts.read", "contracts.write", "chat.read", "chat.write", "chat.manage", "document_templates.read", "sites.read", "leads.read", "leads.write", "analytics.read", "notifications.read", "help.read", "support.write", "companies.read", "search.use", "assistant.use"]),
  accountant: new Set(["clients.read", "orders.read", "documents.read", "documents.write", "finance.read", "finance.write", "tasks.read", "contracts.read", "chat.read", "chat.write", "sites.read", "leads.read", "analytics.read", "notifications.read", "help.read", "support.write", "companies.read", "search.use", "assistant.use"]),
  master: new Set(["visits.read", "visits.write", "chat.read", "chat.write", "document_templates.read", "notifications.read", "help.read", "support.write"]),
};

export class AuthorizationError extends Error {
  constructor() {
    super("The current member is not allowed to perform this operation.");
    this.name = "AuthorizationError";
  }
}

export function hasPermission(subject: OrganizationRole | Pick<AuthenticatedMember, "role" | "permissionOverrides">, permission: Permission) {
  if (typeof subject === "string") return grants[subject].has(permission);
  if (subject.role === "developer") return grants.developer.has(permission);
  if (permission === "support.manage" || permission === "developer.preview") {
    return false;
  }
  return subject.permissionOverrides[permission] ?? grants[subject.role].has(permission);
}

export function requirePermission(member: AuthenticatedMember, permission: Permission) {
  if (!hasPermission(member, permission)) throw new AuthorizationError();
}

export function requireSameOrganization(member: AuthenticatedMember, resourceOrganizationId: string) {
  if (member.organizationId !== resourceOrganizationId) throw new AuthorizationError();
}
