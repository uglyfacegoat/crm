"use server";

import { revalidatePath } from "next/cache";
import { getAuthMode } from "@/server/auth/config";
import { requireSession } from "@/server/auth/session";
import {
  ChatChannelConflictError,
  ChatChannelNotFoundError,
  ChatChannelVersionConflictError,
  ChatGeneralChannelMutationError,
  ChatMemberReferenceError,
  chatMessageExists,
  createChatChannel,
  markChatChannelRead,
  sendChatMessage,
  updateChatChannelMembers,
} from "@/server/chat/repository";
import { chatChannelIdSchema, createChatChannelSchema, sendChatMessageSchema, updateChatChannelMembersSchema } from "@/server/chat/schemas";
import { DocumentFileValidationError, validateDocumentFile } from "@/server/documents/file-validation";
import { createChatAttachmentStorageKey, removeDocumentFile, writeDocumentFile } from "@/server/documents/storage";

export type ChatMutationState = {
  status: "idle" | "success" | "error";
  message: string | null;
  fieldErrors: Record<string, string[]>;
  entityId: string | null;
};

const previewState: ChatMutationState = { status: "error", message: "Предпросмотр не записывает сообщения. Включите рабочий режим.", fieldErrors: {}, entityId: null };

function fieldErrors(error: { flatten(): { fieldErrors: Record<string, string[] | undefined> } }) {
  return Object.fromEntries(Object.entries(error.flatten().fieldErrors).filter((entry): entry is [string, string[]] => Array.isArray(entry[1])));
}

function logUnexpected(operation: string, memberId: string, error: unknown) {
  console.error(JSON.stringify({ operation, category: "unexpected", memberId, error: error instanceof Error ? error.message : "Unknown error" }));
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : null;
}

export async function createChatChannelAction(_previous: ChatMutationState, formData: FormData): Promise<ChatMutationState> {
  if (getAuthMode() === "preview") return previewState;
  const member = await requireSession();
  const parsed = createChatChannelSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"),
    name: formData.get("name"),
    description: formData.get("description"),
    memberIds: formData.getAll("memberIds"),
  });
  if (!parsed.success) return { status: "error", message: "Проверьте название и состав группы.", fieldErrors: fieldErrors(parsed.error), entityId: null };
  try {
    const channelId = await createChatChannel(member, parsed.data);
    revalidatePath("/chat");
    return { status: "success", message: "Группа создана.", fieldErrors: {}, entityId: channelId };
  } catch (error) {
    if (error instanceof ChatChannelConflictError) return { status: "error", message: "Группа с таким названием уже существует.", fieldErrors: { name: ["Название уже используется"] }, entityId: null };
    if (error instanceof ChatMemberReferenceError) return { status: "error", message: "Один из выбранных сотрудников больше недоступен.", fieldErrors: { memberIds: ["Обновите список участников"] }, entityId: null };
    logUnexpected("chat.channel.create", member.memberId, error);
    return { status: "error", message: "Не удалось создать группу. Изменения не сохранены.", fieldErrors: {}, entityId: null };
  }
}

export async function sendChatMessageAction(_previous: ChatMutationState, formData: FormData): Promise<ChatMutationState> {
  if (getAuthMode() === "preview") return previewState;
  const member = await requireSession();
  const parsed = sendChatMessageSchema.safeParse({ idempotencyKey: formData.get("idempotencyKey"), channelId: formData.get("channelId"), body: formData.get("body") });
  if (!parsed.success) return { status: "error", message: "Введите сообщение длиной до 4000 символов.", fieldErrors: fieldErrors(parsed.error), entityId: null };
  const uploadedFile = formData.get("file");
  const hasAttachment = uploadedFile instanceof File && uploadedFile.size > 0;
  let storageKey: string | null = null;
  let persisted = false;
  try {
    if (await chatMessageExists(member, parsed.data.idempotencyKey, parsed.data.channelId)) {
      return { status: "success", message: null, fieldErrors: {}, entityId: parsed.data.idempotencyKey };
    }
    let attachment = null;
    if (hasAttachment) {
      const buffer = Buffer.from(await uploadedFile.arrayBuffer());
      const file = validateDocumentFile({ filename: uploadedFile.name, declaredMimeType: uploadedFile.type, buffer });
      storageKey = createChatAttachmentStorageKey(member.organizationId, parsed.data.idempotencyKey, file.extension);
      await writeDocumentFile(storageKey, buffer);
      attachment = { id: parsed.data.idempotencyKey, ...file, storageKey };
    }
    const messageId = await sendChatMessage(member, parsed.data, attachment);
    persisted = true;
    revalidatePath("/chat");
    return { status: "success", message: null, fieldErrors: {}, entityId: messageId };
  } catch (error) {
    if (storageKey && !persisted && errorCode(error) !== "EEXIST") {
      try { await removeDocumentFile(storageKey); } catch (cleanupError) { logUnexpected("chat.attachment.cleanup", member.memberId, cleanupError); }
    }
    if (error instanceof DocumentFileValidationError) return { status: "error", message: error.message, fieldErrors: { file: [error.message] }, entityId: null };
    if (error instanceof ChatChannelNotFoundError) return { status: "error", message: "Группа больше не существует или недоступна.", fieldErrors: {}, entityId: null };
    if (errorCode(error) === "EEXIST") {
      if (await chatMessageExists(member, parsed.data.idempotencyKey, parsed.data.channelId)) return { status: "success", message: null, fieldErrors: {}, entityId: parsed.data.idempotencyKey };
      return { status: "error", message: "Вложение ещё обрабатывается. Подождите и повторите.", fieldErrors: {}, entityId: null };
    }
    logUnexpected("chat.message.send", member.memberId, error);
    return { status: "error", message: "Не удалось отправить сообщение. Текст сохранён в поле.", fieldErrors: {}, entityId: null };
  }
}

export async function updateChatChannelMembersAction(_previous: ChatMutationState, formData: FormData): Promise<ChatMutationState> {
  if (getAuthMode() === "preview") return previewState;
  const member = await requireSession();
  const parsed = updateChatChannelMembersSchema.safeParse({
    channelId: formData.get("channelId"),
    expectedVersion: formData.get("expectedVersion"),
    memberIds: formData.getAll("memberIds"),
  });
  if (!parsed.success) return { status: "error", message: "Проверьте состав группы.", fieldErrors: fieldErrors(parsed.error), entityId: null };
  try {
    await updateChatChannelMembers(member, parsed.data);
    revalidatePath("/chat");
    return { status: "success", message: "Состав группы обновлён.", fieldErrors: {}, entityId: parsed.data.channelId };
  } catch (error) {
    if (error instanceof ChatChannelNotFoundError) return { status: "error", message: "Группа больше не существует.", fieldErrors: {}, entityId: null };
    if (error instanceof ChatChannelVersionConflictError) return { status: "error", message: "Состав уже изменил другой сотрудник. Обновите страницу.", fieldErrors: {}, entityId: null };
    if (error instanceof ChatGeneralChannelMutationError) return { status: "error", message: "Состав общего канала обновляется автоматически.", fieldErrors: {}, entityId: null };
    if (error instanceof ChatMemberReferenceError) return { status: "error", message: "Один из сотрудников больше недоступен.", fieldErrors: { memberIds: ["Обновите список"] }, entityId: null };
    logUnexpected("chat.channel.members_update", member.memberId, error);
    return { status: "error", message: "Не удалось обновить состав группы.", fieldErrors: {}, entityId: null };
  }
}

export async function markChatChannelReadAction(channelId: string) {
  if (getAuthMode() === "preview") return;
  const member = await requireSession();
  const parsed = chatChannelIdSchema.safeParse(channelId);
  if (!parsed.success) throw new Error("Invalid channel identifier.");
  await markChatChannelRead(member, parsed.data);
  revalidatePath("/chat");
}
