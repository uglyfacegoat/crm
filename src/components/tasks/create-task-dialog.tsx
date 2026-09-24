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
import type { TaskAssigneeOption, TaskOrderOption } from "@/server/tasks/types";

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
  developer: "Разработчик",
  admin: "Администратор",
  dispatcher: "Диспетчер",
  manager: "Менеджер",
  accountant: "Бухгалтер",
  master: "Мастер",
} as const;

function CreateTaskForm({
  requestKey,
  assigneeOptions,
  orderOptions,
  currentMemberId,
  onComplete,
}: {
  requestKey: string;
  assigneeOptions: TaskAssigneeOption[];
  orderOptions: TaskOrderOption[];
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
    <form action={action} className="task-create-form flex flex-1 flex-col">
      <input type="hidden" name="idempotencyKey" value={requestKey} />
      <div className="task-create-fields">
        <label className={`${fieldLabelClass} task-create-title`}>
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
        <label className={`${fieldLabelClass} task-create-description`}>
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
          <span>Исполнитель</span>
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
        <label className={fieldLabelClass}>
          <span>Связанный заказ</span>
          <select name="relatedOrderId" defaultValue="" className={fieldClass}>
            <option value="">Не связан с заказом</option>
            {orderOptions.map((order) => (
              <option key={order.id} value={order.id}>
                {order.orderNumber} · {order.clientName}
              </option>
            ))}
          </select>
          <FieldError errors={state.fieldErrors.relatedOrderId} />
        </label>
        <fieldset className="task-create-deadline">
          <legend className="text-[10px] text-[var(--text-secondary)]">
            Срок
          </legend>
          <div>
            <label className="grid gap-2 text-[10px] text-[var(--muted)]">
              <span className="sr-only">Дата</span>
              <DateInput name="localDate" className={fieldClass} />
              <FieldError errors={state.fieldErrors.localDate} />
            </label>
            <label className="grid gap-2 text-[10px] text-[var(--muted)]">
              <span className="sr-only">Время</span>
              <TimeInput name="localTime" className={fieldClass} />
              <FieldError errors={state.fieldErrors.localTime} />
            </label>
          </div>
        </fieldset>
        <label className={fieldLabelClass}>
          <span>Приоритет</span>
          <select name="priority" defaultValue="normal" className={fieldClass}>
            <option value="low">Низкий</option>
            <option value="normal">Обычный</option>
            <option value="high">Высокий</option>
            <option value="critical">Критичный</option>
          </select>
          <FieldError errors={state.fieldErrors.priority} />
        </label>
        <p className="task-create-note">
          Автоматические напоминания создаются из выездов.
        </p>
        {state.message ? (
          <p
            role="status"
            className={`task-create-status rounded-[12px] border p-3 text-xs ${state.status === "success" ? "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]" : "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-ink)]"}`}
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
  orderOptions,
  currentMemberId,
}: {
  assigneeOptions: TaskAssigneeOption[];
  orderOptions: TaskOrderOption[];
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
            orderOptions={orderOptions}
            currentMemberId={currentMemberId}
            onComplete={close}
          />
        ) : null}
      </Dialog>
    </>
  );
}
