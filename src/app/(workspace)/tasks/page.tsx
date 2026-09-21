import type { Metadata } from "next";
import { CreateTaskButton } from "@/components/tasks/create-task-dialog";
import { TasksWorkspace } from "@/components/tasks/tasks-workspace";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import { getPreviewTasks } from "@/server/tasks/preview";
import { listTasks } from "@/server/tasks/repository";

export const metadata: Metadata = { title: "Задачи" };

export default async function TasksPage() {
  const member = await requireOfficeSession();
  const generatedAt = new Date().toISOString();
  const snapshot = getAuthMode() === "preview" ? getPreviewTasks() : await listTasks(member);
  const canWrite = hasPermission(member, "tasks.write");
  return (
    <div className="figma-report-page tasks-figma-page">
      <header className="tasks-figma-header">
        <p className="figma-report-kicker">Команда / Контроль исполнения</p>
        <h1 className="figma-report-title mt-[9px]">Задачи</h1>
        <p className="figma-report-description mt-[6px]">Следующие действия, напоминания и просроченные обязательства.</p>
        {canWrite ? <div className="tasks-create"><CreateTaskButton assigneeOptions={snapshot.assigneeOptions} orderOptions={snapshot.orderOptions} currentMemberId={snapshot.currentMemberId} /></div> : null}
      </header>
      <TasksWorkspace
        key={snapshot.tasks.map((task) => `${task.id}:${task.version}`).join("|")}
        snapshot={snapshot}
        canWrite={canWrite}
        generatedAt={generatedAt}
      />
    </div>
  );
}
