import { z } from "zod";
import type { OrganizationRole } from "@/server/auth/types";

export const memberRoleLabels: Record<OrganizationRole, string> = {
  owner: "Владелец",
  developer: "Разработчик",
  deputy: "Заместитель",
  finance_controller: "Финконтроль",
  sales_lead: "Руководитель продаж", sales_specialist: "Менеджер продаж",
  regional_director: "Региональный директор",
  crm_coordinator: "Координатор CRM",
  tender_specialist: "Тендерный отдел",
  foreman: "Бригадир",
  admin: "Администратор",
  dispatcher: "Диспетчер",
  manager: "Менеджер",
  accountant: "Бухгалтер",
  master: "Мастер",
};
export const MEMBER_PAGE_SIZE = 30;
export const memberDirectoryQuerySchema = z.object({
  q: z.string().trim().max(100).default(""),
  status: z.enum(["all", "active", "inactive"]).default("active"),
  page: z.coerce.number().int().min(1).max(100000).default(1),
});
export const memberMasterQuerySchema = z.object({
  q: z.string().trim().max(100).default(""),
  memberId: z.string().uuid().optional(),
});
export type MemberDirectoryQuery = z.infer<typeof memberDirectoryQuerySchema>;
export type MemberMasterQuery = z.infer<typeof memberMasterQuerySchema>;
