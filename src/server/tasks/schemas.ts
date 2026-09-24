import { z } from "zod";
import { taskColumns, taskPriorities } from "./types.ts";

const optionalText = (maximum: number) => z.string().trim().max(maximum).optional().transform((value) => value || null);
const optionalUuid = z.union([z.literal(""), z.string().uuid()]).transform((value) => value || null);

const editableTaskFields = {
  title: z.string().trim().min(2, "Укажите название задачи").max(240),
  description: optionalText(4_000),
  priority: z.enum(taskPriorities),
  assignedMemberId: optionalUuid,
  localDate: z.union([z.literal(""), z.iso.date("Укажите корректную дату")]),
  localTime: z.union([z.literal(""), z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Укажите время в формате ЧЧ:ММ")]),
};

function requireCompleteDeadline(value: { localDate: string; localTime: string }, context: z.RefinementCtx) {
  if ((value.localDate && !value.localTime) || (!value.localDate && value.localTime)) {
    context.addIssue({ code: "custom", path: [value.localDate ? "localTime" : "localDate"], message: "Дата и время указываются вместе" });
  }
}

export const createTaskSchema = z.object({
  idempotencyKey: z.string().uuid(),
  relatedOrderId: optionalUuid,
  ...editableTaskFields,
}).superRefine(requireCompleteDeadline);

export const taskMutationSchema = z.object({
  taskId: z.string().uuid(),
  expectedVersion: z.coerce.number().int().positive(),
});

export const rescheduleTaskSchema = taskMutationSchema.extend({ column: z.enum(taskColumns) });

export const updateTaskSchema = taskMutationSchema.extend(editableTaskFields).superRefine(requireCompleteDeadline);

export const cancelTaskSchema = taskMutationSchema.extend({
  reason: z.string().trim().min(3, "Укажите причину отмены").max(1_000),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type TaskMutationInput = z.infer<typeof taskMutationSchema>;
export type RescheduleTaskInput = z.infer<typeof rescheduleTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type CancelTaskInput = z.infer<typeof cancelTaskSchema>;
