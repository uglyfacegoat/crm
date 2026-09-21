"use server";

import { revalidatePath } from "next/cache";
import { getAuthMode } from "@/server/auth/config";
import { requireSession } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/permissions";
import { consumeRequestLimit } from "@/server/request-limits/repository";
import {
  assertChatMessageAccess,
  assertChatAvatarAccess,
  ChatChannelConflictError,
  ChatDirectConversationError,
  ChatEntityUnavailableError,
  ChatChannelNotFoundError,
  ChatChannelVersionConflictError,
  ChatGeneralChannelMutationError,
  ChatMemberReferenceError,
  chatMessageExists,
  createChatChannel,
  createDirectChat,
  markChatChannelRead,
  sendChatMessage,
  toggleChatReaction,
  toggleChatChannelPin,
  updateChatChannelMembers,
  updateChatChannelSettings,
} from "@/server/chat/repository";
import { chatChannelIdSchema, createChatChannelSchema, createDirectChatSchema, sendChatMessageSchema, toggleChatReactionSchema, updateChatChannelMembersSchema, updateChatChannelSettingsSchema } from "@/server/chat/schemas";
import { MAX_CHAT_ATTACHMENT_BYTES, MAX_CHAT_AVATAR_BYTES, validateChatAttachment, validateChatAvatar } from "@/server/chat/file-validation";
import { DocumentFileValidationError } from "@/server/documents/file-validation";
import { createChatAttachmentStorageKey, createChatChannelAvatarStorageKey, removeDocumentFile, writeDocumentFile } from "@/server/documents/storage";

export type ChatMutationState = {
  status: "idle" | "success" | "error";
  message: string | null;
  fieldErrors: Record<string, string[]>;
  entityId: string | null;
  refreshRequired?: true;
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

export async function createDirectChatAction(_previous: ChatMutationState, formData: FormData): Promise<ChatMutationState> {
  if (getAuthMode() === "preview") return previewState;
  const member = await requireSession();
  const parsed = createDirectChatSchema.safeParse({ idempotencyKey: formData.get("idempotencyKey"), targetMemberId: formData.get("targetMemberId") });
  if (!parsed.success) return { status: "error", message: "Выберите сотрудника для личного диалога.", fieldErrors: fieldErrors(parsed.error), entityId: null };
  try {
    const channelId = await createDirectChat(member, parsed.data);
    revalidatePath("/chat");
    return { status: "success", message: "Личный диалог открыт.", fieldErrors: {}, entityId: channelId };
  } catch (error) {
    if (error instanceof ChatMemberReferenceError) return { status: "error", message: "Сотрудник больше недоступен.", fieldErrors: { targetMemberId: ["Обновите список сотрудников"] }, entityId: null };
    if (error instanceof ChatDirectConversationError) return { status: "error", message: "Нельзя открыть личный диалог с самим собой.", fieldErrors: { targetMemberId: ["Выберите другого сотрудника"] }, entityId: null };
    logUnexpected("chat.direct.create", member.memberId, error);
    return { status: "error", message: "Не удалось открыть личный диалог.", fieldErrors: {}, entityId: null };
  }
}

export async function sendChatMessageAction(_previous: ChatMutationState, formData: FormData): Promise<ChatMutationState> {
  if (getAuthMode() === "preview") return previewState;
  const member = await requireSession();
  const uploadedFile = formData.get("file");
  const hasAttachment = uploadedFile instanceof File && uploadedFile.size > 0;
  const body = String(formData.get("body") ?? "").trim() || (hasAttachment && uploadedFile.type.startsWith("audio/") ? "Голосовое сообщение" : "");
  const parsed = sendChatMessageSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"),
    channelId: formData.get("channelId"),
    body,
    sharedEntityType: formData.get("sharedEntityType"),
    sharedEntityId: formData.get("sharedEntityId"),
  });
  if (!parsed.success) return { status: "error", message: "Введите сообщение или выберите объект системы.", fieldErrors: fieldErrors(parsed.error), entityId: null };
  let storageKey: string | null = null;
  let fileWritten = false;
  let persisted = false;
  try {
    await assertChatMessageAccess(member, parsed.data.channelId);
    if (await chatMessageExists(member, parsed.data.idempotencyKey, parsed.data.channelId)) {
      return { status: "success", message: null, fieldErrors: {}, entityId: parsed.data.idempotencyKey };
    }
    if (hasAttachment && uploadedFile.size > MAX_CHAT_ATTACHMENT_BYTES) throw new DocumentFileValidationError("Размер файла не должен превышать 15 МБ.");
    const messageBudget = await consumeRequestLimit(member, "chat_message");
    if (!messageBudget.allowed) return { status: "error", message: `Слишком много сообщений. Повторите через ${messageBudget.retryAfterSeconds} сек. Черновик сохранён.`, fieldErrors: {}, entityId: null };
    let attachment = null;
    if (hasAttachment) {
      const uploadBudget = await consumeRequestLimit(member, "chat_upload");
      if (!uploadBudget.allowed) return { status: "error", message: `Слишком много загрузок. Повторите через ${uploadBudget.retryAfterSeconds} сек. Черновик сохранён.`, fieldErrors: {}, entityId: null };
      const buffer = Buffer.from(await uploadedFile.arrayBuffer());
      const file = validateChatAttachment({ filename: uploadedFile.name, declaredMimeType: uploadedFile.type, buffer });
      storageKey = createChatAttachmentStorageKey(member.organizationId, parsed.data.idempotencyKey, file.extension);
      await writeDocumentFile(storageKey, buffer);
      fileWritten = true;
      attachment = { id: parsed.data.idempotencyKey, ...file, storageKey };
    }
    const messageId = await sendChatMessage(member, parsed.data, attachment);
    persisted = true;
    revalidatePath("/chat");
    return { status: "success", message: null, fieldErrors: {}, entityId: messageId };
  } catch (error) {
    if (persisted) {
      logUnexpected("chat.message.revalidate", member.memberId, error);
      return { status: "success", refreshRequired: true, message: "Сообщение отправлено, но переписку не удалось обновить. Обновите страницу вручную.", fieldErrors: {}, entityId: parsed.data.idempotencyKey };
    }
    const rejected = error instanceof AuthorizationError || error instanceof ChatChannelNotFoundError || error instanceof ChatEntityUnavailableError;
    if (storageKey && fileWritten && rejected) {
      try { await removeDocumentFile(storageKey); } catch (cleanupError) { logUnexpected("chat.attachment.cleanup", member.memberId, cleanupError); }
    }
    if (error instanceof DocumentFileValidationError) return { status: "error", message: error.message, fieldErrors: { file: [error.message] }, entityId: null };
    if (error instanceof AuthorizationError) return { status: "error", message: "Недостаточно прав для отправки сообщений.", fieldErrors: {}, entityId: null };
    if (error instanceof ChatChannelNotFoundError) return { status: "error", message: "Группа больше не существует или недоступна.", fieldErrors: {}, entityId: null };
    if (error instanceof ChatEntityUnavailableError) return { status: "error", message: "Объект больше недоступен или у вас нет права его отправлять.", fieldErrors: { sharedEntityId: ["Выберите объект повторно"] }, entityId: null };
    if (errorCode(error) === "EEXIST") {
      if (await chatMessageExists(member, parsed.data.idempotencyKey, parsed.data.channelId)) return { status: "success", message: null, fieldErrors: {}, entityId: parsed.data.idempotencyKey };
      return { status: "error", message: "Вложение ещё обрабатывается. Подождите и повторите.", fieldErrors: {}, entityId: null };
    }
    logUnexpected("chat.message.send", member.memberId, error);
    return { status: "error", message: "Не удалось подтвердить отправку. Проверьте переписку перед повторной отправкой. Текст сохранён в поле.", fieldErrors: {}, entityId: null };
  }
}

export async function updateChatChannelSettingsAction(_previous: ChatMutationState, formData: FormData): Promise<ChatMutationState> {
  if (getAuthMode() === "preview") return previewState;
  const member = await requireSession();
  const parsed = updateChatChannelSettingsSchema.safeParse({
    channelId: formData.get("channelId"), expectedVersion: formData.get("expectedVersion"),
    name: formData.get("name"), description: formData.get("description"), muted: formData.get("muted"),
  });
  if (!parsed.success) return { status: "error", message: "Проверьте название и описание группы.", fieldErrors: fieldErrors(parsed.error), entityId: null };
  const uploadedFile = formData.get("avatar");
  const hasAvatar = uploadedFile instanceof File && uploadedFile.size > 0;
  let storageKey: string | null = null;
  let fileWritten = false;
  let persisted = false;
  try {
    let avatar = null;
    if (hasAvatar) {
      await assertChatAvatarAccess(member, parsed.data.channelId, parsed.data.expectedVersion);
      if (uploadedFile.size > MAX_CHAT_AVATAR_BYTES) throw new DocumentFileValidationError("Фото группы не должно превышать 3 МБ.");
      const uploadBudget = await consumeRequestLimit(member, "chat_upload");
      if (!uploadBudget.allowed) return { status: "error", message: `Слишком много загрузок. Повторите через ${uploadBudget.retryAfterSeconds} сек.`, fieldErrors: {}, entityId: null };
      const buffer = Buffer.from(await uploadedFile.arrayBuffer());
      const file = validateChatAvatar({ filename: uploadedFile.name, declaredMimeType: uploadedFile.type, buffer });
      storageKey = createChatChannelAvatarStorageKey(member.organizationId, parsed.data.channelId, parsed.data.expectedVersion + 1, file.extension);
      await writeDocumentFile(storageKey, buffer);
      fileWritten = true;
      avatar = { id: parsed.data.channelId, ...file, storageKey };
    }
    const result = await updateChatChannelSettings(member, parsed.data, avatar);
    persisted = true;
    if (storageKey && result.previousAvatarStorageKey && result.previousAvatarStorageKey !== storageKey) {
      try { await removeDocumentFile(result.previousAvatarStorageKey); } catch (cleanupError) { logUnexpected("chat.avatar.previous_cleanup", member.memberId, cleanupError); }
    }
    revalidatePath("/chat");
    return { status: "success", message: "Настройки группы сохранены.", fieldErrors: {}, entityId: parsed.data.channelId };
  } catch (error) {
    if (persisted) {
      logUnexpected("chat.channel.settings_revalidate", member.memberId, error);
      return { status: "success", refreshRequired: true, message: "Настройки группы сохранены, но страницу не удалось обновить. Обновите её вручную.", fieldErrors: {}, entityId: parsed.data.channelId };
    }
    const rejected = error instanceof AuthorizationError || error instanceof ChatGeneralChannelMutationError
      || error instanceof ChatChannelConflictError || error instanceof ChatChannelVersionConflictError || error instanceof ChatChannelNotFoundError;
    if (storageKey && fileWritten && rejected) {
      try { await removeDocumentFile(storageKey); } catch (cleanupError) { logUnexpected("chat.avatar.cleanup", member.memberId, cleanupError); }
    }
    if (error instanceof DocumentFileValidationError) return { status: "error", message: error.message, fieldErrors: { avatar: [error.message] }, entityId: null };
    if (error instanceof AuthorizationError) return { status: "error", message: "Недостаточно прав для изменения группы.", fieldErrors: {}, entityId: null };
    if (error instanceof ChatGeneralChannelMutationError) return { status: "error", message: "Фото этого канала управляется системой.", fieldErrors: {}, entityId: null };
    if (error instanceof ChatChannelConflictError) return { status: "error", message: "Группа с таким названием уже существует.", fieldErrors: { name: ["Название уже используется"] }, entityId: null };
    if (error instanceof ChatChannelVersionConflictError) return { status: "error", message: "Настройки уже изменились. Обновите страницу.", fieldErrors: {}, entityId: null };
    if (error instanceof ChatChannelNotFoundError) return { status: "error", message: "Группа больше недоступна.", fieldErrors: {}, entityId: null };
    if (errorCode(error) === "EEXIST") return { status: "error", message: "Фото группы уже обрабатывается. Обновите страницу и повторите.", fieldErrors: {}, entityId: null };
    logUnexpected("chat.channel.settings_update", member.memberId, error);
    return { status: "error", message: "Не удалось подтвердить сохранение настроек. Обновите группу и проверьте результат перед повторным изменением.", fieldErrors: {}, entityId: null };
  }
}

export async function toggleChatReactionAction(messageId: string, emoji: string) {
  if (getAuthMode() === "preview") return;
  const member = await requireSession();
  const parsed = toggleChatReactionSchema.parse({ messageId, emoji });
  await toggleChatReaction(member, parsed);
  revalidatePath("/chat");
}

export async function toggleChatChannelPinAction(channelId: string) {
  if (getAuthMode() === "preview") return;
  const member = await requireSession();
  const parsed = chatChannelIdSchema.parse(channelId);
  await toggleChatChannelPin(member, parsed);
  revalidatePath("/chat");
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
    if (error instanceof ChatGeneralChannelMutationError) return { status: "error", message: "Состав системного канала обновляется автоматически.", fieldErrors: {}, entityId: null };
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
