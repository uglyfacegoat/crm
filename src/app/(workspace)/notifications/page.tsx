import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth/page-access";
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
  requirePagePermission(member, "notifications.read");
  if (!hasPermission(member, "notifications.read")) redirect("/");
  const snapshot = getAuthMode() === "preview"
    ? getPreviewNotifications(100, false)
    : await listNotifications(member, { limit: 100, unreadOnly: false });
  return (
    <div>
      <PageHeading eyebrow="Оперативный контроль" title="Центр уведомлений" description="Выезды, задачи, договоры, документы и изменения карт процессов. Push настраиваются в разделе «Настройки → Уведомления»." />
      <NotificationsWorkspace initialSnapshot={snapshot} />
    </div>
  );
}
