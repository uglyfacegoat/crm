"use client";

import { DateInput, TimeInput } from "@/components/ui/date-time-inputs";
import { MultiDateCalendar } from "@/components/ui/multi-date-calendar";
import { ServiceChoice, resolveServiceChoice } from "@/components/catalog/service-choice";
import type { ObjectServiceProfile } from "@/server/catalog/object-service-profiles";
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
import { useActionState, useCallback, useEffect, useMemo, useState } from "react";
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
import { generateVisitRecurrenceDates, type VisitRecurrenceUnit } from "@/lib/visits/recurrence";
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
function localToday() {
  const date = new Date();
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())).toISOString().slice(0, 10);
}
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
  const [contractProfile, setContractProfile] = useState<ObjectServiceProfile | null>(null);
  useEffect(() => {
    if (!order.objectId) return;
    const controller = new AbortController();
    fetch(`/api/v1/services/object/${order.objectId}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => response.ok ? (await response.json() as { data: ObjectServiceProfile }).data : null)
      .then((profile) => { if (!controller.signal.aborted) setContractProfile(profile); })
      .catch(() => { if (!controller.signal.aborted) setContractProfile(null); });
    return () => controller.abort();
  }, [order.objectId]);
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
                  <div className="sm:col-span-3"><ServiceChoice value={service.catalogItemId ?? ""} items={options.catalogItems ?? []} profile={contractProfile} onChange={(value, selectedItem) => {
                    const item = selectedItem ?? options.catalogItems?.find((candidate) => candidate.id === value);
                    if (!item) { updateService(service.id, { catalogItemId: null }); return; }
                    const choice = resolveServiceChoice(item, contractProfile);
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
      className={`focus-within:outline focus-within:outline-2 focus-within:outline-offset-[-2px] focus-within:outline-[var(--focus)] flex cursor-pointer items-center gap-3 rounded-[12px] border px-3 py-3 transition-colors ${checked ? "border-[var(--accent)]/25 bg-[var(--accent)]/[0.055]" : "border-[var(--line)] bg-[var(--surface-inset)] hover:bg-[var(--surface-soft)]"}`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={`grid size-5 shrink-0 place-items-center rounded-[6px] border ${checked ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--on-accent)]" : "border-[var(--line-strong)] text-transparent"}`}
      >
        <Check className="size-3.5" />
      </span>
      {icon ? (
        <span className="grid size-5 shrink-0 place-items-center text-[var(--text-secondary)]">{icon}</span>
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
  options,
  visits,
  canWriteFinance,
  requestKey,
  onClose,
}: {
  order: OrderDetail;
  options: OrderCreationOptions;
  visits: ServiceVisit[];
  canWriteFinance: boolean;
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
  const [copyContact, setCopyContact] = useState(Boolean(order.contactId));
  const [copyRelatedObjects, setCopyRelatedObjects] = useState(true);
  const [copyMaster, setCopyMaster] = useState(false);
  const [copyNotes, setCopyNotes] = useState(Boolean(order.notes));
  const [copyMode, setCopyMode] = useState<"single" | "dates" | "repeat">("single");
  const [singleCopyDate, setSingleCopyDate] = useState("");
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  type DateOverride = { date: string; assignedMasterId?: string | null; masterPayment?: string | null; serviceIds?: string[]; expenseIds?: string[]; extraServices?: Array<{ catalogItemId?: string | null; name: string; kind: "service" | "product"; unit: string; quantity: string; unitPrice: string }>; notes?: string | null; visitNotes?: string | null; arrivalMode?: "fixed" | "window"; startTime?: string; endTime?: string };
  const [dateOverrides, setDateOverrides] = useState<DateOverride[]>([]);
  const [selectedMasterNames, setSelectedMasterNames] = useState<Record<string, string>>({});
  const [contractProfile, setContractProfile] = useState<ObjectServiceProfile | null>(null);
  useEffect(() => {
    if (!order.objectId) return;
    const controller = new AbortController();
    fetch(`/api/v1/services/object/${order.objectId}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => response.ok ? (await response.json() as { data: ObjectServiceProfile }).data : null)
      .then((profile) => { if (!controller.signal.aborted) setContractProfile(profile); })
      .catch(() => { if (!controller.signal.aborted) setContractProfile(null); });
    return () => controller.abort();
  }, [order.objectId]);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [repeatStartsOn, setRepeatStartsOn] = useState(localToday);
  const [repeatEndsOn, setRepeatEndsOn] = useState(() => new Date(Date.parse(`${localToday()}T00:00:00Z`) + 365 * 86_400_000).toISOString().slice(0, 10));
  const [repeatUnit, setRepeatUnit] = useState<VisitRecurrenceUnit>("month");
  const [repeatInterval, setRepeatInterval] = useState(1);
  const today = localToday();
  const maxSeriesDate = new Date(Date.parse(`${today}T00:00:00Z`) + 365 * 86_400_000).toISOString().slice(0, 10);
  const repeatedDates = useMemo(() => {
    try { return generateVisitRecurrenceDates(repeatStartsOn, repeatEndsOn, repeatUnit, repeatInterval); }
    catch { return []; }
  }, [repeatStartsOn, repeatEndsOn, repeatUnit, repeatInterval]);
  const copyDates = copyMode === "dates" ? selectedDates : copyMode === "repeat" ? repeatedDates : [];
  const configuredDates = copyMode === "single" ? (singleCopyDate ? [singleCopyDate] : []) : [...copyDates].sort();
  const selectedConfigDate = expandedDate && configuredDates.includes(expandedDate) ? expandedDate : configuredDates[0] ?? null;
  function changeDate(date: string, patch: Partial<DateOverride>) {
    setDateOverrides((current) => {
      const existing = current.find((item) => item.date === date) ?? { date };
      return [...current.filter((item) => item.date !== date), { ...existing, ...patch }];
    });
  }
  const eligibleVisits = visits.filter(
    (visit) =>
      (visit.statusCode === "planned" || visit.statusCode === "confirmed"),
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
      <input type="hidden" name="copyContact" value={String(copyContact)} />
      <input type="hidden" name="copyRelatedObjects" value={String(copyRelatedObjects)} />
      <input type="hidden" name="copyNotes" value={String(copyNotes)} />
      <input type="hidden" name="copyDates" value={JSON.stringify(copyDates)} />
      <input type="hidden" name="dateOverrides" value={JSON.stringify(dateOverrides.filter((entry) => configuredDates.includes(entry.date)).map((entry) => ({ ...entry, masterPayment: entry.masterPayment || undefined, startTime: entry.startTime || undefined, endTime: entry.endTime || undefined, visitNotes: entry.visitNotes || undefined })))} />
      <div className="flex-1 space-y-6 p-5 sm:p-7">
        <div role="group" aria-label="Способ копирования" className="grid grid-cols-3 gap-1 rounded-xl bg-[var(--surface-inset)] p-1">
          <button type="button" aria-pressed={copyMode === "single"} onClick={() => setCopyMode("single")} className={`focus-ring min-h-11 rounded-lg px-2 text-xs font-semibold ${copyMode === "single" ? "bg-[var(--accent)] text-[var(--on-accent)]" : "bg-[var(--surface)] text-[var(--text)]"}`}>Одна копия</button>
          <button type="button" aria-pressed={copyMode === "repeat"} onClick={() => setCopyMode("repeat")} className={`focus-ring min-h-11 rounded-lg px-1 text-xs font-semibold ${copyMode === "repeat" ? "bg-[var(--accent)] text-[var(--on-accent)]" : "bg-[var(--surface)] text-[var(--text)]"}`}>По интервалу</button>
          <button type="button" aria-pressed={copyMode === "dates"} onClick={() => setCopyMode("dates")} className={`focus-ring min-h-11 rounded-lg px-1 text-xs font-semibold ${copyMode === "dates" ? "bg-[var(--accent)] text-[var(--on-accent)]" : "bg-[var(--surface)] text-[var(--text)]"}`}>Выбрать даты</button>
        </div>
        {copyMode === "single" ? <div className="grid gap-3 rounded-[14px] border border-[var(--line)] bg-[var(--surface-inset)] p-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <OrderField
            label="Дата новой копии"
            required
            errors={state.fieldErrors.copyDate}
          >
            <DateInput name="copyDate" value={singleCopyDate} onChange={setSingleCopyDate} required className={orderInputClass} />
          </OrderField>
          <div className="pb-1 text-[10px] leading-4 text-[var(--muted)] sm:max-w-48">
            Первый выбранный выезд встанет на эту дату. Остальные сохранят
            интервалы.
          </div>
        </div> : <div className="space-y-3">
          <p className="text-xs leading-5 text-[var(--muted)]">На каждую дату создадим отдельный заказ с отмеченными ниже данными. Копии будут связаны в группу.</p>
          {copyMode === "dates" ? <MultiDateCalendar dates={selectedDates} onChange={(nextDates) => {
            const added = nextDates.find((date) => !selectedDates.includes(date));
            setSelectedDates(nextDates);
            if (added) setExpandedDate(added);
            else if (expandedDate && !nextDates.includes(expandedDate)) setExpandedDate(nextDates[0] ?? null);
          }} minDate={today} maxDate={maxSeriesDate} limit={24} showSelectedDates={false} /> : <div className="grid gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 sm:grid-cols-2">
            <OrderField label="Первая дата"><DateInput value={repeatStartsOn} onChange={setRepeatStartsOn} /></OrderField>
            <OrderField label="До даты"><DateInput value={repeatEndsOn} onChange={setRepeatEndsOn} /></OrderField>
            <OrderPicker label="Повторять" value={repeatUnit} onChange={(value) => setRepeatUnit(value as VisitRecurrenceUnit)} options={[{ value: "week", label: "Каждые N недель" }, { value: "month", label: "Каждые N месяцев" }]} placeholder="Выберите период" />
            <OrderField label="Каждые"><input type="number" min="1" max="12" value={repeatInterval} onChange={(event) => setRepeatInterval(Number(event.target.value))} className={orderInputClass} /></OrderField>
            <p className="text-xs text-[var(--muted)] sm:col-span-2">Получится заказов: {repeatedDates.length}. За один раз можно создать не больше 24 копий.</p>
          </div>}
          <input type="hidden" name="copyDate" value={copyDates[0] ?? ""} />
          {state.fieldErrors.copyDates?.[0] ? <p role="alert" className="text-xs text-[var(--danger-ink)]">{state.fieldErrors.copyDates[0]}</p> : null}

        </div>}
        {configuredDates.length ? <section className="space-y-2 rounded-xl border border-[var(--line)] bg-[var(--surface-inset)] p-3 sm:p-4">
            <div>
              <p className="text-sm font-semibold">{copyMode === "single" ? "Настройки копии" : "Настройки по датам"}</p>
              <p className="text-xs text-[var(--muted)]">Общие параметры ниже действуют для всех копий. Здесь можно изменить только выбранную дату.</p>
            </div>
            {configuredDates.length > 1 ? <OrderPicker label="Настроить дату" value={selectedConfigDate ?? ""} onChange={setExpandedDate} options={configuredDates.map((date) => ({
              value: date,
              label: new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)),
              detail: dateOverrides.some((entry) => entry.date === date) ? "Индивидуальные настройки" : "Общие настройки",
            }))} placeholder="Выберите дату" searchPlaceholder="Найти дату" /> : null}
            {selectedConfigDate ? [selectedConfigDate].map((date) => {
              const entry = dateOverrides.find((item) => item.date === date);
              const effectiveServices = entry?.serviceIds ?? serviceIds;
              const effectiveExpenses = entry?.expenseIds ?? expenseIds;
              return <div key={date} className="rounded-lg border border-[var(--line)] bg-[var(--surface)]">
                <div className="flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left text-sm font-medium">
                  <span>{new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`))}</span>
                  <span className="text-xs text-[var(--muted)]">{entry ? "Есть изменения" : "Как у всех"}</span>
                </div>
                <div className="space-y-4 border-t border-[var(--line)] p-3">
                  <OrderPicker label="Мастер на эту дату" value={entry?.assignedMasterId === undefined ? "default" : entry.assignedMasterId ?? "none"} onChange={(value) => changeDate(date, { assignedMasterId: value === "default" ? undefined : value === "none" ? null : value })} onSelected={(option) => setSelectedMasterNames((current) => ({ ...current, [option.value]: option.label }))} options={[{ value: "default", label: "Как в общих настройках" }, { value: "none", label: "Без мастера" }, ...options.masters.map((master) => ({ value: master.id, label: master.name, detail: master.phone }))]} pinnedValues={["default", "none"]} remote={{ type: "masters" }} searchPlaceholder="Имя или телефон" placeholder="Выберите мастера" />
                  {canWriteFinance ? <OrderField label="Выплата мастеру, ₽"><input inputMode="decimal" value={entry?.masterPayment ?? ""} onChange={(event) => changeDate(date, { masterPayment: event.target.value })} disabled={entry?.assignedMasterId === null || (entry?.assignedMasterId === undefined && !copyMaster)} placeholder="Как в общих настройках" className={orderInputClass} /></OrderField> : null}
                  <div>
                    <p className="mb-2 text-xs font-semibold">Время выезда на эту дату</p>
                    <div className="mb-3 flex flex-wrap gap-2">
                      <button type="button" aria-pressed={entry?.arrivalMode === "fixed"} onClick={() => changeDate(date, { arrivalMode: "fixed", endTime: undefined })} className={`focus-ring min-h-10 rounded-lg border px-3 text-xs ${entry?.arrivalMode === "fixed" ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line)]"}`}>Точное время</button>
                      <button type="button" aria-pressed={entry?.arrivalMode === "window"} onClick={() => changeDate(date, { arrivalMode: "window" })} className={`focus-ring min-h-10 rounded-lg border px-3 text-xs ${entry?.arrivalMode === "window" ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line)]"}`}>Интервал</button>
                      {entry?.arrivalMode ? <button type="button" onClick={() => changeDate(date, { arrivalMode: undefined, startTime: undefined, endTime: undefined })} className="focus-ring min-h-10 rounded-lg border border-[var(--line)] px-3 text-xs">Без изменения времени</button> : null}
                    </div>
                    {entry?.arrivalMode ? <div className="grid gap-3 sm:grid-cols-2">
                      <OrderField label={entry.arrivalMode === "fixed" ? "Время прибытия" : "Начало интервала"}><TimeInput name="overrideStartTime" value={entry.startTime ?? ""} onChange={(value) => changeDate(date, { startTime: value })} required className={orderInputClass} /></OrderField>
                      {entry.arrivalMode === "window" ? <OrderField label="Окончание интервала"><TimeInput name="overrideEndTime" value={entry.endTime ?? ""} onChange={(value) => changeDate(date, { endTime: value })} required className={orderInputClass} /></OrderField> : null}
                    </div> : null}
                    <p className="mt-2 text-xs text-[var(--muted)]">{visitIds.length ? "Время изменит первый скопированный выезд." : entry?.arrivalMode ? "На эту дату будет создан новый выезд." : "Без времени заказ останется без выезда."}</p>
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-semibold">Услуги этой копии</p>
                    <div className="grid gap-2">{order.services.map((service) => <SelectionRow key={service.id} checked={effectiveServices.includes(service.id)} onChange={(checked) => changeDate(date, { serviceIds: checked ? [...effectiveServices, service.id] : effectiveServices.filter((id) => id !== service.id) })} title={service.name} detail={`${service.quantity} ${service.unit ?? "усл."} · ${service.pricePending ? "цена уточняется" : formatMoneyMinor(service.lineTotalMinor)}`} />)}</div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold">Добавить услугу или товар только сюда</p><button type="button" className="focus-ring text-xs font-medium underline" onClick={() => changeDate(date, { extraServices: [...(entry?.extraServices ?? []), { catalogItemId: null, name: "", kind: "service", unit: "усл.", quantity: "1", unitPrice: "" }] })}>+ Добавить</button></div>
                    {(entry?.extraServices ?? []).map((service, index) => {
                      const replace = (patch: Partial<typeof service>) => changeDate(date, { extraServices: (entry?.extraServices ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) });
                      return <div key={index} className="space-y-3 rounded-lg border border-[var(--line)] bg-[var(--surface-inset)] p-3">
                        <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><ServiceChoice value={service.catalogItemId ?? ""} items={(options.catalogItems ?? []).filter((item) => item.active)} profile={contractProfile} onChange={(value, selectedItem) => {
                          const item = selectedItem ?? options.catalogItems?.find((candidate) => candidate.id === value);
                          if (!item) { replace({ catalogItemId: null }); return; }
                          const choice = resolveServiceChoice(item, contractProfile);
                          replace({ catalogItemId: choice.catalogItemId, name: choice.name, kind: item.kind, unit: item.unit, quantity: choice.quantity, unitPrice: choice.unitPrice });
                        }} /></div><button type="button" aria-label="Удалить услугу из этой даты" onClick={() => changeDate(date, { extraServices: (entry?.extraServices ?? []).filter((_, itemIndex) => itemIndex !== index) })} className="focus-ring mt-5 grid size-10 shrink-0 place-items-center rounded-lg border border-[var(--line)]"><Trash2 className="size-4" /></button></div>
                        <div className="grid gap-2 sm:grid-cols-2"><OrderField label="Название"><input value={service.name} onChange={(event) => replace({ name: event.target.value, catalogItemId: null })} className={orderInputClass} /></OrderField><OrderPicker label="Тип позиции" value={service.kind} onChange={(value) => replace({ kind: value as "service" | "product", catalogItemId: null })} options={[{ value: "service", label: "Услуга" }, { value: "product", label: "Товар" }]} placeholder="Выберите тип" /></div>
                        <div className="grid gap-2 sm:grid-cols-3"><OrderField label="Единица"><input value={service.unit} onChange={(event) => replace({ unit: event.target.value })} className={orderInputClass} /></OrderField><OrderField label="Количество"><input value={service.quantity} onChange={(event) => replace({ quantity: event.target.value })} inputMode="decimal" className={orderInputClass} /></OrderField><OrderField label="Цена, ₽"><input value={service.unitPrice} onChange={(event) => replace({ unitPrice: event.target.value })} inputMode="decimal" placeholder="Уточняется" className={orderInputClass} /></OrderField></div>
                      </div>;
                    })}
                  </div>
                  <OrderField label="Заметка этой копии"><textarea value={entry?.notes === undefined ? (copyNotes ? order.notes ?? "" : "") : entry.notes ?? ""} onChange={(event) => changeDate(date, { notes: event.target.value })} className={orderTextareaClass} placeholder="Условия только для этой даты" /></OrderField>
                  {visitIds.length ? <OrderField label="Инструкция для выезда"><textarea value={entry?.visitNotes ?? ""} onChange={(event) => changeDate(date, { visitNotes: event.target.value })} className={orderTextareaClass} placeholder="Если оставить пустым, инструкция останется как в исходном выезде" /></OrderField> : null}
                  {order.expenses.length ? <div><p className="mb-2 text-xs font-semibold">Расходы этой копии</p><div className="grid gap-2">{order.expenses.map((expense) => <SelectionRow key={expense.id} checked={effectiveExpenses.includes(expense.id)} onChange={(checked) => changeDate(date, { expenseIds: checked ? [...effectiveExpenses, expense.id] : effectiveExpenses.filter((id) => id !== expense.id) })} title={`${expense.category} · ${formatMoneyMinor(expense.amountMinor)}`} detail="Будет учтён только в этом заказе" />)}</div></div> : null}
                </div>
              </div>;
            }) : null}
            {state.fieldErrors.dateOverrides?.[0] ? <p role="alert" className="text-xs text-[var(--danger-ink)]">{state.fieldErrors.dateOverrides[0]}</p> : null}
        </section> : null}
        <section>
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                Услуги
              </p>
              <p className="mt-1 text-[10px] text-[var(--muted-subtle)]">
                Можно снять все, если услуги нужно заполнить позже
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
                detail={`${service.kind === "product" ? "Товар · " : "Услуга · "}${service.quantity} ${service.unit ?? "усл."} × ${service.pricePending ? "цена уточняется" : formatMoneyMinor(service.unitPriceMinor)} · ${service.pricePending ? "цена уточняется" : formatMoneyMinor(service.lineTotalMinor)}`}
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
          {order.contactId ? <SelectionRow checked={copyContact} onChange={setCopyContact} icon={<UserRound className="size-4" />} title="Контакт заказчика" detail={`${order.contactName}${order.contactPhone ? ` · ${order.contactPhone}` : ""}`} /> : null}
          {(order.relatedObjects?.length ?? 0) > 1 ? <SelectionRow checked={copyRelatedObjects} onChange={setCopyRelatedObjects} title="Дополнительные объекты" detail={`${(order.relatedObjects?.length ?? 1) - 1} объектов помимо основного`} /> : null}
          <SelectionRow
            checked={copyMaster}
            onChange={setCopyMaster}
            icon={<UserRound className="size-4" />}
            title={canWriteFinance ? "Мастер и выплата" : "Мастер"}
            detail={
              order.master
                ? canWriteFinance ? `${order.master} · ${order.masterPaymentMinor === null ? "выплата не указана" : formatMoneyMinor(order.masterPaymentMinor)}` : order.master
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
        {configuredDates.length ? <details className="group rounded-[12px] border border-[var(--line)] bg-[var(--surface)]">
          <summary className="focus-ring flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 text-xs font-semibold">Проверить перед созданием · {configuredDates.length}<span aria-hidden="true" className="text-[var(--muted)] group-open:rotate-180">⌄</span></summary>
          <div className="max-h-64 divide-y divide-[var(--line)] overflow-y-auto border-t border-[var(--line)] px-3">
            {configuredDates.map((date) => {
              const override = dateOverrides.find((entry) => entry.date === date);
              const master = override?.assignedMasterId === null ? "Без мастера" : override?.assignedMasterId ? selectedMasterNames[override.assignedMasterId] ?? options.masters.find((item) => item.id === override.assignedMasterId)?.name ?? "Выбранный мастер" : copyMaster ? order.master ?? "Без мастера" : "Без мастера";
              const time = override?.arrivalMode === "fixed" ? override.startTime ? `Точно ${override.startTime}` : "Время не указано" : override?.arrivalMode === "window" ? override.startTime && override.endTime ? `${override.startTime}–${override.endTime}` : "Интервал не указан" : visitIds.length ? `${visitIds.length} выездов из заказа` : "Без выезда";
              const serviceCount = (override?.serviceIds ?? serviceIds).length + (override?.extraServices?.length ?? 0);
              return <div key={date} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 text-xs">
                <span className="font-medium">{new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`))}</span>
                <span className="text-[var(--muted)]">{time} · {master} · {serviceCount} поз.{override?.notes !== undefined ? " · своя заметка" : ""}</span>
              </div>;
            })}
          </div>
        </details> : null}
        <p className="rounded-[12px] border border-[var(--info-border)]/45 bg-[var(--info-bg)] p-3 text-[10px] leading-4 text-[var(--info)]">
          {copyMode !== "single" ? `Будет создано заказов: ${copyDates.length}. ` : ""}Каждая копия получит новый номер; при наличии выезда статус будет «Запланирован». Оплаты, счета, закрывающие
          акты и история оригинала не переносятся.
        </p>
        <OrderFormStatus state={state} />
      </div>
      <OrderFormFooter
        pending={pending}
        saved={state.status === "success"}
        onCancel={onClose}
        submitLabel={copyMode !== "single" ? `Создать ${copyDates.length || ""} заказов`.trim() : "Создать копию"}
        disabled={copyMode !== "single" && (!copyDates.length || copyDates.length > 24)}
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
}: {
  order: OrderDetail;
  options: OrderCreationOptions;
  visits: ServiceVisit[];
  canWrite: boolean;
  canWriteFinance: boolean;
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
              Копия
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
        title={`Копия заказа ${order.number}`}
        description="Выберите только те данные, которые должны стать частью нового независимого заказа."
      >
        {active === "copy" && requestKey ? (
          <CopyOrderForm
            order={order}
            options={options}
            visits={visits}
            canWriteFinance={canWriteFinance}
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
