"use server";

import { revalidatePath } from "next/cache";
import { requireOfficeSession } from "@/server/auth/session";
import { addOwnMailDestination, destinationEmailSchema, removeOwnMailDestination,
  listMailSources, updateOwnMailDestination } from "@/server/mail/repository";

export type MailActionState = { status: "idle" | "success" | "error"; message: string };

export async function addMailDestinationAction(_previous: MailActionState, formData: FormData): Promise<MailActionState> {
  const member = await requireOfficeSession();
  const parsed = destinationEmailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { status: "error", message: "Проверьте адрес электронной почты." };
  try {
    await addOwnMailDestination(member, parsed.data);
    revalidatePath("/profile");
    return { status: "success", message: "Адрес добавлен. После подключения почтового сервиса придёт письмо для подтверждения." };
  } catch (error) {
    return { status: "error", message: error instanceof Error && error.message === "MAIL_DESTINATION_EXISTS"
      ? "Этот адрес уже добавлен." : error instanceof Error && error.message === "MAIL_DESTINATION_LIMIT"
        ? "Можно добавить не больше пяти адресов." : "Не удалось добавить адрес." };
  }
}

export async function updateMailDestinationAction(formData: FormData) {
  const member = await requireOfficeSession();
  const id = String(formData.get("id") ?? "");
  const sources = await listMailSources(member);
  await updateOwnMailDestination(member, id, sources.map((source) => ({
    sourceId: source.id, leadsEnabled: formData.has(`source:${source.id}:leads`),
    mailEnabled: formData.has(`source:${source.id}:mail`),
  })));
  revalidatePath("/profile");
}

export async function removeMailDestinationAction(formData: FormData) {
  const member = await requireOfficeSession();
  await removeOwnMailDestination(member, String(formData.get("id") ?? ""));
  revalidatePath("/profile");
}
