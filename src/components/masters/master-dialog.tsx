"use client";

import { Check, Plus, UserRoundPen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useState } from "react";
import {
  createMasterAction,
  type MasterMutationState,
  updateMasterAction,
} from "@/app/(workspace)/masters/actions";
import {
  OrderField,
  OrderFormFooter,
  orderInputClass,
  orderTextareaClass,
} from "@/components/orders/order-form-parts";
import { Dialog } from "@/components/ui/dialog";
import { DateInput } from "@/components/ui/date-time-inputs";
import { clientCrypto as crypto } from "@/lib/client-id";
import type {
  MasterListItem,
  MasterOperationalStatus,
} from "@/server/masters/types";

const initialState: MasterMutationState = {
  status: "idle",
  message: null,
  fieldErrors: {},
};

function MutationStatus({ state }: { state: MasterMutationState }) {
  if (!state.message) return null;
  return (
    <p
      role="status"
      className={`rounded-[12px] border p-3 text-xs leading-5 ${state.status === "success" ? "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]" : "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-ink)]"}`}
    >
      {state.status === "success" ? (
        <Check className="mr-2 inline size-4" />
      ) : null}
      {state.message}
    </p>
  );
}

function MasterFields({
  state,
  master,
}: {
  state: MasterMutationState;
  master?: MasterListItem;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <OrderField label="ФИО" required errors={state.fieldErrors.fullName}>
        <input
          name="fullName"
          required
          minLength={2}
          maxLength={200}
          defaultValue={master?.fullName}
          placeholder="Иванов Иван Иванович"
          className={orderInputClass}
        />
      </OrderField>
      <OrderField label="Телефон" required errors={state.fieldErrors.phone}>
        <input
          name="phone"
          required
          inputMode="tel"
          minLength={7}
          maxLength={40}
          defaultValue={master?.phone}
          placeholder="+7 999 000-00-00"
          className={orderInputClass}
        />
      </OrderField>
      <OrderField label="Мессенджер" errors={state.fieldErrors.messenger}>
        <input
          name="messenger"
          maxLength={120}
          defaultValue={master?.messenger ?? ""}
          placeholder="@username или WhatsApp"
          className={orderInputClass}
        />
      </OrderField>
      <OrderField
        label="Базовая выплата, ₽"
        required
        errors={state.fieldErrors.basePaymentMinor}
      >
        <input
          name="basePayment"
          required
          inputMode="decimal"
          defaultValue={
            master?.basePaymentMinor === null ||
            master?.basePaymentMinor === undefined
              ? ""
              : String(master.basePaymentMinor / 100)
          }
          placeholder="4 000"
          className={orderInputClass}
        />
      </OrderField>
      <OrderField
        label="Регион"
        required
        errors={state.fieldErrors.serviceRegion}
      >
        <input
          name="serviceRegion"
          required
          minLength={2}
          maxLength={160}
          defaultValue={master?.serviceRegion}
          placeholder="Москва"
          className={orderInputClass}
        />
      </OrderField>
      <OrderField
        label="Зона обслуживания"
        required
        errors={state.fieldErrors.serviceZone}
      >
        <input
          name="serviceZone"
          required
          maxLength={160}
          defaultValue={master?.serviceZone}
          placeholder="ЦАО, САО или радиус"
          className={orderInputClass}
        />
      </OrderField>
      <OrderField
        label="Лимит выездов в день"
        required
        errors={state.fieldErrors.dailyCapacity}
      >
        <input
          name="dailyCapacity"
          type="number"
          required
          min={1}
          max={20}
          defaultValue={master?.dailyCapacity ?? 4}
          className={orderInputClass}
        />
      </OrderField>
      <OrderField
        label="Специализации через запятую"
        errors={state.fieldErrors.skills}
      >
        <input
          name="skills"
          maxLength={1500}
          defaultValue={master?.skills.join(", ") ?? ""}
          placeholder="Дератизация, дезинсекция"
          className={orderInputClass}
        />
      </OrderField>
      <div className="sm:col-span-2">
        <OrderField label="Заметка для офиса" errors={state.fieldErrors.notes}>
          <textarea
            name="notes"
            maxLength={4000}
            defaultValue={master?.notes ?? ""}
            placeholder="Допуски, особенности зоны, рабочий график"
            className={orderTextareaClass}
          />
        </OrderField>
      </div>
    </div>
  );
}

const workDays = [
  [1, "Пн"],
  [2, "Вт"],
  [3, "Ср"],
  [4, "Чт"],
  [5, "Пт"],
  [6, "Сб"],
  [7, "Вс"],
] as const;
const operationalStatuses: Array<{
  value: MasterOperationalStatus;
  label: string;
  note: string;
}> = [
  {
    value: "working",
    label: "Работает",
    note: "Доступен для новых назначений",
  },
  {
    value: "vacation",
    label: "В отпуске",
    note: "Недоступен до указанной даты",
  },
  {
    value: "unavailable",
    label: "Временно не работает",
    note: "Больничный, выходной или ЧП",
  },
  { value: "terminated", label: "Уволен", note: "Остаётся только в истории" },
];

function MasterAvailabilityFields({
  state,
  master,
}: {
  state: MasterMutationState;
  master?: MasterListItem;
}) {
  const initialStatus = master?.operationalStatus ?? "working";
  const [status, setStatus] = useState<MasterOperationalStatus>(initialStatus);
  const [selectedDays, setSelectedDays] = useState<number[]>(
    master?.workingDays ?? [1, 2, 3, 4, 5],
  );
  const terminated = status === "terminated";

  function toggleDay(day: number) {
    if (terminated) return;
    setSelectedDays((current) =>
      current.includes(day)
        ? current.filter((value) => value !== day)
        : [...current, day].sort(),
    );
  }

  if (!master)
    return (
      <section className="inset-panel p-5 sm:p-6">
        <input type="hidden" name="operationalStatus" value="working" />
        <input type="hidden" name="statusUntil" value="" />
        <input type="hidden" name="statusNote" value="" />
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">
              Рабочие дни
            </p>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              Новый мастер создаётся активным. Статус можно изменить позже в
              карточке.
            </p>
          </div>
          <span className="text-[10px] text-[var(--muted)]">
            Выбрано: {selectedDays.length}
          </span>
        </div>
        <div className="mt-5 grid grid-cols-4 gap-2 sm:grid-cols-7">
          {workDays.map(([value, label]) => {
            const selected = selectedDays.includes(value);
            return (
              <label
                key={value}
                className={`focus-within:outline focus-within:outline-2 focus-within:outline-offset-[-2px] focus-within:outline-[var(--focus)] flex min-h-14 cursor-pointer flex-col items-center justify-center rounded-[12px] border text-xs transition-colors ${selected ? "border-[var(--text)] bg-[var(--text)] font-semibold text-[var(--canvas)]" : "border-[var(--line-strong)] bg-[var(--surface)] text-[var(--muted)] hover:bg-[var(--surface-soft)]"}`}
              >
                <input
                  type="checkbox"
                  name="workingDays"
                  value={value}
                  checked={selected}
                  onChange={() => toggleDay(value)}
                  className="sr-only"
                />
                <span>{label}</span>
                <span className="mt-1 text-[8px] font-normal opacity-65">
                  {value <= 5 ? "рабочий" : "выходной"}
                </span>
              </label>
            );
          })}
        </div>
        {state.fieldErrors.workingDays?.length ? (
          <p className="mt-3 text-[10px] text-[var(--danger-ink)]">
            {state.fieldErrors.workingDays[0]}
          </p>
        ) : null}
      </section>
    );

  return (
    <section className="overflow-hidden inset-panel">
      <header className="border-b border-[var(--line)] px-5 py-4 sm:px-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">
          Статус и доступность
        </p>
        <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
          Сначала выберите состояние мастера, затем при необходимости уточните
          срок и рабочую неделю.
        </p>
      </header>
      <div className="space-y-6 p-5 sm:p-6">
        <fieldset>
          <legend className="text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">
            Статус мастера
          </legend>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {operationalStatuses.map((option) => (
              <label
                key={option.value}
                className={`grid min-h-20 cursor-pointer grid-cols-[1rem_minmax(0,1fr)] gap-3 rounded-[13px] border p-3.5 transition-colors ${status === option.value ? "border-[var(--text)] bg-[var(--surface-inset)]" : "border-[var(--line)] bg-[var(--surface)] hover:border-[var(--line-strong)]"}`}
              >
                <input
                  type="radio"
                  name="operationalStatus"
                  value={option.value}
                  checked={status === option.value}
                  onChange={() => setStatus(option.value)}
                  className="mt-1 size-3.5 appearance-none rounded-full border border-[var(--line-strong)] checked:border-[5px] checked:border-[var(--text)]"
                />
                <span>
                  <strong className="block text-xs font-medium text-[var(--text)]">
                    {option.label}
                  </strong>
                  <span className="mt-1 block text-[9px] text-[var(--muted)]">
                    {option.note}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className={`min-w-0 border-t border-[var(--line)] pt-5 ${terminated ? "opacity-50" : ""}`}>
          <legend className="text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">
            Рабочая неделя
          </legend>
          <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-7">
            {workDays.map(([value, label]) => {
              const selected = selectedDays.includes(value);
              return (
                <label
                  key={value}
                  className={`focus-within:outline focus-within:outline-2 focus-within:outline-offset-[-2px] focus-within:outline-[var(--focus)] flex min-h-16 flex-col items-start justify-between rounded-[11px] border p-3 text-xs transition-colors ${terminated ? "cursor-not-allowed" : "cursor-pointer"} ${selected ? "border-[var(--accent)] bg-[var(--accent-soft)] font-semibold text-[var(--text)]" : "border-[var(--line)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-soft)]"}`}
                >
                  <input
                    type="checkbox"
                    name="workingDays"
                    value={value}
                    checked={selected}
                    disabled={terminated}
                    onChange={() => toggleDay(value)}
                    className="sr-only"
                  />
                  <span>{label}</span>
                  <span className="text-[8px] font-normal opacity-65">
                    {value <= 5 ? "рабочий" : "выходной"}
                  </span>
                </label>
              );
            })}
          </div>
          {terminated
            ? selectedDays.map((day) => (
                <input key={day} type="hidden" name="workingDays" value={day} />
              ))
            : null}
          {state.fieldErrors.workingDays?.length ? (
            <p className="mt-3 text-[10px] text-[var(--danger-ink)]">
              {state.fieldErrors.workingDays[0]}
            </p>
          ) : null}
          <p className="mt-3 text-[10px] leading-4 text-[var(--muted)]">
            {terminated
              ? "График сохранён для истории и недоступен для изменения."
              : "Дни участвуют в подборе мастера и проверке календаря."}
          </p>
        </fieldset>
      </div>
      {status === "working" ? (
        <>
          <input type="hidden" name="statusUntil" value="" />
          <input type="hidden" name="statusNote" value="" />
        </>
      ) : (
        <div className={`grid gap-4 border-t border-[var(--line)] p-5 sm:p-6 ${terminated ? "sm:grid-cols-1" : "sm:grid-cols-2"}`}>
          {terminated ? (
            <input type="hidden" name="statusUntil" value="" />
          ) : (
            <OrderField
              label="Статус действует до"
              errors={state.fieldErrors.statusUntil}
            >
            <DateInput
              name="statusUntil"
              defaultValue={master.statusUntil ?? ""}
            />
            </OrderField>
          )}
          <OrderField
            label={terminated ? "Причина увольнения" : "Причина / комментарий"}
            errors={state.fieldErrors.statusNote}
          >
            <input
              name="statusNote"
              maxLength={1000}
              defaultValue={master.statusNote ?? ""}
              placeholder={terminated ? "Укажите причину" : "Отпуск, больничный или комментарий"}
              className={orderInputClass}
            />
          </OrderField>
        </div>
      )}
      <p className="border-t border-[var(--line)] px-5 py-4 text-[10px] leading-4 text-[var(--muted)]">
        «Уволен» скрывает мастера из новых назначений, блокирует редактирование
        графика и сохраняет историю.
      </p>
    </section>
  );
}

function MasterForm({
  master,
  requestKey,
  onComplete,
}: {
  master?: MasterListItem;
  requestKey?: string;
  onComplete: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    master ? updateMasterAction : createMasterAction,
    initialState,
  );
  const router = useRouter();
  useEffect(() => {
    if (state.status !== "success") return;
    const timeout = window.setTimeout(() => {
      onComplete();
      router.refresh();
    }, 650);
    return () => window.clearTimeout(timeout);
  }, [onComplete, router, state.status]);

  return (
    <form action={formAction} className="flex min-h-full flex-1 flex-col">
      {requestKey ? (
        <input type="hidden" name="idempotencyKey" value={requestKey} />
      ) : null}
      {master ? (
        <>
          <input type="hidden" name="masterId" value={master.id} />
          <input type="hidden" name="expectedVersion" value={master.version} />
        </>
      ) : null}
      <div className="flex-1 space-y-6 p-5 sm:p-7">
        <MasterFields state={state} master={master} />
        <MasterAvailabilityFields state={state} master={master} />
        <MutationStatus state={state} />
      </div>
      <OrderFormFooter
        pending={pending}
        saved={state.status === "success"}
        onCancel={onComplete}
        submitLabel={master ? "Сохранить" : "Добавить мастера"}
      />
    </form>
  );
}

export function CreateMasterButton() {
  const [requestKey, setRequestKey] = useState<string | null>(null);
  const close = useCallback(() => setRequestKey(null), []);
  return (
    <>
      <button
        type="button"
        onClick={() => setRequestKey(crypto.randomUUID())}
        className="focus-ring flex h-11 items-center gap-2 rounded-[13px] bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--on-accent)]"
      >
        <Plus className="size-4" />
        Новый мастер
      </button>
      <Dialog
        open={requestKey !== null}
        onClose={close}
        title="Новый мастер"
        description="Контакты, зона и условия оплаты сохранятся в справочнике."
      >
        {requestKey ? (
          <MasterForm requestKey={requestKey} onComplete={close} />
        ) : null}
      </Dialog>
    </>
  );
}

export function EditMasterButton({
  master,
  onOpen,
}: {
  master: MasterListItem;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        type="button"
        aria-label={`Редактировать мастера ${master.fullName}`}
        onClick={() => {
          setOpen(true);
          onOpen?.();
        }}
        className="focus-ring flex h-10 shrink-0 items-center gap-2 rounded-[12px] border border-[var(--line)] px-3 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)]"
      >
        <UserRoundPen className="size-4" />
        Редактировать
      </button>
      <Dialog
        open={open}
        onClose={close}
        title={master.fullName}
        description="Изменения справочника не переписывают исторические данные уже созданных заказов."
      >
        {open ? <MasterForm master={master} onComplete={close} /> : null}
      </Dialog>
    </>
  );
}
