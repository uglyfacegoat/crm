"use client";

import {
  CalendarDays,
  Check,
  Clock3,
  GripVertical,
  History,
  MoreVertical,
  Pencil,
  RotateCcw,
  RotateCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  completeTaskAction,
  rescheduleTaskAction,
} from "@/app/(workspace)/tasks/actions";
import { TaskManagementDialogs } from "@/components/tasks/task-management-dialogs";
import { TaskDistributionChart } from "@/components/tasks/task-distribution-chart";
import { Dialog } from "@/components/ui/dialog";
import { matchesSearchText } from "@/lib/search-normalization";
import type {
  TaskCard,
  TaskColumn,
  TaskPriority,
  TaskSnapshot,
} from "@/server/tasks/types";

const columns: { id: TaskColumn; title: string; tone: string }[] = [
  { id: "overdue", title: "Просроченные", tone: "var(--danger)" },
  { id: "today", title: "На сегодня", tone: "var(--warning)" },
  { id: "upcoming", title: "Ближайшие", tone: "var(--support)" },
  { id: "unscheduled", title: "Без срока", tone: "var(--muted-subtle)" },
];

const priorityLabels = {
  low: "Низкий",
  normal: "Обычный",
  high: "Высокий",
  critical: "Критичный",
} as const;
const completedAtFormatter = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Moscow",
});
type TaskSourceFilter = "all" | TaskCard["source"];
type TaskFilters = {
  priority: "all" | TaskPriority;
  source: TaskSourceFilter;
  assignee: string;
};
const defaultFilters: TaskFilters = {
  priority: "all",
  source: "all",
  assignee: "",
};

function taskMatchesFilters(
  task: TaskCard,
  filters: TaskFilters,
  query: string,
) {
  if (filters.priority !== "all" && task.priority !== filters.priority)
    return false;
  if (filters.source !== "all" && task.source !== filters.source) return false;
  if (filters.assignee && task.assignedMemberId !== filters.assignee)
    return false;

  return matchesSearchText(query, [
    task.title,
    task.meta,
    task.description,
    task.assigneeName,
  ]);
}

function FilterChoice<T extends string>({
  value,
  current,
  label,
  onChange,
}: {
  value: T;
  current: T;
  label: string;
  onChange: (value: T) => void;
}) {
  const selected = value === current;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onChange(value)}
      className={`focus-ring min-h-10 rounded-[11px] border px-3 text-left text-xs transition-colors ${selected ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "border-[var(--line)] text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"}`}
    >
      {label}
    </button>
  );
}

export function TasksWorkspace({
  snapshot,
  canWrite,
}: {
  snapshot: TaskSnapshot;
  canWrite: boolean;
}) {
  const [tasks, setTasks] = useState(snapshot.tasks);
  const [activeTab, setActiveTab] = useState<"all" | "mine" | "completed">(
    "all",
  );
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState(defaultFilters);
  const [draftFilters, setDraftFilters] = useState(defaultFilters);
  const [menuTaskId, setMenuTaskId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [dialogTaskId, setDialogTaskId] = useState<string | null>(null);
  const [dialogMode, setDialogMode] = useState<
    "edit" | "cancel" | "history" | null
  >(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const visibleTasks = useMemo(
    () =>
      tasks.filter(
        (task) =>
          (activeTab === "all" ||
            task.assignedMemberId === snapshot.currentMemberId) &&
          taskMatchesFilters(task, filters, query),
      ),
    [activeTab, filters, query, snapshot.currentMemberId, tasks],
  );
  const visibleCompletedTasks = useMemo(
    () =>
      snapshot.completedTasks.filter((task) =>
        taskMatchesFilters(task, filters, query),
      ),
    [filters, query, snapshot.completedTasks],
  );
  const activeFilterCount = [
    filters.priority !== "all",
    filters.source !== "all",
    Boolean(filters.assignee),
  ].filter(Boolean).length;
  const dialogTask = tasks.find((task) => task.id === dialogTaskId) ?? null;

  function resetFilters() {
    setQuery("");
    setFilters(defaultFilters);
    setDraftFilters(defaultFilters);
  }

  function openDialog(task: TaskCard, mode: "edit" | "cancel" | "history") {
    setMenuTaskId(null);
    setDialogTaskId(task.id);
    setDialogMode(mode);
  }

  function closeDialog() {
    setDialogTaskId(null);
    setDialogMode(null);
  }

  function persistMove(task: TaskCard, column: TaskColumn) {
    if (
      !canWrite ||
      task.source === "visit_reminder" ||
      task.column === column ||
      isPending
    )
      return;
    const previousTasks = tasks;
    setMessage(null);
    setMenuTaskId(null);
    setPendingTaskId(task.id);
    setTasks((current) =>
      current.map((entry) =>
        entry.id === task.id
          ? {
              ...entry,
              column,
              due:
                column === "unscheduled"
                  ? "Без срока"
                  : "Сохраняем новый срок…",
            }
          : entry,
      ),
    );
    startTransition(async () => {
      const result = await rescheduleTaskAction(task.id, task.version, column);
      if (result.status === "error") {
        setTasks(previousTasks);
        setMessage(result.message);
      } else {
        setTasks((current) =>
          current.map((entry) =>
            entry.id === task.id
              ? { ...entry, version: result.version ?? entry.version }
              : entry,
          ),
        );
        router.refresh();
      }
      setPendingTaskId(null);
    });
  }

  function complete(task: TaskCard) {
    if (!canWrite || isPending) return;
    const previousTasks = tasks;
    setMessage(null);
    setPendingTaskId(task.id);
    setTasks((current) => current.filter((entry) => entry.id !== task.id));
    startTransition(async () => {
      const result = await completeTaskAction(task.id, task.version);
      if (result.status === "error") {
        setTasks(previousTasks);
        setMessage(result.message);
      } else {
        router.refresh();
      }
      setPendingTaskId(null);
    });
  }

  return (
    <div className="mt-[clamp(1.5rem,1.1rem+0.8vw,2.25rem)] grid gap-4 2xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0">
        <div className="surface-panel mb-4 flex min-w-0 gap-2 overflow-x-auto p-2">
          <button
            onClick={() => setActiveTab("all")}
            className={`focus-ring h-11 shrink-0 rounded-[12px] px-4 text-xs font-medium ${activeTab === "all" ? "bg-[var(--accent)] text-[var(--on-accent)]" : "soft-button text-[var(--text-secondary)]"}`}
          >
            Все задачи <span className="ml-2 opacity-60">{tasks.length}</span>
          </button>
          <button
            onClick={() => setActiveTab("mine")}
            className={`focus-ring h-11 shrink-0 rounded-[12px] px-4 text-xs font-medium ${activeTab === "mine" ? "bg-[var(--accent)] text-[var(--on-accent)]" : "soft-button text-[var(--text-secondary)]"}`}
          >
            Мои задачи{" "}
            <span className="ml-2 opacity-60">
              {
                tasks.filter(
                  (task) => task.assignedMemberId === snapshot.currentMemberId,
                ).length
              }
            </span>
          </button>
          <button
            onClick={() => setActiveTab("completed")}
            className={`focus-ring h-11 shrink-0 rounded-[12px] px-4 text-xs font-medium ${activeTab === "completed" ? "bg-[var(--accent)] text-[var(--on-accent)]" : "soft-button text-[var(--text-secondary)]"}`}
          >
            Последние выполненные{" "}
            <span className="ml-2 opacity-60">
              {snapshot.completedTasks.length}
            </span>
          </button>
          <span className="ml-auto flex shrink-0 items-center gap-2 px-3 text-[10px] text-[var(--muted)]">
            <Sparkles className="size-3.5 text-[var(--accent)]" />
            Выезды создают напоминания автоматически
          </span>
        </div>
        <div className="surface-panel mb-4 flex min-w-0 gap-2 p-3">
          <label className="soft-button flex h-11 min-w-0 flex-1 items-center gap-2 rounded-[12px] px-3 sm:max-w-md">
            <Search className="size-4 shrink-0 text-[var(--muted)]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Задача, заказ, описание или сотрудник"
              className="min-w-0 flex-1 bg-transparent text-xs text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)]"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              setDraftFilters(filters);
              setFiltersOpen(true);
            }}
            className={`focus-ring flex h-11 shrink-0 items-center gap-2 rounded-[12px] border px-3 text-xs ${activeFilterCount ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "border-[var(--line)] text-[var(--text-secondary)]"}`}
          >
            <SlidersHorizontal className="size-4" />
            Фильтры
            {activeFilterCount ? (
              <span className="grid min-w-5 place-items-center rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--on-accent)]">
                {activeFilterCount}
              </span>
            ) : null}
          </button>
          {query.trim() || activeFilterCount ? (
            <button
              type="button"
              onClick={resetFilters}
              aria-label="Сбросить фильтры задач"
              className="focus-ring grid size-11 shrink-0 place-items-center rounded-[12px] border border-[var(--line)] text-[var(--text-secondary)]"
            >
              <RotateCcw className="size-3.5" />
            </button>
          ) : null}
        </div>
        {message ? (
          <p
            role="alert"
            className="mb-4 flex items-center gap-2 rounded-[12px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-xs text-[var(--danger-ink)]"
          >
            <RotateCw className="size-4" />
            {message}
          </p>
        ) : null}
        {activeTab === "completed" ? (
          <section className="surface-panel">
            <header className="border-b border-[var(--line)] p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-[var(--text)]">
                Последние выполненные задачи
              </h2>
              <p className="mt-1 text-xs text-[var(--muted)]">
                До 50 последних завершений с ответственным и связью с заказом.
              </p>
            </header>
            {visibleCompletedTasks.length ? (
              <div className="space-y-2 p-3">
                {visibleCompletedTasks.map((task) => (
                  <article
                    key={task.id}
                    className="grid gap-3 rounded-[12px] border border-[var(--line)] bg-[var(--surface-raised)] p-4 transition-[border-color,background-color] hover:border-[var(--line-strong)] hover:bg-[var(--surface-soft)] md:grid-cols-[minmax(0,1fr)_12rem_10rem] md:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--success-bg)] text-[var(--success)]">
                          <Check className="size-3.5" />
                        </span>
                        {task.relatedOrderId ? (
                          <Link
                            href={`/orders/${task.relatedOrderId}`}
                            className="focus-ring min-w-0 truncate rounded text-sm font-medium text-[var(--text)] hover:text-[var(--accent-ink)]"
                          >
                            {task.title}
                          </Link>
                        ) : (
                          <h3 className="min-w-0 truncate text-sm font-medium text-[var(--text)]">
                            {task.title}
                          </h3>
                        )}
                      </div>
                      <p className="mt-1 pl-9 text-[10px] text-[var(--muted)]">
                        {task.meta}
                      </p>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)]">
                      {task.assigneeName ?? "Без ответственного"}
                    </p>
                    <time
                      dateTime={task.completedAt}
                      className="text-xs text-[var(--success)] md:text-right"
                    >
                      {completedAtFormatter.format(new Date(task.completedAt))}
                    </time>
                  </article>
                ))}
              </div>
            ) : (
              <div className="grid min-h-64 place-items-center text-center">
                <div>
                  <Check className="mx-auto size-8 text-[var(--muted-subtle)]" />
                  <p className="mt-3 text-sm text-[var(--text-secondary)]">
                    Выполненных задач по выбранным условиям нет
                  </p>
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="focus-ring mt-4 rounded-[10px] bg-[var(--surface-soft)] px-3 py-2 text-xs text-[var(--text)]"
                  >
                    Сбросить фильтры
                  </button>
                </div>
              </div>
            )}
          </section>
        ) : null}
        <div
          className={`${activeTab === "completed" ? "hidden" : "grid"} gap-4 lg:grid-cols-2`}
        >
          {columns.map((column) => {
            const columnTasks = visibleTasks.filter(
              (task) => task.column === column.id,
            );
            return (
              <section
                key={column.id}
                onDragOver={(event) => {
                  if (canWrite) event.preventDefault();
                }}
                onDrop={(event) => {
                  const task = tasks.find(
                    (entry) =>
                      entry.id === event.dataTransfer.getData("text/task-id"),
                  );
                  if (task) persistMove(task, column.id);
                }}
                className="surface-panel flex h-[clamp(27rem,58vh,39rem)] min-w-0 flex-col"
              >
                <header className="flex shrink-0 items-center gap-2 border-b border-[var(--line)] px-4 py-3.5">
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: column.tone }}
                  />
                  <h2 className="text-sm font-semibold text-[var(--text)]">
                    {column.title}
                  </h2>
                  <span className="ml-auto rounded-full bg-[var(--surface-soft)] px-2 py-1 text-[10px] text-[var(--text-secondary)]">
                    {columnTasks.length}
                  </span>
                </header>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                  {columnTasks.map((task) => (
                    <article
                      key={task.id}
                      draggable={
                        canWrite && task.source === "manual" && !isPending
                      }
                      onDragStart={(event) =>
                        event.dataTransfer.setData("text/task-id", task.id)
                      }
                      className={`group relative rounded-[12px] border border-[var(--line)] bg-[var(--surface-raised)] p-3.5 transition-[border-color,background-color] hover:border-[var(--line-strong)] hover:bg-[var(--surface-soft)] ${pendingTaskId === task.id ? "opacity-55" : ""}`}
                    >
                      <div className="flex items-start gap-2">
                        {canWrite && task.source === "manual" ? (
                          <GripVertical className="mt-0.5 size-3.5 shrink-0 cursor-grab text-[var(--muted-subtle)] opacity-0 transition-opacity group-hover:opacity-100" />
                        ) : null}
                        <div className="min-w-0 flex-1">
                          {task.relatedOrderId ? (
                            <Link
                              href={`/orders/${task.relatedOrderId}`}
                              className="focus-ring rounded text-xs font-semibold leading-5 text-[var(--text)] hover:text-[var(--accent-ink)]"
                            >
                              {task.title}
                            </Link>
                          ) : (
                            <h3 className="text-xs font-semibold leading-5 text-[var(--text)]">
                              {task.title}
                            </h3>
                          )}
                          <p className="mt-1 text-[10px] text-[var(--muted)]">
                            {task.meta}
                          </p>
                          {task.description ? (
                            <p className="mt-2 line-clamp-2 text-[10px] leading-4 text-[var(--text-secondary)]">
                              {task.description}
                            </p>
                          ) : null}
                        </div>
                        {canWrite ? (
                          <button
                            type="button"
                            aria-label={`Действия с задачей ${task.title}`}
                            aria-expanded={menuTaskId === task.id}
                            onClick={() =>
                              setMenuTaskId((current) =>
                                current === task.id ? null : task.id,
                              )
                            }
                            className="focus-ring rounded-md p-1 text-[var(--muted)]"
                          >
                            <MoreVertical className="size-3.5" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openDialog(task, "history")}
                            aria-label={`История задачи ${task.title}`}
                            className="focus-ring rounded-md p-1 text-[var(--muted)]"
                          >
                            <History className="size-3.5" />
                          </button>
                        )}
                      </div>
                      {menuTaskId === task.id ? (
                        <div
                          className="absolute right-3 top-10 z-10 w-52 rounded-[12px] border border-[var(--line-strong)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow-panel)]"
                          role="menu"
                          aria-label="Действия с задачей"
                        >
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => openDialog(task, "edit")}
                            className="focus-ring flex min-h-9 w-full items-center gap-2 rounded-[8px] px-2.5 text-left text-[10px] text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
                          >
                            <Pencil className="size-3.5" />
                            Редактировать
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => openDialog(task, "history")}
                            className="focus-ring flex min-h-9 w-full items-center gap-2 rounded-[8px] px-2.5 text-left text-[10px] text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
                          >
                            <History className="size-3.5" />
                            История
                          </button>
                          {task.source === "manual" ? (
                            <>
                              <div className="my-1 border-t border-[var(--line)]" />
                              {columns
                                .filter((target) => target.id !== task.column)
                                .map((target) => (
                                  <button
                                    key={target.id}
                                    type="button"
                                    role="menuitem"
                                    onClick={() => persistMove(task, target.id)}
                                    className="focus-ring flex min-h-9 w-full items-center gap-2 rounded-[8px] px-2.5 text-left text-[10px] text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
                                  >
                                    <Clock3 className="size-3.5" />
                                    <span
                                      className="size-1.5 rounded-full"
                                      style={{ backgroundColor: target.tone }}
                                    />
                                    {target.title}
                                  </button>
                                ))}
                              <div className="my-1 border-t border-[var(--line)]" />
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => openDialog(task, "cancel")}
                                className="focus-ring flex min-h-9 w-full items-center gap-2 rounded-[8px] px-2.5 text-left text-[10px] text-[var(--danger-ink)] hover:bg-[var(--danger-bg)]"
                              >
                                <Trash2 className="size-3.5" />
                                Отменить задачу
                              </button>
                            </>
                          ) : (
                            <p className="border-t border-[var(--line)] px-2.5 py-2 text-[9px] leading-4 text-[var(--muted)]">
                              Срок и отмена управляются через выезд.
                            </p>
                          )}
                        </div>
                      ) : null}
                      <div className="mt-4 flex items-center gap-2">
                        <p
                          className="min-w-0 flex-1 truncate text-[10px]"
                          style={{ color: column.tone }}
                        >
                          {task.due}
                        </p>
                        {task.source === "visit_reminder" ? (
                          <span
                            title="Создано по выезду"
                            className="grid size-7 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-ink)]"
                          >
                            <Sparkles className="size-3" />
                          </span>
                        ) : null}
                        <span
                          title={`${task.assigneeName ?? "Без ответственного"} · приоритет: ${priorityLabels[task.priority]}`}
                          className="grid size-7 place-items-center rounded-full bg-[var(--surface-soft)] text-[9px] font-semibold text-[var(--text-secondary)]"
                        >
                          {task.assignee}
                        </span>
                        {canWrite ? (
                          <button
                            type="button"
                            onClick={() => complete(task)}
                            disabled={isPending}
                            aria-label={`Отметить задачу «${task.title}» выполненной`}
                            className="focus-ring grid size-7 place-items-center rounded-lg border border-[var(--line)] text-[var(--muted)] hover:border-[var(--success-border)] hover:text-[var(--success)] disabled:opacity-50"
                          >
                            <Check className="size-3.5" />
                          </button>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
                {!columnTasks.length ? (
                  <p className="grid flex-1 place-items-center px-4 py-8 text-center text-xs text-[var(--muted)]">
                    В этом разделе задач нет
                  </p>
                ) : null}
              </section>
            );
          })}
        </div>
      </div>

      <aside className="grid content-start gap-6 sm:grid-cols-2 2xl:grid-cols-1">
        <section className="surface-panel p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text)]">
                Распределение задач
              </h2>
              <p className="mt-1 text-[10px] text-[var(--muted)]">
                Структура открытой очереди по срокам
              </p>
            </div>
            <CalendarDays className="size-4 text-[var(--accent)]" />
          </div>
          <TaskDistributionChart tasks={tasks} />
        </section>
        <section className="surface-panel p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-[var(--text)]">Сводка</h2>
          <dl className="mt-4 space-y-3 text-xs">
            <div className="flex items-center gap-3">
              <dt className="flex-1 text-[var(--text-secondary)]">
                Открыто сейчас
              </dt>
              <dd className="font-display font-semibold text-[var(--text)]">
                {tasks.length}
              </dd>
            </div>
            <div className="flex items-center gap-3">
              <dt className="flex-1 text-[var(--text-secondary)]">
                Автоматических
              </dt>
              <dd className="font-display font-semibold text-[var(--accent-ink)]">
                {
                  tasks.filter((task) => task.source === "visit_reminder")
                    .length
                }
              </dd>
            </div>
            <div className="flex items-center gap-3 border-t border-[var(--line)] pt-3">
              <dt className="flex-1 text-[var(--text-secondary)]">
                Выполнено за 30 дней
              </dt>
              <dd className="font-display font-semibold text-[var(--success)]">
                {snapshot.completedLast30Days}
              </dd>
            </div>
          </dl>
        </section>
      </aside>
      <Dialog
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Фильтры задач"
        description="Отберите открытые и выполненные задачи по приоритету, происхождению и ответственному сотруднику."
      >
        <div className="space-y-7 p-5 sm:p-7">
          <fieldset>
            <legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">
              Приоритет
            </legend>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
              <FilterChoice
                value="all"
                current={draftFilters.priority}
                label="Любой приоритет"
                onChange={(priority) =>
                  setDraftFilters((current) => ({ ...current, priority }))
                }
              />
              {Object.entries(priorityLabels).map(([priority, label]) => (
                <FilterChoice
                  key={priority}
                  value={priority as TaskPriority}
                  current={draftFilters.priority}
                  label={label}
                  onChange={(selectedPriority) =>
                    setDraftFilters((current) => ({
                      ...current,
                      priority: selectedPriority,
                    }))
                  }
                />
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">
              Источник
            </legend>
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
              <FilterChoice
                value="all"
                current={draftFilters.source}
                label="Все задачи"
                onChange={(source) =>
                  setDraftFilters((current) => ({ ...current, source }))
                }
              />
              <FilterChoice
                value="manual"
                current={draftFilters.source}
                label="Ручные"
                onChange={(source) =>
                  setDraftFilters((current) => ({ ...current, source }))
                }
              />
              <FilterChoice
                value="visit_reminder"
                current={draftFilters.source}
                label="По выездам"
                onChange={(source) =>
                  setDraftFilters((current) => ({ ...current, source }))
                }
              />
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">
              Ответственный
            </legend>
            <div
              className="max-h-56 space-y-1 overflow-y-auto rounded-[13px] border border-[var(--line)] bg-[var(--surface-inset)] p-1.5"
              role="radiogroup"
            >
              <FilterChoice
                value=""
                current={draftFilters.assignee}
                label="Любой сотрудник"
                onChange={(assignee) =>
                  setDraftFilters((current) => ({ ...current, assignee }))
                }
              />
              {snapshot.assigneeOptions.map((assignee) => (
                <FilterChoice
                  key={assignee.id}
                  value={assignee.id}
                  current={draftFilters.assignee}
                  label={assignee.displayName}
                  onChange={(selectedAssignee) =>
                    setDraftFilters((current) => ({
                      ...current,
                      assignee: selectedAssignee,
                    }))
                  }
                />
              ))}
            </div>
          </fieldset>
        </div>
        <footer className="sticky bottom-0 mt-auto grid shrink-0 grid-cols-[auto_minmax(0,1fr)] gap-2 border-t border-[var(--line)] bg-[var(--surface)] p-4 sm:p-5">
          <button
            type="button"
            onClick={() => setDraftFilters(defaultFilters)}
            className="focus-ring h-11 rounded-[12px] border border-[var(--line)] px-4 text-xs text-[var(--text-secondary)]"
          >
            <RotateCcw className="mr-2 inline size-3.5" />
            Очистить
          </button>
          <button
            type="button"
            onClick={() => {
              setFilters(draftFilters);
              setFiltersOpen(false);
            }}
            className="focus-ring h-11 rounded-[12px] bg-[var(--accent)] px-4 text-xs font-semibold text-[var(--on-accent)]"
          >
            Показать задачи
          </button>
        </footer>
      </Dialog>
      <TaskManagementDialogs
        task={dialogTask}
        mode={dialogMode}
        assigneeOptions={snapshot.assigneeOptions}
        timeZone={snapshot.timeZone}
        onClose={closeDialog}
      />
    </div>
  );
}
