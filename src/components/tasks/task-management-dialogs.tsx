"use client";

import { DateInput, TimeInput } from "@/components/ui/date-time-inputs";
import {
  AlertTriangle,
  Check,
  Clock3,
  History,
  LoaderCircle,
  UserRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useActionState,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import {
  cancelTaskAction,
  getTaskHistoryAction,
  updateTaskAction,
  type UpdateTaskState,
} from "@/app/(workspace)/tasks/actions";
import { Dialog } from "@/components/ui/dialog";
import type {
  TaskAssigneeOption,
  TaskCard,
  TaskHistoryEvent,
  TaskHistoryFeed,
} from "@/server/tasks/types";

const initialUpdateState: UpdateTaskState = {
  status: "idle",
  message: null,
  fieldErrors: {},
  taskId: null,
};
const roleLabels = {
  admin: "Администратор",
  dispatcher: "Диспетчер",
  manager: "Менеджер",
  accountant: "Бухгалтер",
  master: "Мастер",
} as const;
const priorityLabels = {
  low: "Низкий",
  normal: "Обычный",
  high: "Высокий",
  critical: "Критичный",
} as const;
const eventLabels = {
  created: "Задача создана",
  updated: "Задача изменена",
  rescheduled: "Изменён срок",
  reassigned: "Изменён ответственный",
  completed: "Задача выполнена",
  cancelled: "Задача отменена",
} as const;
const fieldClass =
  "focus-ring h-12 rounded-[12px] border border-[var(--line)] bg-[var(--surface-inset)] px-3.5 text-sm text-[var(--text)] outline-none disabled:cursor-not-allowed disabled:opacity-55";
const fieldLabelClass = "grid gap-2 text-[10px] text-[var(--text-secondary)]";

function deadlineParts(timestamp: string | null, timeZone: string) {
  if (!timestamp) return { date: "", time: "" };
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(timestamp))
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function FieldError({ errors }: { errors?: string[] }) {
  return errors?.length ? (
    <span className="text-[10px] text-[var(--danger-ink)]">{errors[0]}</span>
  ) : null;
}

function EditTaskForm({
  task,
  assigneeOptions,
  timeZone,
  onComplete,
}: {
  task: TaskCard;
  assigneeOptions: TaskAssigneeOption[];
  timeZone: string;
  onComplete: () => void;
}) {
  const [state, action, pending] = useActionState(
    updateTaskAction,
    initialUpdateState,
  );
  const router = useRouter();
  const deadline = useMemo(
    () => deadlineParts(task.dueAt, timeZone),
    [task.dueAt, timeZone],
  );
  const managedByVisit = task.source === "visit_reminder";
  useEffect(() => {
    if (state.status !== "success") return;
    router.refresh();
    const timeout = window.setTimeout(onComplete, 500);
    return () => window.clearTimeout(timeout);
  }, [onComplete, router, state.status]);

  return (
    <form action={action} className="flex flex-1 flex-col">
      <input type="hidden" name="taskId" value={task.id} />
      <input type="hidden" name="expectedVersion" value={task.version} />
      {managedByVisit ? (
        <>
          <input type="hidden" name="title" value={task.title} />
          <input
            type="hidden"
            name="description"
            value={task.description ?? ""}
          />
          <input type="hidden" name="localDate" value={deadline.date} />
          <input type="hidden" name="localTime" value={deadline.time} />
        </>
      ) : null}
      <div className="flex-1 space-y-5 p-5 sm:p-7">
        {managedByVisit ? (
          <p className="rounded-[12px] border border-[var(--support-strong)] bg-[var(--support-soft)] p-3 text-[10px] leading-4 text-[var(--support-strong)]">
            Эта задача синхронизирована с выездом. Здесь можно изменить
            ответственного и приоритет; дату и содержание меняйте в календаре
            выездов.
          </p>
        ) : null}
        <label className={fieldLabelClass}>
          <span>Название *</span>
          <input
            name={managedByVisit ? undefined : "title"}
            defaultValue={task.title}
            disabled={managedByVisit}
            required={!managedByVisit}
            minLength={2}
            maxLength={240}
            className={fieldClass}
          />
          <FieldError errors={state.fieldErrors.title} />
        </label>
        <label className={fieldLabelClass}>
          <span>Описание</span>
          <textarea
            name={managedByVisit ? undefined : "description"}
            defaultValue={task.description ?? ""}
            disabled={managedByVisit}
            maxLength={4000}
            rows={4}
            className="focus-ring resize-none rounded-[12px] border border-[var(--line)] bg-[var(--surface-inset)] p-3.5 text-sm leading-6 text-[var(--text)] outline-none disabled:cursor-not-allowed disabled:opacity-55"
          />
          <FieldError errors={state.fieldErrors.description} />
        </label>
        <label className={fieldLabelClass}>
          <span>Ответственный</span>
          <select
            name="assignedMemberId"
            defaultValue={task.assignedMemberId ?? ""}
            className={fieldClass}
          >
            <option value="">Без ответственного</option>
            {assigneeOptions.map((assignee) => (
              <option key={assignee.id} value={assignee.id}>
                {assignee.displayName} · {roleLabels[assignee.role]}
              </option>
            ))}
          </select>
          <FieldError errors={state.fieldErrors.assignedMemberId} />
        </label>
        <fieldset>
          <legend className="text-[10px] text-[var(--text-secondary)]">
            Приоритет
          </legend>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Object.entries(priorityLabels).map(([value, label]) => (
              <label
                key={value}
                className="focus-within:outline focus-within:outline-2 focus-within:outline-offset-[-2px] focus-within:outline-[var(--focus)]"
              >
                <input
                  type="radio"
                  name="priority"
                  value={value}
                  defaultChecked={task.priority === value}
                  className="peer sr-only"
                />
                <span className="grid min-h-11 cursor-pointer place-items-center rounded-[11px] border border-[var(--line)] text-[10px] text-[var(--text-secondary)] peer-checked:border-[var(--accent)] peer-checked:bg-[var(--accent-soft)] peer-checked:text-[var(--accent-ink)]">
                  {label}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset disabled={managedByVisit}>
          <legend className="text-[10px] text-[var(--text-secondary)]">
            Срок
          </legend>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-2 text-[10px] text-[var(--muted)]">
              <span>Дата</span>
              <DateInput
                name={managedByVisit ? undefined : "localDate"}
                defaultValue={deadline.date}
                className={fieldClass}
              />
              <FieldError errors={state.fieldErrors.localDate} />
            </label>
            <label className="grid gap-2 text-[10px] text-[var(--muted)]">
              <span>Время</span>
              <TimeInput
                name={managedByVisit ? undefined : "localTime"}
                defaultValue={deadline.time}
                className={fieldClass}
              />
              <FieldError errors={state.fieldErrors.localTime} />
            </label>
          </div>
        </fieldset>
        {state.message ? (
          <p
            role="status"
            className={`rounded-[12px] border p-3 text-xs ${state.status === "success" ? "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]" : "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-ink)]"}`}
          >
            {state.status === "success" ? (
              <Check className="mr-2 inline size-4" />
            ) : null}
            {state.message}
          </p>
        ) : null}
      </div>
      <footer className="sticky bottom-0 flex gap-2 border-t border-[var(--line)] bg-[var(--surface)] p-4 sm:px-7">
        <button
          type="button"
          onClick={onComplete}
          disabled={pending}
          className="focus-ring h-12 flex-1 rounded-[12px] border border-[var(--line)] text-xs text-[var(--text-secondary)]"
        >
          Закрыть
        </button>
        <button
          type="submit"
          disabled={pending || state.status === "success"}
          className="focus-ring flex h-12 flex-[1.4] items-center justify-center gap-2 rounded-[12px] bg-[var(--accent)] text-xs font-semibold text-[var(--on-accent)] disabled:opacity-65"
        >
          {pending ? (
            <>
              <LoaderCircle className="size-4 animate-spin" />
              Сохраняем…
            </>
          ) : (
            "Сохранить"
          )}
        </button>
      </footer>
    </form>
  );
}

function CancelTaskForm({
  task,
  onComplete,
}: {
  task: TaskCard;
  onComplete: () => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  function submit() {
    if (reason.trim().length < 3 || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await cancelTaskAction(task.id, task.version, reason);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      onComplete();
      router.refresh();
    });
  }
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 space-y-5 p-5 sm:p-7">
        <div className="flex gap-3 rounded-[14px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-4">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[var(--danger-ink)]" />
          <div>
            <p className="text-sm font-semibold text-[var(--text)]">
              {task.title}
            </p>
            <p className="mt-1 text-[10px] leading-4 text-[var(--danger-ink)]">
              Задача исчезнет с рабочей доски, но причина и история изменений
              сохранятся.
            </p>
          </div>
        </div>
        <label className={fieldLabelClass}>
          <span>Причина отмены *</span>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={1000}
            rows={5}
            autoFocus
            placeholder="Почему задача больше не должна выполняться"
            className="focus-ring resize-none rounded-[12px] border border-[var(--line)] bg-[var(--surface-inset)] p-3.5 text-sm leading-6 text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)]"
          />
        </label>
        {error ? (
          <p
            role="alert"
            className="rounded-[12px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-xs text-[var(--danger-ink)]"
          >
            {error}
          </p>
        ) : null}
      </div>
      <footer className="sticky bottom-0 flex gap-2 border-t border-[var(--line)] bg-[var(--surface)] p-4 sm:px-7">
        <button
          type="button"
          onClick={onComplete}
          disabled={pending}
          className="focus-ring h-12 flex-1 rounded-[12px] border border-[var(--line)] text-xs text-[var(--text-secondary)]"
        >
          Не отменять
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending || reason.trim().length < 3}
          className="focus-ring flex h-12 flex-[1.4] items-center justify-center gap-2 rounded-[12px] bg-[var(--danger)] text-xs font-semibold text-[var(--on-accent)] disabled:opacity-50"
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
          Отменить задачу
        </button>
      </footer>
    </div>
  );
}

function readableValue(
  field: string,
  value: unknown,
  assigneeOptions: TaskAssigneeOption[],
) {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "assignedMemberId")
    return (
      assigneeOptions.find((assignee) => assignee.id === value)?.displayName ??
      "Сотрудник удалён"
    );
  if (
    field === "priority" &&
    typeof value === "string" &&
    value in priorityLabels
  )
    return priorityLabels[value as keyof typeof priorityLabels];
  if (field === "dueAt" && typeof value === "string")
    return new Intl.DateTimeFormat("ru-RU", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));
  if (field === "status")
    return value === "open"
      ? "Открыта"
      : value === "completed"
        ? "Выполнена"
        : "Отменена";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function eventChanges(
  event: TaskHistoryEvent,
  assigneeOptions: TaskAssigneeOption[],
) {
  if (!event.beforeState) return [];
  const labels: Record<string, string> = {
    title: "Название",
    description: "Описание",
    priority: "Приоритет",
    dueAt: "Срок",
    assignedMemberId: "Ответственный",
    status: "Статус",
  };
  return Object.keys(labels)
    .filter((field) => event.beforeState?.[field] !== event.afterState?.[field])
    .map((field) => ({
      label: labels[field],
      before: readableValue(field, event.beforeState?.[field], assigneeOptions),
      after: readableValue(field, event.afterState?.[field], assigneeOptions),
    }));
}

function TaskHistory({
  task,
  assigneeOptions,
}: {
  task: TaskCard;
  assigneeOptions: TaskAssigneeOption[];
}) {
  const [feed, setFeed] = useState<TaskHistoryFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void getTaskHistoryAction(task.id).then((result) => {
      if (!active) return;
      if (result.status === "error") setError(result.message);
      else setFeed(result.feed);
    });
    return () => {
      active = false;
    };
  }, [task.id]);
  if (error)
    return (
      <p
        role="alert"
        className="m-5 rounded-[12px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-4 text-xs text-[var(--danger-ink)] sm:m-7"
      >
        {error}
      </p>
    );
  if (!feed)
    return (
      <div className="grid min-h-56 place-items-center text-xs text-[var(--muted)]">
        <LoaderCircle className="mr-2 inline size-4 animate-spin" />
        Загружаем историю…
      </div>
    );
  return (
    <div className="space-y-3 p-5 sm:p-7">
      {feed.events.map((event) => {
        const changes = eventChanges(event, assigneeOptions);
        return (
          <article
            key={event.id}
            className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-inset)] p-4"
          >
            <div className="flex items-start gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[var(--accent-soft)] text-[var(--accent-ink)]">
                {event.eventType === "reassigned" ? (
                  <UserRound className="size-4" />
                ) : event.eventType === "rescheduled" ? (
                  <Clock3 className="size-4" />
                ) : (
                  <History className="size-4" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-xs font-semibold text-[var(--text)]">
                  {eventLabels[event.eventType]}
                </h3>
                <p className="mt-1 text-[10px] text-[var(--muted)]">
                  {event.actorName ?? "Система"} ·{" "}
                  {new Intl.DateTimeFormat("ru-RU", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(event.createdAt))}
                </p>
              </div>
            </div>
            {event.reason ? (
              <p className="mt-3 rounded-[10px] bg-[var(--surface-soft)] p-3 text-[10px] leading-4 text-[var(--text-secondary)]">
                {event.reason}
              </p>
            ) : null}
            {changes.length ? (
              <dl className="mt-3 space-y-2 border-t border-[var(--line)] pt-3">
                {changes.map((change) => (
                  <div
                    key={change.label}
                    className="grid gap-1 text-[10px] sm:grid-cols-[7rem_1fr]"
                  >
                    <dt className="text-[var(--muted)]">{change.label}</dt>
                    <dd className="min-w-0 text-[var(--text-secondary)]">
                      <span className="line-through opacity-55">
                        {change.before}
                      </span>
                      <span className="mx-2 text-[var(--accent)]">→</span>
                      {change.after}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </article>
        );
      })}
      {feed.truncated ? (
        <p className="text-center text-[10px] text-[var(--muted)]">
          Показаны последние 100 событий.
        </p>
      ) : null}
    </div>
  );
}

export function TaskManagementDialogs({
  task,
  mode,
  assigneeOptions,
  timeZone,
  onClose,
}: {
  task: TaskCard | null;
  mode: "edit" | "cancel" | "history" | null;
  assigneeOptions: TaskAssigneeOption[];
  timeZone: string;
  onClose: () => void;
}) {
  return (
    <>
      <Dialog
        open={Boolean(task && mode === "edit")}
        onClose={onClose}
        title="Редактировать задачу"
        description="Изменения защищены версией записи и сохраняются в истории."
      >
        {task && mode === "edit" ? (
          <EditTaskForm
            task={task}
            assigneeOptions={assigneeOptions}
            timeZone={timeZone}
            onComplete={onClose}
          />
        ) : null}
      </Dialog>
      <Dialog
        open={Boolean(task && mode === "cancel")}
        onClose={onClose}
        title="Отменить задачу"
        description="Отмена требует причины и не удаляет историю."
      >
        {task && mode === "cancel" ? (
          <CancelTaskForm task={task} onComplete={onClose} />
        ) : null}
      </Dialog>
      <Dialog
        open={Boolean(task && mode === "history")}
        onClose={onClose}
        title="История задачи"
        description={task?.title}
      >
        {task && mode === "history" ? (
          <TaskHistory task={task} assigneeOptions={assigneeOptions} />
        ) : null}
      </Dialog>
    </>
  );
}
