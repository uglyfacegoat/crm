"use server";

import { revalidatePath } from "next/cache";
import { getAuthMode } from "@/server/auth/config";
import { requireSession } from "@/server/auth/session";
import { InvalidProfileImageError, profileNameSchema, updateOwnProfile } from "@/server/members/profile";

export type ProfileActionState = { status: "idle" | "success" | "error"; message: string };

export async function updateProfileAction(_previous: ProfileActionState, formData: FormData): Promise<ProfileActionState> {
  if (getAuthMode() === "preview") return { status: "error", message: "В режиме просмотра профиль не сохраняется." };
  const member = await requireSession();
  const name = profileNameSchema.safeParse(formData.get("displayName"));
  if (!name.success) return { status: "error", message: name.error.issues[0]?.message ?? "Проверьте имя." };
  const photo = formData.get("photo");
  if (photo !== null && !(photo instanceof File)) return { status: "error", message: "Выберите корректное фото." };
  try {
    await updateOwnProfile(member, { displayName: name.data, photo, removePhoto: formData.get("removePhoto") === "on" });
    revalidatePath("/profile");
    revalidatePath("/settings");
    return { status: "success", message: "Профиль сохранён." };
  } catch (error) {
    if (error instanceof InvalidProfileImageError) return { status: "error", message: "Фото должно быть PNG, JPEG или WebP размером до 2 МБ." };
    console.error("profile.update_failed", error instanceof Error ? error.name : "unknown");
    return { status: "error", message: "Не удалось сохранить профиль. Попробуйте ещё раз." };
  }
}
