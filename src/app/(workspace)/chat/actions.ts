"use server";

import { revalidatePath } from "next/cache";
import { getAuthMode } from "@/server/auth/config";
import { requireSession } from "@/server/auth/session";
import {
  ChatChannelConflictError,
  ChatChannelNotFoundError,
  ChatMemberReferenceError,
  createChatChannel,
  markChatChannelRead,
  sendChatMessage,
} from "@/server/chat/repository";
import { chatChannelIdSchema, createChatChannelSchema, sendChatMessageSchema } from "@/server/chat/schemas";

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
  try {
    const messageId = await sendChatMessage(member, parsed.data);
    revalidatePath("/chat");
    return { status: "success", message: null, fieldErrors: {}, entityId: messageId };
  } catch (error) {
    if (error instanceof ChatChannelNotFoundError) return { status: "error", message: "Группа больше не существует или недоступна.", fieldErrors: {}, entityId: null };
    logUnexpected("chat.message.send", member.memberId, error);
    return { status: "error", message: "Не удалось отправить сообщение. Текст сохранён в поле.", fieldErrors: {}, entityId: null };
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
