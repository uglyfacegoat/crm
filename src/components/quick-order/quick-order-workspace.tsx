"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  Plus,
  Search,
  Wrench,
  X,
} from "lucide-react";
import { useActionState, useEffect, useMemo, useState } from "react";
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
import type { OrderPickerResult } from "@/lib/order-picker";
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
      <h2 tabIndex={-1} className="mt-3 font-display text-[clamp(1.45rem,1.24rem+0.6vw,1.9rem)] font-medium tracking-[-0.045em] text-[var(--text)] outline-none">
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
    <div className="grid gap-1 py-2">
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
  const [clientQuery, setClientQuery] = useState("");
  const [clientId, setClientId] = useState(initialClientId);
  const [clientMatches, setClientMatches] = useState(options.clients);
  const [clientMatchesQuery, setClientMatchesQuery] = useState("");
  const [clientHasMore, setClientHasMore] = useState(false);
  const [clientSearchLoading, setClientSearchLoading] = useState(false);
  const [clientSearchError, setClientSearchError] = useState(false);
  const [clientSearchRetry, setClientSearchRetry] = useState(0);
  const [selectedClientRecord, setSelectedClientRecord] = useState(options.clients.find((client) => client.id === initialClientId));
  const [relatedOptions, setRelatedOptions] = useState({ objects: options.objects, contacts: options.contacts });
  const [relationsError, setRelationsError] = useState(false);
  const [relationsRetry, setRelationsRetry] = useState(0);
  const [contactQuery, setContactQuery] = useState("");
  const [contactMatches, setContactMatches] = useState(options.contacts);
  const [contactMatchesQuery, setContactMatchesQuery] = useState("");
  const [contactHasMore, setContactHasMore] = useState(false);
  const [contactSearchError, setContactSearchError] = useState(false);
  const [contactSearchLoading, setContactSearchLoading] = useState(false);
  const [contactSearchRetry, setContactSearchRetry] = useState(0);
  const [selectedContactRecord, setSelectedContactRecord] = useState<OrderCreationOptions["contacts"][number] | null>(null);
  const [selectedObjectRecord, setSelectedObjectRecord] = useState<OrderCreationOptions["objects"][number] | null>(null);
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
  const [selectedMasterRecord, setSelectedMasterRecord] = useState<OrderCreationOptions["masters"][number] | null>(null);
  const [masterPayment, setMasterPayment] = useState("");
  const [orderNotes, setOrderNotes] = useState(prefill?.orderNotes ?? "");
  const [visitDate, setVisitDate] = useState(defaultVisitDate);
  const [visitTime, setVisitTime] = useState("10:00");
  const [durationMinutes, setDurationMinutes] = useState("120");
  const [visitNotes, setVisitNotes] = useState("");

  useEffect(() => {
    if (!options.remote || clientMode !== "existing") return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setClientSearchLoading(true);
      setClientSearchError(false);
      try {
        const params = new URLSearchParams({ type: "clients", q: clientQuery });
        const response = await fetch(`/api/v1/orders/options?${params}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Client picker request failed");
        const payload = await response.json() as { data: OrderPickerResult };
        if (!controller.signal.aborted) {
          setClientMatches(payload.data.items.map((item) => ({ id: item.id, name: item.name })));
          setClientMatchesQuery(clientQuery);
          setClientHasMore(payload.data.hasMore);
        }
      } catch {
        if (!controller.signal.aborted) setClientSearchError(true);
      } finally {
        if (!controller.signal.aborted) setClientSearchLoading(false);
      }
    }, clientQuery ? 250 : 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [clientMode, clientQuery, clientSearchRetry, options.remote]);
  useEffect(() => {
    if (!options.remote || !clientId || clientMode !== "existing") return;
    const controller = new AbortController();
    const load = async () => {
      setRelationsError(false);
      try {
        const params = new URLSearchParams({ clientId });
        const [objectsResponse, contactsResponse] = await Promise.all([
          fetch(`/api/v1/orders/options?${params}&type=objects`, { signal: controller.signal, cache: "no-store" }),
          fetch(`/api/v1/orders/options?${params}&type=contacts`, { signal: controller.signal, cache: "no-store" }),
        ]);
        if (!objectsResponse.ok || !contactsResponse.ok) throw new Error("Client relations request failed");
        const objectsPayload = await objectsResponse.json() as { data: OrderPickerResult };
        const contactsPayload = await contactsResponse.json() as { data: OrderPickerResult };
        if (controller.signal.aborted) return;
        const objects = objectsPayload.data.items.map((item) => ({ id: item.id, clientId, name: item.name, address: item.detail ?? "" }));
        const contacts = contactsPayload.data.items.map((item) => ({ id: item.id, clientId, name: item.name, phone: item.detail ?? "", isPrimary: item.isPrimary ?? false }));
        setRelatedOptions({ objects, contacts });
        setContactMatches(contacts);
        setContactMatchesQuery("");
        setContactId(contacts.find((contact) => contact.isPrimary)?.id ?? contacts[0]?.id ?? "");
        setObjectId(objects[0]?.id ?? "");
        setContactMode(contacts.length ? "existing" : "new");
        setObjectMode(objects.length ? "existing" : "new");
      } catch {
        if (!controller.signal.aborted) setRelationsError(true);
      }
    };
    void load();
    return () => controller.abort();
  }, [clientId, clientMode, options.remote, relationsRetry]);
  useEffect(() => {
    if (!options.remote || !clientId || clientMode !== "existing" || contactMode !== "existing") return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setContactSearchLoading(true);
      setContactSearchError(false);
      try {
        const params = new URLSearchParams({ type: "contacts", clientId, q: contactQuery });
        const response = await fetch(`/api/v1/orders/options?${params}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Contact picker request failed");
        const payload = await response.json() as { data: OrderPickerResult };
        if (!controller.signal.aborted) {
          setContactMatches(payload.data.items.map((item) => ({ id: item.id, clientId, name: item.name, phone: item.detail ?? "", isPrimary: item.isPrimary ?? false })));
          setContactMatchesQuery(contactQuery);
          setContactHasMore(payload.data.hasMore);
        }
      } catch {
        if (!controller.signal.aborted) setContactSearchError(true);
      } finally {
        if (!controller.signal.aborted) setContactSearchLoading(false);
      }
    }, contactQuery ? 250 : 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [clientId, clientMode, contactMode, contactQuery, contactSearchRetry, options.remote]);
  const availableContacts = useMemo(
    () => relatedOptions.contacts.filter((contact) => contact.clientId === clientId),
    [clientId, relatedOptions.contacts],
  );
  const availableObjects = useMemo(
    () => relatedOptions.objects.filter((object) => object.clientId === clientId),
    [clientId, relatedOptions.objects],
  );
  const selectedClient = selectedClientRecord?.id === clientId ? selectedClientRecord : options.clients.find((client) => client.id === clientId);
  const selectedContact = availableContacts.find((contact) => contact.id === contactId) ?? (selectedContactRecord?.id === contactId ? selectedContactRecord : undefined);
  const selectedObject = availableObjects.find((object) => object.id === objectId) ?? (selectedObjectRecord?.id === objectId ? selectedObjectRecord : undefined);
  const selectedMaster = options.masters.find((master) => master.id === masterId) ?? (selectedMasterRecord?.id === masterId ? selectedMasterRecord : undefined);
  const visibleClients = options.remote ? (clientMatchesQuery === clientQuery ? clientMatches : []) : options.clients.filter((client) => client.name.toLocaleLowerCase("ru").includes(clientQuery.trim().toLocaleLowerCase("ru")));
  const visibleContacts = options.remote ? (contactMatchesQuery === contactQuery ? contactMatches.filter((contact) => contact.clientId === clientId) : []) : availableContacts;
  const contactEmailValid = isValidOptionalEmail(contactEmail);

  function selectClient(nextClientId: string) {
    if (options.remote) {
      setSelectedClientRecord(clientMatches.find((client) => client.id === nextClientId) ?? options.clients.find((client) => client.id === nextClientId));
      setClientId(nextClientId);
      setContactId("");
      setObjectId("");
      setRelatedOptions({ objects: [], contacts: [] });
      setContactMatches([]);
      setSelectedContactRecord(null);
      setSelectedObjectRecord(null);
      setContactQuery("");
      return;
    }
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

  useEffect(() => {
    document.getElementById(activeSectionId)?.querySelector("h2")?.focus();
  }, [activeSectionId]);

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
        <dl className="mt-6 grid gap-x-6 border-t border-[var(--line)] pt-4 sm:grid-cols-2">
          <SummaryLine label="Клиент" value={draftClientName} strong />
          <SummaryLine
            label="Объект"
            value={[draftObjectName, draftAddress].filter(Boolean).join(" · ")}
          />
          <SummaryLine
            label="Первый выезд"
            value={`${formatDraftDate(visitDate)} · ${visitTime} · ${durationMinutes} мин`}
          />
          <SummaryLine
            label="Мастер"
            value={selectedMaster?.name ?? "Пока не назначен"}
          />
          <SummaryLine
            label="Согласовано"
            value={formatMoney(serviceTotal)}
            strong
          />
        </dl>
        <div className="mt-6 grid gap-3 border-t border-[var(--line)] pt-5 sm:grid-cols-2">
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
          <Link href="/calendar" className="back-link justify-center">
            Открыть календарь
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
      className="w-full space-y-5"
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

      <header className="flex items-start justify-between gap-4 sm:items-center">
        <div className="min-w-0">
          <p className="eyebrow">
            {prefill ? "Проверка входящей заявки" : "Оформление"} / шаг{" "}
            {step + 1} из {steps.length}
          </p>
          <h1 className="mt-2 font-display text-[clamp(1.65rem,1.35rem+0.8vw,2.25rem)] font-medium tracking-[-0.045em] text-[var(--text)]">
            {prefill ? "Уточнить и принять заявку" : "Оформить заказ"}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--muted)]">
            Четыре коротких шага: клиент, объект, работы и первый выезд.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <Link
            href={prefill ? "/inbox" : "/orders"}
            aria-label="Закрыть оформление"
            className="focus-ring grid size-10 place-items-center rounded-full border border-[var(--line-strong)] bg-[var(--surface)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
          >
            <X className="size-5" />
          </Link>
        </div>
      </header>

      <nav aria-label="Маршрут оформления" className="border-b border-[var(--line)] pb-3">
        <ol aria-label="Этапы оформления" className="grid grid-cols-4 gap-1">
          {steps.map((entry, index) => {
            const active = index === step;
            const done = index < step && sectionValidity[index];
            const available =
              index <= step || sectionValidity.slice(0, index).every(Boolean);

            return (
              <li key={entry.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => goToSection(index)}
                  disabled={!available}
                  aria-current={active ? "step" : undefined}
                  className={`focus-ring flex min-h-[3.75rem] w-full min-w-0 flex-col items-center justify-center gap-1 rounded-[12px] px-1 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55 sm:flex-row sm:justify-start sm:gap-2.5 sm:px-3 ${active ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "text-[var(--muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)]"}`}
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

      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_16.5rem]">
        <div className="surface-panel relative min-w-0 overflow-hidden">
          <section
            id="quick-client-section"
            aria-hidden={activeSectionId !== "quick-client-section"}
            className={
              activeSectionId === "quick-client-section"
                ? "relative z-10 animate-rise p-5 sm:p-6"
                : "hidden"
            }
          >
            <div className="grid gap-6 md:grid-cols-[minmax(11rem,0.7fr)_minmax(0,1.3fr)]">
              <aside className="min-w-0 border-b border-[var(--line)] pb-5 md:border-b-0 md:border-r md:pb-0 md:pr-5">
                <p className="eyebrow mb-4">Найти клиента</p>
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
                  <>
                    <label className="mt-4 flex h-11 items-center gap-2 rounded-[12px] border border-[var(--line)] bg-[var(--surface)] px-3">
                      <Search className="size-4 shrink-0 text-[var(--muted)]" />
                      <input
                        aria-label="Поиск клиента"
                        value={clientQuery}
                        onChange={(event) => setClientQuery(event.target.value)}
                        maxLength={100}
                        placeholder="Имя или название"
                        className="min-w-0 flex-1 bg-transparent text-xs text-[var(--text)] outline-none"
                      />
                    </label>
                    <p className="eyebrow mb-3 mt-5">Клиенты в CRM</p>
                    <div
                      aria-label="Клиенты в CRM"
                      className="max-h-64 space-y-2 overflow-y-auto overscroll-contain md:max-h-96"
                    >
                      {visibleClients.map((client) => (
                          <button
                            key={client.id}
                            type="button"
                            aria-pressed={client.id === clientId}
                            onClick={() => selectClient(client.id)}
                            className={`focus-ring flex min-h-14 w-full items-center justify-between gap-2 rounded-[12px] p-3 text-left text-xs ${client.id === clientId ? "bg-[var(--accent-soft)] font-semibold text-[var(--text)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-inset)]"}`}
                          >
                            <span className="min-w-0 break-words">
                              {client.name}
                            </span>
                            {client.id === clientId ? (
                              <Check className="size-4 shrink-0" />
                            ) : null}
                          </button>
                        ))}
                      {!visibleClients.length && !clientSearchLoading && (!options.remote || clientMatchesQuery === clientQuery) ? (
                        <p className="p-3 text-xs leading-5 text-[var(--muted)]">
                          {clientSearchError ? "Не удалось загрузить клиентов." : "Клиенты не найдены. Измените запрос или выберите «Новый клиент»."}
                        </p>
                      ) : null}
                      {clientSearchLoading || options.remote && clientMatchesQuery !== clientQuery ? <p className="p-3 text-xs text-[var(--muted)]">Загрузка…</p> : null}
                      {options.remote && clientHasMore && !clientSearchLoading ? <p className="p-3 text-xs text-[var(--muted)]">Показаны первые 20. Уточните поиск.</p> : null}
                      {options.remote && clientSearchError ? <button type="button" onClick={() => setClientSearchRetry((value) => value + 1)} className="focus-ring p-3 text-xs text-[var(--accent)]">Повторить</button> : null}
                    </div>
                  </>
                ) : (
                  <p className="mt-5 text-xs leading-5 text-[var(--muted)]">
                    Новый клиент и контакт сохранятся вместе с заказом после
                    последнего шага.
                  </p>
                )}
              </aside>
              <div className="min-w-0">
                <SectionIntro
                  number="01"
                  title={
                    clientMode === "existing"
                      ? (selectedClient?.name ?? "Выберите клиента")
                      : "Новый клиент"
                  }
                  description="Контактное лицо — с кем связаться по этому заказу."
                />
                {clientMode === "existing" ? (
                  <div className="mt-6 grid gap-4">
                    {relationsError ? <p role="alert" className="text-xs text-[var(--danger-ink)]">Не удалось загрузить контакты и объекты. <button type="button" onClick={() => setRelationsRetry((value) => value + 1)} className="underline">Повторить</button></p> : null}
                    {availableContacts.length &&
                    effectiveContactMode === "new" ? (
                      <ModeSwitch
                        value={contactMode}
                        onChange={setContactMode}
                        existingLabel="Готовый контакт"
                        newLabel="Новый контакт"
                      />
                    ) : null}
                    {effectiveContactMode === "existing" ? (
                      <div className="grid gap-3">
                        {options.remote ? <input aria-label="Поиск контакта" value={contactQuery} onChange={(event) => setContactQuery(event.target.value)} maxLength={100} placeholder="Имя или телефон" className={orderInputClass} /> : null}
                        {visibleContacts.map((contact) => (
                          <button
                            key={contact.id}
                            type="button"
                            aria-pressed={contactId === contact.id}
                            onClick={() => { setContactId(contact.id); setSelectedContactRecord(contact); }}
                            className={`focus-ring rounded-[14px] border p-4 text-left ${contactId === contact.id ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line)] bg-[var(--surface-inset)] hover:bg-[var(--surface-soft)]"}`}
                          >
                            <span className="flex items-center justify-between gap-2 text-sm font-medium text-[var(--text)]">
                              {contact.name}
                              {contactId === contact.id ? (
                                <Check className="size-4 shrink-0" />
                              ) : null}
                            </span>
                            <span className="mt-2 block text-xs text-[var(--text-secondary)]">
                              {contact.phone}
                            </span>
                            {contact.isPrimary ? (
                              <span className="mt-2 block text-[10px] text-[var(--muted)]">
                                Основной контакт
                              </span>
                            ) : null}
                          </button>
                        ))}
                        {options.remote && contactSearchLoading ? <p className="text-xs text-[var(--muted)]">Загрузка…</p> : null}
                        {options.remote && contactHasMore && !contactSearchLoading ? <p className="text-xs text-[var(--muted)]">Показаны первые 20. Уточните поиск.</p> : null}
                        {options.remote && contactSearchError ? <p role="alert" className="text-xs text-[var(--danger-ink)]">Не удалось загрузить контакты. <button type="button" onClick={() => setContactSearchRetry((value) => value + 1)} className="underline">Повторить</button></p> : null}
                        <button
                          type="button"
                          onClick={() => setContactMode("new")}
                          className="focus-ring flex min-h-11 items-center justify-center gap-2 rounded-[12px] border border-[var(--line)] text-xs text-[var(--text)]"
                        >
                          Новый контакт
                          <Plus className="size-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="grid gap-4 sm:grid-cols-2">
                        <OrderField label="Контактное лицо" required>
                          <input
                            value={contactName}
                            onChange={(event) =>
                              setContactName(event.target.value)
                            }
                            className={orderInputClass}
                            placeholder="Имя и фамилия"
                          />
                        </OrderField>
                        <OrderField label="Телефон" required>
                          <input
                            inputMode="tel"
                            value={contactPhone}
                            onChange={(event) =>
                              setContactPhone(
                                formatPhoneInput(event.target.value),
                              )
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
            </div>
          </section>

          <section
            id="quick-object-section"
            aria-hidden={activeSectionId !== "quick-object-section"}
            className={
              activeSectionId === "quick-object-section"
                ? "relative z-10 animate-rise p-5 sm:p-6"
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
                <div className="space-y-4">
                  <OrderPicker
                    key={`object-${clientId}`}
                    label="Объект"
                    required
                    value={objectId}
                    onChange={setObjectId}
                    onSelected={(option) => setSelectedObjectRecord({ id: option.value, clientId, name: option.label, address: option.detail ?? "" })}
                    placeholder="Выберите объект"
                    options={availableObjects.map((object) => ({
                      value: object.id,
                      label: object.name,
                      detail: object.address,
                    }))}
                    searchable
                    remote={options.remote ? { type: "objects", clientId } : undefined}
                    searchPlaceholder="Название или адрес"
                  />
                  {selectedObject ? (
                    <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-inset)] p-5">
                      <p className="eyebrow">Выбранный объект</p>
                      <h3 className="mt-3 text-lg font-semibold text-[var(--text)]">
                        {selectedObject.name}
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                        {selectedObject.address}
                      </p>
                    </div>
                  ) : null}
                </div>
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
                ? "relative z-10 animate-rise p-5 sm:p-6"
                : "hidden"
            }
          >
            <SectionIntro
              number="03"
              title="Что нужно сделать"
              description="Зафиксируйте работу, стоимость и исполнителя. Финансовые значения сохранятся снимком."
            />
            <div className="grid gap-4 border-b border-[var(--line)] pb-6 sm:grid-cols-[minmax(0,2fr)_minmax(4rem,0.5fr)_minmax(6rem,0.8fr)_minmax(6rem,0.8fr)]">
              <div>
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
              <div className="self-end pb-3">
                <p className="mb-3 text-xs text-[var(--muted)]">Сумма</p>
                <output className="text-lg font-semibold text-[var(--text)]">
                  {formatMoney(serviceTotal)}
                </output>
              </div>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <OrderPicker
                label="Мастер"
                value={masterId}
                onChange={(value) => {
                  setMasterId(value);
                  if (!value) setMasterPayment("");
                }}
                onSelected={(option) => setSelectedMasterRecord({ id: option.value, name: option.label, phone: option.detail ?? "" })}
                placeholder="Назначить позже"
                searchable
                remote={options.remote ? { type: "masters" } : undefined}
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
                ? "relative z-10 animate-rise p-5 sm:p-6"
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
              <div className="rounded-[14px] bg-[var(--accent-soft)] p-5 sm:col-span-3">
                <p className="text-lg font-semibold text-[var(--text)]">
                  {formatDraftDate(visitDate)} · {visitTime} · {durationMinutes}{" "}
                  мин
                </p>
                <p className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">
                  {selectedMaster
                    ? `Мастер: ${selectedMaster.name}`
                    : "Мастер пока не назначен. Его можно выбрать позже в заказе или календаре."}
                </p>
              </div>
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

          <footer className="relative border-t border-[var(--line)] p-5 sm:px-6">
            <details className="inset-panel mb-4 p-3 xl:hidden">
              <summary className="focus-ring flex cursor-pointer list-none items-center justify-between gap-3 text-xs [&::-webkit-details-marker]:hidden">
                <span className="min-w-0">
                  <span className="block text-[10px] text-[var(--muted)]">
                    Черновик · шаг {step + 1} из 4
                  </span>
                  <span className="mt-2 block truncate text-[var(--text)]">
                    {[draftClientName, draftContactName]
                      .filter(Boolean)
                      .join(" · ") || "Клиент не выбран"}
                  </span>
                </span>
                <strong className="shrink-0 text-base text-[var(--text)]">
                  {formatMoney(serviceTotal)}
                </strong>
              </summary>
              <dl className="mt-3 border-t border-[var(--line)] pt-2">
                <SummaryLine
                  label="Объект"
                  value={[draftObjectName, draftAddress]
                    .filter(Boolean)
                    .join(" · ")}
                />
                <SummaryLine label="Работа" value={serviceName} />
                <SummaryLine
                  label="Мастер"
                  value={selectedMaster?.name ?? "Назначить позже"}
                />
                <SummaryLine
                  label="Выезд"
                  value={`${formatDraftDate(visitDate)} · ${visitTime}`}
                />
              </dl>
            </details>
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
            <div className="flex justify-between gap-3">
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
                  key="continue"
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
                  key="submit"
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
          className="surface-panel hidden p-5 xl:sticky xl:top-[calc(var(--header-height)+1rem)] xl:block"
        >
          <div className="min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-display text-sm font-semibold text-[var(--text)]">
                  Черновик заказа
                </p>
                <p className="mt-3 font-display text-2xl font-semibold text-[var(--text)]">
                  0{step + 1} / 04
                </p>
                <p className="mt-2 text-[10px] text-[var(--muted)]">
                  {completedSections} из 4 разделов заполнено
                </p>
              </div>
              <span
                className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 font-display text-[10px] font-semibold ${allSectionsValid ? "bg-[var(--success-bg)] text-[var(--success)]" : "bg-[var(--surface-raised)] text-[var(--muted)]"}`}
              >
                {allSectionsValid ? "Готов" : "В работе"}
              </span>
            </div>
            <dl className="mt-5 grid gap-x-6 sm:grid-cols-2 xl:grid-cols-1">
              <SummaryLine label="Клиент" value={draftClientName} strong />
              <SummaryLine
                label="Контакт"
                value={[draftContactName, draftPhone]
                  .filter(Boolean)
                  .join(" · ")}
              />
              <SummaryLine
                label="Объект"
                value={[draftObjectName, draftAddress]
                  .filter(Boolean)
                  .join(" · ")}
                strong
              />
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
