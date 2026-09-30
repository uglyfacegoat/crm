export const assignableOrganizationRoles = [
  "deputy",
  "finance_controller",
  "sales_lead",
  "regional_director",
  "crm_coordinator",
  "sales_specialist",
  "tender_specialist",
  "foreman",
  "accountant",
  "master",
] as const;

export const organizationRoles = [
  "owner",
  "developer",
  // Legacy roles remain readable until existing accounts are migrated.
  "admin",
  "dispatcher",
  "manager",
  ...assignableOrganizationRoles,
] as const;
export type OrganizationRole = (typeof organizationRoles)[number];
export type AssignableOrganizationRole =
  (typeof assignableOrganizationRoles)[number];

export const roleGrades: Record<OrganizationRole, 1 | 2 | 3> = {
  owner: 1,
  developer: 1,
  deputy: 2,
  finance_controller: 2,
  sales_lead: 3,
  regional_director: 2,
  accountant: 2,
  admin: 3,
  dispatcher: 3,
  manager: 3,
  crm_coordinator: 3,
  sales_specialist: 3,
  tender_specialist: 3,
  foreman: 3,
  master: 3,
};

export type AuthenticatedMember = {
  sessionId: string | null;
  organizationId: string;
  organizationName: string;
  memberId: string;
  displayName: string;
  email: string;
  role: OrganizationRole;
  masterId: string | null;
  permissionOverrides: Record<string, boolean>;
};

export type SessionCookie = { token: string; expiresAt: Date };
