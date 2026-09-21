"use client";

import {
  Check,
  MoreVertical,
  Pencil,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { completeTaskAction } from "@/app/(workspace)/tasks/actions";
import { TaskManagementDialogs } from "@/components/tasks/task-management-dialogs";
import { Dialog } from "@/components/ui/dialog";
import { matchesSearchText } from "@/lib/search-normalization";
import type {
  TaskCard,
  TaskColumn,
  TaskPriority,
  TaskSnapshot,
} from "@/server/tasks/types";

type TaskFilters = {
  priority: "all" | TaskPriority;
  source: "all" | TaskCard["source"];
  assignee: string;
};

const defaultFilters: TaskFilters = {
  priority: "all",
  source: "all",
  assignee: "",
};

const columnLabels: Record<TaskColumn, string> = {
  overdue: "Просроченные",
  today: "На сегодня",
  upcoming: "Ближайшие",
  unscheduled: "Без срока",
};

const priorityLabels: Record<TaskPriority, string> = {
  low: "Низкий",
  normal: "Обычный",
  high: "Высокий",
  critical: "Критично",
};

function matchesFilters(
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
    task.description,
    task.meta,
    task.assigneeName,
  ]);
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="tasks-filter-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  );
}

export function TasksWorkspace({
  snapshot,
  canWrite,
  generatedAt,
}: {
  snapshot: TaskSnapshot;
  canWrite: boolean;
  generatedAt: string;
}) {
  const [tasks, setTasks] = useState(snapshot.tasks);
  const [activeTab, setActiveTab] = useState<"all" | "mine" | "completed">(
    "all",
  );
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(defaultFilters);
  const [draftFilters, setDraftFilters] = useState(defaultFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [menuTaskId, setMenuTaskId] = useState<string | null>(null);
  const [dialogTaskId, setDialogTaskId] = useState<string | null>(null);
  const [dialogMode, setDialogMode] = useState<
    "edit" | "cancel" | "history" | null
  >(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const generatedDate = new Date(generatedAt);
  const pageDate = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: snapshot.timeZone,
  }).format(generatedDate);
  const compactDate = new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: snapshot.timeZone,
  }).format(generatedDate);

  useEffect(() => {
    if (!menuTaskId) return;
    const close = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(`[data-task-menu-root="${menuTaskId}"]`)
      )
        return;
      setMenuTaskId(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuTaskId]);

  const activeFilterCount = [
    filters.priority !== "all",
    filters.source !== "all",
    Boolean(filters.assignee),
  ].filter(Boolean).length;

  const visibleTasks = useMemo(
    () =>
      tasks.filter(
        (task) =>
          (activeTab !== "mine" ||
            task.assignedMemberId === snapshot.currentMemberId) &&
          matchesFilters(task, filters, query),
      ),
    [activeTab, filters, query, snapshot.currentMemberId, tasks],
  );

  const visibleCompleted = useMemo(
    () =>
      snapshot.completedTasks.filter((task) =>
        matchesFilters(task, filters, query),
      ),
    [filters, query, snapshot.completedTasks],
  );

  const dialogTask = tasks.find((task) => task.id === dialogTaskId) ?? null;

  function openDialog(
    task: TaskCard,
    mode: "edit" | "cancel" | "history",
  ) {
    setMenuTaskId(null);
    setDialogTaskId(task.id);
    setDialogMode(mode);
  }

  function complete(task: TaskCard) {
    if (!canWrite || isPending) return;
    const previous = tasks;
    setPendingTaskId(task.id);
    setMessage(null);
    setTasks((current) => current.filter((entry) => entry.id !== task.id));
    startTransition(async () => {
      const result = await completeTaskAction(task.id, task.version);
      if (result.status === "error") {
        setTasks(previous);
        setMessage(result.message);
      } else {
        router.refresh();
      }
      setPendingTaskId(null);
    });
  }

  const tabCounts = {
    all: tasks.length,
    mine: tasks.filter(
      (task) => task.assignedMemberId === snapshot.currentMemberId,
    ).length,
    completed: snapshot.completedTasks.length,
  };

  return (
    <div className="tasks-workspace">
      <div className="tasks-view-tabs" role="tablist" aria-label="Вид задач">
        {[
          ["all", "Все задачи"],
          ["mine", "Мои задачи"],
          ["completed", "Последние выполненные"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={activeTab === value}
            onClick={() => setActiveTab(value as typeof activeTab)}
          >
            {label} <span>{tabCounts[value as keyof typeof tabCounts]}</span>
          </button>
        ))}
        <time dateTime={generatedAt}>{pageDate}</time>
      </div>

      <div className="tasks-search-row">
        <label>
          <Search />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Задача, заказ, описание или сотрудник"
          />
        </label>
        <button
          type="button"
          onClick={() => {
            setDraftFilters(filters);
            setFiltersOpen(true);
          }}
        >
          <SlidersHorizontal />
          <span>Фильтры</span>
          {activeFilterCount ? <i>{activeFilterCount}</i> : null}
        </button>
        <small>{tasks.length} автоматические · 1 ручная</small>
      </div>

      {message ? (
        <p role="alert" className="tasks-error">
          {message}
        </p>
      ) : null}

      <section className="tasks-queue" aria-label="Очередь задач">
        {activeTab === "completed" ? (
          <TaskGroup
            column="upcoming"
            title="Последние выполненные"
            tasks={visibleCompleted}
            canWrite={false}
            pendingTaskId={pendingTaskId}
            menuTaskId={menuTaskId}
            onMenu={setMenuTaskId}
            onComplete={complete}
            onDialog={openDialog}
            completed
          />
        ) : (
          (["overdue", "today", "upcoming", "unscheduled"] as const).map(
            (column) => (
              <TaskGroup
                key={column}
                column={column}
                title={columnLabels[column]}
                tasks={visibleTasks.filter((task) => task.column === column)}
                canWrite={canWrite}
                pendingTaskId={pendingTaskId}
                menuTaskId={menuTaskId}
                onMenu={setMenuTaskId}
                onComplete={complete}
                onDialog={openDialog}
              />
            ),
          )
        )}
      </section>

      <footer className="tasks-workspace-footer">
        <span>Автоматические напоминания обновляются при изменении выезда.</span>
        <time dateTime={generatedAt}>Данные обновлены · {compactDate}</time>
      </footer>

      <Dialog
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Фильтры задач"
        description="Применяются к выбранному представлению очереди"
      >
        <div className="tasks-filter-dialog">
          <FilterSelect
            label="Исполнитель"
            value={draftFilters.assignee}
            onChange={(assignee) =>
              setDraftFilters((current) => ({ ...current, assignee }))
            }
          >
            <option value="">Все сотрудники</option>
            {snapshot.assigneeOptions.map((assignee) => (
              <option key={assignee.id} value={assignee.id}>
                {assignee.displayName}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="Приоритет"
            value={draftFilters.priority}
            onChange={(priority) =>
              setDraftFilters((current) => ({
                ...current,
                priority: priority as TaskFilters["priority"],
              }))
            }
          >
            <option value="all">Все приоритеты</option>
            {Object.entries(priorityLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </FilterSelect>
          <fieldset>
            <legend>Тип задачи</legend>
            <div role="radiogroup" aria-label="Тип задачи">
              {[
                ["all", "Все"],
                ["manual", "Ручные"],
                ["visit_reminder", "Автоматические"],
              ].map(([value, label]) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={draftFilters.source === value}
                  key={value}
                  data-active={draftFilters.source === value}
                  onClick={() =>
                    setDraftFilters((current) => ({
                      ...current,
                      source: value as TaskFilters["source"],
                    }))
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="tasks-filter-dates">
            <label>
              <span>Период срока</span>
              <input type="date" aria-label="С даты" />
            </label>
            <label>
              <span>&nbsp;</span>
              <input type="date" aria-label="По дату" />
            </label>
          </div>
          <p>Задачи без срока доступны в отдельной группе очереди.</p>
        </div>
        <footer className="tasks-filter-actions">
          <button
            type="button"
            onClick={() => setDraftFilters(defaultFilters)}
          >
            <RotateCcw /> Сбросить
          </button>
          <button
            type="button"
            onClick={() => {
              setFilters(draftFilters);
              setFiltersOpen(false);
            }}
          >
            Применить
          </button>
        </footer>
      </Dialog>

      <TaskManagementDialogs
        task={dialogTask}
        mode={dialogMode}
        assigneeOptions={snapshot.assigneeOptions}
        timeZone={snapshot.timeZone}
        onClose={() => {
          setDialogTaskId(null);
          setDialogMode(null);
        }}
      />
    </div>
  );
}

function TaskGroup({
  column,
  title,
  tasks,
  canWrite,
  pendingTaskId,
  menuTaskId,
  onMenu,
  onComplete,
  onDialog,
  completed = false,
}: {
  column: TaskColumn;
  title: string;
  tasks: TaskCard[];
  canWrite: boolean;
  pendingTaskId: string | null;
  menuTaskId: string | null;
  onMenu: (id: string | null) => void;
  onComplete: (task: TaskCard) => void;
  onDialog: (task: TaskCard, mode: "edit" | "cancel" | "history") => void;
  completed?: boolean;
}) {
  const listId = completed ? "tasks-completed-list" : `tasks-${column}-list`;
  return (
    <section id={`tasks-${column}`} className="figma-report-panel tasks-group">
      <header>
        <div>
          <h2>{title}</h2>
          {column === "overdue" ? (
            <p>Срок уже прошёл. Действия и связи с заказом остаются под рукой.</p>
          ) : column === "upcoming" ? (
            <p>Даты напоминаний связаны с выездами.</p>
          ) : null}
        </div>
        <span>{tasks.length}</span>
      </header>
      {tasks.length ? (
        <div
          id={listId}
          className="tasks-group-list"
          role="region"
          aria-label={`Список задач: ${title}`}
          tabIndex={0}
        >
          {tasks.map((task) => (
            <article key={task.id} className="tasks-row">
              <div className="tasks-row-date">
                <strong>{task.due.match(/\d+/)?.[0] ?? "—"}</strong>
                <span>{task.due.replace(/^\d+\s*/, "") || "без срока"}</span>
                <em className="tasks-row-mobile-priority">
                  {priorityLabels[task.priority]}
                </em>
              </div>
              <div className="tasks-row-main">
                <h3>{task.title}</h3>
                <p>{task.meta}</p>
                {task.description ? <small>{task.description}</small> : null}
                <em data-source={task.source}>
                  {task.source === "manual" ? "Ручная" : "Автоматическая"}
                </em>
              </div>
              <div className="tasks-row-owner">
                <span>{task.assigneeName?.slice(0, 2).toUpperCase() ?? "LA"}</span>
                <strong>{task.assigneeName ?? task.assignee}</strong>
                <em>{priorityLabels[task.priority]}</em>
              </div>
              <div className="tasks-row-actions" data-task-menu-root={task.id}>
                {task.relatedOrderId ? (
                  <Link
                    href={`/orders/${task.relatedOrderId}`}
                    className="tasks-row-open"
                  >
                    Открыть
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="tasks-row-open"
                    onClick={() => onDialog(task, "edit")}
                  >
                    Открыть
                  </button>
                )}
                <button
                  type="button"
                  className="tasks-row-complete"
                  disabled={!canWrite || pendingTaskId === task.id}
                  onClick={() => onComplete(task)}
                  aria-label={`Завершить задачу ${task.title}`}
                >
                  <Check />
                </button>
                <button
                  type="button"
                  className="tasks-row-more"
                  onClick={() => onMenu(menuTaskId === task.id ? null : task.id)}
                  aria-label={`Меню задачи ${task.title}`}
                >
                  <MoreVertical />
                </button>
                {menuTaskId === task.id ? (
                  <div className="tasks-row-menu">
                    <button type="button" onClick={() => onDialog(task, "edit")}>
                      <Pencil /> Редактировать
                    </button>
                    <button type="button" onClick={() => onDialog(task, "history")}>
                      История
                    </button>
                    <button type="button" onClick={() => onDialog(task, "cancel")}>
                      <Trash2 /> Отменить
                    </button>
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="tasks-group-empty">
          {column === "today"
            ? "Задач со сроком на сегодня нет."
            : "В этой группе задач нет."}
        </p>
      )}
    </section>
  );
}
