"use client";

import { DateInput, TimeInput } from "@/components/ui/date-time-inputs";
import { Check, LoaderCircle, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useState } from "react";
import {
  createTaskAction,
  type CreateTaskState,
} from "@/app/(workspace)/tasks/actions";
import { Dialog } from "@/components/ui/dialog";
import { clientCrypto as crypto } from "@/lib/client-id";
import type { TaskAssigneeOption } from "@/server/tasks/types";

const initialState: CreateTaskState = {
  status: "idle",
  message: null,
  fieldErrors: {},
  taskId: null,
};
const fieldClass =
  "focus-ring h-12 rounded-[12px] border border-[var(--line)] bg-[var(--surface-inset)] px-3.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)]";
const fieldLabelClass = "grid gap-2 text-[10px] text-[var(--text-secondary)]";

function FieldError({ errors }: { errors?: string[] }) {
  return errors?.length ? (
    <span className="text-[10px] text-[var(--danger-ink)]">{errors[0]}</span>
  ) : null;
}

const roleLabels = {
  admin: "Администратор",
  dispatcher: "Диспетчер",
  manager: "Менеджер",
  accountant: "Бухгалтер",
  master: "Мастер",
} as const;

function CreateTaskForm({
  requestKey,
  assigneeOptions,
  currentMemberId,
  onComplete,
}: {
  requestKey: string;
  assigneeOptions: TaskAssigneeOption[];
  currentMemberId: string;
  onComplete: () => void;
}) {
  const [state, action, pending] = useActionState(
    createTaskAction,
    initialState,
  );
  const router = useRouter();
  useEffect(() => {
    if (state.status !== "success") return;
    router.refresh();
    const timeout = window.setTimeout(onComplete, 550);
    return () => window.clearTimeout(timeout);
  }, [onComplete, router, state.status]);

  return (
    <form action={action} className="flex flex-1 flex-col">
      <input type="hidden" name="idempotencyKey" value={requestKey} />
      <div className="flex-1 space-y-5 p-5 sm:p-7">
        <label className={fieldLabelClass}>
          <span>Название *</span>
          <input
            name="title"
            required
            minLength={2}
            maxLength={240}
            placeholder="Например, отправить акт клиенту"
            className={fieldClass}
          />
          <FieldError errors={state.fieldErrors.title} />
        </label>
        <label className={fieldLabelClass}>
          <span>Описание</span>
          <textarea
            name="description"
            maxLength={4000}
            rows={5}
            placeholder="Контекст, результат и важные детали"
            className="focus-ring resize-none rounded-[12px] border border-[var(--line)] bg-[var(--surface-inset)] p-3.5 text-sm leading-6 text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)]"
          />
          <FieldError errors={state.fieldErrors.description} />
        </label>
        <label className={fieldLabelClass}>
          <span>Ответственный</span>
          <select
            name="assignedMemberId"
            defaultValue={currentMemberId}
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
            {(
              [
                ["low", "Низкий"],
                ["normal", "Обычный"],
                ["high", "Высокий"],
                ["critical", "Критичный"],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className="focus-within:outline focus-within:outline-2 focus-within:outline-offset-[-2px] focus-within:outline-[var(--focus)]"
              >
                <input
                  type="radio"
                  name="priority"
                  value={value}
                  defaultChecked={value === "normal"}
                  className="peer sr-only"
                />
                <span className="grid min-h-11 cursor-pointer place-items-center rounded-[11px] border border-[var(--line)] text-[10px] text-[var(--text-secondary)] peer-checked:border-[var(--accent)] peer-checked:bg-[var(--accent-soft)] peer-checked:text-[var(--accent-ink)]">
                  {label}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-[10px] text-[var(--text-secondary)]">
            Срок (необязательно)
          </legend>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-2 text-[10px] text-[var(--muted)]">
              <span>Дата</span>
              <DateInput name="localDate" className={fieldClass} />
              <FieldError errors={state.fieldErrors.localDate} />
            </label>
            <label className="grid gap-2 text-[10px] text-[var(--muted)]">
              <span>Время</span>
              <TimeInput name="localTime" className={fieldClass} />
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
          Отмена
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
          ) : state.status === "success" ? (
            <>
              <Check className="size-4" />
              Сохранено
            </>
          ) : (
            "Создать задачу"
          )}
        </button>
      </footer>
    </form>
  );
}

export function CreateTaskButton({
  assigneeOptions,
  currentMemberId,
}: {
  assigneeOptions: TaskAssigneeOption[];
  currentMemberId: string;
}) {
  const [requestKey, setRequestKey] = useState<string | null>(null);
  const close = useCallback(() => setRequestKey(null), []);
  return (
    <>
      <button
        onClick={() => setRequestKey(crypto.randomUUID())}
        className="focus-ring flex h-11 items-center gap-2 rounded-[13px] bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--on-accent)]"
      >
        <Plus className="size-4" />
        Новая задача
      </button>
      <Dialog
        open={requestKey !== null}
        onClose={close}
        title="Новая задача"
        description="Задача сохраняется в CRM и сразу появляется у ответственного сотрудника."
      >
        {requestKey ? (
          <CreateTaskForm
            requestKey={requestKey}
            assigneeOptions={assigneeOptions}
            currentMemberId={currentMemberId}
            onComplete={close}
          />
        ) : null}
      </Dialog>
    </>
  );
}
