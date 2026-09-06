"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarClock,
  Check,
  CheckCircle2,
  CircleAlert,
  ClipboardList,
  FilePenLine,
  LoaderCircle,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import { useActionState, useMemo, useRef, useState } from "react";
import { createQuickOrderAction, type QuickOrderState } from "@/app/(workspace)/quick-order/actions";
import { OrderField, OrderPicker, orderInputClass, orderTextareaClass } from "@/components/orders/order-form-parts";
import { DateInput, TimeInput } from "@/components/ui/date-time-inputs";
import { VisitDispatchCardButton } from "@/components/visits/visit-dispatch-card";
import { formatMoney } from "@/lib/format";
import { formatPhoneInput } from "@/lib/phone-input";
import type { IncomingLeadPrefill } from "@/server/incoming-leads/types";
import type { OrderCreationOptions } from "@/server/orders/types";

type ClientMode = "existing" | "new";
type ReferenceMode = "existing" | "new";

const steps = [
  { id: "quick-client-section", title: "Клиент", description: "Заказчик и контактное лицо", icon: UserRound },
  { id: "quick-object-section", title: "Объект", description: "Адрес и условия доступа", icon: Building2 },
  { id: "quick-work-section", title: "Работы", description: "Услуга, стоимость и мастер", icon: ClipboardList },
  { id: "quick-visit-section", title: "Выезд", description: "Дата, время и инструкция", icon: CalendarClock },
] as const;

const initialQuickOrderState: QuickOrderState = {
  status: "idle",
  message: null,
  fieldErrors: {},
  result: null,
};

const emptyObject = {
  name: "",
  objectType: "Коммерческий объект",
  address: "",
  areaSquareMeters: "",
  floorCount: "",
  onsiteContact: "",
  accessInstructions: "",
  parkingNotes: "",
  restrictions: "",
  riskLevel: "3",
  infestationLevel: "1",
};

function isValidOptionalEmail(value: string) {
  return !value.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function parseAmount(value: string) {
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : 0;
}

function formatDraftDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : "";
}

function ModeSwitch({ value, onChange, existingLabel, newLabel }: {
  value: ReferenceMode;
  onChange: (value: ReferenceMode) => void;
  existingLabel: string;
  newLabel: string;
}) {
  return <div className="grid grid-cols-2 border border-white/[0.08] bg-black/10 p-1">
    {([["existing", existingLabel], ["new", newLabel]] as const).map(([mode, label]) => (
      <button
        key={mode}
        type="button"
        onClick={() => onChange(mode)}
        aria-pressed={value === mode}
        className={`focus-ring min-h-11 px-3 text-xs font-medium transition-colors ${value === mode ? "bg-[var(--accent)] text-[#101308]" : "text-[#7d878d] hover:bg-white/[0.035] hover:text-white"}`}
      >
        {label}
      </button>
    ))}
  </div>;
}

function SectionIntro({ number, title, description }: { number: string; title: string; description: string }) {
  return <header className="mb-6 flex items-start gap-4">
    <span className="grid size-11 shrink-0 place-items-center border border-[var(--accent)]/20 bg-[var(--accent)]/[0.055] font-display text-xs font-semibold text-[var(--accent)]">{number}</span>
    <div>
      <h2 className="font-display text-xl font-semibold tracking-[-0.035em] text-white">{title}</h2>
      <p className="mt-1.5 max-w-2xl text-xs leading-5 text-[#778187]">{description}</p>
    </div>
  </header>;
}

function ObjectFields({ value, onChange }: { value: typeof emptyObject; onChange: (value: typeof emptyObject) => void }) {
  const set = (field: keyof typeof emptyObject, fieldValue: string) => onChange({ ...value, [field]: fieldValue });
  return <div className="grid gap-4 sm:grid-cols-2">
    <OrderField label="Название объекта" required><input data-testid="quick-object-name" value={value.name} onChange={(event) => set("name", event.target.value)} className={orderInputClass} placeholder="Склад на Лесной" /></OrderField>
    <OrderField label="Тип объекта" required><input value={value.objectType} onChange={(event) => set("objectType", event.target.value)} className={orderInputClass} placeholder="Склад, офис, производство" /></OrderField>
    <div className="sm:col-span-2"><OrderField label="Адрес" required><input data-testid="quick-object-address" value={value.address} onChange={(event) => set("address", event.target.value)} className={orderInputClass} placeholder="Город, улица, дом, корпус" /></OrderField></div>
    <OrderField label="Площадь, м²"><input inputMode="decimal" value={value.areaSquareMeters} onChange={(event) => set("areaSquareMeters", event.target.value)} className={orderInputClass} placeholder="500" /></OrderField>
    <OrderField label="Этажей"><input inputMode="numeric" value={value.floorCount} onChange={(event) => set("floorCount", event.target.value)} className={orderInputClass} placeholder="1" /></OrderField>
    <div className="sm:col-span-2"><OrderField label="Контакт и доступ на объект"><textarea value={value.onsiteContact} onChange={(event) => set("onsiteContact", event.target.value)} className={orderTextareaClass} placeholder="К кому обратиться, где вход, пропускной режим" /></OrderField></div>
  </div>;
}

function SummaryLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className="grid gap-1.5 border-b border-white/[0.07] py-3.5 last:border-0">
    <dt className="text-[9px] uppercase tracking-[0.13em] text-[#5f696f]">{label}</dt>
    <dd className={`min-w-0 break-words text-xs ${strong ? "font-semibold text-white" : "text-[#b8c0c3]"}`}>{value || "—"}</dd>
  </div>;
}

export function QuickOrderWorkspace({ options, idempotencyKey, defaultVisitDate, prefill }: {
  options: OrderCreationOptions;
  idempotencyKey: string;
  defaultVisitDate: string;
  prefill?: IncomingLeadPrefill;
}) {
  const suggestedClientId = prefill?.possibleClientId && options.clients.some((client) => client.id === prefill.possibleClientId)
    ? prefill.possibleClientId
    : null;
  const initialClientId = suggestedClientId ?? options.clients[0]?.id ?? "";
  const initialContactId = options.contacts.find((contact) => contact.clientId === initialClientId && contact.isPrimary)?.id
    ?? options.contacts.find((contact) => contact.clientId === initialClientId)?.id ?? "";
  const initialObjectId = options.objects.find((object) => object.clientId === initialClientId)?.id ?? "";
  const explicitSubmitRef = useRef(false);
  const sectionRefs = useRef<Array<HTMLElement | null>>([]);
  const [state, formAction, pending] = useActionState(createQuickOrderAction, initialQuickOrderState);
  const [step, setStep] = useState(0);
  const [clientMode, setClientMode] = useState<ClientMode>(prefill && !suggestedClientId ? "new" : options.clients.length ? "existing" : "new");
  const [clientId, setClientId] = useState(initialClientId);
  const [clientKind, setClientKind] = useState<"legal_entity" | "individual">(prefill ? "individual" : "legal_entity");
  const [clientName, setClientName] = useState(prefill?.contactName || prefill?.phone || prefill?.email || "");
  const [taxId, setTaxId] = useState("");
  const [contactName, setContactName] = useState(prefill?.contactName ?? "");
  const [contactPosition, setContactPosition] = useState("");
  const [contactPhone, setContactPhone] = useState(() => formatPhoneInput(prefill?.phone ?? ""));
  const [contactEmail, setContactEmail] = useState(prefill?.email ?? "");
  const [contactMode, setContactMode] = useState<ReferenceMode>(initialContactId ? "existing" : "new");
  const [contactId, setContactId] = useState(initialContactId);
  const [objectMode, setObjectMode] = useState<ReferenceMode>(initialObjectId ? "existing" : "new");
  const [objectId, setObjectId] = useState(initialObjectId);
  const [newObject, setNewObject] = useState(emptyObject);
  const [serviceName, setServiceName] = useState(prefill?.serviceInterest || "Дезинсекция и контроль вредителей");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [masterId, setMasterId] = useState("");
  const [masterPayment, setMasterPayment] = useState("");
  const [orderNotes, setOrderNotes] = useState(prefill?.orderNotes ?? "");
  const [visitDate, setVisitDate] = useState(defaultVisitDate);
  const [visitTime, setVisitTime] = useState("10:00");
  const [durationMinutes, setDurationMinutes] = useState("120");
  const [visitNotes, setVisitNotes] = useState("");

  const availableContacts = useMemo(() => options.contacts.filter((contact) => contact.clientId === clientId), [clientId, options.contacts]);
  const availableObjects = useMemo(() => options.objects.filter((object) => object.clientId === clientId), [clientId, options.objects]);
  const selectedClient = options.clients.find((client) => client.id === clientId);
  const selectedContact = availableContacts.find((contact) => contact.id === contactId);
  const selectedObject = availableObjects.find((object) => object.id === objectId);
  const selectedMaster = options.masters.find((master) => master.id === masterId);
  const contactEmailValid = isValidOptionalEmail(contactEmail);

  function selectClient(nextClientId: string) {
    const contacts = options.contacts.filter((contact) => contact.clientId === nextClientId);
    const objects = options.objects.filter((object) => object.clientId === nextClientId);
    setClientId(nextClientId);
    setContactId(contacts.find((contact) => contact.isPrimary)?.id ?? contacts[0]?.id ?? "");
    setObjectId(objects[0]?.id ?? "");
    setContactMode(contacts.length ? "existing" : "new");
    setObjectMode(objects.length ? "existing" : "new");
  }

  const effectiveContactMode = clientMode === "existing" && availableContacts.length ? contactMode : "new";
  const effectiveObjectMode = clientMode === "existing" && availableObjects.length ? objectMode : "new";
  const sectionValidity = [
    clientMode === "new"
      ? clientName.trim().length >= 2 && contactName.trim().length >= 2 && contactPhone.trim().length >= 7 && contactEmailValid && (clientKind === "individual" || /^\d{10}(\d{2})?$/.test(taxId))
      : Boolean(clientId) && (effectiveContactMode === "existing" ? Boolean(contactId) : contactName.trim().length >= 2 && contactPhone.trim().length >= 7 && contactEmailValid),
    effectiveObjectMode === "existing" ? Boolean(objectId) : newObject.name.trim().length >= 2 && newObject.objectType.trim().length >= 2 && newObject.address.trim().length >= 5,
    serviceName.trim().length >= 2 && parseAmount(quantity) > 0 && parseAmount(unitPrice) > 0 && (!masterId || (masterPayment.trim().length > 0 && parseAmount(masterPayment) >= 0)),
    Boolean(visitDate) && /^\d{2}:\d{2}$/.test(visitTime) && Number(durationMinutes) >= 15,
  ] as const;
  const allSectionsValid = sectionValidity.every(Boolean);
  const completedSections = sectionValidity.filter(Boolean).length;
  const serviceTotal = parseAmount(quantity) * parseAmount(unitPrice);
  const draftClientName = clientMode === "existing" ? selectedClient?.name ?? "" : clientName;
  const draftContactName = effectiveContactMode === "existing" ? selectedContact?.name ?? "" : contactName;
  const draftPhone = effectiveContactMode === "existing" ? selectedContact?.phone ?? "" : contactPhone;
  const draftObjectName = effectiveObjectMode === "existing" ? selectedObject?.name ?? "" : newObject.name;
  const draftAddress = effectiveObjectMode === "existing" ? selectedObject?.address ?? "" : newObject.address;

  const payload = {
    idempotencyKey,
    sourceLead: prefill ? { id: prefill.sourceLeadId, expectedVersion: prefill.sourceLeadVersion } : null,
    client: clientMode === "new" ? {
      mode: "new" as const,
      details: { kind: clientKind, legalName: clientName, taxId, contactName, contactPosition, phone: contactPhone, email: contactEmail },
      object: newObject,
    } : {
      mode: "existing" as const,
      clientId,
      contact: effectiveContactMode === "existing"
        ? { mode: "existing" as const, contactId }
        : { mode: "new" as const, details: { fullName: contactName, position: contactPosition, phone: contactPhone, email: contactEmail } },
      object: effectiveObjectMode === "existing"
        ? { mode: "existing" as const, objectId }
        : { mode: "new" as const, details: newObject },
    },
    order: {
      assignedMasterId: masterId,
      masterPayment,
      notes: orderNotes,
      services: [{ name: serviceName, quantity, unitPrice, note: "" }],
      expenses: [],
    },
    visit: { localDate: visitDate, localTime: visitTime, durationMinutes, assignedMasterId: masterId, notes: visitNotes },
  };

  function goToSection(index: number) {
    setStep(index);
    sectionRefs.current[index]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function continueFlow() {
    if (!sectionValidity[step]) return;
    goToSection(Math.min(steps.length - 1, step + 1));
  }

  if (state.status === "success" && state.result) {
    return <section data-testid="quick-order-success" className="mx-auto max-w-3xl overflow-hidden border border-[#69d3a4]/20 bg-[#0e1418] shadow-[0_24px_80px_rgba(0,0,0,0.2)]">
      <div className="border-b border-white/[0.065] p-5 sm:p-8">
        <span className="grid size-12 place-items-center bg-[#69d3a4]/10 text-[#69d3a4]"><CheckCircle2 className="size-6" /></span>
        <p className="eyebrow mt-5">Операция завершена</p>
        <h2 className="mt-2 font-display text-2xl font-semibold tracking-[-0.04em] text-white">{state.result.orderNumber} готов к работе</h2>
        <p className="mt-3 max-w-xl text-sm leading-6 text-[#7f898e]">Клиент, объект, заказ, выезд и напоминание сохранены. Теперь можно открыть карточку и сразу отправить её мастеру.</p>
      </div>
      <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-8">
        <VisitDispatchCardButton visitId={state.result.visitId} className="h-12 bg-[var(--accent)] font-semibold text-[#111509] hover:bg-[#f4f854]" />
        <Link href={`/orders/${state.result.orderId}`} className="focus-ring flex h-12 items-center justify-center border border-white/[0.09] text-xs font-medium text-[#c5cbce] hover:bg-white/[0.04]">Открыть заказ</Link>
        <a href={prefill ? "/inbox" : "/quick-order"} className="focus-ring flex h-11 items-center justify-center text-xs text-[#778187] hover:text-white sm:col-span-2">{prefill ? "Вернуться во входящие" : "Оформить ещё один"}</a>
      </div>
    </section>;
  }

  return <form
    action={formAction}
    data-testid="quick-order-form"
    className="overflow-hidden border-y border-white/[0.1] bg-[#0b1013] shadow-[0_32px_90px_rgba(0,0,0,0.2)] xl:border"
    onKeyDown={(event) => {
      if (event.key === "Enter" && !(event.target instanceof HTMLTextAreaElement)) event.preventDefault();
    }}
    onSubmit={(event) => {
      if (!explicitSubmitRef.current || step !== steps.length - 1 || !allSectionsValid || pending) {
        event.preventDefault();
        return;
      }
      explicitSubmitRef.current = false;
    }}
  >
    <input type="hidden" name="payload" value={JSON.stringify(payload)} />

    <header className="flex items-center justify-between gap-4 border-b border-white/[0.1] bg-[#080d10] px-4 py-5 sm:px-6 lg:px-8">
      <div>
        <p className="eyebrow">{prefill ? "Проверка входящей заявки" : "Новый заказ"}</p>
        <h1 className="mt-2 font-display text-[clamp(1.65rem,1.35rem+0.8vw,2.5rem)] font-medium tracking-[-0.045em] text-white">{prefill ? "Уточнить и принять заявку" : "Оформить заказ"}</h1>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden items-center gap-2 text-xs text-[#7d878d] sm:flex"><FilePenLine className="size-4 text-[var(--accent)]" />Черновик заказа</span>
        <Link href={prefill ? "/inbox" : "/orders"} aria-label="Закрыть оформление" className="focus-ring grid size-11 place-items-center border border-white/[0.09] text-[#889297] hover:border-white/[0.16] hover:text-white"><X className="size-5" /></Link>
      </div>
    </header>

    <div className="grid items-start lg:grid-cols-[14rem_minmax(0,1fr)] 2xl:grid-cols-[14rem_minmax(0,1fr)_19rem]">
      <aside className="border-b border-white/[0.09] bg-[#0b1013] p-3 lg:sticky lg:top-[calc(var(--header-height)+1rem)] lg:border-b-0 lg:border-r lg:p-6">
        <div className="hidden lg:block">
          <p className="eyebrow">Маршрут</p>
          <p className="mt-3 text-[10px] leading-5 text-[#687279]">Все разделы открыты. Маршрут помогает быстро вернуться к нужным данным.</p>
        </div>
        <ol aria-label="Этапы оформления" className="grid grid-cols-4 gap-1.5 lg:mt-7 lg:grid-cols-1 lg:gap-0">
          {steps.map((entry, index) => {
            const Icon = entry.icon;
            const active = index === step;
            const done = sectionValidity[index];
            return <li key={entry.id} className="relative lg:pb-8 lg:last:pb-0">
              {index < steps.length - 1 ? <span aria-hidden="true" className={`absolute left-[1.1rem] top-10 hidden h-[calc(100%-2rem)] w-px lg:block ${done ? "bg-[var(--accent)]/50" : "bg-white/[0.09]"}`} /> : null}
              <button
                type="button"
                onClick={() => goToSection(index)}
                aria-current={active ? "step" : undefined}
                className={`focus-ring relative z-10 flex min-h-14 w-full min-w-0 items-center justify-center gap-2 px-1.5 text-left transition-colors lg:justify-start lg:px-0 ${active ? "text-white" : "text-[#667178] hover:text-white"}`}
              >
                <span className={`grid size-9 shrink-0 place-items-center border ${active ? "border-[var(--accent)]/30 bg-[var(--accent)] text-[#101308]" : done ? "border-[var(--accent)]/25 bg-[#0b1013] text-[var(--accent)]" : "border-white/[0.08] bg-[#0b1013]"}`}>{done && !active ? <Check className="size-4" /> : <Icon className="size-4" />}</span>
                <span className="hidden min-w-0 flex-1 lg:block"><span className="block text-xs font-semibold">0{index + 1} · {entry.title}</span><span className="mt-1 block text-[9px] leading-4 text-[#626c72]">{entry.description}</span></span>
                <span className="font-display text-[9px] lg:hidden">0{index + 1}</span>
              </button>
            </li>;
          })}
        </ol>
        <div className="mt-7 hidden border-t border-white/[0.08] pt-5 lg:block">
          <p className="text-[9px] uppercase tracking-[0.14em] text-[#59636a]">Заполнено</p>
          <p className="mt-2 font-display text-lg text-white">{completedSections}<span className="text-[#59636a]"> / {steps.length}</span></p>
        </div>
      </aside>

      <div className="min-w-0 bg-[#0e1418]">
        <section id="quick-client-section" ref={(node) => { sectionRefs.current[0] = node; }} className="scroll-mt-28 border-b border-white/[0.09] p-4 sm:p-7 xl:p-9">
          <SectionIntro number="01" title="Кто заказывает" description="Найдите клиента в CRM или заведите нового вместе с основным контактным лицом." />
          <ModeSwitch value={clientMode} onChange={(mode) => { setClientMode(mode); if (mode === "existing" && clientId) selectClient(clientId); }} existingLabel="Из CRM" newLabel="Новый клиент" />
          {clientMode === "existing" ? <div className="mt-6 grid gap-4">
            <OrderPicker label="Клиент" required value={clientId} onChange={selectClient} placeholder="Выберите клиента" options={options.clients.map((client) => ({ value: client.id, label: client.name }))} />
            {availableContacts.length ? <ModeSwitch value={contactMode} onChange={setContactMode} existingLabel="Готовый контакт" newLabel="Новый контакт" /> : null}
            {effectiveContactMode === "existing" ? <OrderPicker label="Контакт" required value={contactId} onChange={setContactId} placeholder="Выберите контакт" options={availableContacts.map((contact) => ({ value: contact.id, label: contact.name, detail: contact.phone }))} /> : <div className="grid gap-4 sm:grid-cols-2"><OrderField label="Контактное лицо" required><input value={contactName} onChange={(event) => setContactName(event.target.value)} className={orderInputClass} placeholder="Имя и фамилия" /></OrderField><OrderField label="Телефон" required><input inputMode="tel" value={contactPhone} onChange={(event) => setContactPhone(formatPhoneInput(event.target.value))} className={orderInputClass} placeholder="+7 (999) 000-00-00" /></OrderField><OrderField label="Должность"><input value={contactPosition} onChange={(event) => setContactPosition(event.target.value)} className={orderInputClass} placeholder="Управляющий" /></OrderField><OrderField label="Email" errors={contactEmailValid ? undefined : ["Введите адрес в формате name@company.ru"]}><input type="email" maxLength={254} value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} className={orderInputClass} placeholder="mail@company.ru" /></OrderField></div>}
          </div> : <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <OrderPicker label="Тип клиента" required value={clientKind} onChange={(value) => setClientKind(value as typeof clientKind)} placeholder="Тип клиента" options={[{ value: "legal_entity", label: "Юридическое лицо" }, { value: "individual", label: "Физическое лицо" }]} />
            <OrderField label={clientKind === "legal_entity" ? "Название организации" : "ФИО"} required><input data-testid="quick-client-name" value={clientName} onChange={(event) => setClientName(event.target.value)} className={orderInputClass} placeholder={clientKind === "legal_entity" ? "ООО «Компания»" : "Иванов Иван Иванович"} /></OrderField>
            {clientKind === "legal_entity" ? <OrderField label="ИНН" required><input data-testid="quick-tax-id" inputMode="numeric" value={taxId} onChange={(event) => setTaxId(event.target.value.replace(/\D/g, ""))} className={orderInputClass} placeholder="10 или 12 цифр" /></OrderField> : null}
            <OrderField label="Контактное лицо" required><input data-testid="quick-contact-name" value={contactName} onChange={(event) => setContactName(event.target.value)} className={orderInputClass} placeholder="Имя и фамилия" /></OrderField>
            <OrderField label="Телефон" required><input data-testid="quick-contact-phone" inputMode="tel" value={contactPhone} onChange={(event) => setContactPhone(formatPhoneInput(event.target.value))} className={orderInputClass} placeholder="+7 (999) 000-00-00" /></OrderField>
            <OrderField label="Email" errors={contactEmailValid ? undefined : ["Введите адрес в формате name@company.ru"]}><input type="email" maxLength={254} value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} className={orderInputClass} placeholder="mail@company.ru" /></OrderField>
          </div>}
        </section>

        <section id="quick-object-section" ref={(node) => { sectionRefs.current[1] = node; }} className="scroll-mt-28 border-b border-white/[0.09] p-4 sm:p-7 xl:p-9">
          <SectionIntro number="02" title="Куда выезжать" description="Выберите существующий объект клиента или сразу создайте новый адрес без повторного ввода." />
          {clientMode === "existing" && availableObjects.length ? <ModeSwitch value={objectMode} onChange={setObjectMode} existingLabel="Из объектов" newLabel="Новый объект" /> : null}
          <div className="mt-6">{effectiveObjectMode === "existing" ? <OrderPicker label="Объект" required value={objectId} onChange={setObjectId} placeholder="Выберите объект" options={availableObjects.map((object) => ({ value: object.id, label: object.name, detail: object.address }))} /> : <ObjectFields value={newObject} onChange={setNewObject} />}</div>
        </section>

        <section id="quick-work-section" ref={(node) => { sectionRefs.current[2] = node; }} className="scroll-mt-28 border-b border-white/[0.09] p-4 sm:p-7 xl:p-9">
          <SectionIntro number="03" title="Что нужно сделать" description="Зафиксируйте работу, стоимость и исполнителя. Финансовые значения сохранятся снимком." />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2"><OrderField label="Услуга" required><input data-testid="quick-service-name" value={serviceName} onChange={(event) => setServiceName(event.target.value)} className={orderInputClass} /></OrderField></div>
            <OrderField label="Количество" required><input inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} className={orderInputClass} /></OrderField>
            <OrderField label="Цена, ₽" required><input data-testid="quick-unit-price" inputMode="decimal" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} className={orderInputClass} placeholder="25000" /></OrderField>
            <OrderPicker label="Мастер" value={masterId} onChange={(value) => { setMasterId(value); if (!value) setMasterPayment(""); }} placeholder="Назначить позже" searchable searchPlaceholder="ФИО или телефон" options={[{ value: "", label: "Назначить позже" }, ...options.masters.map((master) => ({ value: master.id, label: master.name, detail: master.phone }))]} />
            <OrderField label="Выплата мастеру" required={Boolean(masterId)}><input inputMode="decimal" disabled={!masterId} value={masterPayment} onChange={(event) => setMasterPayment(event.target.value)} className={orderInputClass} placeholder="4000" /></OrderField>
            <div className="sm:col-span-2"><OrderField label="Комментарий к заказу"><textarea value={orderNotes} onChange={(event) => setOrderNotes(event.target.value)} className={orderTextareaClass} placeholder="Особые условия, состав препаратов, договорённости" /></OrderField></div>
          </div>
        </section>

        <section id="quick-visit-section" ref={(node) => { sectionRefs.current[3] = node; }} className="scroll-mt-28 p-4 sm:p-7 xl:p-9">
          <SectionIntro number="04" title="Когда выезжать" description="Назначьте первый выезд. Он сразу появится в календаре и создаст напоминание." />
          <div className="grid gap-4 sm:grid-cols-3">
            <OrderField label="Дата" required><DateInput data-testid="quick-visit-date" name="visitDate" value={visitDate} onChange={setVisitDate} required /></OrderField>
            <OrderField label="Время" required><TimeInput data-testid="quick-visit-time" name="visitTime" value={visitTime} onChange={setVisitTime} required /></OrderField>
            <OrderField label="Длительность, мин" required><input inputMode="numeric" value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} className={orderInputClass} /></OrderField>
            <div className="sm:col-span-3"><OrderField label="Инструкция мастеру"><textarea value={visitNotes} onChange={(event) => setVisitNotes(event.target.value)} className={orderTextareaClass} placeholder="Ориентиры, пропуск, кому позвонить перед приездом" /></OrderField></div>
          </div>
        </section>

        <footer className="sticky bottom-0 z-20 border-t border-white/[0.1] bg-[#0d1317]/95 p-3 backdrop-blur sm:p-4">
          {state.status === "error" && state.message ? <p data-testid="quick-order-error" role="alert" className="mb-3 flex items-start gap-2 border border-[#ef646a]/20 bg-[#ef646a]/[0.05] p-3 text-xs leading-5 text-[#d89599]"><CircleAlert className="mt-0.5 size-4 shrink-0" />{state.message}</p> : null}
          <div className="flex gap-2">
            <button type="button" onClick={() => goToSection(Math.max(0, step - 1))} disabled={step === 0 || pending} className="focus-ring flex h-12 items-center justify-center gap-2 border border-white/[0.08] px-4 text-xs text-[#7d878d] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"><ArrowLeft className="size-4" /><span className="hidden sm:inline">Назад</span></button>
            {step < steps.length - 1 ? <button data-testid="quick-next" type="button" onClick={continueFlow} disabled={!sectionValidity[step]} className="focus-ring flex h-12 flex-1 items-center justify-center gap-2 bg-[var(--accent)] px-4 text-xs font-semibold text-[#101308] disabled:cursor-not-allowed disabled:opacity-35">Продолжить<ArrowRight className="size-4" /></button> : <button data-testid="quick-submit" type="button" onClick={(event) => { explicitSubmitRef.current = true; event.currentTarget.form?.requestSubmit(); }} disabled={!allSectionsValid || pending} className="focus-ring flex h-12 flex-1 items-center justify-center gap-2 bg-[var(--accent)] px-4 text-xs font-semibold text-[#101308] disabled:cursor-not-allowed disabled:opacity-35">{pending ? <><LoaderCircle className="size-4 animate-spin" />Сохраняем всё…</> : <><Wrench className="size-4" />Создать заказ и выезд</>}</button>}
          </div>
        </footer>
      </div>

      <aside data-testid="quick-order-summary" aria-label="Черновик заказа" className="border-t border-white/[0.09] bg-[#080d10] p-5 lg:col-span-2 lg:p-7 2xl:sticky 2xl:top-[calc(var(--header-height)+1rem)] 2xl:col-span-1 2xl:border-l 2xl:border-t-0">
        <div className="flex items-start justify-between gap-3">
          <div><p className="font-display text-sm font-semibold text-white">Черновик заказа</p><p className="mt-1 text-[10px] text-[#626c72]">{completedSections} из {steps.length} разделов заполнено</p></div>
          <span className={`grid size-9 place-items-center border ${allSectionsValid ? "border-[var(--accent)]/25 bg-[var(--accent)]/[0.07] text-[var(--accent)]" : "border-white/[0.08] text-[#657078]"}`}>{allSectionsValid ? <Check className="size-4" /> : <FilePenLine className="size-4" />}</span>
        </div>
        <dl className="mt-5 border-y border-white/[0.08]">
          <SummaryLine label="Клиент" value={draftClientName} strong />
          <SummaryLine label="Контакт" value={draftContactName} />
          <SummaryLine label="Телефон" value={draftPhone} />
          {effectiveContactMode === "new" ? <SummaryLine label="Email" value={contactEmail} /> : null}
          <SummaryLine label="Объект" value={draftObjectName} strong />
          <SummaryLine label="Адрес" value={draftAddress} />
          <SummaryLine label="Работа" value={serviceName} />
          <SummaryLine label="Мастер" value={selectedMaster?.name ?? "Назначить позже"} />
          <SummaryLine label="Выезд" value={`${formatDraftDate(visitDate)}${visitTime ? ` · ${visitTime}` : ""}`} />
        </dl>
        <div className="flex items-end justify-between gap-4 border-b border-white/[0.08] py-5">
          <span className="text-[10px] uppercase tracking-[0.13em] text-[#626c72]">Итого</span>
          <strong className="font-display text-xl font-semibold text-white">{serviceTotal > 0 ? formatMoney(serviceTotal) : "0 ₽"}</strong>
        </div>
        <p className={`mt-5 flex items-start gap-2 text-[10px] leading-5 ${allSectionsValid ? "text-[#8ed7b8]" : "text-[#a28d6c]"}`}>{allSectionsValid ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <CircleAlert className="mt-0.5 size-4 shrink-0" />}{allSectionsValid ? "Все обязательные данные заполнены. Заказ готов к созданию." : "Заполните обязательные поля во всех четырёх разделах."}</p>
      </aside>
    </div>
  </form>;
}
