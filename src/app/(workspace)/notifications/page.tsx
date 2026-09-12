import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NotificationsWorkspace } from "@/components/notifications/notifications-workspace";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import { getPreviewNotifications } from "@/server/notifications/preview";
import { listNotifications } from "@/server/notifications/repository";

export const metadata: Metadata = { title: "Уведомления" };

export default async function NotificationsPage() {
  const member = await requireSession();
  if (!hasPermission(member, "notifications.read")) redirect("/");
  const snapshot = getAuthMode() === "preview"
    ? getPreviewNotifications(100, false)
    : await listNotifications(member, { limit: 100, unreadOnly: false });
  return (
    <div>
      <PageHeading eyebrow="Оперативный контроль" title="Центр уведомлений" description="События, которые требуют внимания: выезды, задачи, договоры и документы." />
      <NotificationsWorkspace initialSnapshot={snapshot} />
    </div>
  );
}
