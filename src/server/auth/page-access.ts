import "server-only";
import { redirect } from "next/navigation";
import { hasPermission, type Permission } from "./permissions";
import type { AuthenticatedMember } from "./types";

export function requirePagePermission(member: AuthenticatedMember, permission: Permission) {
  if (!hasPermission(member, permission)) redirect("/profile");
}
