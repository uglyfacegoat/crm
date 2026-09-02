export const organizationRoles = ["admin", "dispatcher", "manager", "accountant", "master"] as const;
export type OrganizationRole = (typeof organizationRoles)[number];

export type AuthenticatedMember = {
  sessionId: string;
  organizationId: string;
  organizationName: string;
  memberId: string;
  displayName: string;
  email: string;
  role: OrganizationRole;
  masterId: string | null;
};

export type SessionCookie = { token: string; expiresAt: Date };
