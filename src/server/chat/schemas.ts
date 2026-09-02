import { z } from "zod";

export const createChatChannelSchema = z.object({
  idempotencyKey: z.string().uuid(),
  name: z.string().trim().min(2, "Укажите название группы").max(120),
  description: z.preprocess((value) => typeof value === "string" && value.trim() === "" ? null : value, z.string().trim().max(1000).nullable()),
  memberIds: z.array(z.string().uuid()).max(100).transform((memberIds) => [...new Set(memberIds)]),
});

export const sendChatMessageSchema = z.object({
  idempotencyKey: z.string().uuid(),
  channelId: z.string().uuid(),
  body: z.string().trim().min(1, "Введите сообщение").max(4000, "Сообщение не должно превышать 4000 символов"),
});

export const chatChannelIdSchema = z.string().uuid();

export const updateChatChannelMembersSchema = z.object({
  channelId: z.string().uuid(),
  expectedVersion: z.coerce.number().int().positive(),
  memberIds: z.array(z.string().uuid()).max(100).transform((memberIds) => [...new Set(memberIds)]),
});

export type CreateChatChannelInput = z.infer<typeof createChatChannelSchema>;
export type SendChatMessageInput = z.infer<typeof sendChatMessageSchema>;
export type UpdateChatChannelMembersInput = z.infer<typeof updateChatChannelMembersSchema>;
