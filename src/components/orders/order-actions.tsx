"use client";

import { DateInput } from "@/components/ui/date-time-inputs";
import { CopyOrderForm } from "./order-copy-form";
import { ServiceChoice, resolveServiceChoice } from "@/components/catalog/service-choice";
import {
  Copy,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useActionState, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clientCrypto as crypto } from "@/lib/client-id";
import {
  addOrderExpenseAction,
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
type EditableService = {
  id: string;
  existingLineId: string | null;
  catalogItemId: string | null;
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
    if (service.unitPrice) parseMoneyToMinorUnits(service.unitPrice);
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
  canWriteFinance,
  onClose,
}: {
  order: OrderDetail;
  options: OrderCreationOptions;
  canWriteFinance: boolean;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(
    updateOrderAction,
    initialOrderMutationState,
  );
  const [status, setStatus] = useState<OrderStatus>(order.statusCode);
  const [masterId, setMasterId] = useState(order.assignedMasterId ?? "");
  const [manualTotal, setManualTotal] = useState((order.agreedTotalMinor / 100).toFixed(2));
  const [services, setServices] = useState<EditableService[]>(() =>
    order.services.map((service) => ({
      id: service.id,
      existingLineId: service.id,
      catalogItemId: service.catalogItemId ?? null,
      name: service.name,
      quantity: service.quantity,
      unitPrice: service.pricePending ? "" : String(service.unitPriceMinor / 100),
      note: service.note ?? "",
    })),
  );
  useRefreshAfterSuccess(state.status, onClose);
  const totalMinor = services.length ? services.reduce(
    (total, service) => total + editableServiceTotal(service),
    0,
  ) : (() => { try { return Number(parseMoneyToMinorUnits(manualTotal)); } catch { return 0; } })();
  const serializedServices = services.map((service) => ({
    existingLineId: service.existingLineId,
    catalogItemId: service.catalogItemId,
    name: service.name,
    quantity: service.quantity,
    unitPrice: service.unitPrice,
    note: service.note,
  }));
  const servicesReady = services.every(editableServiceIsValid);

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
      <input type="hidden" name="agreedTotal" value={services.length ? (totalMinor / 100).toFixed(2) : manualTotal} />
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
                    existingLineId: null,
                    catalogItemId: null,
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
              Позиция
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
                  <div className="sm:col-span-3"><ServiceChoice value={service.catalogItemId ?? ""} items={options.catalogItems ?? []} onChange={(value, selectedItem) => {
                    const item = selectedItem ?? options.catalogItems?.find((candidate) => candidate.id === value);
                    if (!item) { updateService(service.id, { catalogItemId: null }); return; }
                    const choice = resolveServiceChoice(item, order.objectAreaSquareMeters);
                    updateService(service.id, { catalogItemId: choice.catalogItemId, name: choice.name, quantity: choice.quantity, unitPrice: choice.unitPrice });
                  }} /></div>
                  <OrderField label="Название" required>
                    <input
                      aria-label={`Название услуги ${index + 1}`}
                      value={service.name}
                      onChange={(event) =>
                        updateService(service.id, { name: event.target.value, catalogItemId: null })
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
                  <OrderField label="Цена за единицу, ₽">
                    <input
                      aria-label={`Цена услуги ${index + 1}`}
                      value={service.unitPrice}
                      onChange={(event) =>
                        updateService(service.id, {
                          unitPrice: event.target.value,
                        })
                      }
                      inputMode="decimal"
                      placeholder="Уточняется"
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
          {!services.length ? <div className="mt-4"><OrderField label="Цена заказа, ₽" errors={state.fieldErrors.agreedTotal}><input value={manualTotal} onChange={(event) => setManualTotal(event.target.value)} inputMode="decimal" className={orderInputClass} /></OrderField><p className="mt-2 text-xs text-[var(--muted)]">Состав работ и цену можно добавить позже.</p></div> : null}
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
          {canWriteFinance ? <OrderField
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
          </OrderField> : <input type="hidden" name="masterPayment" value="preserve" />}
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

type ActiveDialog = "edit" | "expense" | "copy" | null;

export function OrderActions({
  order,
  options,
  visits,
  canWrite,
  canWriteFinance,
  dispatchVisitId,
  canScheduleVisit,
}: {
  order: OrderDetail;
  options: OrderCreationOptions;
  visits: ServiceVisit[];
  canWrite: boolean;
  canWriteFinance: boolean;
  dispatchVisitId: string | null;
  canScheduleVisit: boolean;
}) {
  const [active, setActive] = useState<ActiveDialog>(null);
  const [requestKey, setRequestKey] = useState<string | null>(null);
  const close = useCallback(() => {
    setActive(null);
    setRequestKey(null);
  }, []);

  return (
    <>
      <div className="grid w-full min-w-0 grid-cols-2 gap-2 lg:grid-cols-4 xl:flex xl:w-auto xl:flex-wrap xl:items-center">
        <VisitDispatchCardButton
          visitId={dispatchVisitId}
          label="Карточка"
          className="w-full xl:w-auto"
        />
        {canWrite ? (
          <>
            <button
              onClick={() => setActive("edit")}
              className="focus-ring flex h-10 min-w-0 w-full items-center justify-center gap-2 rounded-[13px] bg-[var(--accent)] px-2 text-xs font-semibold text-[var(--on-accent)] min-[720px]:px-3 xl:w-auto xl:px-4"
            >
              <Pencil className="size-4 shrink-0" />
              <span className="min-[720px]:hidden">Изменить</span><span className="hidden min-[720px]:inline">Редактировать</span>
            </button>
            <button
              onClick={() => {
                setRequestKey(crypto.randomUUID());
                setActive("copy");
              }}
              className="focus-ring flex h-10 min-w-0 w-full items-center justify-center gap-2 rounded-[13px] border border-[var(--line-strong)] px-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] min-[720px]:px-3 xl:w-auto"
            >
              <Copy className="size-4 shrink-0" />
              Копия и серия
            </button>
            {canWriteFinance ? <button
              onClick={() => {
                setRequestKey(crypto.randomUUID());
                setActive("expense");
              }}
              className="focus-ring flex h-10 min-w-0 w-full items-center justify-center gap-2 rounded-[13px] border border-[var(--line-strong)] px-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] min-[720px]:px-3 xl:w-auto"
            >
              <Plus className="size-4 shrink-0" />
              Расход
            </button> : null}
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
          <EditOrderForm order={order} options={options} canWriteFinance={canWriteFinance} onClose={close} />
        ) : null}
      </Dialog>
      <Dialog
        open={active === "copy"}
        onClose={close}
        title="Копия и серия"
        description="Создайте новый заказ или добавьте выезды к текущему."
      >
        {(active === "copy") && requestKey ? (
          <CopyOrderForm
            order={order}
            options={options}
            visits={visits}
            canWriteFinance={canWriteFinance}
            requestKey={requestKey}
            canScheduleVisit={canScheduleVisit}
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
