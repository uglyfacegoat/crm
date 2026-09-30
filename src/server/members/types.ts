import type { OrganizationRole } from "@/server/auth/types";
import type { Permission } from "@/server/auth/permissions";

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
  permissionOverrides: Partial<Record<Permission, boolean>>;
};

export type MemberMasterOption = {
  id: string;
  fullName: string;
  phone: string;
  active: boolean;
  linkedMemberId: string | null;
};

export type MemberDirectoryPage = {
  items: OrganizationMemberListItem[];
  total: number;
  page: number;
  pageSize: number;
};
export type MemberActivityAccount = Pick<OrganizationMemberListItem, "id" | "displayName" | "email" | "role">;
