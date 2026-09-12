"use client";

import { DateInput } from "@/components/ui/date-time-inputs";
import {
  CalendarDays,
  Check,
  Copy,
  Pencil,
  Plus,
  ReceiptText,
  Trash2,
  UserRound,
} from "lucide-react";
import { useActionState, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clientCrypto as crypto } from "@/lib/client-id";
import {
  addOrderExpenseAction,
  copyOrderAction,
  type CopyOrderState,
  updateOrderAction,
  type OrderMutationState,
} from "@/app/(workspace)/orders/actions";
import { Dialog } from "@/components/ui/dialog";
import { VisitDispatchCardButton } from "@/components/visits/visit-dispatch-card";
import { formatMoneyMinor } from "@/lib/format";
import {
  calculateServiceLineTotalMinor,
  parseMoneyToMinorUnits,
  parseQuantityToMilliunits,
} from "@/server/orders/money";
import {
  orderStatusLabels,
  orderStatuses,
  type OrderCreationOptions,
  type OrderDetail,
  type OrderStatus,
} from "@/server/orders/types";
import type { ServiceVisit } from "@/server/visits/types";
import {
  OrderField,
  OrderFormFooter,
  OrderFormStatus,
  orderInputClass,
  OrderPicker,
  orderTextareaClass,
} from "./order-form-parts";

const initialOrderMutationState: OrderMutationState = {
  status: "idle",
  message: null,
  fieldErrors: {},
};
const initialCopyOrderState: CopyOrderState = {
  status: "idle",
  message: null,
  fieldErrors: {},
  orderId: null,
};
type EditableService = {
  id: string;
  name: string;
  quantity: string;
  unitPrice: string;
  note: string;
};

function editableServiceTotal(service: EditableService) {
  try {
    return Number(
      calculateServiceLineTotalMinor(
        parseMoneyToMinorUnits(service.unitPrice),
        parseQuantityToMilliunits(service.quantity),
      ),
    );
  } catch {
    return 0;
  }
}

function editableServiceIsValid(service: EditableService) {
  if (service.name.trim().length < 2) return false;
  try {
    parseMoneyToMinorUnits(service.unitPrice);
    parseQuantityToMilliunits(service.quantity);
    return true;
  } catch {
    return false;
  }
}

function useRefreshAfterSuccess(
  status: OrderMutationState["status"],
  onClose: () => void,
) {
  const router = useRouter();
  useEffect(() => {
    if (status !== "success") return;
    router.refresh();
    const timeout = window.setTimeout(onClose, 550);
    return () => window.clearTimeout(timeout);
  }, [onClose, router, status]);
}

function EditOrderForm({
  order,
  options,
  onClose,
}: {
  order: OrderDetail;
  options: OrderCreationOptions;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(
    updateOrderAction,
    initialOrderMutationState,
  );
  const [status, setStatus] = useState<OrderStatus>(order.statusCode);
  const [masterId, setMasterId] = useState(order.assignedMasterId ?? "");
  const [services, setServices] = useState<EditableService[]>(() =>
    order.services.map((service) => ({
      id: service.id,
      name: service.name,
      quantity: service.quantity,
      unitPrice: String(service.unitPriceMinor / 100),
      note: service.note ?? "",
    })),
  );
  useRefreshAfterSuccess(state.status, onClose);
  const totalMinor = services.reduce(
    (total, service) => total + editableServiceTotal(service),
    0,
  );
  const serializedServices = services.map((service) => ({
    name: service.name,
    quantity: service.quantity,
    unitPrice: service.unitPrice,
    note: service.note,
  }));
  const servicesReady =
    services.length > 0 && services.every(editableServiceIsValid);

  function updateService(id: string, changes: Partial<EditableService>) {
    setServices((current) =>
      current.map((service) =>
        service.id === id ? { ...service, ...changes } : service,
      ),
    );
  }

  return (
    <form action={action} className="flex flex-1 flex-col">
      <input type="hidden" name="orderId" value={order.id} />
      <input type="hidden" name="expectedVersion" value={order.version} />
      <input type="hidden" name="status" value={status} />
      <input type="hidden" name="assignedMasterId" value={masterId} />
      <input
        type="hidden"
        name="services"
        value={JSON.stringify(serializedServices)}
      />
      <div className="flex-1 space-y-7 p-5 sm:p-7">
        <fieldset>
          <legend className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
            Статус
          </legend>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {orderStatuses.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatus(value)}
                className={`focus-ring min-h-11 rounded-[11px] border px-2 text-[10px] ${status === value ? "border-[var(--accent)]/35 bg-[var(--accent)]/[0.07] text-[var(--text)]" : "border-[var(--line)] text-[var(--text-secondary)] hover:bg-[var(--surface-soft)]"}`}
              >
                {orderStatusLabels[value]}
              </button>
            ))}
          </div>
        </fieldset>
        {status === "cancelled" ? (
          <OrderField
            label="Причина отмены"
            required
            errors={state.fieldErrors.statusReason}
          >
            <textarea
              name="statusReason"
              required
              minLength={3}
              maxLength={1000}
              defaultValue={order.statusReason ?? ""}
              placeholder="Почему заказ отменён"
              className={orderTextareaClass}
            />
          </OrderField>
        ) : (
          <input type="hidden" name="statusReason" value="" />
        )}
        <fieldset>
          <div className="flex items-center justify-between gap-3">
            <div>
              <legend className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                Состав заказа
              </legend>
              <p className="mt-1 text-[10px] text-[var(--muted-subtle)]">
                Изменение попадёт в историю карточки
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setServices((current) => [
                  ...current,
                  {
                    id: crypto.randomUUID(),
                    name: "",
                    quantity: "1",
                    unitPrice: "",
                    note: "",
                  },
                ])
              }
              className="focus-ring flex h-9 items-center gap-1.5 rounded-[10px] border border-[var(--line-strong)] px-3 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--surface-soft)]"
            >
              <Plus className="size-3.5" />
              Услуга
            </button>
          </div>
          <div className="mt-4 space-y-3">
            {services.map((service, index) => (
              <div
                key={service.id}
                className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-inset)] p-3.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[10px] text-[var(--muted)]">
                    Позиция {index + 1}
                  </span>
                  {services.length > 1 ? (
                    <button
                      type="button"
                      onClick={() =>
                        setServices((current) =>
                          current.filter(
                            (candidate) => candidate.id !== service.id,
                          ),
                        )
                      }
                      aria-label={`Удалить услугу ${index + 1}`}
                      className="focus-ring grid size-8 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--danger-bg)] hover:text-[var(--danger-ink)]"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  ) : null}
                </div>
                <div className="mt-2 grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_9rem]">
                  <OrderField label="Название" required>
                    <input
                      aria-label={`Название услуги ${index + 1}`}
                      value={service.name}
                      onChange={(event) =>
                        updateService(service.id, { name: event.target.value })
                      }
                      maxLength={200}
                      className={orderInputClass}
                    />
                  </OrderField>
                  <OrderField label="Количество" required>
                    <input
                      aria-label={`Количество услуги ${index + 1}`}
                      value={service.quantity}
                      onChange={(event) =>
                        updateService(service.id, {
                          quantity: event.target.value,
                        })
                      }
                      inputMode="decimal"
                      className={orderInputClass}
                    />
                  </OrderField>
                  <OrderField label="Цена, ₽" required>
                    <input
                      aria-label={`Цена услуги ${index + 1}`}
                      value={service.unitPrice}
                      onChange={(event) =>
                        updateService(service.id, {
                          unitPrice: event.target.value,
                        })
                      }
                      inputMode="decimal"
                      className={orderInputClass}
                    />
                  </OrderField>
                </div>
                <input
                  aria-label={`Примечание к услуге ${index + 1}`}
                  value={service.note}
                  onChange={(event) =>
                    updateService(service.id, { note: event.target.value })
                  }
                  maxLength={1000}
                  placeholder="Примечание к услуге"
                  className={`${orderInputClass} mt-3 h-10 text-xs`}
                />
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between rounded-[12px] border border-[var(--line)] bg-[var(--surface-inset)] px-3.5 py-3">
            <span className="text-xs text-[var(--text-secondary)]">
              Новый итог
            </span>
            <strong className="font-display text-base text-[var(--text)]">
              {formatMoneyMinor(totalMinor)}
            </strong>
          </div>
          {state.fieldErrors.services?.length ? (
            <p className="mt-2 text-[10px] text-[var(--danger-ink)]">
              {state.fieldErrors.services[0]}
            </p>
          ) : null}
        </fieldset>
        <fieldset className="space-y-4">
          <legend className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
            Исполнитель и экономика
          </legend>
          <OrderPicker
            label="Мастер"
            value={masterId}
            onChange={setMasterId}
            options={[
              { value: "", label: "Не назначен" },
              ...options.masters.map((master) => ({
                value: master.id,
                label: master.name,
                detail: master.phone,
              })),
            ]}
            placeholder="Не назначен"
            errors={state.fieldErrors.assignedMasterId}
          />
          <OrderField
            label="Выплата мастеру, ₽"
            required={Boolean(masterId)}
            errors={state.fieldErrors.masterPayment}
          >
            <input
              name="masterPayment"
              disabled={!masterId}
              required={Boolean(masterId)}
              defaultValue={
                order.masterPaymentMinor === null
                  ? ""
                  : String(order.masterPaymentMinor / 100)
              }
              inputMode="decimal"
              className={orderInputClass}
            />
          </OrderField>
        </fieldset>
        <OrderField label="Внутренняя заметка" errors={state.fieldErrors.notes}>
          <textarea
            name="notes"
            maxLength={4000}
            defaultValue={order.notes ?? ""}
            placeholder="Условия заказа и важные детали"
            className={orderTextareaClass}
          />
        </OrderField>
        <OrderFormStatus state={state} />
      </div>
      <OrderFormFooter
        pending={pending}
        saved={state.status === "success"}
        onCancel={onClose}
        submitLabel="Сохранить изменения"
        disabled={!servicesReady}
      />
    </form>
  );
}

function AddExpenseForm({
  orderId,
  requestKey,
  onClose,
}: {
  orderId: string;
  requestKey: string;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(
    addOrderExpenseAction,
    initialOrderMutationState,
  );
  useRefreshAfterSuccess(state.status, onClose);
  return (
    <form action={action} className="flex flex-1 flex-col">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="idempotencyKey" value={requestKey} />
      <div className="flex-1 space-y-5 p-5 sm:p-7">
        <OrderField
          label="Категория"
          required
          errors={state.fieldErrors.category}
        >
          <input
            name="category"
            required
            minLength={2}
            maxLength={80}
            placeholder="Топливо, материалы, парковка"
            className={orderInputClass}
          />
        </OrderField>
        <div className="grid gap-4 sm:grid-cols-2">
          <OrderField
            label="Сумма, ₽"
            required
            errors={state.fieldErrors.amount}
          >
            <input
              name="amount"
              required
              inputMode="decimal"
              placeholder="1 500"
              className={orderInputClass}
            />
          </OrderField>
          <OrderField
            label="Дата расхода"
            required
            errors={state.fieldErrors.occurredOn}
          >
            <DateInput name="occurredOn" required className={orderInputClass} />
          </OrderField>
        </div>
        <OrderField label="Комментарий" errors={state.fieldErrors.note}>
          <textarea
            name="note"
            maxLength={1000}
            placeholder="Что именно оплачено"
            className={orderTextareaClass}
          />
        </OrderField>
        <p className="text-[10px] leading-4 text-[var(--muted)]">
          Расход сразу попадёт в экономику заказа и будет зафиксирован в журнале
          аудита.
        </p>
        <OrderFormStatus state={state} />
      </div>
      <OrderFormFooter
        pending={pending}
        saved={state.status === "success"}
        onCancel={onClose}
        submitLabel="Добавить расход"
      />
    </form>
  );
}

function SelectionRow({
  checked,
  onChange,
  title,
  detail,
  icon,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  detail: string;
  icon?: React.ReactNode;
}) {
  return (
    <label
      className={`focus-within:outline focus-within:outline-2 focus-within:outline-offset-[-2px] focus-within:outline-[var(--focus)] flex cursor-pointer items-start gap-3 rounded-[12px] border px-3 py-3 transition-colors ${checked ? "border-[var(--accent)]/25 bg-[var(--accent)]/[0.055]" : "border-[var(--line)] bg-[var(--surface-inset)] hover:bg-[var(--surface-soft)]"}`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-[6px] border ${checked ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--on-accent)]" : "border-[var(--line-strong)] text-transparent"}`}
      >
        <Check className="size-3.5" />
      </span>
      {icon ? (
        <span className="mt-0.5 text-[var(--text-secondary)]">{icon}</span>
      ) : null}
      <span className="min-w-0">
        <span className="block text-xs font-medium text-[var(--text)]">
          {title}
        </span>
        <span className="mt-1 block text-[10px] leading-4 text-[var(--muted)]">
          {detail}
        </span>
      </span>
    </label>
  );
}

function CopyOrderForm({
  order,
  visits,
  requestKey,
  onClose,
}: {
  order: OrderDetail;
  visits: ServiceVisit[];
  requestKey: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    copyOrderAction,
    initialCopyOrderState,
  );
  const [serviceIds, setServiceIds] = useState(() =>
    order.services.map((service) => service.id),
  );
  const [expenseIds, setExpenseIds] = useState<string[]>([]);
  const [visitIds, setVisitIds] = useState<string[]>([]);
  const [copyMaster, setCopyMaster] = useState(false);
  const [copyNotes, setCopyNotes] = useState(Boolean(order.notes));
  const eligibleVisits = visits.filter(
    (visit) =>
      visit.statusCode === "planned" || visit.statusCode === "confirmed",
  );

  useEffect(() => {
    if (state.status === "success" && state.orderId)
      router.push(`/orders/${state.orderId}`);
  }, [router, state.orderId, state.status]);

  function toggle(
    selected: string[],
    id: string,
    checked: boolean,
    setSelected: (ids: string[]) => void,
  ) {
    setSelected(
      checked
        ? [...selected, id]
        : selected.filter((selectedId) => selectedId !== id),
    );
  }

  return (
    <form action={action} className="flex flex-1 flex-col">
      <input type="hidden" name="idempotencyKey" value={requestKey} />
      <input type="hidden" name="sourceOrderId" value={order.id} />
      <input type="hidden" name="expectedVersion" value={order.version} />
      <input
        type="hidden"
        name="serviceIds"
        value={JSON.stringify(serviceIds)}
      />
      <input
        type="hidden"
        name="expenseIds"
        value={JSON.stringify(expenseIds)}
      />
      <input type="hidden" name="visitIds" value={JSON.stringify(visitIds)} />
      <input type="hidden" name="copyMaster" value={String(copyMaster)} />
      <input type="hidden" name="copyNotes" value={String(copyNotes)} />
      <div className="flex-1 space-y-6 p-5 sm:p-7">
        <div className="grid gap-3 rounded-[14px] border border-[var(--line)] bg-[var(--surface-inset)] p-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <OrderField
            label="Дата новой копии"
            required
            errors={state.fieldErrors.copyDate}
          >
            <DateInput name="copyDate" required className={orderInputClass} />
          </OrderField>
          <div className="pb-1 text-[10px] leading-4 text-[var(--muted)] sm:max-w-48">
            Первый выбранный выезд встанет на эту дату. Остальные сохранят
            интервалы.
          </div>
        </div>
        <section>
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                Услуги
              </p>
              <p className="mt-1 text-[10px] text-[var(--muted-subtle)]">
                Минимум одна строка
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setServiceIds(
                  serviceIds.length === order.services.length
                    ? []
                    : order.services.map((service) => service.id),
                )
              }
              className="focus-ring rounded-lg px-2 py-1 text-[10px] text-[var(--accent)]"
            >
              {serviceIds.length === order.services.length
                ? "Снять все"
                : "Выбрать все"}
            </button>
          </div>
          <div className="grid gap-2">
            {order.services.map((service) => (
              <SelectionRow
                key={service.id}
                checked={serviceIds.includes(service.id)}
                onChange={(checked) =>
                  toggle(serviceIds, service.id, checked, setServiceIds)
                }
                title={service.name}
                detail={`${service.quantity} × ${formatMoneyMinor(service.unitPriceMinor)} · ${formatMoneyMinor(service.lineTotalMinor)}`}
              />
            ))}
          </div>
          {state.fieldErrors.serviceIds?.length ? (
            <p className="mt-2 text-[10px] text-[var(--danger-ink)]">
              {state.fieldErrors.serviceIds[0]}
            </p>
          ) : null}
        </section>
        {order.expenses.length ? (
          <section>
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                  Прямые расходы
                </p>
                <p className="mt-1 text-[10px] text-[var(--muted-subtle)]">
                  По умолчанию не копируются
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setExpenseIds(
                    expenseIds.length === order.expenses.length
                      ? []
                      : order.expenses.map((expense) => expense.id),
                  )
                }
                className="focus-ring rounded-lg px-2 py-1 text-[10px] text-[var(--accent)]"
              >
                {expenseIds.length === order.expenses.length
                  ? "Снять все"
                  : "Выбрать все"}
              </button>
            </div>
            <div className="grid gap-2">
              {order.expenses.map((expense) => (
                <SelectionRow
                  key={expense.id}
                  checked={expenseIds.includes(expense.id)}
                  onChange={(checked) =>
                    toggle(expenseIds, expense.id, checked, setExpenseIds)
                  }
                  icon={<ReceiptText className="size-4" />}
                  title={`${expense.category} · ${formatMoneyMinor(expense.amountMinor)}`}
                  detail="Будет создан новый расход на дату копии — это влияет на её экономику."
                />
              ))}
            </div>
          </section>
        ) : null}
        {eligibleVisits.length ? (
          <section>
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                  Будущие выезды
                </p>
                <p className="mt-1 text-[10px] text-[var(--muted-subtle)]">
                  Новая независимая серия дат
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setVisitIds(
                    visitIds.length === eligibleVisits.length
                      ? []
                      : eligibleVisits.map((visit) => visit.id),
                  )
                }
                className="focus-ring rounded-lg px-2 py-1 text-[10px] text-[var(--accent)]"
              >
                {visitIds.length === eligibleVisits.length
                  ? "Снять все"
                  : "Выбрать все"}
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {eligibleVisits.map((visit) => (
                <SelectionRow
                  key={visit.id}
                  checked={visitIds.includes(visit.id)}
                  onChange={(checked) =>
                    toggle(visitIds, visit.id, checked, setVisitIds)
                  }
                  icon={<CalendarDays className="size-4" />}
                  title={new Intl.DateTimeFormat("ru-RU", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: visit.timezone,
                  }).format(new Date(visit.scheduledStartAt))}
                  detail={`${visit.status}${visit.master ? ` · ${visit.master}` : " · без мастера"}`}
                />
              ))}
            </div>
          </section>
        ) : null}
        <section className="grid gap-2 sm:grid-cols-2">
          <SelectionRow
            checked={copyMaster}
            onChange={setCopyMaster}
            icon={<UserRound className="size-4" />}
            title="Мастер и выплата"
            detail={
              order.master
                ? `${order.master} · ${order.masterPaymentMinor === null ? "выплата не указана" : formatMoneyMinor(order.masterPaymentMinor)}`
                : "В заказе мастер не назначен"
            }
          />
          <SelectionRow
            checked={copyNotes}
            onChange={setCopyNotes}
            title="Внутренняя заметка"
            detail={
              order.notes
                ? "Перенести условия и важные детали"
                : "В исходном заказе заметки нет"
            }
          />
        </section>
        <p className="rounded-[12px] border border-[var(--info-border)]/45 bg-[var(--info-bg)] p-3 text-[10px] leading-4 text-[var(--info)]">
          Копия получит новый номер и статус «Новый». Оплаты, счета, закрывающие
          акты и история оригинала не переносятся.
        </p>
        <OrderFormStatus state={state} />
      </div>
      <OrderFormFooter
        pending={pending}
        saved={state.status === "success"}
        onCancel={onClose}
        submitLabel="Создать копию"
        disabled={!serviceIds.length}
      />
    </form>
  );
}

type ActiveDialog = "edit" | "expense" | "copy" | null;

export function OrderActions({
  order,
  options,
  visits,
  canWrite,
  dispatchVisitId,
}: {
  order: OrderDetail;
  options: OrderCreationOptions;
  visits: ServiceVisit[];
  canWrite: boolean;
  dispatchVisitId: string | null;
}) {
  const [active, setActive] = useState<ActiveDialog>(null);
  const [requestKey, setRequestKey] = useState<string | null>(null);
  const close = useCallback(() => {
    setActive(null);
    setRequestKey(null);
  }, []);

  return (
    <>
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        <VisitDispatchCardButton
          visitId={dispatchVisitId}
          className="flex-1 min-[520px]:flex-none"
        />
        {canWrite ? (
          <>
            <button
              onClick={() => setActive("edit")}
              className="focus-ring flex h-10 min-w-0 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-[13px] bg-[var(--accent)] px-3 text-xs font-semibold text-[var(--on-accent)] min-[520px]:flex-none min-[520px]:px-4"
            >
              <Pencil className="size-4" />
              Редактировать
            </button>
            <button
              onClick={() => {
                setRequestKey(crypto.randomUUID());
                setActive("copy");
              }}
              className="focus-ring flex h-10 items-center gap-2 rounded-[13px] border border-[var(--line-strong)] px-3 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-soft)]"
            >
              <Copy className="size-4" />
              Копия
            </button>
            <button
              onClick={() => {
                setRequestKey(crypto.randomUUID());
                setActive("expense");
              }}
              className="focus-ring flex h-10 items-center gap-2 rounded-[13px] border border-[var(--line-strong)] px-3 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-soft)]"
            >
              <Plus className="size-4" />
              Расход
            </button>
          </>
        ) : null}
      </div>
      <Dialog
        open={active === "edit"}
        onClose={close}
        title="Редактировать заказ"
        description="Изменения сохраняются с проверкой версии карточки."
      >
        {active === "edit" ? (
          <EditOrderForm order={order} options={options} onClose={close} />
        ) : null}
      </Dialog>
      <Dialog
        open={active === "copy"}
        onClose={close}
        title={`Копия заказа ${order.number}`}
        description="Выберите только те данные, которые должны стать частью нового независимого заказа."
      >
        {active === "copy" && requestKey ? (
          <CopyOrderForm
            order={order}
            visits={visits}
            requestKey={requestKey}
            onClose={close}
          />
        ) : null}
      </Dialog>
      <Dialog
        open={active === "expense"}
        onClose={close}
        title="Новый расход"
        description="Топливо, материалы и другие прямые затраты по заказу."
      >
        {active === "expense" && requestKey ? (
          <AddExpenseForm
            orderId={order.id}
            requestKey={requestKey}
            onClose={close}
          />
        ) : null}
      </Dialog>
    </>
  );
}
