"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { DIGIT_STYLE_COOKIE, FONT_SCALE_COOKIE, digitStyleOptions, fontScaleOptions } from "@/lib/appearance";
import { requirePermission } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";

const appearanceSchema = z.object({
  fontScale: z.enum(fontScaleOptions),
  digitStyle: z.enum(digitStyleOptions),
});

export type AppearanceState = { status: "idle" | "success" | "error"; message: string | null };

export async function saveAppearanceAction(_state: AppearanceState, formData: FormData): Promise<AppearanceState> {
  const member = await requireSession();
  requirePermission(member, "settings.write");
  const parsed = appearanceSchema.safeParse({ fontScale: formData.get("fontScale"), digitStyle: formData.get("digitStyle") });
  if (!parsed.success) return { status: "error", message: "Выберите допустимый размер текста и вид цифр." };

  const cookieStore = await cookies();
  const options = { httpOnly: true, sameSite: "lax" as const, secure: process.env.AUTH_COOKIE_SECURE === "true", path: "/", maxAge: 31_536_000 };
  cookieStore.set(FONT_SCALE_COOKIE, parsed.data.fontScale, options);
  cookieStore.set(DIGIT_STYLE_COOKIE, parsed.data.digitStyle, options);
  return { status: "success", message: "Представление сохранено для этого браузера." };
}
