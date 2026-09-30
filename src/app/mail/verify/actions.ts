"use server";

import { redirect } from "next/navigation";
import { verifyMailDestination } from "@/server/mail/repository";

export async function confirmMailDestination(formData: FormData) {
  const token = formData.get("token");
  const verified = typeof token === "string" && await verifyMailDestination(token);
  redirect(verified ? "/mail/verify?status=confirmed" : "/mail/verify?status=expired");
}
