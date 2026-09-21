import { z } from "zod";
import { isChatEmoji } from "../../lib/chat-emojis.ts";
import { chatEntityTypes } from "./types.ts";

export const createChatChannelSchema = z.object({
  idempotencyKey: z.string().uuid(),
  name: z.string().trim().min(2, "Укажите название группы").max(120),
  description: z.preprocess((value) => typeof value === "string" && value.trim() === "" ? null : value, z.string().trim().max(1000).nullable()),
  memberIds: z.array(z.string().uuid()).max(100).transform((memberIds) => [...new Set(memberIds)]),
});

export const createDirectChatSchema = z.object({
  idempotencyKey: z.string().uuid(),
  targetMemberId: z.string().uuid(),
});

export const sendChatMessageSchema = z.object({
  idempotencyKey: z.string().uuid(),
  channelId: z.string().uuid(),
  body: z.string().trim().max(4000, "Сообщение не должно превышать 4000 символов"),
  sharedEntityType: z.preprocess((value) => value === "" || value === null ? undefined : value, z.enum(chatEntityTypes).optional()),
  sharedEntityId: z.preprocess((value) => value === "" || value === null ? undefined : value, z.string().uuid().optional()),
}).superRefine((input, context) => {
  if (Boolean(input.sharedEntityType) !== Boolean(input.sharedEntityId)) {
    context.addIssue({ code: "custom", path: ["sharedEntityId"], message: "Выберите объект системы повторно" });
  }
  if (!input.body && !input.sharedEntityId) {
    context.addIssue({ code: "custom", path: ["body"], message: "Введите сообщение или выберите объект системы" });
  }
});

export const chatChannelIdSchema = z.string().uuid();

export const updateChatChannelMembersSchema = z.object({
  channelId: z.string().uuid(),
  expectedVersion: z.coerce.number().int().positive(),
  memberIds: z.array(z.string().uuid()).max(100).transform((memberIds) => [...new Set(memberIds)]),
});

export const updateChatChannelSettingsSchema = z.object({
  channelId: z.string().uuid(),
  expectedVersion: z.coerce.number().int().positive(),
  name: z.string().trim().min(2, "Укажите название группы").max(120),
  description: z.preprocess((value) => typeof value === "string" && value.trim() === "" ? null : value, z.string().trim().max(1000).nullable()),
  muted: z.preprocess((value) => value === "on" || value === "true", z.boolean()),
});

export const toggleChatReactionSchema = z.object({
  messageId: z.string().uuid(),
  emoji: z.string().refine(isChatEmoji, "Unsupported chat emoji"),
});

export type CreateChatChannelInput = z.infer<typeof createChatChannelSchema>;
export type CreateDirectChatInput = z.infer<typeof createDirectChatSchema>;
export type SendChatMessageInput = z.infer<typeof sendChatMessageSchema>;
export type UpdateChatChannelMembersInput = z.infer<typeof updateChatChannelMembersSchema>;
export type UpdateChatChannelSettingsInput = z.infer<typeof updateChatChannelSettingsSchema>;
export type ToggleChatReactionInput = z.infer<typeof toggleChatReactionSchema>;
