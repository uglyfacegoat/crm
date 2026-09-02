import type { OrganizationRole } from "@/server/auth/types";

export type OrganizationMemberListItem = {
  id: string;
  displayName: string;
  email: string;
  phone: string | null;
  role: OrganizationRole;
  active: boolean;
  masterId: string | null;
  masterName: string | null;
  lastLoginAt: string | null;
  version: number;
};

export type MemberMasterOption = {
  id: string;
  fullName: string;
  phone: string;
  active: boolean;
  linkedMemberId: string | null;
};
