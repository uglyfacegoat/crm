import { z } from "zod";
import { assignableOrganizationRoles, type OrganizationRole } from "../auth/types.ts";
import { canRoleHavePermission, configurablePermissions } from "../auth/permissions.ts";
import { isValidContactPhone, normalizeContactPhone } from "../clients/phone.ts";

const optionalMasterId = z.union([z.literal(""), z.string().uuid()]).transform((value) => value || null);
const optionalPhone = z.string().trim().max(40).refine((value) => !value || isValidContactPhone(value), "Введите корректный телефон")
  .transform((value) => value ? normalizeContactPhone(value) : null);
const roleAndMaster = {
  role: z.enum(assignableOrganizationRoles),
  masterId: optionalMasterId,
};
const editableMemberRoles = [...assignableOrganizationRoles, "admin", "dispatcher", "manager"] as const;
const memberPasswordSchema = z.string().min(12, "Минимум 12 символов").max(128)
  .refine((value) => /\p{L}/u.test(value) && /\d/.test(value), "Добавьте хотя бы одну букву и одну цифру");

function validateMasterLink(value: { role: OrganizationRole; masterId: string | null }, context: z.RefinementCtx) {
  if ((value.role === "master" || value.role === "foreman") && !value.masterId) context.addIssue({ code: "custom", path: ["masterId"], message: "Выберите профиль мастера" });
  if (value.role !== "master" && value.role !== "foreman" && value.masterId) context.addIssue({ code: "custom", path: ["masterId"], message: "Привязка доступна только полевой роли" });
}

export const createMemberSchema = z.object({
  idempotencyKey: z.string().uuid(),
  displayName: z.string().trim().min(2, "Введите имя сотрудника").max(200),
  email: z.string().trim().transform((value) => value.toLocaleLowerCase("en")).pipe(z.email("Введите корректный e-mail")),
  phone: optionalPhone,
  password: memberPasswordSchema,
  ...roleAndMaster,
}).superRefine(validateMasterLink);

export const updateMemberAccessSchema = z.object({
  memberId: z.string().uuid(),
  expectedVersion: z.coerce.number().int().positive(),
  active: z.boolean(),
  permissionOverrides: z.partialRecord(z.enum(configurablePermissions), z.boolean()).default({}),
  role: z.enum(editableMemberRoles),
  masterId: optionalMasterId,
}).superRefine((value, context) => {
  validateMasterLink(value, context);
  for (const [permission, allowed] of Object.entries(value.permissionOverrides)) {
    if (allowed && !canRoleHavePermission(value.role, permission as (typeof configurablePermissions)[number])) {
      context.addIssue({ code: "custom", path: ["permissionOverrides"], message: "Это разрешение недоступно на выбранном уровне" });
    }
  }
});

export const resetMemberPasswordSchema = z.object({
  idempotencyKey: z.string().uuid(),
  memberId: z.string().uuid(),
  expectedVersion: z.coerce.number().int().positive(),
  password: memberPasswordSchema,
  passwordConfirmation: z.string(),
}).superRefine((value, context) => {
  if (value.password !== value.passwordConfirmation) {
    context.addIssue({ code: "custom", path: ["passwordConfirmation"], message: "Пароли не совпадают" });
  }
});

export type CreateMemberInput = z.infer<typeof createMemberSchema>;
export type UpdateMemberAccessInput = z.infer<typeof updateMemberAccessSchema>;
export type ResetMemberPasswordInput = z.infer<typeof resetMemberPasswordSchema>;
