import "server-only";
import { z } from "zod";
import { requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
import type { CancelTaskInput, CreateTaskInput, RescheduleTaskInput, TaskMutationInput, UpdateTaskInput } from "./schemas";
import type { CompletedTaskCard, TaskAssigneeOption, TaskCard, TaskColumn, TaskHistoryFeed, TaskSnapshot } from "./types";

const uuidSchema = z.string().uuid();
const taskRowSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  priority: z.enum(["low", "normal", "high", "critical"]),
  due_at: z.coerce.date().nullable(),
  assigned_member_id: uuidSchema.nullable(),
  assignee_name: z.string().nullable(),
  source: z.enum(["manual", "visit_reminder"]),
  related_order_id: uuidSchema.nullable(),
  order_number: z.string().nullable(),
  client_name: z.string().nullable(),
  version: z.number().int().positive(),
  timezone: z.string(),
});

const completedTaskRowSchema = taskRowSchema.extend({ completed_at: z.coerce.date() });

const assigneeRowSchema = z.object({
  id: uuidSchema,
  display_name: z.string(),
  role: z.enum(["admin", "dispatcher", "manager", "accountant", "master"]),
});

const taskHistoryRowSchema = z.object({
  id: uuidSchema,
  event_type: z.enum(["created", "updated", "rescheduled", "reassigned", "completed", "cancelled"]),
  actor_name: z.string().nullable(),
  before_state: z.record(z.string(), z.unknown()).nullable(),
  after_state: z.record(z.string(), z.unknown()),
  reason: z.string().nullable(),
  created_at: z.coerce.date(),
});

const mutableTaskRowSchema = z.object({
  title: z.string(),
  description: z.string().nullable(),
  priority: z.enum(["low", "normal", "high", "critical"]),
  due_at: z.coerce.date().nullable(),
  assigned_member_id: uuidSchema.nullable(),
  source: z.enum(["manual", "visit_reminder"]),
  status: z.enum(["open", "completed", "cancelled"]),
  version: z.number().int().positive(),
});

function taskState(task: z.infer<typeof mutableTaskRowSchema>) {
  return {
    title: task.title,
    description: task.description,
    priority: task.priority,
    dueAt: task.due_at?.toISOString() ?? null,
    assignedMemberId: task.assigned_member_id,
    status: task.status,
    source: task.source,
    version: task.version,
  };
}

export class TaskNotFoundError extends Error {
  constructor() { super("Task was not found."); this.name = "TaskNotFoundError"; }
}

export class TaskVersionConflictError extends Error {
  constructor() { super("Task was changed by another member."); this.name = "TaskVersionConflictError"; }
}

export class TaskAssigneeNotFoundError extends Error {
  constructor() { super("The selected active assignee was not found."); this.name = "TaskAssigneeNotFoundError"; }
}

export class TaskManagedByVisitError extends Error {
  constructor() { super("Visit reminder scheduling and cancellation are managed by the related visit."); this.name = "TaskManagedByVisitError"; }
}

function localDateKey(date: Date, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDateDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function taskColumn(dueAt: Date | null, timeZone: string, now: Date): TaskColumn {
  if (!dueAt) return "unscheduled";
  if (dueAt < now) return "overdue";
  return localDateKey(dueAt, timeZone) === localDateKey(now, timeZone) ? "today" : "upcoming";
}

function overdueDayLabel(days: number) {
  const mod100 = days % 100;
  const mod10 = days % 10;
  const unit = mod100 >= 11 && mod100 <= 14 ? "дней" : mod10 === 1 ? "день" : mod10 >= 2 && mod10 <= 4 ? "дня" : "дней";
  return `Просрочено на ${days} ${unit}`;
}

function dueLabel(dueAt: Date | null, timeZone: string, column: TaskColumn, now: Date) {
  if (!dueAt) return "Без срока";
  const dateKey = localDateKey(dueAt, timeZone);
  const today = localDateKey(now, timeZone);
  const time = new Intl.DateTimeFormat("ru-RU", { timeZone, hour: "2-digit", minute: "2-digit" }).format(dueAt);
  if (column === "overdue") {
    const days = Math.max(1, Math.ceil((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${dateKey}T12:00:00Z`)) / 86_400_000));
    return overdueDayLabel(days);
  }
  if (dateKey === today) return `Сегодня, ${time}`;
  if (dateKey === addDateDays(today, 1)) return `Завтра, ${time}`;
  return new Intl.DateTimeFormat("ru-RU", { timeZone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(dueAt);
}

function initials(name: string | null) {
  if (!name) return "—";
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase("ru-RU") ?? "").join("");
}

function mapTask(row: unknown, now: Date): TaskCard {
  const task = taskRowSchema.parse(row);
  const column = taskColumn(task.due_at, task.timezone, now);
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    meta: task.order_number ? `${task.order_number}${task.client_name ? ` · ${task.client_name}` : ""}` : "Внутренняя задача",
    due: dueLabel(task.due_at, task.timezone, column, now),
    dueAt: task.due_at?.toISOString() ?? null,
    assignee: initials(task.assignee_name),
    assignedMemberId: task.assigned_member_id,
    assigneeName: task.assignee_name,
    column,
    priority: task.priority,
    source: task.source,
    relatedOrderId: task.related_order_id,
    version: task.version,
  };
}

export async function listTasks(member: AuthenticatedMember): Promise<TaskSnapshot> {
  requirePermission(member, "tasks.read");
  const sql = getDatabase();
  const now = new Date();
  const [rows, completedRows, [summary], assigneeRows, [organization]] = await Promise.all([
    sql`SELECT tasks.id, tasks.title, tasks.description, tasks.priority, tasks.due_at, tasks.assigned_member_id,
      members.display_name AS assignee_name, tasks.source, tasks.related_order_id, orders.order_number,
      orders.client_name_snapshot AS client_name, tasks.version, organizations.timezone
      FROM tasks
      JOIN organizations ON organizations.id = tasks.organization_id
      LEFT JOIN organization_members members
        ON members.organization_id = tasks.organization_id AND members.id = tasks.assigned_member_id
      LEFT JOIN orders ON orders.organization_id = tasks.organization_id AND orders.id = tasks.related_order_id
      WHERE tasks.organization_id = ${member.organizationId} AND tasks.status = 'open'
      ORDER BY
        CASE
          WHEN tasks.due_at < now() THEN 0
          WHEN tasks.due_at < ((date_trunc('day', now() AT TIME ZONE organizations.timezone) + interval '1 day') AT TIME ZONE organizations.timezone) THEN 1
          WHEN tasks.due_at IS NULL THEN 2
          ELSE 3
        END,
        CASE WHEN tasks.due_at IS NULL THEN tasks.created_at END DESC,
        tasks.due_at ASC,
        tasks.created_at DESC
      LIMIT 500`,
    sql`SELECT tasks.id, tasks.title, tasks.description, tasks.priority, tasks.due_at, tasks.assigned_member_id,
      members.display_name AS assignee_name, tasks.source, tasks.related_order_id, orders.order_number,
      orders.client_name_snapshot AS client_name, tasks.version, organizations.timezone, tasks.completed_at
      FROM tasks
      JOIN organizations ON organizations.id = tasks.organization_id
      LEFT JOIN organization_members members
        ON members.organization_id = tasks.organization_id AND members.id = tasks.assigned_member_id
      LEFT JOIN orders ON orders.organization_id = tasks.organization_id AND orders.id = tasks.related_order_id
      WHERE tasks.organization_id = ${member.organizationId} AND tasks.status = 'completed'
      ORDER BY tasks.completed_at DESC
      LIMIT 50`,
    sql`SELECT count(*)::integer AS completed_count FROM tasks
      WHERE organization_id = ${member.organizationId} AND status = 'completed' AND completed_at >= now() - interval '30 days'`,
    sql`SELECT id, display_name, role FROM organization_members
      WHERE organization_id = ${member.organizationId} AND active
      ORDER BY display_name
      LIMIT 500`,
    sql`SELECT timezone FROM organizations WHERE id = ${member.organizationId}`,
  ]);
  if (!organization) throw new Error("The task organization was not found.");
  return {
    tasks: rows.map((row) => mapTask(row, now)),
    completedTasks: completedRows.map((row): CompletedTaskCard => {
      const completedTask = completedTaskRowSchema.parse(row);
      return { ...mapTask(row, now), completedAt: completedTask.completed_at.toISOString() };
    }),
    assigneeOptions: assigneeRows.map((row): TaskAssigneeOption => {
      const assignee = assigneeRowSchema.parse(row);
      return { id: assignee.id, displayName: assignee.display_name, role: assignee.role };
    }),
    timeZone: z.string().min(1).parse(organization.timezone),
    currentMemberId: member.memberId,
    completedLast30Days: z.number().int().nonnegative().parse(summary?.completed_count ?? 0),
  };
}

export async function createTask(member: AuthenticatedMember, input: CreateTaskInput) {
  requirePermission(member, "tasks.write");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    if (input.assignedMemberId) {
      const assignee = await transaction`SELECT id FROM organization_members
        WHERE organization_id = ${member.organizationId} AND id = ${input.assignedMemberId} AND active
        FOR KEY SHARE`;
      if (!assignee.length) throw new TaskAssigneeNotFoundError();
    }
    const [due] = input.localDate && input.localTime
      ? await transaction`SELECT ((${input.localDate} || ' ' || ${input.localTime})::timestamp AT TIME ZONE timezone) AS due_at
          FROM organizations WHERE id = ${member.organizationId}`
      : [{ due_at: null }];
    const insertedTasks = await transaction`INSERT INTO tasks (
      organization_id, title, description, priority, due_at, assigned_member_id, source,
      idempotency_key, created_by, updated_by
    ) VALUES (
      ${member.organizationId}, ${input.title}, ${input.description}, ${input.priority}, ${due?.due_at ?? null},
      ${input.assignedMemberId}, 'manual', ${input.idempotencyKey}, ${member.memberId}, ${member.memberId}
    ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING
      RETURNING id`;
    if (!insertedTasks.length) {
      const [existingTask] = await transaction`SELECT id FROM tasks
        WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
      if (!existingTask) throw new Error("Idempotent task creation could not resolve the existing task.");
      return uuidSchema.parse(existingTask.id);
    }
    const [task] = insertedTasks;
    const taskId = uuidSchema.parse(task.id);
    const createdState = {
      title: input.title,
      description: input.description,
      priority: input.priority,
      dueAt: due?.due_at ?? null,
      assignedMemberId: input.assignedMemberId,
      status: "open",
      source: "manual",
      version: 1,
    };
    await transaction`INSERT INTO task_events (organization_id, task_id, actor_id, event_type, after_state)
      VALUES (${member.organizationId}, ${taskId}, ${member.memberId}, 'created', ${transaction.json(createdState)})`;
    await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'task.create', 'task', ${taskId},
        ${transaction.json(createdState)})`;
    return taskId;
  });
}

export async function completeTask(member: AuthenticatedMember, input: TaskMutationInput) {
  requirePermission(member, "tasks.write");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [existingRow] = await transaction`SELECT title, description, priority, due_at, assigned_member_id, source, status, version
      FROM tasks WHERE organization_id = ${member.organizationId} AND id = ${input.taskId} FOR UPDATE`;
    if (!existingRow) throw new TaskNotFoundError();
    const existing = mutableTaskRowSchema.parse(existingRow);
    if (existing.version !== input.expectedVersion || existing.status !== "open") throw new TaskVersionConflictError();
    const [task] = await transaction`UPDATE tasks SET status = 'completed', completed_at = now(), completed_by = ${member.memberId},
      version = version + 1, updated_by = ${member.memberId}, updated_at = now()
      WHERE organization_id = ${member.organizationId} AND id = ${input.taskId} AND version = ${input.expectedVersion}
      RETURNING version`;
    if (!task) throw new TaskVersionConflictError();
    const version = z.number().int().positive().parse(task.version);
    const beforeState = taskState(existing);
    const afterState = { ...beforeState, status: "completed", version };
    if (existing.source === "manual") {
      await transaction`INSERT INTO task_events (organization_id, task_id, actor_id, event_type, before_state, after_state)
        VALUES (${member.organizationId}, ${input.taskId}, ${member.memberId}, 'completed', ${transaction.json(beforeState)}, ${transaction.json(afterState)})`;
    }
    await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'task.complete', 'task', ${input.taskId},
        ${transaction.json({ before: beforeState, after: afterState })})`;
    return version;
  });
}

export async function rescheduleTask(member: AuthenticatedMember, input: RescheduleTaskInput) {
  requirePermission(member, "tasks.write");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [existingRow] = await transaction`SELECT title, description, priority, due_at, assigned_member_id, source, status, version
      FROM tasks WHERE organization_id = ${member.organizationId} AND id = ${input.taskId} FOR UPDATE`;
    if (!existingRow) throw new TaskNotFoundError();
    const existing = mutableTaskRowSchema.parse(existingRow);
    if (existing.version !== input.expectedVersion || existing.status !== "open") throw new TaskVersionConflictError();
    if (existing.source === "visit_reminder") throw new TaskManagedByVisitError();
    const [schedule] = await transaction`SELECT CASE ${input.column}
      WHEN 'overdue' THEN ((now() AT TIME ZONE timezone)::date - 1 + time '17:00') AT TIME ZONE timezone
      WHEN 'today' THEN ((now() AT TIME ZONE timezone)::date + time '23:59') AT TIME ZONE timezone
      WHEN 'upcoming' THEN ((now() AT TIME ZONE timezone)::date + 1 + time '09:00') AT TIME ZONE timezone
      ELSE NULL END AS due_at
      FROM organizations WHERE id = ${member.organizationId}`;
    const [task] = await transaction`UPDATE tasks SET due_at = ${schedule?.due_at ?? null}, version = version + 1,
      updated_by = ${member.memberId}, updated_at = now()
      WHERE organization_id = ${member.organizationId} AND id = ${input.taskId} AND version = ${input.expectedVersion}
      RETURNING version`;
    if (!task) throw new TaskVersionConflictError();
    const version = z.number().int().positive().parse(task.version);
    const beforeState = taskState(existing);
    const dueAt = schedule?.due_at ? z.coerce.date().parse(schedule.due_at).toISOString() : null;
    const afterState = { ...beforeState, dueAt, version };
    await transaction`INSERT INTO task_events (organization_id, task_id, actor_id, event_type, before_state, after_state)
      VALUES (${member.organizationId}, ${input.taskId}, ${member.memberId}, 'rescheduled', ${transaction.json(beforeState)}, ${transaction.json(afterState)})`;
    await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'task.reschedule', 'task', ${input.taskId},
        ${transaction.json({ before: beforeState, after: afterState, column: input.column })})`;
    return version;
  });
}

export async function updateTask(member: AuthenticatedMember, input: UpdateTaskInput) {
  requirePermission(member, "tasks.write");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [existingRow] = await transaction`SELECT title, description, priority, due_at, assigned_member_id, source, status, version
      FROM tasks WHERE organization_id = ${member.organizationId} AND id = ${input.taskId} FOR UPDATE`;
    if (!existingRow) throw new TaskNotFoundError();
    const existing = mutableTaskRowSchema.parse(existingRow);
    if (existing.version !== input.expectedVersion || existing.status !== "open") throw new TaskVersionConflictError();

    if (input.assignedMemberId) {
      const assignee = await transaction`SELECT id FROM organization_members
        WHERE organization_id = ${member.organizationId} AND id = ${input.assignedMemberId} AND active
        FOR KEY SHARE`;
      if (!assignee.length) throw new TaskAssigneeNotFoundError();
    }
    const [schedule] = input.localDate && input.localTime
      ? await transaction`SELECT ((${input.localDate} || ' ' || ${input.localTime})::timestamp AT TIME ZONE timezone) AS due_at
          FROM organizations WHERE id = ${member.organizationId}`
      : [{ due_at: null }];
    const dueAt = schedule?.due_at ? z.coerce.date().parse(schedule.due_at) : null;
    if (existing.source === "visit_reminder") {
      const dueChanged = dueAt?.getTime() !== existing.due_at?.getTime();
      if (input.title !== existing.title || input.description !== existing.description || dueChanged) throw new TaskManagedByVisitError();
    }
    const unchanged = input.title === existing.title
      && input.description === existing.description
      && input.priority === existing.priority
      && input.assignedMemberId === existing.assigned_member_id
      && dueAt?.getTime() === existing.due_at?.getTime();
    if (unchanged) return existing.version;

    const beforeState = taskState(existing);
    const [updatedRow] = await transaction`UPDATE tasks SET
        title = ${input.title}, description = ${input.description}, priority = ${input.priority}, due_at = ${dueAt},
        assigned_member_id = ${input.assignedMemberId}, version = version + 1,
        updated_by = ${member.memberId}, updated_at = now()
      WHERE organization_id = ${member.organizationId} AND id = ${input.taskId} AND version = ${input.expectedVersion}
      RETURNING version`;
    if (!updatedRow) throw new TaskVersionConflictError();
    const version = z.number().int().positive().parse(updatedRow.version);
    const afterState = {
      ...beforeState,
      title: input.title,
      description: input.description,
      priority: input.priority,
      dueAt: dueAt?.toISOString() ?? null,
      assignedMemberId: input.assignedMemberId,
      version,
    };
    const onlyAssigneeChanged = beforeState.title === afterState.title
      && beforeState.description === afterState.description
      && beforeState.priority === afterState.priority
      && beforeState.dueAt === afterState.dueAt
      && beforeState.assignedMemberId !== afterState.assignedMemberId;
    const eventType = onlyAssigneeChanged ? "reassigned" : "updated";
    await transaction`INSERT INTO task_events (organization_id, task_id, actor_id, event_type, before_state, after_state)
      VALUES (${member.organizationId}, ${input.taskId}, ${member.memberId}, ${eventType},
        ${transaction.json(beforeState)}, ${transaction.json(afterState)})`;
    await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'task.update', 'task', ${input.taskId},
        ${transaction.json({ before: beforeState, after: afterState })})`;
    return version;
  });
}

export async function cancelTask(member: AuthenticatedMember, input: CancelTaskInput) {
  requirePermission(member, "tasks.write");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [existingRow] = await transaction`SELECT title, description, priority, due_at, assigned_member_id, source, status, version
      FROM tasks WHERE organization_id = ${member.organizationId} AND id = ${input.taskId} FOR UPDATE`;
    if (!existingRow) throw new TaskNotFoundError();
    const existing = mutableTaskRowSchema.parse(existingRow);
    if (existing.version !== input.expectedVersion || existing.status !== "open") throw new TaskVersionConflictError();
    if (existing.source === "visit_reminder") throw new TaskManagedByVisitError();

    const [updatedRow] = await transaction`UPDATE tasks SET status = 'cancelled', cancellation_reason = ${input.reason},
        cancelled_at = now(), cancelled_by = ${member.memberId}, version = version + 1,
        updated_by = ${member.memberId}, updated_at = now()
      WHERE organization_id = ${member.organizationId} AND id = ${input.taskId} AND version = ${input.expectedVersion}
      RETURNING version`;
    if (!updatedRow) throw new TaskVersionConflictError();
    const version = z.number().int().positive().parse(updatedRow.version);
    const beforeState = taskState(existing);
    const afterState = { ...beforeState, status: "cancelled", version };
    await transaction`INSERT INTO task_events (organization_id, task_id, actor_id, event_type, before_state, after_state, reason)
      VALUES (${member.organizationId}, ${input.taskId}, ${member.memberId}, 'cancelled',
        ${transaction.json(beforeState)}, ${transaction.json(afterState)}, ${input.reason})`;
    await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'task.cancel', 'task', ${input.taskId},
        ${transaction.json({ before: beforeState, after: afterState, reason: input.reason })})`;
    return version;
  });
}

export async function listTaskHistory(member: AuthenticatedMember, taskId: string): Promise<TaskHistoryFeed> {
  requirePermission(member, "tasks.read");
  const parsedTaskId = uuidSchema.parse(taskId);
  const sql = getDatabase();
  const task = await sql`SELECT id FROM tasks
    WHERE organization_id = ${member.organizationId} AND id = ${parsedTaskId}`;
  if (!task.length) throw new TaskNotFoundError();
  const rows = await sql`SELECT events.id, events.event_type, actors.display_name AS actor_name,
      events.before_state, events.after_state, events.reason, events.created_at
    FROM task_events events
    LEFT JOIN organization_members actors
      ON actors.organization_id = events.organization_id AND actors.id = events.actor_id
    WHERE events.organization_id = ${member.organizationId} AND events.task_id = ${parsedTaskId}
    ORDER BY events.created_at DESC, events.id DESC
    LIMIT 101`;
  return {
    events: rows.slice(0, 100).map((row) => {
      const event = taskHistoryRowSchema.parse(row);
      return {
        id: event.id,
        eventType: event.event_type,
        actorName: event.actor_name,
        beforeState: event.before_state,
        afterState: event.after_state,
        reason: event.reason,
        createdAt: event.created_at.toISOString(),
      };
    }),
    truncated: rows.length > 100,
  };
}
