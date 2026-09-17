import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DeveloperSupportQueue } from "@/components/help/developer-support-queue";
import { hasPermission } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import { getDeveloperSupportQueue } from "@/server/support/repository";

export const metadata: Metadata = { title: "Очередь обращений" };

export default async function DeveloperSupportPage() {
  const member = await requireSession();
  if (!hasPermission(member, "support.manage")) redirect("/");
  const queue = await getDeveloperSupportQueue(member);
  return <DeveloperSupportQueue queue={queue} />;
}
