export const taskColumns = ["overdue", "today", "upcoming", "unscheduled"] as const;
export type TaskColumn = (typeof taskColumns)[number];

export const taskPriorities = ["low", "normal", "high", "critical"] as const;
export type TaskPriority = (typeof taskPriorities)[number];

export type TaskCard = {
  id: string;
  title: string;
  description: string | null;
  meta: string;
  due: string;
  dueAt: string | null;
  assignee: string;
  assignedMemberId: string | null;
  assigneeName: string | null;
  column: TaskColumn;
  priority: TaskPriority;
  source: "manual" | "visit_reminder";
  relatedOrderId: string | null;
  version: number;
};

export type CompletedTaskCard = TaskCard & {
  completedAt: string;
};

export type TaskAssigneeOption = {
  id: string;
  displayName: string;
  role: "admin" | "dispatcher" | "manager" | "accountant" | "master";
};

export type TaskOrderOption = {
  id: string;
  orderNumber: string;
  clientName: string;
};

export type TaskHistoryEvent = {
  id: string;
  eventType: "created" | "updated" | "rescheduled" | "reassigned" | "completed" | "cancelled";
  actorName: string | null;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
  reason: string | null;
  createdAt: string;
};

export type TaskHistoryFeed = {
  events: TaskHistoryEvent[];
  truncated: boolean;
};

export type TaskSnapshot = {
  tasks: TaskCard[];
  completedTasks: CompletedTaskCard[];
  assigneeOptions: TaskAssigneeOption[];
  orderOptions: TaskOrderOption[];
  timeZone: string;
  currentMemberId: string;
  completedLast30Days: number;
};
