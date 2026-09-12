"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  CircleAlert,
  FilePenLine,
  LoaderCircle,
  Wrench,
  X,
} from "lucide-react";
import { useActionState, useMemo, useState } from "react";
import {
  createQuickOrderAction,
  type QuickOrderState,
} from "@/app/(workspace)/quick-order/actions";
import {
  OrderField,
  OrderPicker,
  orderInputClass,
  orderTextareaClass,
} from "@/components/orders/order-form-parts";
import { DateInput, TimeInput } from "@/components/ui/date-time-inputs";
import { VisitDispatchCardButton } from "@/components/visits/visit-dispatch-card";
import { formatMoney } from "@/lib/format";
import { formatPhoneInput } from "@/lib/phone-input";
import type { IncomingLeadPrefill } from "@/server/incoming-leads/types";
import type { OrderCreationOptions } from "@/server/orders/types";

type ClientMode = "existing" | "new";
type ReferenceMode = "existing" | "new";

const steps = [
  {
    id: "quick-client-section",
    title: "Клиент",
    description: "Заказчик и контактное лицо",
  },
  {
    id: "quick-object-section",
    title: "Объект",
    description: "Адрес и условия доступа",
  },
  {
    id: "quick-work-section",
    title: "Работы",
    description: "Услуга, стоимость и мастер",
  },
  {
    id: "quick-visit-section",
    title: "Выезд",
    description: "Дата, время и инструкция",
  },
] as const;

const validationMessages = [
  "Укажите клиента и контактные данные, чтобы продолжить.",
  "Выберите объект или заполните данные нового адреса.",
  "Добавьте работу и укажите её стоимость.",
  "Проверьте дату, время и длительность первого выезда.",
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

function ModeSwitch({
  value,
  onChange,
  existingLabel,
  newLabel,
}: {
  value: ReferenceMode;
  onChange: (value: ReferenceMode) => void;
  existingLabel: string;
  newLabel: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-[14px] border border-[var(--line-strong)] bg-[var(--surface-inset)] p-1">
      {(
        [
          ["existing", existingLabel],
          ["new", newLabel],
        ] as const
      ).map(([mode, label]) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          aria-pressed={value === mode}
          className={`focus-ring min-h-11 rounded-[10px] border px-4 text-left text-xs font-semibold transition-colors ${value === mode ? "border-[var(--accent)]/35 bg-[var(--surface)] text-[var(--accent-ink)] shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "border-transparent text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function SectionIntro({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <header className="mb-7 border-b border-[var(--line)] pb-6">
      <p className="eyebrow flex items-center gap-2">
        <span className="grid size-5 place-items-center rounded-full bg-[var(--accent)] font-display text-[9px] tracking-normal text-[var(--on-accent)]">
          {number}
        </span>
        Шаг из 04
      </p>
      <h2 className="mt-3 font-display text-[clamp(1.45rem,1.24rem+0.6vw,1.9rem)] font-medium tracking-[-0.045em] text-[var(--text)]">
        {title}
      </h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--muted)]">
        {description}
      </p>
    </header>
  );
}

function ObjectFields({
  value,
  onChange,
}: {
  value: typeof emptyObject;
  onChange: (value: typeof emptyObject) => void;
}) {
  const set = (field: keyof typeof emptyObject, fieldValue: string) =>
    onChange({ ...value, [field]: fieldValue });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <OrderField label="Название объекта" required>
        <input
          data-testid="quick-object-name"
          value={value.name}
          onChange={(event) => set("name", event.target.value)}
          className={orderInputClass}
          placeholder="Склад на Лесной"
        />
      </OrderField>
      <OrderField label="Тип объекта" required>
        <input
          value={value.objectType}
          onChange={(event) => set("objectType", event.target.value)}
          className={orderInputClass}
          placeholder="Склад, офис, производство"
        />
      </OrderField>
      <div className="sm:col-span-2">
        <OrderField label="Адрес" required>
          <input
            data-testid="quick-object-address"
            value={value.address}
            onChange={(event) => set("address", event.target.value)}
            className={orderInputClass}
            placeholder="Город, улица, дом, корпус"
          />
        </OrderField>
      </div>
      <OrderField label="Площадь, м²">
        <input
          inputMode="decimal"
          value={value.areaSquareMeters}
          onChange={(event) => set("areaSquareMeters", event.target.value)}
          className={orderInputClass}
          placeholder="500"
        />
      </OrderField>
      <OrderField label="Этажей">
        <input
          inputMode="numeric"
          value={value.floorCount}
          onChange={(event) => set("floorCount", event.target.value)}
          className={orderInputClass}
          placeholder="1"
        />
      </OrderField>
      <div className="sm:col-span-2">
        <OrderField label="Контакт и доступ на объект">
          <textarea
            value={value.onsiteContact}
            onChange={(event) => set("onsiteContact", event.target.value)}
            className={orderTextareaClass}
            placeholder="К кому обратиться, где вход, пропускной режим"
          />
        </OrderField>
      </div>
    </div>
  );
}

function SummaryLine({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="grid gap-1 py-3.5">
      <dt className="text-[10px] uppercase tracking-[0.13em] text-[var(--muted)]">
        {label}
      </dt>
      <dd
        className={`min-w-0 break-words text-xs leading-5 ${strong ? "font-semibold text-[var(--text)]" : "text-[var(--text-secondary)]"}`}
      >
        {value || "—"}
      </dd>
    </div>
  );
}

export function QuickOrderWorkspace({
  options,
  idempotencyKey,
  defaultVisitDate,
  prefill,
}: {
  options: OrderCreationOptions;
  idempotencyKey: string;
  defaultVisitDate: string;
  prefill?: IncomingLeadPrefill;
}) {
  const suggestedClientId =
    prefill?.possibleClientId &&
    options.clients.some((client) => client.id === prefill.possibleClientId)
      ? prefill.possibleClientId
      : null;
  const initialClientId = suggestedClientId ?? options.clients[0]?.id ?? "";
  const initialContactId =
    options.contacts.find(
      (contact) => contact.clientId === initialClientId && contact.isPrimary,
    )?.id ??
    options.contacts.find((contact) => contact.clientId === initialClientId)
      ?.id ??
    "";
  const initialObjectId =
    options.objects.find((object) => object.clientId === initialClientId)?.id ??
    "";
  const [state, formAction, pending] = useActionState(
    createQuickOrderAction,
    initialQuickOrderState,
  );
  const [step, setStep] = useState(0);
  const [stepError, setStepError] = useState<string | null>(null);
  const [clientMode, setClientMode] = useState<ClientMode>(
    prefill && !suggestedClientId
      ? "new"
      : options.clients.length
        ? "existing"
        : "new",
  );
  const [clientId, setClientId] = useState(initialClientId);
  const [clientKind, setClientKind] = useState<"legal_entity" | "individual">(
    prefill ? "individual" : "legal_entity",
  );
  const [clientName, setClientName] = useState(
    prefill?.contactName || prefill?.phone || prefill?.email || "",
  );
  const [taxId, setTaxId] = useState("");
  const [contactName, setContactName] = useState(prefill?.contactName ?? "");
  const [contactPosition, setContactPosition] = useState("");
  const [contactPhone, setContactPhone] = useState(() =>
    formatPhoneInput(prefill?.phone ?? ""),
  );
  const [contactEmail, setContactEmail] = useState(prefill?.email ?? "");
  const [contactMode, setContactMode] = useState<ReferenceMode>(
    initialContactId ? "existing" : "new",
  );
  const [contactId, setContactId] = useState(initialContactId);
  const [objectMode, setObjectMode] = useState<ReferenceMode>(
    initialObjectId ? "existing" : "new",
  );
  const [objectId, setObjectId] = useState(initialObjectId);
  const [newObject, setNewObject] = useState(emptyObject);
  const [serviceName, setServiceName] = useState(
    prefill?.serviceInterest || "Дезинсекция и контроль вредителей",
  );
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [masterId, setMasterId] = useState("");
  const [masterPayment, setMasterPayment] = useState("");
  const [orderNotes, setOrderNotes] = useState(prefill?.orderNotes ?? "");
  const [visitDate, setVisitDate] = useState(defaultVisitDate);
  const [visitTime, setVisitTime] = useState("10:00");
  const [durationMinutes, setDurationMinutes] = useState("120");
  const [visitNotes, setVisitNotes] = useState("");

  const availableContacts = useMemo(
    () => options.contacts.filter((contact) => contact.clientId === clientId),
    [clientId, options.contacts],
  );
  const availableObjects = useMemo(
    () => options.objects.filter((object) => object.clientId === clientId),
    [clientId, options.objects],
  );
  const selectedClient = options.clients.find(
    (client) => client.id === clientId,
  );
  const selectedContact = availableContacts.find(
    (contact) => contact.id === contactId,
  );
  const selectedObject = availableObjects.find(
    (object) => object.id === objectId,
  );
  const selectedMaster = options.masters.find(
    (master) => master.id === masterId,
  );
  const contactEmailValid = isValidOptionalEmail(contactEmail);

  function selectClient(nextClientId: string) {
    const contacts = options.contacts.filter(
      (contact) => contact.clientId === nextClientId,
    );
    const objects = options.objects.filter(
      (object) => object.clientId === nextClientId,
    );
    setClientId(nextClientId);
    setContactId(
      contacts.find((contact) => contact.isPrimary)?.id ??
        contacts[0]?.id ??
        "",
    );
    setObjectId(objects[0]?.id ?? "");
    setContactMode(contacts.length ? "existing" : "new");
    setObjectMode(objects.length ? "existing" : "new");
  }

  const effectiveContactMode =
    clientMode === "existing" && availableContacts.length ? contactMode : "new";
  const effectiveObjectMode =
    clientMode === "existing" && availableObjects.length ? objectMode : "new";
  const sectionValidity = [
    clientMode === "new"
      ? clientName.trim().length >= 2 &&
        contactName.trim().length >= 2 &&
        contactPhone.trim().length >= 7 &&
        contactEmailValid &&
        (clientKind === "individual" || /^\d{10}(\d{2})?$/.test(taxId))
      : Boolean(clientId) &&
        (effectiveContactMode === "existing"
          ? Boolean(contactId)
          : contactName.trim().length >= 2 &&
            contactPhone.trim().length >= 7 &&
            contactEmailValid),
    effectiveObjectMode === "existing"
      ? Boolean(objectId)
      : newObject.name.trim().length >= 2 &&
        newObject.objectType.trim().length >= 2 &&
        newObject.address.trim().length >= 5,
    serviceName.trim().length >= 2 &&
      parseAmount(quantity) > 0 &&
      parseAmount(unitPrice) > 0 &&
      (!masterId ||
        (masterPayment.trim().length > 0 && parseAmount(masterPayment) >= 0)),
    Boolean(visitDate) &&
      /^\d{2}:\d{2}$/.test(visitTime) &&
      Number(durationMinutes) >= 15,
  ] as const;
  const allSectionsValid = sectionValidity.every(Boolean);
  const completedSections = sectionValidity.filter(Boolean).length;
  const serviceTotal = parseAmount(quantity) * parseAmount(unitPrice);
  const draftClientName =
    clientMode === "existing" ? (selectedClient?.name ?? "") : clientName;
  const draftContactName =
    effectiveContactMode === "existing"
      ? (selectedContact?.name ?? "")
      : contactName;
  const draftPhone =
    effectiveContactMode === "existing"
      ? (selectedContact?.phone ?? "")
      : contactPhone;
  const draftObjectName =
    effectiveObjectMode === "existing"
      ? (selectedObject?.name ?? "")
      : newObject.name;
  const draftAddress =
    effectiveObjectMode === "existing"
      ? (selectedObject?.address ?? "")
      : newObject.address;

  const payload = {
    idempotencyKey,
    sourceLead: prefill
      ? { id: prefill.sourceLeadId, expectedVersion: prefill.sourceLeadVersion }
      : null,
    client:
      clientMode === "new"
        ? {
            mode: "new" as const,
            details: {
              kind: clientKind,
              legalName: clientName,
              taxId,
              contactName,
              contactPosition,
              phone: contactPhone,
              email: contactEmail,
            },
            object: newObject,
          }
        : {
            mode: "existing" as const,
            clientId,
            contact:
              effectiveContactMode === "existing"
                ? { mode: "existing" as const, contactId }
                : {
                    mode: "new" as const,
                    details: {
                      fullName: contactName,
                      position: contactPosition,
                      phone: contactPhone,
                      email: contactEmail,
                    },
                  },
            object:
              effectiveObjectMode === "existing"
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
    visit: {
      localDate: visitDate,
      localTime: visitTime,
      durationMinutes,
      assignedMasterId: masterId,
      notes: visitNotes,
    },
  };

  function goToSection(index: number) {
    if (index > step && !sectionValidity.slice(0, index).every(Boolean)) {
      const incompleteStep = sectionValidity.findIndex(
        (valid, currentIndex) => currentIndex < index && !valid,
      );
      setStepError(
        validationMessages[incompleteStep < 0 ? step : incompleteStep],
      );
      return;
    }
    setStepError(null);
    setStep(index);
  }

  function continueFlow() {
    if (!sectionValidity[step]) {
      setStepError(validationMessages[step]);
      return;
    }
    setStepError(null);
    goToSection(Math.min(steps.length - 1, step + 1));
  }

  const activeSectionId = steps[step].id;

  if (state.status === "success" && state.result) {
    return (
      <section
        data-testid="quick-order-success"
        className="surface-panel mx-auto max-w-3xl p-6 sm:p-8"
      >
        <div className="max-w-2xl">
          <span className="grid size-12 place-items-center rounded-full bg-[var(--success-bg)] text-[var(--success)]">
            <CheckCircle2 className="size-6" />
          </span>
          <p className="eyebrow mt-6">Операция завершена</p>
          <h2 className="mt-2 font-display text-2xl font-semibold tracking-[-0.04em] text-[var(--text)]">
            {state.result.orderNumber} готов к работе
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--muted)]">
            Клиент, объект, заказ, выезд и напоминание сохранены. Теперь можно
            открыть карточку и сразу отправить её мастеру.
          </p>
        </div>
        <div className="mt-8 grid gap-3 border-t border-[var(--line)] pt-5 sm:grid-cols-2">
          <VisitDispatchCardButton
            visitId={state.result.visitId}
            className="!border-0 h-12 rounded-[12px] bg-[var(--accent)] font-semibold text-[var(--on-accent)] hover:bg-[var(--accent-strong)]"
          />
          <Link
            href={`/orders/${state.result.orderId}`}
            className="focus-ring flex h-12 items-center justify-center rounded-[12px] border border-[var(--line-strong)] bg-[var(--surface)] text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
          >
            Открыть заказ
          </Link>
          <a
            href={prefill ? "/inbox" : "/quick-order"}
            className="focus-ring flex h-11 items-center justify-center rounded-[12px] text-xs text-[var(--muted)] transition-colors hover:bg-[var(--surface-raised)] hover:text-[var(--accent-ink)] sm:col-span-2"
          >
            {prefill ? "Вернуться во входящие" : "Оформить ещё один"}
          </a>
        </div>
      </section>
    );
  }

  return (
    <form
      action={formAction}
      data-testid="quick-order-form"
      className="surface-panel w-full overflow-hidden"
      onSubmit={(event) => {
        if (pending) {
          event.preventDefault();
          return;
        }
        if (!allSectionsValid) {
          event.preventDefault();
          const incompleteStep = sectionValidity.findIndex((valid) => !valid);
          setStep(incompleteStep);
          setStepError(validationMessages[incompleteStep]);
        }
      }}
      onKeyDown={(event) => {
        if (
          event.key === "Enter" &&
          event.target instanceof HTMLInputElement &&
          event.target.type !== "submit"
        ) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />

      <header className="flex items-start justify-between gap-4 px-5 py-6 sm:items-center sm:px-8 sm:py-7 xl:px-10">
        <div className="min-w-0">
          <p className="eyebrow">
            {prefill ? "Проверка входящей заявки" : "Новый заказ"}
          </p>
          <h1 className="mt-2 font-display text-[clamp(1.65rem,1.35rem+0.8vw,2.25rem)] font-medium tracking-[-0.045em] text-[var(--text)]">
            {prefill ? "Уточнить и принять заявку" : "Оформить заказ"}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--muted)]">
            Четыре коротких шага: клиент, объект, работы и первый выезд.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <span className="hidden items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-2 text-xs text-[var(--muted)] sm:flex">
            <FilePenLine className="size-4 text-[var(--accent)]" />
            Черновик
          </span>
          <Link
            href={prefill ? "/inbox" : "/orders"}
            aria-label="Закрыть оформление"
            className="focus-ring grid size-10 place-items-center rounded-full border border-[var(--line-strong)] bg-[var(--surface)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
          >
            <X className="size-5" />
          </Link>
        </div>
      </header>

      <nav aria-label="Маршрут оформления" className="border-y border-[var(--line)] bg-[var(--surface-inset)] p-3 sm:p-4 xl:px-6">
        <ol
          aria-label="Этапы оформления"
          className="grid grid-cols-2 gap-1 sm:grid-cols-4"
        >
          {steps.map((entry, index) => {
            const active = index === step;
            const done = sectionValidity[index];
            const available =
              index <= step || sectionValidity.slice(0, index).every(Boolean);

            return (
              <li key={entry.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => goToSection(index)}
                  disabled={!available}
                  aria-current={active ? "step" : undefined}
                  className={`focus-ring flex min-h-[3.75rem] w-full min-w-0 items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-35 sm:px-3 ${active ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "text-[var(--muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)]"}`}
                >
                  <span
                    className={`grid size-7 shrink-0 place-items-center rounded-full border text-[10px] font-semibold ${active ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--on-accent)]" : done ? "border-[var(--support)]/35 bg-[var(--support-soft)] text-[var(--support-strong)]" : "border-[var(--line-strong)] text-[var(--muted)]"}`}
                  >
                    {done && !active ? (
                      <Check
                        className="size-3.5"
                        aria-label="Раздел заполнен"
                      />
                    ) : (
                      `0${index + 1}`
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold">
                      {entry.title}
                    </span>
                    <span
                      className={`mt-0.5 hidden truncate text-[10px] sm:block ${active ? "text-[var(--accent-ink)]/75" : "text-[var(--muted)]"}`}
                    >
                      {entry.description}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="grid min-w-0 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="relative min-w-0 max-md:pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
          <section
            id="quick-client-section"
            aria-hidden={activeSectionId !== "quick-client-section"}
            className={
              activeSectionId === "quick-client-section"
                ? "relative z-10 animate-rise p-5 sm:p-8 xl:p-10"
                : "hidden"
            }
          >
            <SectionIntro
              number="01"
              title="Кто заказывает"
              description="Найдите клиента в CRM или заведите нового вместе с основным контактным лицом."
            />
            <ModeSwitch
              value={clientMode}
              onChange={(mode) => {
                setClientMode(mode);
                if (mode === "existing" && clientId) selectClient(clientId);
              }}
              existingLabel="Из CRM"
              newLabel="Новый клиент"
            />
            {clientMode === "existing" ? (
              <div className="mt-6 grid gap-4">
                <OrderPicker
                  label="Клиент"
                  required
                  value={clientId}
                  onChange={selectClient}
                  placeholder="Выберите клиента"
                  options={options.clients.map((client) => ({
                    value: client.id,
                    label: client.name,
                  }))}
                  searchable
                  searchPlaceholder="Название или ИНН"
                />
                {availableContacts.length ? (
                  <ModeSwitch
                    value={contactMode}
                    onChange={setContactMode}
                    existingLabel="Готовый контакт"
                    newLabel="Новый контакт"
                  />
                ) : null}
                {effectiveContactMode === "existing" ? (
                  <OrderPicker
                    label="Контакт"
                    required
                    value={contactId}
                    onChange={setContactId}
                    placeholder="Выберите контакт"
                    options={availableContacts.map((contact) => ({
                      value: contact.id,
                      label: contact.name,
                      detail: contact.phone,
                    }))}
                    searchable
                    searchPlaceholder="Имя или телефон"
                  />
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <OrderField label="Контактное лицо" required>
                      <input
                        value={contactName}
                        onChange={(event) => setContactName(event.target.value)}
                        className={orderInputClass}
                        placeholder="Имя и фамилия"
                      />
                    </OrderField>
                    <OrderField label="Телефон" required>
                      <input
                        inputMode="tel"
                        value={contactPhone}
                        onChange={(event) =>
                          setContactPhone(formatPhoneInput(event.target.value))
                        }
                        className={orderInputClass}
                        placeholder="+7 (999) 000-00-00"
                      />
                    </OrderField>
                    <OrderField label="Должность">
                      <input
                        value={contactPosition}
                        onChange={(event) =>
                          setContactPosition(event.target.value)
                        }
                        className={orderInputClass}
                        placeholder="Управляющий"
                      />
                    </OrderField>
                    <OrderField
                      label="Email"
                      errors={
                        contactEmailValid
                          ? undefined
                          : ["Введите адрес в формате name@company.ru"]
                      }
                    >
                      <input
                        type="email"
                        maxLength={254}
                        value={contactEmail}
                        onChange={(event) =>
                          setContactEmail(event.target.value)
                        }
                        className={orderInputClass}
                        placeholder="mail@company.ru"
                      />
                    </OrderField>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <OrderPicker
                  label="Тип клиента"
                  required
                  value={clientKind}
                  onChange={(value) =>
                    setClientKind(value as typeof clientKind)
                  }
                  placeholder="Тип клиента"
                  options={[
                    { value: "legal_entity", label: "Юридическое лицо" },
                    { value: "individual", label: "Физическое лицо" },
                  ]}
                />
                <OrderField
                  label={
                    clientKind === "legal_entity"
                      ? "Название организации"
                      : "ФИО"
                  }
                  required
                >
                  <input
                    data-testid="quick-client-name"
                    value={clientName}
                    onChange={(event) => setClientName(event.target.value)}
                    className={orderInputClass}
                    placeholder={
                      clientKind === "legal_entity"
                        ? "ООО «Компания»"
                        : "Иванов Иван Иванович"
                    }
                  />
                </OrderField>
                {clientKind === "legal_entity" ? (
                  <OrderField label="ИНН" required>
                    <input
                      data-testid="quick-tax-id"
                      inputMode="numeric"
                      value={taxId}
                      onChange={(event) =>
                        setTaxId(event.target.value.replace(/\D/g, ""))
                      }
                      className={orderInputClass}
                      placeholder="10 или 12 цифр"
                    />
                  </OrderField>
                ) : null}
                <OrderField label="Контактное лицо" required>
                  <input
                    data-testid="quick-contact-name"
                    value={contactName}
                    onChange={(event) => setContactName(event.target.value)}
                    className={orderInputClass}
                    placeholder="Имя и фамилия"
                  />
                </OrderField>
                <OrderField label="Телефон" required>
                  <input
                    data-testid="quick-contact-phone"
                    inputMode="tel"
                    value={contactPhone}
                    onChange={(event) =>
                      setContactPhone(formatPhoneInput(event.target.value))
                    }
                    className={orderInputClass}
                    placeholder="+7 (999) 000-00-00"
                  />
                </OrderField>
                <OrderField
                  label="Email"
                  errors={
                    contactEmailValid
                      ? undefined
                      : ["Введите адрес в формате name@company.ru"]
                  }
                >
                  <input
                    type="email"
                    maxLength={254}
                    value={contactEmail}
                    onChange={(event) => setContactEmail(event.target.value)}
                    className={orderInputClass}
                    placeholder="mail@company.ru"
                  />
                </OrderField>
              </div>
            )}
          </section>

          <section
            id="quick-object-section"
            aria-hidden={activeSectionId !== "quick-object-section"}
            className={
              activeSectionId === "quick-object-section"
                ? "relative z-10 animate-rise p-5 sm:p-8 xl:p-10"
                : "hidden"
            }
          >
            <SectionIntro
              number="02"
              title="Куда выезжать"
              description="Выберите существующий объект клиента или сразу создайте новый адрес без повторного ввода."
            />
            {clientMode === "existing" && availableObjects.length ? (
              <ModeSwitch
                value={objectMode}
                onChange={setObjectMode}
                existingLabel="Из объектов"
                newLabel="Новый объект"
              />
            ) : null}
            <div className="mt-6">
              {effectiveObjectMode === "existing" ? (
                <OrderPicker
                  label="Объект"
                  required
                  value={objectId}
                  onChange={setObjectId}
                  placeholder="Выберите объект"
                  options={availableObjects.map((object) => ({
                    value: object.id,
                    label: object.name,
                    detail: object.address,
                  }))}
                  searchable
                  searchPlaceholder="Название или адрес"
                />
              ) : (
                <ObjectFields value={newObject} onChange={setNewObject} />
              )}
            </div>
          </section>

          <section
            id="quick-work-section"
            aria-hidden={activeSectionId !== "quick-work-section"}
            className={
              activeSectionId === "quick-work-section"
                ? "relative z-10 animate-rise p-5 sm:p-8 xl:p-10"
                : "hidden"
            }
          >
            <SectionIntro
              number="03"
              title="Что нужно сделать"
              description="Зафиксируйте работу, стоимость и исполнителя. Финансовые значения сохранятся снимком."
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <OrderField label="Услуга" required>
                  <input
                    data-testid="quick-service-name"
                    value={serviceName}
                    onChange={(event) => setServiceName(event.target.value)}
                    className={orderInputClass}
                  />
                </OrderField>
              </div>
              <OrderField label="Количество" required>
                <input
                  inputMode="decimal"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  className={orderInputClass}
                />
              </OrderField>
              <OrderField label="Цена, ₽" required>
                <input
                  data-testid="quick-unit-price"
                  inputMode="decimal"
                  value={unitPrice}
                  onChange={(event) => setUnitPrice(event.target.value)}
                  className={orderInputClass}
                  placeholder="25000"
                />
              </OrderField>
              <OrderPicker
                label="Мастер"
                value={masterId}
                onChange={(value) => {
                  setMasterId(value);
                  if (!value) setMasterPayment("");
                }}
                placeholder="Назначить позже"
                searchable
                searchPlaceholder="ФИО или телефон"
                options={[
                  { value: "", label: "Назначить позже" },
                  ...options.masters.map((master) => ({
                    value: master.id,
                    label: master.name,
                    detail: master.phone,
                  })),
                ]}
              />
              <OrderField label="Выплата мастеру" required={Boolean(masterId)}>
                <input
                  inputMode="decimal"
                  disabled={!masterId}
                  value={masterPayment}
                  onChange={(event) => setMasterPayment(event.target.value)}
                  className={orderInputClass}
                  placeholder="4000"
                />
              </OrderField>
              <div className="sm:col-span-2">
                <OrderField label="Комментарий к заказу">
                  <textarea
                    value={orderNotes}
                    onChange={(event) => setOrderNotes(event.target.value)}
                    className={orderTextareaClass}
                    placeholder="Особые условия, состав препаратов, договорённости"
                  />
                </OrderField>
              </div>
            </div>
          </section>

          <section
            id="quick-visit-section"
            aria-hidden={activeSectionId !== "quick-visit-section"}
            className={
              activeSectionId === "quick-visit-section"
                ? "relative z-10 animate-rise p-5 sm:p-8 xl:p-10"
                : "hidden"
            }
          >
            <SectionIntro
              number="04"
              title="Когда выезжать"
              description="Назначьте первый выезд. Он сразу появится в календаре и создаст напоминание."
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <OrderField label="Дата" required>
                <DateInput
                  data-testid="quick-visit-date"
                  name="visitDate"
                  value={visitDate}
                  onChange={setVisitDate}
                  required
                />
              </OrderField>
              <OrderField label="Время" required>
                <TimeInput
                  data-testid="quick-visit-time"
                  name="visitTime"
                  value={visitTime}
                  onChange={setVisitTime}
                  required
                />
              </OrderField>
              <OrderField label="Длительность, мин" required>
                <input
                  inputMode="numeric"
                  value={durationMinutes}
                  onChange={(event) => setDurationMinutes(event.target.value)}
                  className={orderInputClass}
                />
              </OrderField>
              <div className="sm:col-span-3">
                <OrderField label="Инструкция мастеру">
                  <textarea
                    value={visitNotes}
                    onChange={(event) => setVisitNotes(event.target.value)}
                    className={orderTextareaClass}
                    placeholder="Ориентиры, пропуск, кому позвонить перед приездом"
                  />
                </OrderField>
              </div>
            </div>
          </section>

          <footer className="relative z-0 border-t border-[var(--line)] px-5 py-5 max-md:fixed max-md:bottom-[calc(4.5rem+env(safe-area-inset-bottom))] max-md:left-[var(--workspace-gutter)] max-md:right-[var(--workspace-gutter)] max-md:z-40 max-md:rounded-[18px] max-md:border max-md:bg-[var(--surface-raised)] sm:px-8 xl:px-10">
            {stepError ? (
              <p
                role="alert"
                className="mb-4 flex items-start gap-2 rounded-[12px] border border-[var(--danger-border)]/45 bg-[var(--danger-bg)] px-4 py-3 text-xs leading-5 text-[var(--danger-ink)]"
              >
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                {stepError}
              </p>
            ) : null}
            {state.status === "error" && state.message ? (
              <p
                data-testid="quick-order-error"
                role="alert"
                className="mb-4 flex items-start gap-2 rounded-[12px] border border-[var(--danger-border)]/45 bg-[var(--danger-bg)] px-4 py-3 text-xs leading-5 text-[var(--danger-ink)]"
              >
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                {state.message}
              </p>
            ) : null}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => goToSection(Math.max(0, step - 1))}
                disabled={step === 0 || pending}
                className="focus-ring flex h-12 items-center justify-center gap-2 rounded-[12px] border border-[var(--line-strong)] bg-[var(--surface)] px-4 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-soft)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ArrowLeft className="size-4" />
                <span className="hidden sm:inline">Назад</span>
              </button>
              {step < steps.length - 1 ? (
                <button
                  data-testid="quick-next"
                  type="button"
                  onClick={continueFlow}
                  disabled={pending}
                  className="focus-ring flex h-12 flex-1 items-center justify-center gap-2 rounded-[12px] bg-[var(--accent)] px-5 text-xs font-semibold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-strong)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 sm:max-w-64 sm:flex-none sm:min-w-56"
                >
                  Продолжить
                  <ArrowRight className="size-4" />
                </button>
              ) : (
                <button
                  data-testid="quick-submit"
                  type="submit"
                  disabled={pending}
                  className="focus-ring flex h-12 flex-1 items-center justify-center gap-2 rounded-[12px] bg-[var(--accent)] px-5 text-xs font-semibold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-strong)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 sm:max-w-72 sm:flex-none sm:min-w-64"
                >
                  {pending ? (
                    <>
                      <LoaderCircle className="size-4 animate-spin" />
                      Сохраняем всё…
                    </>
                  ) : (
                    <>
                      <Wrench className="size-4" />
                      Создать заказ и выезд
                    </>
                  )}
                </button>
              )}
            </div>
          </footer>
        </div>

        <aside
          data-testid="quick-order-summary"
          aria-label="Черновик заказа"
          className="border-t border-[var(--line)] bg-[var(--surface-inset)] p-5 sm:p-7 xl:border-l xl:border-t-0 xl:p-6"
        >
          <div className="xl:sticky xl:top-[calc(var(--header-height)+1rem)] xl:rounded-[16px] xl:border xl:border-[var(--line)] xl:bg-[var(--surface)] xl:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-display text-sm font-semibold text-[var(--text)]">
                Черновик заказа
              </p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {completedSections} из {steps.length} разделов заполнено
              </p>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 font-display text-[10px] font-semibold ${allSectionsValid ? "bg-[var(--success-bg)] text-[var(--success)]" : "bg-[var(--surface-raised)] text-[var(--muted)]"}`}
            >
              {allSectionsValid ? "Готов" : "В работе"}
            </span>
          </div>
          <dl className="mt-5 divide-y divide-[var(--line)]">
            <SummaryLine label="Клиент" value={draftClientName} strong />
            <SummaryLine label="Контакт" value={draftContactName} />
            <SummaryLine label="Телефон" value={draftPhone} />
            {effectiveContactMode === "new" ? (
              <SummaryLine label="Email" value={contactEmail} />
            ) : null}
            <SummaryLine label="Объект" value={draftObjectName} strong />
            <SummaryLine label="Адрес" value={draftAddress} />
            <SummaryLine label="Работа" value={serviceName} />
            <SummaryLine
              label="Мастер"
              value={selectedMaster?.name ?? "Назначить позже"}
            />
            <SummaryLine
              label="Выезд"
              value={`${formatDraftDate(visitDate)}${visitTime ? ` · ${visitTime}` : ""}`}
            />
          </dl>
          <div className="mt-3 flex items-end justify-between gap-4 border-t border-[var(--line-strong)] pt-4">
            <span className="text-[10px] uppercase tracking-[0.13em] text-[var(--muted)]">
              Итого
            </span>
            <strong className="font-display text-xl font-semibold text-[var(--text)]">
              {serviceTotal > 0 ? formatMoney(serviceTotal) : "0 ₽"}
            </strong>
          </div>
          <p
            className={`mt-5 flex items-start gap-2 border-t border-[var(--line)] pt-4 text-xs leading-5 ${allSectionsValid ? "text-[var(--success)]" : "text-[var(--warning)]"}`}
          >
            {allSectionsValid ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            ) : (
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
            )}
            {allSectionsValid
              ? "Черновик готов к созданию."
              : "Заполните обязательные данные на каждом шаге."}
          </p>
          </div>
        </aside>
      </div>
    </form>
  );
}
