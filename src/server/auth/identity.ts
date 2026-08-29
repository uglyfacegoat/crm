import { z } from "zod";

const emailSchema = z.string().email().max(254);

export type LoginIdentity = { kind: "email" | "phone"; normalizedValue: string };

export function normalizeLoginIdentity(input: string): LoginIdentity | null {
  const trimmed = input.trim().toLocaleLowerCase("ru");
  if (trimmed.includes("@")) {
    const parsed = emailSchema.safeParse(trimmed);
    return parsed.success ? { kind: "email", normalizedValue: parsed.data } : null;
  }

  let digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) digits = `7${digits}`;
  if (digits.length === 11 && digits.startsWith("8")) digits = `7${digits.slice(1)}`;
  if (digits.length < 11 || digits.length > 15) return null;
  return { kind: "phone", normalizedValue: `+${digits}` };
}
