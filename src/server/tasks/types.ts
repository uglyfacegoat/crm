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
  column: TaskColumn;
  priority: TaskPriority;
  source: "manual" | "visit_reminder";
  relatedOrderId: string | null;
  version: number;
};

export type TaskSnapshot = {
  tasks: TaskCard[];
  currentMemberId: string;
  completedLast30Days: number;
};
