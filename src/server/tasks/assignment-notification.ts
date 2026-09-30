import type postgres from "postgres";

export async function notifyTaskAssignee(transaction: postgres.TransactionSql, input: {
  organizationId: string;
  taskId: string;
  assigneeId: string | null;
  title: string;
  version: number;
}) {
  if (!input.assigneeId) return;
  await transaction`INSERT INTO notifications (
      organization_id, recipient_member_id, kind, severity, title, body,
      source_type, source_id, target_type, target_id, event_key, occurred_at
    ) VALUES (
      ${input.organizationId}, ${input.assigneeId}, 'task_assigned', 'info',
      'Вам назначена задача', ${input.title}, 'task', ${input.taskId},
      'task', ${input.taskId}, ${`task_assigned:${input.taskId}:${input.version}`}, now()
    ) ON CONFLICT (organization_id, recipient_member_id, event_key) DO NOTHING`;
}

export async function resolveTaskAssignmentNotification(transaction: postgres.TransactionSql, organizationId: string, taskId: string) {
  await transaction`UPDATE notifications SET resolved_at = now(), updated_at = now()
    WHERE organization_id = ${organizationId} AND source_type = 'task' AND source_id = ${taskId}
      AND kind = 'task_assigned' AND resolved_at IS NULL`;
}
