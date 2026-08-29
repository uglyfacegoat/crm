import { z } from "zod";
import { taskColumns, taskPriorities } from "./types.ts";

const optionalText = (maximum: number) => z.string().trim().max(maximum).optional().transform((value) => value || null);

export const createTaskSchema = z.object({
  idempotencyKey: z.string().uuid(),
  title: z.string().trim().min(2, "Укажите название задачи").max(240),
  description: optionalText(4_000),
  priority: z.enum(taskPriorities),
  localDate: z.union([z.literal(""), z.iso.date("Укажите корректную дату")]),
  localTime: z.union([z.literal(""), z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Укажите время в формате ЧЧ:ММ")]),
}).superRefine((value, context) => {
  if ((value.localDate && !value.localTime) || (!value.localDate && value.localTime)) {
    context.addIssue({ code: "custom", path: [value.localDate ? "localTime" : "localDate"], message: "Дата и время указываются вместе" });
  }
});

export const taskMutationSchema = z.object({
  taskId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
});

export const rescheduleTaskSchema = taskMutationSchema.extend({ column: z.enum(taskColumns) });

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type TaskMutationInput = z.infer<typeof taskMutationSchema>;
export type RescheduleTaskInput = z.infer<typeof rescheduleTaskSchema>;
