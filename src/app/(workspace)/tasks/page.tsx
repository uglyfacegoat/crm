import type { Metadata } from "next";
import { z } from "zod";
import { requirePagePermission } from "@/server/auth/page-access";
import { CreateTaskButton } from "@/components/tasks/create-task-dialog";
import { TasksWorkspace } from "@/components/tasks/tasks-workspace";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import { getPreviewTasks } from "@/server/tasks/preview";
import { listTasks } from "@/server/tasks/repository";

export const metadata: Metadata = { title: "Задачи" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const member = await requireOfficeSession();
  requirePagePermission(member, "tasks.read");
  const generatedAt = new Date().toISOString();
  const focusedOrderId = z.string().uuid().safeParse((await searchParams).order).data ?? null;
  const preview = getAuthMode() === "preview";
  const baseSnapshot = preview ? getPreviewTasks() : await listTasks(member, focusedOrderId, 50, 50);
  const snapshot = preview && focusedOrderId
    ? { ...baseSnapshot, tasks: baseSnapshot.tasks.filter((task) => task.relatedOrderId === focusedOrderId),
        tasksTotal: baseSnapshot.tasks.filter((task) => task.relatedOrderId === focusedOrderId).length,
        myTasks: baseSnapshot.myTasks.filter((task) => task.relatedOrderId === focusedOrderId),
        myTasksTotal: baseSnapshot.myTasks.filter((task) => task.relatedOrderId === focusedOrderId).length,
        strandedTasks: baseSnapshot.strandedTasks.filter((task) => task.relatedOrderId === focusedOrderId),
        strandedTotal: baseSnapshot.strandedTasks.filter((task) => task.relatedOrderId === focusedOrderId).length,
        completedTasks: baseSnapshot.completedTasks.filter((task) => task.relatedOrderId === focusedOrderId) }
    : baseSnapshot;
  const canWrite = hasPermission(member, "tasks.write");
  return (
    <div className="figma-report-page tasks-figma-page">
      <header className="tasks-figma-header">
        <p className="figma-report-kicker">Команда / Контроль исполнения</p>
        <h1 className="figma-report-title mt-[9px]">Задачи</h1>
        <p className="figma-report-description mt-[6px]">Следующие действия, напоминания и просроченные обязательства.</p>
        {canWrite ? <div className="tasks-create"><CreateTaskButton assigneeOptions={snapshot.assigneeOptions} orderOptions={snapshot.orderOptions} currentMemberId={snapshot.currentMemberId} organizationName={member.organizationName} initialRelatedOrderId={snapshot.orderOptions.some((order) => order.id === focusedOrderId) ? focusedOrderId ?? "" : ""} /></div> : null}
      </header>
      <TasksWorkspace
        key={[...snapshot.tasks, ...snapshot.myTasks, ...snapshot.strandedTasks].map((task) => `${task.id}:${task.version}`).join("|")}
        snapshot={snapshot}
        preview={preview}
        canWrite={canWrite}
        generatedAt={generatedAt}
        focusedOrderId={focusedOrderId}
      />
    </div>
  );
}
