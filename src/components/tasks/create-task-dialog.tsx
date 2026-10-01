"use client";

import { DateInput, TimeInput } from "@/components/ui/date-time-inputs";
import { Check, LoaderCircle, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import type { FormEvent } from "react";
import type { CreateTaskState } from "@/app/(workspace)/tasks/actions";
import { Dialog } from "@/components/ui/dialog";
import { OrderPicker } from "@/components/orders/order-form-parts";
import { clientCrypto as crypto } from "@/lib/client-id";
import type { TaskAssigneeOption, TaskOrderOption } from "@/server/tasks/types";

const initialState: CreateTaskState = {
  status: "idle",
  message: null,
  fieldErrors: {},
  taskId: null,
};
const fieldClass =
  "focus-ring h-12 min-w-0 w-full rounded-[12px] border border-[var(--line)] bg-[var(--surface-inset)] px-3.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)]";
const fieldLabelClass = "grid min-w-0 gap-2 text-[10px] text-[var(--text-secondary)]";

function FieldError({ errors }: { errors?: string[] }) {
  return errors?.length ? (
    <span className="text-[10px] text-[var(--danger-ink)]">{errors[0]}</span>
  ) : null;
}

const roleLabels = {
  owner: "Владелец",
  developer: "Разработчик",
  deputy: "Заместитель",
  finance_controller: "Финконтроль",
  sales_lead: "Руководитель продаж", sales_specialist: "Менеджер продаж",
  regional_director: "Региональный директор",
  crm_coordinator: "Координатор CRM",
  tender_specialist: "Тендерный отдел",
  foreman: "Бригадир",
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
  organizationName,
  initialRelatedOrderId,
  onComplete,
}: {
  requestKey: string;
  assigneeOptions: TaskAssigneeOption[];
  orderOptions: TaskOrderOption[];
  currentMemberId: string;
  organizationName: string;
  initialRelatedOrderId: string;
  onComplete: () => void;
}) {
  const [state, setState] = useState<CreateTaskState>(initialState);
  const [assigneeId, setAssigneeId] = useState(currentMemberId);
  const [relatedOrderId, setRelatedOrderId] = useState(initialRelatedOrderId);
  const [priority, setPriority] = useState("normal");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    startTransition(async () => {
      try {
        const response = await fetch("/api/v1/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        const result = await response.json() as { taskId?: string; error?: string; fieldErrors?: Record<string, string[]> };
        setState(response.ok && result.taskId
          ? { status: "success", message: "Задача создана.", fieldErrors: {}, taskId: result.taskId }
          : { status: "error", message: result.error ?? "Не удалось создать задачу. Поля сохранены в форме.", fieldErrors: result.fieldErrors ?? {}, taskId: null });
      } catch {
        setState({ status: "error", message: "Связь прервалась. Поля сохранены в форме; проверьте список задач перед повторной отправкой.", fieldErrors: {}, taskId: null });
      }
    });
  };
  useEffect(() => {
    if (state.status !== "success") return;
    const timeout = window.setTimeout(() => {
      onComplete();
      router.refresh();
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [onComplete, router, state.status]);

  return (
    <form onSubmit={submit} className="task-create-form flex flex-1 flex-col">
      <input type="hidden" name="idempotencyKey" value={requestKey} />
      <div className="task-create-fields">
        <label className={`${fieldLabelClass} task-create-title`}>
          <span>Название *</span>
          <input
            name="title"
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
        <div className="grid gap-2">
          <input type="hidden" name="assignedMemberId" value={assigneeId} />
          <OrderPicker label="Исполнитель" value={assigneeId} onChange={setAssigneeId}
            options={[{ value: "", label: "Без ответственного" },
              ...assigneeOptions.map((assignee) => ({ value: assignee.id, label: assignee.displayName, detail: roleLabels[assignee.role] }))]}
            placeholder="Без ответственного" remoteUrl="/api/v1/tasks/options?type=assignees"
            searchPlaceholder="Имя или email" errors={state.fieldErrors.assignedMemberId} />
          <span className="text-[10px] leading-4 text-[var(--muted)]">Исполнитель увидит задачу в контуре «{organizationName}».</span>
        </div>
        <div>
          <input type="hidden" name="relatedOrderId" value={relatedOrderId} />
          <OrderPicker label="Связанный заказ" value={relatedOrderId} onChange={setRelatedOrderId}
            options={[{ value: "", label: "Не связан с заказом" },
              ...orderOptions.map((order) => ({ value: order.id, label: order.orderNumber, detail: order.clientName }))]}
            placeholder="Не связан с заказом" remoteUrl="/api/v1/tasks/options?type=orders"
            searchPlaceholder="Номер заказа или клиент" errors={state.fieldErrors.relatedOrderId} />
        </div>
        <fieldset className="task-create-deadline">
          <legend className="text-[10px] text-[var(--text-secondary)]">
            Срок
          </legend>
          <div>
            <label className="grid gap-2 text-[10px] text-[var(--muted)]">
              <span className="sr-only">Дата</span>
              <DateInput name="localDate" className="w-full" />
              <FieldError errors={state.fieldErrors.localDate} />
            </label>
            <label className="grid gap-2 text-[10px] text-[var(--muted)]">
              <span className="sr-only">Время</span>
              <TimeInput name="localTime" className="w-full" />
              <FieldError errors={state.fieldErrors.localTime} />
            </label>
          </div>
          <p className="mt-2 text-[10px] text-[var(--muted)]">Если нужен срок, укажите и дату, и время. Можно оставить оба поля пустыми.</p>
        </fieldset>
        <div>
          <input type="hidden" name="priority" value={priority} />
          <OrderPicker searchable={false} label="Приоритет" value={priority} onChange={setPriority}
            options={[{ value: "low", label: "Низкий" }, { value: "normal", label: "Обычный" },
              { value: "high", label: "Высокий" }, { value: "critical", label: "Критичный" }]}
            placeholder="Выберите приоритет" errors={state.fieldErrors.priority} />
        </div>
        <p className="task-create-note">
          Автоматические напоминания создаются из выездов.
        </p>
      </div>
      <footer className="sticky bottom-0 z-10 flex flex-col gap-2 border-t border-[var(--line)] bg-[var(--surface)] p-4 sm:px-7">
        {state.message ? <p role="status" className={`rounded-[12px] border p-3 text-xs ${state.status === "success" ? "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]" : "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-ink)]"}`}>{state.status === "success" ? <Check className="mr-2 inline size-4" /> : null}{state.message}</p> : null}
        <div className="flex gap-2">
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
        </div>
      </footer>
    </form>
  );
}

export function CreateTaskButton({
  assigneeOptions,
  orderOptions,
  currentMemberId,
  organizationName,
  initialRelatedOrderId = "",
}: {
  assigneeOptions: TaskAssigneeOption[];
  orderOptions: TaskOrderOption[];
  currentMemberId: string;
  organizationName: string;
  initialRelatedOrderId?: string;
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
            organizationName={organizationName}
            initialRelatedOrderId={initialRelatedOrderId}
            onComplete={close}
          />
        ) : null}
      </Dialog>
    </>
  );
}
