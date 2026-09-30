"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuthMode } from "@/server/auth/config";
import { requireOfficeSession } from "@/server/auth/session";
import { centerRecordIsAccessible } from "@/server/organizations/center-feed";

const targetSchema = z.object({
  kind: z.enum(["lead", "order", "task", "visit"]),
  organizationId: z.string().uuid(),
  recordId: z.string().uuid(),
});

export async function openCenterRecordAction(formData: FormData) {
  const member = await requireOfficeSession();
  if (getAuthMode() !== "required") redirect("/companies");
  const parsed = targetSchema.safeParse({
    kind: formData.get("kind"),
    organizationId: formData.get("organizationId"),
    recordId: formData.get("recordId"),
  });
  if (!parsed.success) redirect("/companies?centerError=unavailable");
  const target = parsed.data;
  if (!(await centerRecordIsAccessible(member, target.kind, target.organizationId, target.recordId))) {
    redirect("/companies?centerError=unavailable");
  }
  if (target.kind === "order") redirect(`/orders/${target.recordId}`);
  redirect(`/companies/records/${target.kind}/${target.recordId}?organizationId=${target.organizationId}`);
}
