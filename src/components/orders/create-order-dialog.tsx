"use client";

import { DateInput } from "@/components/ui/date-time-inputs";
import { Plus, Trash2 } from "lucide-react";
import { useActionState, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createOrderAction, type CreateOrderState } from "@/app/(workspace)/orders/actions";
import { Dialog } from "@/components/ui/dialog";
import { formatMoneyMinor } from "@/lib/format";
import type { OrderPickerResult } from "@/lib/order-picker";
import { clientCrypto as crypto } from "@/lib/client-id";
import { calculateServiceLineTotalMinor, parseMoneyToMinorUnits, parseQuantityToMilliunits } from "@/server/orders/money";
import type { OrderCreationOptions } from "@/server/orders/types";
import { OrderField, OrderFormFooter, OrderFormStatus, orderInputClass, OrderPicker, orderTextareaClass } from "./order-form-parts";

type ServiceDraft = { id: string; name: string; quantity: string; unitPrice: string; note: string };
type ExpenseDraft = { id: string; category: string; amount: string; occurredOn: string; note: string };
const initialCreateOrderState: CreateOrderState = { status: "idle", message: null, fieldErrors: {}, orderId: null };

function lineTotal(service: ServiceDraft) {
  try {
    return Number(calculateServiceLineTotalMinor(parseMoneyToMinorUnits(service.unitPrice), parseQuantityToMilliunits(service.quantity)));
  } catch {
    return 0;
  }
}

function CreateOrderForm({ requestKey, options, onComplete }: { requestKey: string; options: OrderCreationOptions; onComplete: () => void }) {
  const [state, action, pending] = useActionState(createOrderAction, initialCreateOrderState);
  const [clientId, setClientId] = useState("");
  const [objectId, setObjectId] = useState("");
  const [contactId, setContactId] = useState("");
  const [masterId, setMasterId] = useState("");
  const [relatedOptions, setRelatedOptions] = useState({ objects: options.objects, contacts: options.contacts });
  const [relationsError, setRelationsError] = useState(false);
  const [relationsRetry, setRelationsRetry] = useState(0);
  const [services, setServices] = useState<ServiceDraft[]>([{ id: "service-1", name: "", quantity: "1", unitPrice: "", note: "" }]);
  const [expenses, setExpenses] = useState<ExpenseDraft[]>([]);
  const router = useRouter();

  useEffect(() => {
    if (state.status !== "success" || !state.orderId) return;
    router.push(`/orders/${state.orderId}`);
    router.refresh();
    const timeout = window.setTimeout(onComplete, 500);
    return () => window.clearTimeout(timeout);
  }, [onComplete, router, state.orderId, state.status]);

  useEffect(() => {
    if (!options.remote || !clientId) return;
    const controller = new AbortController();
    const load = async () => {
      setRelationsError(false);
      try {
        const params = new URLSearchParams({ clientId });
        const [objectResponse, contactResponse] = await Promise.all([
          fetch(`/api/v1/orders/options?${params}&type=objects`, { signal: controller.signal, cache: "no-store" }),
          fetch(`/api/v1/orders/options?${params}&type=contacts`, { signal: controller.signal, cache: "no-store" }),
        ]);
        if (!objectResponse.ok || !contactResponse.ok) throw new Error("Client relations request failed");
        const objectsPayload = await objectResponse.json() as { data: OrderPickerResult };
        const contactsPayload = await contactResponse.json() as { data: OrderPickerResult };
        if (controller.signal.aborted) return;
        const objects = objectsPayload.data.items.map((item) => ({ id: item.id, clientId, name: item.name, address: item.detail ?? "" }));
        const contacts = contactsPayload.data.items.map((item) => ({ id: item.id, clientId, name: item.name, phone: item.detail ?? "", isPrimary: item.isPrimary ?? false }));
        setRelatedOptions({ objects, contacts });
        setObjectId(objects[0]?.id ?? "");
        setContactId(contacts.find((contact) => contact.isPrimary)?.id ?? contacts[0]?.id ?? "");
      } catch {
        if (!controller.signal.aborted) setRelationsError(true);
      }
    };
    void load();
    return () => controller.abort();
  }, [clientId, options.remote, relationsRetry]);
  const objects = useMemo(() => relatedOptions.objects.filter((object) => object.clientId === clientId), [clientId, relatedOptions.objects]);
  const contacts = useMemo(() => relatedOptions.contacts.filter((contact) => contact.clientId === clientId), [clientId, relatedOptions.contacts]);
  const totalMinor = services.reduce((total, service) => total + lineTotal(service), 0);
  const ready = Boolean(clientId && objectId && contactId && services.length && services.every((service) => service.name.trim().length >= 2 && service.quantity.trim() && service.unitPrice.trim()));

  function chooseClient(value: string) {
    setClientId(value);
    setObjectId("");
    if (options.remote) setRelatedOptions({ objects: [], contacts: [] });
    const primary = options.remote ? null : options.contacts.find((contact) => contact.clientId === value && contact.isPrimary);
    setContactId(primary?.id ?? "");
  }

  function updateService(id: string, changes: Partial<ServiceDraft>) {
    setServices((current) => current.map((service) => service.id === id ? { ...service, ...changes } : service));
  }

  function updateExpense(id: string, changes: Partial<ExpenseDraft>) {
    setExpenses((current) => current.map((expense) => expense.id === id ? { ...expense, ...changes } : expense));
  }

  const serializedServices = services.map((service) => ({ name: service.name, quantity: service.quantity, unitPrice: service.unitPrice, note: service.note }));
  const serializedExpenses = expenses.map((expense) => ({ category: expense.category, amount: expense.amount, occurredOn: expense.occurredOn, note: expense.note }));

  return <form action={action} className="flex flex-1 flex-col"><input type="hidden" name="idempotencyKey" value={requestKey} /><input type="hidden" name="clientId" value={clientId} /><input type="hidden" name="objectId" value={objectId} /><input type="hidden" name="contactId" value={contactId} /><input type="hidden" name="assignedMasterId" value={masterId} /><input type="hidden" name="services" value={JSON.stringify(serializedServices)} /><input type="hidden" name="expenses" value={JSON.stringify(serializedExpenses)} />
    <div className="flex-1 space-y-7 p-5 sm:p-7">
      {options.clients.length === 0 ? <div className="rounded-[13px] border border-[var(--warning-border)]/45 bg-[var(--warning-bg)] p-4 text-xs leading-5 text-[var(--warning)]">Сначала создайте клиента, контакт и объект. Заказ без этих связей не сохраняется.</div> : null}
      <fieldset className="space-y-4"><legend className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Заказчик и объект</legend><OrderPicker label="Клиент" required value={clientId} onChange={chooseClient} options={options.clients.map((client) => ({ value: client.id, label: client.name }))} remote={options.remote ? { type: "clients" } : undefined} placeholder="Выберите клиента" searchable searchPlaceholder="Название или ИНН" errors={state.fieldErrors.clientId} /><OrderPicker key={`object-${clientId}`} label="Объект" required value={objectId} onChange={setObjectId} disabled={!clientId} options={objects.map((object) => ({ value: object.id, label: object.name, detail: object.address }))} remote={options.remote ? { type: "objects", clientId } : undefined} placeholder={clientId ? "Выберите объект" : "Сначала выберите клиента"} searchable searchPlaceholder="Название или адрес" errors={state.fieldErrors.objectId} /><OrderPicker key={`contact-${clientId}`} label="Контакт" required value={contactId} onChange={setContactId} disabled={!clientId} options={contacts.map((contact) => ({ value: contact.id, label: contact.name, detail: contact.phone }))} remote={options.remote ? { type: "contacts", clientId } : undefined} placeholder={clientId ? "Выберите контакт" : "Сначала выберите клиента"} searchable searchPlaceholder="Имя или телефон" errors={state.fieldErrors.contactId} />{relationsError ? <p role="alert" className="text-xs text-[var(--danger-ink)]">Не удалось загрузить объекты и контакты. <button type="button" onClick={() => setRelationsRetry((value) => value + 1)} className="underline">Повторить</button></p> : null}</fieldset>

      <fieldset><div className="flex items-center justify-between gap-3"><legend className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Состав заказа</legend><button type="button" onClick={() => setServices((current) => [...current, { id: crypto.randomUUID(), name: "", quantity: "1", unitPrice: "", note: "" }])} className="focus-ring flex h-9 items-center gap-1.5 rounded-[10px] border border-[var(--line-strong)] px-3 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--surface-soft)]"><Plus className="size-3.5" />Услуга</button></div><div className="mt-4 space-y-3">{services.map((service, index) => <div key={service.id} className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-inset)] p-3.5"><div className="flex items-center justify-between gap-3"><span className="text-[10px] text-[var(--muted)]">Услуга {index + 1}</span>{services.length > 1 ? <button type="button" onClick={() => setServices((current) => current.filter((candidate) => candidate.id !== service.id))} aria-label={`Удалить услугу ${index + 1}`} className="focus-ring grid size-8 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--danger-bg)] hover:text-[var(--danger-ink)]"><Trash2 className="size-3.5" /></button> : null}</div><div className="mt-2 grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_9rem]"><OrderField label="Название" required><input aria-label={`Название услуги ${index + 1}`} value={service.name} onChange={(event) => updateService(service.id, { name: event.target.value })} maxLength={200} placeholder="Дератизация" className={orderInputClass} /></OrderField><OrderField label="Количество" required><input aria-label={`Количество услуги ${index + 1}`} value={service.quantity} onChange={(event) => updateService(service.id, { quantity: event.target.value })} inputMode="decimal" placeholder="1" className={orderInputClass} /></OrderField><OrderField label="Цена, ₽" required><input aria-label={`Цена услуги ${index + 1}`} value={service.unitPrice} onChange={(event) => updateService(service.id, { unitPrice: event.target.value })} inputMode="decimal" placeholder="25 000" className={orderInputClass} /></OrderField></div><input aria-label={`Примечание к услуге ${index + 1}`} value={service.note} onChange={(event) => updateService(service.id, { note: event.target.value })} maxLength={1000} placeholder="Примечание к услуге" className={`${orderInputClass} mt-3 h-10 text-xs`} /></div>)}</div><div className="mt-4 flex items-center justify-between border-t border-[var(--line)] pt-4"><span className="text-xs text-[var(--muted)]">Итого по услугам</span><strong className="font-display text-sm text-[var(--text)]">{formatMoneyMinor(totalMinor)}</strong></div>{state.fieldErrors.services?.length ? <p className="mt-2 text-[10px] text-[var(--danger-ink)]">{state.fieldErrors.services[0]}</p> : null}</fieldset>

      <fieldset><div className="flex items-center justify-between gap-3"><legend className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Прямые расходы</legend><button type="button" onClick={() => setExpenses((current) => [...current, { id: crypto.randomUUID(), category: "", amount: "", occurredOn: "", note: "" }])} className="focus-ring flex h-9 items-center gap-1.5 rounded-[10px] border border-[var(--line-strong)] px-3 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--surface-soft)]"><Plus className="size-3.5" />Расход</button></div>{expenses.length ? <div className="mt-4 space-y-3">{expenses.map((expense, index) => <div key={expense.id} className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-inset)] p-3.5"><div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_9rem_auto]"><OrderField label="Категория" required><input aria-label={`Категория расхода ${index + 1}`} value={expense.category} onChange={(event) => updateExpense(expense.id, { category: event.target.value })} placeholder="Топливо" className={orderInputClass} /></OrderField><OrderField label="Сумма, ₽" required><input aria-label={`Сумма расхода ${index + 1}`} value={expense.amount} onChange={(event) => updateExpense(expense.id, { amount: event.target.value })} inputMode="decimal" className={orderInputClass} /></OrderField><OrderField label="Дата" required><DateInput aria-label={`Дата расхода ${index + 1}`} value={expense.occurredOn} onChange={(value) => updateExpense(expense.id, { occurredOn: value })} className={orderInputClass} /></OrderField><button type="button" onClick={() => setExpenses((current) => current.filter((candidate) => candidate.id !== expense.id))} aria-label={`Удалить расход ${index + 1}`} className="focus-ring mt-5 grid size-10 place-items-center rounded-[10px] text-[var(--muted)] hover:bg-[var(--danger-bg)] hover:text-[var(--danger-ink)]"><Trash2 className="size-3.5" /></button></div><input aria-label={`Примечание к расходу ${index + 1}`} value={expense.note} onChange={(event) => updateExpense(expense.id, { note: event.target.value })} placeholder="Комментарий" className={`${orderInputClass} mt-3 h-10 text-xs`} /></div>)}</div> : <p className="mt-3 text-xs leading-5 text-[var(--muted)]">Топливо, материалы и другие расходы можно внести сейчас или добавить позже в карточке.</p>}</fieldset>

      <fieldset className="space-y-4"><legend className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Исполнитель</legend><OrderPicker label="Мастер" value={masterId} onChange={setMasterId} options={[{ value: "", label: "Не назначен" }, ...options.masters.map((master) => ({ value: master.id, label: master.name, detail: master.phone }))]} remote={options.remote ? { type: "masters" } : undefined} placeholder="Не назначен" searchable searchPlaceholder="ФИО или телефон" errors={state.fieldErrors.assignedMasterId} /><OrderField label="Выплата мастеру, ₽" required={Boolean(masterId)} errors={state.fieldErrors.masterPayment}><input name="masterPayment" disabled={!masterId} required={Boolean(masterId)} inputMode="decimal" placeholder="4 000" className={orderInputClass} /></OrderField><OrderField label="Внутренняя заметка" errors={state.fieldErrors.notes}><textarea name="notes" maxLength={4000} placeholder="Условия заказа, особенности объекта, что проверить…" className={orderTextareaClass} /></OrderField></fieldset>
      <OrderFormStatus state={state} />
    </div><OrderFormFooter pending={pending} saved={state.status === "success"} onCancel={onComplete} submitLabel="Создать заказ" disabled={!ready || options.clients.length === 0} />
  </form>;
}

export function CreateOrderButton({ options }: { options: OrderCreationOptions }) {
  const [requestKey, setRequestKey] = useState<string | null>(null);
  const close = useCallback(() => setRequestKey(null), []);
  return <><button onClick={() => setRequestKey(crypto.randomUUID())} className="focus-ring flex h-11 items-center gap-2 rounded-[13px] bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--on-accent)]"><Plus className="size-4" />Новый заказ</button><Dialog open={requestKey !== null} onClose={close} title="Новый заказ" description="Клиентские связи, состав, выплаты и расходы сохраняются одной транзакцией.">{requestKey ? <CreateOrderForm requestKey={requestKey} options={options} onComplete={close} /> : null}</Dialog></>;
}
