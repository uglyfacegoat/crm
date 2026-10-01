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
import { createPortal } from "react-dom";
import { completeTaskAction } from "@/app/(workspace)/tasks/actions";
import { TaskManagementDialogs } from "@/components/tasks/task-management-dialogs";
import { OrderPicker } from "@/components/orders/order-form-parts";
import { Avatar } from "@/components/ui/avatar";
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
  dateFrom: string;
  dateTo: string;
};

const defaultFilters: TaskFilters = {
  priority: "all",
  source: "all",
  assignee: "",
  dateFrom: "",
  dateTo: "",
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
  timeZone: string,
) {
  if (filters.priority !== "all" && task.priority !== filters.priority)
    return false;
  if (filters.source !== "all" && task.source !== filters.source) return false;
  if (filters.assignee && task.assignedMemberId !== filters.assignee)
    return false;
  if (filters.dateFrom || filters.dateTo) {
    if (!task.dueAt) return false;
    const dueDate = new Date(task.dueAt).toLocaleDateString("sv-SE", { timeZone });
    if (filters.dateFrom && dueDate < filters.dateFrom) return false;
    if (filters.dateTo && dueDate > filters.dateTo) return false;
  }
  return matchesSearchText(query, [
    task.title,
    task.description,
    task.meta,
    task.assigneeName,
  ]);
}

export function TasksWorkspace({
  snapshot,
  canWrite,
  generatedAt,
  focusedOrderId,
  preview = false,
}: {
  snapshot: TaskSnapshot;
  canWrite: boolean;
  generatedAt: string;
  focusedOrderId?: string | null;
  preview?: boolean;
}) {
  const [tasks, setTasks] = useState(snapshot.tasks);
  const [allTotal, setAllTotal] = useState(snapshot.tasksTotal);
  const [allPage, setAllPage] = useState(0);
  const [allLoading, setAllLoading] = useState(false);
  const [allError, setAllError] = useState("");
  const [allRefreshKey, setAllRefreshKey] = useState(0);
  const [myTasks, setMyTasks] = useState(snapshot.myTasks);
  const [mineTotal, setMineTotal] = useState(snapshot.myTasksTotal);
  const [minePage, setMinePage] = useState(0);
  const [mineLoading, setMineLoading] = useState(false);
  const [mineError, setMineError] = useState("");
  const [mineRefreshKey, setMineRefreshKey] = useState(0);
  const [strandedTasks, setStrandedTasks] = useState(snapshot.strandedTasks);
  const [strandedTotal, setStrandedTotal] = useState(snapshot.strandedTotal);
  const [strandedPage, setStrandedPage] = useState(0);
  const [strandedLoading, setStrandedLoading] = useState(false);
  const [strandedError, setStrandedError] = useState("");
  const [strandedRefreshKey, setStrandedRefreshKey] = useState(0);
  const [activeTab, setActiveTab] = useState<"all" | "mine" | "reassign" | "completed">(
    "all",
  );
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(defaultFilters);
  const [draftFilters, setDraftFilters] = useState(defaultFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [menuTaskId, setMenuTaskId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
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

  useEffect(() => {
    if (activeTab !== "all" || preview) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setAllLoading(true);
      setAllError("");
      try {
        const params = new URLSearchParams({ q: query.trim(), priority: filters.priority,
          source: filters.source, assignee: filters.assignee, dateFrom: filters.dateFrom,
          dateTo: filters.dateTo, order: focusedOrderId || "", page: String(allPage) });
        const response = await fetch(`/api/v1/tasks/list?${params}`, { signal: controller.signal, cache: "no-store" });
        const result = await response.json() as { data?: { tasks: TaskCard[]; total: number }; error?: { message?: string } };
        if (!response.ok || !result.data) throw new Error(result.error?.message || "Не удалось загрузить задачи.");
        if (controller.signal.aborted) return;
        const data = result.data;
        setAllTotal(data.total);
        if (allPage === 0) setTasks(data.tasks);
        else setTasks((current) => {
          const seen = new Set(current.map((task) => task.id));
          return [...current, ...data.tasks.filter((task) => !seen.has(task.id))];
        });
      } catch (error) {
        if (!controller.signal.aborted) setAllError(error instanceof Error ? error.message : "Не удалось загрузить задачи.");
      } finally {
        if (!controller.signal.aborted) setAllLoading(false);
      }
    }, query ? 220 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [activeTab, preview, query, filters, focusedOrderId, allPage, allRefreshKey]);
  useEffect(() => {
    if (activeTab !== "reassign" || preview || !canWrite) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setStrandedLoading(true);
      setStrandedError("");
      try {
        const params = new URLSearchParams({ q: query.trim(), priority: filters.priority,
          source: filters.source, assignee: filters.assignee, dateFrom: filters.dateFrom,
          dateTo: filters.dateTo, order: focusedOrderId || "", page: String(strandedPage) });
        const response = await fetch(`/api/v1/tasks/stranded?${params}`, { signal: controller.signal, cache: "no-store" });
        const result = await response.json() as { data?: { tasks: TaskCard[]; total: number }; error?: { message?: string } };
        if (!response.ok || !result.data) throw new Error(result.error?.message || "Не удалось загрузить задачи.");
        if (controller.signal.aborted) return;
        const data = result.data;
        setStrandedTotal(data.total);
        if (strandedPage === 0) setStrandedTasks(data.tasks);
        else setStrandedTasks((current) => {
          const seen = new Set(current.map((task) => task.id));
          return [...current, ...data.tasks.filter((task) => !seen.has(task.id))];
        });
      } catch (error) {
        if (!controller.signal.aborted) setStrandedError(error instanceof Error ? error.message : "Не удалось загрузить задачи.");
      } finally {
        if (!controller.signal.aborted) setStrandedLoading(false);
      }
    }, query ? 220 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [activeTab, preview, canWrite, query, filters, focusedOrderId, strandedPage, strandedRefreshKey]);
  const compactDate = new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: snapshot.timeZone,
  }).format(generatedDate);

  useEffect(() => {
    if (activeTab !== "mine" || preview) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setMineLoading(true);
      setMineError("");
      try {
        const params = new URLSearchParams({ q: query.trim(), priority: filters.priority,
          source: filters.source, assignee: filters.assignee, dateFrom: filters.dateFrom,
          dateTo: filters.dateTo, order: focusedOrderId || "", page: String(minePage) });
        const response = await fetch(`/api/v1/tasks/mine?${params}`, { signal: controller.signal, cache: "no-store" });
        const result = await response.json() as { data?: { tasks: TaskCard[]; total: number }; error?: { message?: string } };
        if (!response.ok || !result.data) throw new Error(result.error?.message || "Не удалось загрузить задачи.");
        if (controller.signal.aborted) return;
        const data = result.data;
        setMineTotal(data.total);
        if (minePage === 0) setMyTasks(data.tasks);
        else setMyTasks((current) => {
          const seen = new Set(current.map((task) => task.id));
          return [...current, ...data.tasks.filter((task) => !seen.has(task.id))];
        });
      } catch (error) {
        if (!controller.signal.aborted) setMineError(error instanceof Error ? error.message : "Не удалось загрузить задачи.");
      } finally {
        if (!controller.signal.aborted) setMineLoading(false);
      }
    }, query ? 220 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [activeTab, preview, query, filters, focusedOrderId, minePage, mineRefreshKey]);

  useEffect(() => {
    if (!menuTaskId) return;
    const close = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        (event.target.closest(`[data-task-menu-root="${menuTaskId}"]`) ||
          event.target.closest("[data-task-menu-portal]"))
      )
        return;
      setMenuTaskId(null);
    };
    const closeOnScroll = () => setMenuTaskId(null);
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuTaskId(null); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("resize", closeOnScroll);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("scroll", closeOnScroll, true);
      window.removeEventListener("resize", closeOnScroll);
    };
  }, [menuTaskId]);

  function toggleTaskMenu(taskId: string | null, anchor?: HTMLElement) {
    if (!taskId || !anchor) {
      setMenuTaskId(null);
      return;
    }
    const bounds = anchor.getBoundingClientRect();
    const menuWidth = 170;
    const menuHeight = 125;
    const top = bounds.bottom + menuHeight + 8 <= window.innerHeight
      ? bounds.bottom + 6
      : Math.max(8, bounds.top - menuHeight - 6);
    const left = Math.max(8, Math.min(bounds.right - menuWidth, window.innerWidth - menuWidth - 8));
    setMenuPosition({ top, left });
    setMenuTaskId(taskId);
  }

  const activeFilterCount = [
    filters.priority !== "all",
    filters.source !== "all",
    Boolean(filters.assignee),
    Boolean(filters.dateFrom),
    Boolean(filters.dateTo),
  ].filter(Boolean).length;

  const visibleTasks = useMemo(
    () =>
      activeTab === "all" && !preview ? ((allLoading || allError) && allPage === 0 ? [] : tasks)
        : activeTab === "mine" && !preview ? ((mineLoading || mineError) && minePage === 0 ? [] : myTasks)
        : activeTab === "reassign" && !preview ? ((strandedLoading || strandedError) && strandedPage === 0 ? [] : strandedTasks)
        : (activeTab === "mine" ? myTasks : activeTab === "reassign" ? strandedTasks : tasks).filter(
          (task) => matchesFilters(task, filters, query, snapshot.timeZone),
        ),
    [activeTab, allError, allLoading, allPage, filters, mineError, mineLoading, minePage, myTasks, preview, query, snapshot.timeZone, strandedError, strandedLoading, strandedPage, strandedTasks, tasks],
  );

  const visibleCompleted = useMemo(
    () =>
      snapshot.completedTasks.filter((task) =>
        matchesFilters(task, filters, query, snapshot.timeZone),
      ),
    [filters, query, snapshot.completedTasks, snapshot.timeZone],
  );

  const dialogTask = (activeTab === "mine" ? myTasks : activeTab === "reassign" ? strandedTasks : tasks).find((task) => task.id === dialogTaskId) ?? null;
  const menuTask = (activeTab === "completed" ? visibleCompleted : visibleTasks).find((task) => task.id === menuTaskId) ?? null;

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
    const previousAllTotal = allTotal;
    const previousMine = myTasks;
    const previousMineTotal = mineTotal;
    const previousStranded = strandedTasks;
    const previousStrandedTotal = strandedTotal;
    setPendingTaskId(task.id);
    setMessage(null);
    setTasks((current) => current.filter((entry) => entry.id !== task.id));
    if (tasks.some((entry) => entry.id === task.id)) setAllTotal((current) => Math.max(0, current - 1));
    setMyTasks((current) => current.filter((entry) => entry.id !== task.id));
    if (myTasks.some((entry) => entry.id === task.id)) setMineTotal((current) => Math.max(0, current - 1));
    setStrandedTasks((current) => current.filter((entry) => entry.id !== task.id));
    if (strandedTasks.some((entry) => entry.id === task.id)) setStrandedTotal((current) => Math.max(0, current - 1));
    startTransition(async () => {
      const result = await completeTaskAction(task.id, task.version);
      if (result.status === "error") {
        setTasks(previous);
        setAllTotal(previousAllTotal);
        setMyTasks(previousMine);
        setMineTotal(previousMineTotal);
        setStrandedTasks(previousStranded);
        setStrandedTotal(previousStrandedTotal);
        setMessage(result.message);
      } else {
        router.refresh();
      }
      setPendingTaskId(null);
    });
  }

  const tabCounts = {
    all: allTotal,
    mine: mineTotal,
    reassign: strandedTotal,
    completed: snapshot.completedTasks.length,
  };
  const countSource = activeTab === "mine" ? myTasks : activeTab === "reassign" ? strandedTasks : tasks;
  const manualCount = countSource.filter((task) => task.source === "manual").length;
  const automaticCount = countSource.length - manualCount;

  return (
    <div className="tasks-workspace">
      {focusedOrderId ? <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-xs">
        <span>Задачи заказа {snapshot.orderOptions.find((order) => order.id === focusedOrderId)?.orderNumber ?? ""}</span>
        <Link href="/tasks" className="focus-ring font-semibold underline">Все задачи</Link>
      </div> : null}
      <div className={`tasks-view-tabs ${canWrite && tabCounts.reassign ? "tasks-view-tabs-has-attention" : ""}`} role="tablist" aria-label="Вид задач">
        {[
          ["all", "Все задачи"],
          ["mine", "Мои задачи"],
          ...(canWrite && (snapshot.strandedTotal || activeTab === "reassign") ? [["reassign", "Без исполнителя"]] : []),
          ["completed", "Последние выполненные"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={activeTab === value}
            onClick={() => { setActiveTab(value as typeof activeTab);
              if (value === "mine" && activeTab !== "mine" && !preview) setMineLoading(true);
              if (value === "all" && activeTab !== "all" && !preview) setAllLoading(true);
              if (value === "reassign" && activeTab !== "reassign" && !preview) setStrandedLoading(true); }}
          >
            {label} <span>{tabCounts[value as keyof typeof tabCounts]}</span>
          </button>
        ))}
        <time dateTime={generatedAt}>{pageDate}</time>
      </div>

      {activeTab === "reassign" ? <p role="status" className="mt-3 text-xs text-[var(--text-secondary)]">Ручные задачи без исполнителя или за отключённым сотрудником. Откройте задачу и назначьте действующего сотрудника.{preview ? "" : strandedLoading && strandedPage === 0 ? " Ищем задачи..." : strandedError && strandedPage === 0 ? " Не удалось показать задачи по текущему поиску." : ` Показаны ${strandedTasks.length} из ${strandedTotal} задач по текущему поиску.`}</p> : null}
      {activeTab === "all" && !preview ? <p role="status" className="mt-3 text-xs text-[var(--text-secondary)]">
        {allLoading && allPage === 0 ? "Ищем задачи..." : allError && allPage === 0
          ? "Не удалось показать задачи по текущему поиску."
          : `Показаны ${tasks.length} из ${allTotal} задач по текущему поиску.`}
      </p> : null}
      {activeTab === "mine" && !preview ? <p role="status" className="mt-3 text-xs text-[var(--text-secondary)]">
        {mineLoading && minePage === 0 ? "Ищем задачи..." : mineError && minePage === 0
          ? "Не удалось показать задачи по текущему поиску."
          : `Показаны ${myTasks.length} из ${mineTotal} задач по текущему поиску.`}
      </p> : null}

      <div className="tasks-search-row">
        <label>
          <Search />
          <input
            value={query}
            maxLength={200}
            onChange={(event) => { setQuery(event.target.value); setAllPage(0); setMinePage(0); setStrandedPage(0);
              if (activeTab === "all" && !preview) { setTasks([]); setAllLoading(true); setAllError(""); }
              if (activeTab === "mine" && !preview) { setMyTasks([]); setMineLoading(true); setMineError(""); }
              if (activeTab === "reassign" && !preview) { setStrandedTasks([]); setStrandedLoading(true); setStrandedError(""); } }}
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
        <small>{(activeTab === "mine" || activeTab === "all" || activeTab === "reassign") && !preview ? "Среди показанных · " : ""}Автоматических: {automaticCount} · ручных: {manualCount}</small>
      </div>

      {message ? (
        <p role="alert" className="tasks-error">
          {message}
        </p>
      ) : null}
      {activeTab === "mine" && mineError ? <p role="alert" className="tasks-error">{mineError}{" "}
        <button type="button" className="underline" onClick={() => { setMineLoading(true); setMineRefreshKey((value) => value + 1); }}>Повторить</button>
      </p> : null}
      {activeTab === "all" && allError ? <p role="alert" className="tasks-error">{allError}{" "}
        <button type="button" className="underline" onClick={() => { setAllLoading(true); setAllRefreshKey((value) => value + 1); }}>Повторить</button>
      </p> : null}
      {activeTab === "reassign" && strandedError ? <p role="alert" className="tasks-error">{strandedError}{" "}
        <button type="button" className="underline" onClick={() => { setStrandedLoading(true); setStrandedRefreshKey((value) => value + 1); }}>Повторить</button>
      </p> : null}

      <section className="tasks-queue" aria-label="Очередь задач">
        {activeTab === "completed" ? (
          <TaskGroup
            column="upcoming"
            title="Последние выполненные"
            tasks={visibleCompleted}
            canWrite={false}
            pendingTaskId={pendingTaskId}
            menuTaskId={menuTaskId}
            onMenu={toggleTaskMenu}
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
                onMenu={toggleTaskMenu}
                onComplete={complete}
                onDialog={openDialog}
              />
            ),
          )
        )}
      </section>
      {activeTab === "all" && !preview && !allError && tasks.length < allTotal ? <div className="mt-4 flex justify-center">
        <button type="button" className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-5 py-3 text-sm font-semibold"
          disabled={allLoading} onClick={() => { setAllLoading(true); setAllPage((value) => value + 1); }}>
          {allLoading ? "Загружаем..." : `Показать ещё · ${tasks.length} из ${allTotal}`}
        </button>
      </div> : null}
      {activeTab === "mine" && !preview && !mineError && myTasks.length < mineTotal ? <div className="mt-4 flex justify-center">
        <button type="button" className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-5 py-3 text-sm font-semibold"
          disabled={mineLoading} onClick={() => { setMineLoading(true); setMinePage((value) => value + 1); }}>
          {mineLoading ? "Загружаем..." : `Показать ещё · ${myTasks.length} из ${mineTotal}`}
        </button>
      </div> : null}
      {activeTab === "reassign" && !preview && !strandedError && strandedTasks.length < strandedTotal ? <div className="mt-4 flex justify-center">
        <button type="button" className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-5 py-3 text-sm font-semibold"
          disabled={strandedLoading} onClick={() => { setStrandedLoading(true); setStrandedPage((value) => value + 1); }}>
          {strandedLoading ? "Загружаем..." : `Показать ещё · ${strandedTasks.length} из ${strandedTotal}`}
        </button>
      </div> : null}

      <footer className="tasks-workspace-footer">
        <span>Автоматические напоминания обновляются при изменении выезда.</span>
        <time dateTime={generatedAt}>Данные обновлены · {compactDate}</time>
      </footer>

      {menuTask && menuPosition ? createPortal(
        <div data-task-menu-portal className="tasks-row-menu" role="menu" aria-label={`Действия с задачей ${menuTask.title}`} style={{ position: "fixed", top: menuPosition.top, left: menuPosition.left, right: "auto", zIndex: 100 }}>
          <button type="button" role="menuitem" onClick={() => openDialog(menuTask, "edit")}><Pencil /> Редактировать</button>
          <button type="button" role="menuitem" onClick={() => openDialog(menuTask, "history")}>История</button>
          <button type="button" role="menuitem" onClick={() => openDialog(menuTask, "cancel")}><Trash2 /> Отменить</button>
        </div>, document.body,
      ) : null}

      <Dialog
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Фильтры задач"
        description="Применяются к выбранному представлению очереди"
        bodyClassName="flex-1"
      >
        <div className="tasks-filter-dialog">
          <OrderPicker
            label="Исполнитель"
            value={draftFilters.assignee}
            onChange={(assignee) =>
              setDraftFilters((current) => ({ ...current, assignee }))
            }
            options={[{ value: "", label: "Все сотрудники" }, ...snapshot.assigneeOptions.map((assignee) => ({ value: assignee.id, label: assignee.displayName }))]}
            placeholder="Все сотрудники"
            searchPlaceholder="Имя или email"
            remoteUrl="/api/v1/tasks/options?type=assignees"
            pinnedValues={[""]}
          />
          <OrderPicker searchable={false}
            label="Приоритет"
            value={draftFilters.priority}
            onChange={(priority) =>
              setDraftFilters((current) => ({
                ...current,
                priority: priority as TaskFilters["priority"],
              }))
            }
            options={[{ value: "all", label: "Все приоритеты" }, ...Object.entries(priorityLabels).map(([value, label]) => ({ value, label }))]}
            placeholder="Все приоритеты"
          />
          <fieldset>
            <legend>Тип задачи</legend>
            <div role="radiogroup" aria-label="Тип задачи">
              {[
                ["all", "Все"],
                ["manual", "Ручные"],
                ["visit_reminder", "Напоминания о выезде"],
                ["workflow", "Из воркфлоу"],
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
              <span>С даты</span>
              <input type="date" value={draftFilters.dateFrom} max={draftFilters.dateTo || undefined} onChange={(event) => setDraftFilters((current) => ({ ...current, dateFrom: event.target.value }))} />
            </label>
            <label>
              <span>По дату</span>
              <input type="date" value={draftFilters.dateTo} min={draftFilters.dateFrom || undefined} onChange={(event) => setDraftFilters((current) => ({ ...current, dateTo: event.target.value }))} />
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
              setAllPage(0);
              setMinePage(0);
              setStrandedPage(0);
              if (activeTab === "all" && !preview) { setTasks([]); setAllLoading(true); setAllError(""); }
              if (activeTab === "mine" && !preview) { setMyTasks([]); setMineLoading(true); setMineError(""); }
              if (activeTab === "reassign" && !preview) { setStrandedTasks([]); setStrandedLoading(true); setStrandedError(""); }
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
  onMenu: (id: string | null, anchor?: HTMLElement) => void;
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
                {!completed && task.needsAssignment ? <small role="status" className="font-semibold text-[var(--danger-ink)]">{task.assignedMemberId ? "Исполнитель отключён — переназначьте задачу" : "Нет исполнителя — назначьте сотрудника"}</small> : null}
                <em data-source={task.source}>
                  {task.source === "manual" ? "Ручная" : task.source === "workflow" ? "Воркфлоу" : "Напоминание о выезде"}
                </em>
              </div>
              <div className="tasks-row-owner">
                <span><Avatar name={task.assigneeName ?? task.assignee} size="sm" tone="violet"
                  src={task.assignedMemberId ? `/api/v1/members/${task.assignedMemberId}/avatar` : undefined} /></span>
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
                  onClick={(event) => onMenu(menuTaskId === task.id ? null : task.id, event.currentTarget)}
                  aria-label={`Меню задачи ${task.title}`}
                  aria-haspopup="menu"
                  aria-expanded={menuTaskId === task.id}
                >
                  <MoreVertical />
                </button>
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
