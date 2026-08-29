import type { Metadata } from "next";
import { CreateTaskButton } from "@/components/tasks/create-task-dialog";
import { TasksWorkspace } from "@/components/tasks/tasks-workspace";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import { getPreviewTasks } from "@/server/tasks/preview";
import { listTasks } from "@/server/tasks/repository";

export const metadata: Metadata = { title: "Задачи" };

export default async function TasksPage() {
  const member = await requireSession();
  const snapshot = getAuthMode() === "preview" ? getPreviewTasks() : await listTasks(member);
  const canWrite = hasPermission(member.role, "tasks.write");
  return (
    <div>
      <PageHeading eyebrow="Контроль исполнения" title="Задачи" description="Следующие действия, напоминания и просроченные обязательства." action={canWrite ? <CreateTaskButton /> : undefined} />
      <TasksWorkspace key={snapshot.tasks.map((task) => `${task.id}:${task.version}`).join("|")} snapshot={snapshot} canWrite={canWrite} />
    </div>
  );
}
