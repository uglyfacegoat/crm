"use server";

import { revalidatePath } from "next/cache";
import { getAuthMode } from "@/server/auth/config";
import { requireOfficeSession } from "@/server/auth/session";
import { composeMailSchema, queueOutgoingMail } from "@/server/mail/repository";

export type ComposeMailResult = { ok: boolean; message: string };

export async function composeMailAction(_previous: ComposeMailResult, formData: FormData): Promise<ComposeMailResult> {
  if (getAuthMode() === "preview") return { ok: false, message: "В предпросмотре отправка недоступна." };
  const member = await requireOfficeSession();
  if (process.env.CRM_MAIL_OUTBOUND_ENABLED !== "true") {
    return { ok: false, message: "Исходящая почта пока не настроена. Письмо не отправлено." };
  }
  const parsed = composeMailSchema.safeParse({
    sourceId: formData.get("sourceId"),
    toAddress: formData.get("toAddress"),
    subject: formData.get("subject"),
    bodyText: formData.get("bodyText"),
    replyToMessageId: formData.get("replyToMessageId") || undefined,
  });
  if (!parsed.success) return { ok: false, message: "Проверьте адрес получателя, тему и текст письма." };
  try {
    await queueOutgoingMail(member, parsed.data);
    revalidatePath("/mail");
    return { ok: true, message: "Письмо поставлено в очередь. Статус доставки появится в «Отправленных»." };
  } catch {
    return { ok: false, message: "Не удалось поставить письмо в очередь. Проверьте выбранный ящик." };
  }
}
