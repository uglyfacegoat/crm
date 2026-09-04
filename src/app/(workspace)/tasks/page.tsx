import type { Metadata } from "next";
import { CreateTaskButton } from "@/components/tasks/create-task-dialog";
import { TasksWorkspace } from "@/components/tasks/tasks-workspace";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import { getPreviewTasks } from "@/server/tasks/preview";
import { listTasks } from "@/server/tasks/repository";

export const metadata: Metadata = { title: "Задачи" };

export default async function TasksPage() {
  const member = await requireOfficeSession();
  const snapshot = getAuthMode() === "preview" ? getPreviewTasks() : await listTasks(member);
  const canWrite = hasPermission(member, "tasks.write");
  return (
    <div>
      <PageHeading eyebrow="Контроль исполнения" title="Задачи" description="Следующие действия, напоминания и просроченные обязательства." action={canWrite ? <CreateTaskButton assigneeOptions={snapshot.assigneeOptions} currentMemberId={snapshot.currentMemberId} /> : undefined} />
      <TasksWorkspace key={snapshot.tasks.map((task) => `${task.id}:${task.version}`).join("|")} snapshot={snapshot} canWrite={canWrite} />
    </div>
  );
}
