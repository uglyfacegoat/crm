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
  createUnifiedOrderAction,
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
import { ServiceChoice, resolveServiceChoice } from "@/components/catalog/service-choice";
import { formatMoney } from "@/lib/format";
import type { OrderPickerResult } from "@/lib/order-picker";
import { formatPhoneInput } from "@/lib/phone-input";
import type { IncomingLeadPrefill } from "@/server/incoming-leads/types";
import type { OrderCreationOptions } from "@/server/orders/types";

type ClientMode = "existing" | "new";
type ReferenceMode = "existing" | "new";
type ExtraOrderItem = { id: string; catalogItemId: string | null; name: string; quantity: string; unitPrice: string };
type ExtraContact = { id: string; name: string; position: string; phone: string; email: string; phones: ExtraPhone[] };
type ExtraPhone = { id: string; label: string; phone: string };
type ExtraObject = typeof emptyObject & { id: string };

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
  "Укажите имя или название заказчика и проверьте заполненные поля.",
  "Проверьте заполненные данные объекта или оставьте шаг пустым.",
  "Проверьте заполненные услуги и выплату мастеру.",
  "Проверьте дату и время выбранного выезда или оставьте его на потом.",
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
  testIds = true,
}: {
  value: typeof emptyObject;
  onChange: (value: typeof emptyObject) => void;
  testIds?: boolean;
}) {
  const set = (field: keyof typeof emptyObject, fieldValue: string) =>
    onChange({ ...value, [field]: fieldValue });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <OrderField label="Название объекта">
        <input
          data-testid={testIds ? "quick-object-name" : undefined}
          value={value.name}
          onChange={(event) => set("name", event.target.value)}
          className={orderInputClass}
          placeholder="Склад на Лесной"
        />
      </OrderField>
      <OrderField label="Тип объекта">
        <input
          value={value.objectType}
          onChange={(event) => set("objectType", event.target.value)}
          className={orderInputClass}
          placeholder="Склад, офис, производство"
        />
      </OrderField>
      <div className="sm:col-span-2">
        <OrderField label="Адрес">
          <input
            data-testid={testIds ? "quick-object-address" : undefined}
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
  canScheduleVisit = true,
  canWriteFinance = false,
  embedded = false,
  onCompleted,
}: {
  options: OrderCreationOptions;
  idempotencyKey: string;
  defaultVisitDate: string;
  prefill?: IncomingLeadPrefill;
  canScheduleVisit?: boolean;
  canWriteFinance?: boolean;
  embedded?: boolean;
  onCompleted?: (result: NonNullable<QuickOrderState["result"]>) => void;
}) {
  const workflowSteps = canScheduleVisit ? steps : [...steps.slice(0, 3), { id: "quick-visit-section", title: "Проверка", description: "Проверьте заказ перед сохранением" }];
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
    createUnifiedOrderAction,
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
  const [extraContacts, setExtraContacts] = useState<ExtraContact[]>([]);
  const [extraPhones, setExtraPhones] = useState<ExtraPhone[]>([]);
  const [contactMode, setContactMode] = useState<ReferenceMode>(
    initialContactId ? "existing" : "new",
  );
  const [contactId, setContactId] = useState(initialContactId);
  const [objectMode, setObjectMode] = useState<ReferenceMode>(
    initialObjectId ? "existing" : "new",
  );
  const [objectId, setObjectId] = useState(initialObjectId);
  const [newObject, setNewObject] = useState(emptyObject);
  const [extraObjects, setExtraObjects] = useState<ExtraObject[]>([]);
  const [secondaryObjectIds, setSecondaryObjectIds] = useState<string[]>([]);
  const [serviceName, setServiceName] = useState(
    prefill?.serviceInterest ?? "",
  );
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [catalogItemId, setCatalogItemId] = useState<string | null>(null);
  const [extraOrderItems, setExtraOrderItems] = useState<ExtraOrderItem[]>([]);
  const [masterId, setMasterId] = useState("");
  const [selectedMasterRecord, setSelectedMasterRecord] = useState<OrderCreationOptions["masters"][number] | null>(null);
  const [masterPayment, setMasterPayment] = useState("");
  const [orderNotes, setOrderNotes] = useState(prefill?.orderNotes ?? "");
  const [visitDate, setVisitDate] = useState(defaultVisitDate);
  const [visitTime, setVisitTime] = useState("10:00");
  const [visitEndTime, setVisitEndTime] = useState("12:00");
  const [scheduleVisit, setScheduleVisit] = useState(false);
  const [arrivalMode, setArrivalMode] = useState<"fixed" | "window">("fixed");
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
        const objects = objectsPayload.data.items.map((item) => ({ id: item.id, clientId, name: item.name, address: item.detail ?? "", areaSquareMeters: item.areaSquareMeters }));
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
    if (options.remote && nextClientId === clientId) return;
    if (nextClientId !== clientId) {
      setExtraContacts([]);
      setExtraPhones([]);
      setExtraObjects([]);
      setSecondaryObjectIds([]);
    }
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
  const objectArea = effectiveObjectMode === "new" ? newObject.areaSquareMeters : selectedObject?.areaSquareMeters;
  const hasNewObject = effectiveObjectMode === "new" && Boolean(newObject.name.trim() || newObject.address.trim() || newObject.areaSquareMeters.trim() || newObject.floorCount.trim() || newObject.onsiteContact.trim() || newObject.accessInstructions.trim() || newObject.parkingNotes.trim() || newObject.restrictions.trim());
  const extraObjectRows = extraObjects.filter((item) => item.name.trim() || item.address.trim() || item.areaSquareMeters.trim() || item.floorCount.trim() || item.onsiteContact.trim());
  const validObject = (item: typeof emptyObject) => Boolean(item.name.trim().length >= 2 || item.address.trim().length >= 5) && (!item.address.trim() || item.address.trim().length >= 5) && (!item.areaSquareMeters.trim() || /^\d{1,10}(?:[.,]\d{1,2})?$/.test(item.areaSquareMeters.trim())) && (!item.floorCount.trim() || /^\d{1,3}$/.test(item.floorCount.trim()));
  const validPhone = (value: string) => !value.trim() || value.replace(/\D/g, "").length >= 10;
  const hasObject = effectiveObjectMode === "existing" ? Boolean(objectId) : hasNewObject && Boolean(newObject.name.trim() || newObject.address.trim());
  const serviceRows = [{ catalogItemId, name: serviceName, quantity, unitPrice, note: "" }, ...extraOrderItems.map(({ catalogItemId: id, name, quantity: count, unitPrice: price }) => ({ catalogItemId: id, name, quantity: count, unitPrice: price, note: "" }))].filter((item) => item.name.trim());
  const validServiceRow = (item: typeof serviceRows[number]) => item.name.trim().length >= 2 && parseAmount(item.quantity) > 0 && (!item.unitPrice.trim() || /^\d{1,11}(?:[.,]\d{1,2})?$/.test(item.unitPrice.trim().replace(/\s/g, "")));
  const sectionValidity = [
    (clientMode === "new" ? clientName.trim().length >= 2 : Boolean(clientId)) &&
      contactEmailValid &&
      validPhone(contactPhone) &&
      extraContacts.every((item) => item.name.trim().length >= 2 && isValidOptionalEmail(item.email) && validPhone(item.phone) && item.phones.every((phone) => phone.phone.trim() && validPhone(phone.phone))) &&
      extraPhones.every((item) => item.phone.trim() && validPhone(item.phone)) &&
      (!taxId || /^\d{10}(\d{2})?$/.test(taxId)),
    (!hasNewObject || validObject(newObject)) && extraObjects.every(validObject),
    serviceRows.every(validServiceRow) && (!masterPayment.trim() || Boolean(masterId) && /^\d{1,11}(?:[.,]\d{1,2})?$/.test(masterPayment.trim().replace(/\s/g, ""))),
    !canScheduleVisit || !scheduleVisit || (hasObject && Boolean(visitDate) && /^\d{2}:\d{2}$/.test(visitTime) &&
      (arrivalMode === "fixed" || /^\d{2}:\d{2}$/.test(visitEndTime) && visitEndTime !== visitTime)),
  ] as const;
  const allSectionsValid = sectionValidity.every(Boolean);
  const completedSections = sectionValidity.filter(Boolean).length;
  const serviceTotal = parseAmount(quantity) * parseAmount(unitPrice) + extraOrderItems.reduce((sum, item) => sum + parseAmount(item.quantity) * parseAmount(item.unitPrice), 0);
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
    sourceLead: prefill ? { id: prefill.sourceLeadId, expectedVersion: prefill.sourceLeadVersion } : null,
    client: clientMode === "new" ? {
      mode: "new" as const, kind: clientKind, name: clientName, taxId, email: contactEmail,
      primaryPhone: contactPhone, primaryContactName: contactName, primaryContactPosition: contactPosition,
    } : { mode: "existing" as const, clientId, existingContactId: effectiveContactMode === "existing" && contactId ? contactId : null },
    phones: extraPhones.map(({ label, phone }) => ({ label, phone })),
    contacts: [
      ...(clientMode === "existing" && effectiveContactMode === "new" && (contactName.trim() || contactPhone.trim()) ? [{ name: contactName.trim() || draftClientName, position: contactPosition, phone: contactPhone, email: contactEmail, phones: [] }] : []),
      ...extraContacts.map(({ name, position, phone, email, phones }) => ({ name, position, phone, email, phones: phones.map(({ label, phone: number }) => ({ label, phone: number })) })),
    ],
    objects: [...(effectiveObjectMode === "new" && hasNewObject ? [newObject] : []), ...extraObjectRows.map((item) => ({ name: item.name, objectType: item.objectType, address: item.address, areaSquareMeters: item.areaSquareMeters, floorCount: item.floorCount, onsiteContact: item.onsiteContact, accessInstructions: item.accessInstructions, parkingNotes: item.parkingNotes, restrictions: item.restrictions, riskLevel: item.riskLevel, infestationLevel: item.infestationLevel }))],
    existingObjectIds: effectiveObjectMode === "existing" && objectId ? [objectId, ...secondaryObjectIds.filter((id) => id !== objectId)] : [],
    services: serviceRows,
    manualPrice: "",
    assignedMasterId: masterId || null,
    masterPayment: canWriteFinance ? masterPayment : "",
    notes: orderNotes,
    visit: canScheduleVisit && scheduleVisit ? { localDate: visitDate, localTime: visitTime, arrivalMode, endTime: arrivalMode === "window" ? visitEndTime : null, notes: visitNotes } : null,
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
    goToSection(Math.min(workflowSteps.length - 1, step + 1));
  }

  const activeSectionId = workflowSteps[step].id;

  useEffect(() => {
    document.getElementById(activeSectionId)?.querySelector("h2")?.focus();
  }, [activeSectionId]);

  useEffect(() => {
    if (state.status === "success" && state.result) onCompleted?.(state.result);
  }, [state, onCompleted]);

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
            Заказ сохранён. Заполненные сведения доступны в его карточке;
            остальные можно добавить позже.
          </p>
        </div>
        <dl className="mt-6 grid gap-x-6 border-t border-[var(--line)] pt-4 sm:grid-cols-2">
          <SummaryLine label="Клиент" value={draftClientName} strong />
          <SummaryLine
            label="Объект"
            value={[draftObjectName, draftAddress].filter(Boolean).join(" · ")}
          />
          {state.result.visitId ? <SummaryLine label="Первый выезд" value={`${formatDraftDate(visitDate)} · ${visitTime}${arrivalMode === "window" ? `–${visitEndTime}` : ""}`} /> : null}
          <SummaryLine
            label="Мастер"
            value={selectedMaster?.name ?? "Пока не назначен"}
          />
          <SummaryLine
            label="Согласовано"
            value={serviceRows.length && serviceRows.every((item) => item.unitPrice.trim()) ? formatMoney(serviceTotal) : "Цена уточняется"}
            strong
          />
        </dl>
        <div className="mt-6 grid gap-3 border-t border-[var(--line)] pt-5 sm:grid-cols-2">
          {state.result.visitId ? <VisitDispatchCardButton
            visitId={state.result.visitId}
            className="!border-0 h-12 rounded-[12px] bg-[var(--accent)] font-semibold text-[var(--on-accent)] hover:bg-[var(--accent-strong)]"
          /> : null}
          <Link
            href={`/orders/${state.result.orderId}`}
            className="focus-ring flex h-12 items-center justify-center rounded-[12px] border border-[var(--line-strong)] bg-[var(--surface)] text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
          >
            Открыть заказ
          </Link>
          {state.result.visitId ? <Link href="/calendar" className="back-link justify-center">
            Открыть календарь
          </Link> : null}
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
            {step + 1} из {workflowSteps.length}
          </p>
          <h1 className="mt-2 font-display text-[clamp(1.65rem,1.35rem+0.8vw,2.25rem)] font-medium tracking-[-0.045em] text-[var(--text)]">
            {prefill ? "Уточнить и принять заявку" : "Оформить заказ"}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--muted)]">
            Для создания заказа достаточно имени или названия заказчика. Остальные данные можно добавить позже.
          </p>
        </div>
        {!embedded ? <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <Link
            href={prefill ? "/inbox" : "/orders"}
            aria-label="Закрыть оформление"
            className="focus-ring grid size-10 place-items-center rounded-full border border-[var(--line-strong)] bg-[var(--surface)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
          >
            <X className="size-5" />
          </Link>
        </div> : null}
      </header>

      <nav aria-label="Маршрут оформления" className="border-b border-[var(--line)] pb-3">
        <ol aria-label="Этапы оформления" className="grid grid-cols-4 gap-1">
          {workflowSteps.map((entry, index) => {
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

      <div className={`grid min-w-0 items-start gap-4 ${embedded ? "" : "xl:grid-cols-[minmax(0,1fr)_16.5rem]"}`}>
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
                        <OrderField label="Контактное лицо">
                          <input
                            value={contactName}
                            onChange={(event) =>
                              setContactName(event.target.value)
                            }
                            className={orderInputClass}
                            placeholder="Имя и фамилия"
                          />
                        </OrderField>
                        <OrderField label="Телефон">
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
                    <OrderPicker searchable={false}
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
                      <OrderField label="ИНН">
                        <input
                          data-testid="quick-tax-id"
                          inputMode="numeric"
                          value={taxId}
                          onChange={(event) =>
                            setTaxId(event.target.value.replace(/\D/g, ""))
                          }
                          className={orderInputClass}
                          placeholder="10 или 12 цифр, если есть"
                        />
                      </OrderField>
                    ) : null}
                    <OrderField label="Контактное лицо">
                      <input
                        data-testid="quick-contact-name"
                        value={contactName}
                        onChange={(event) => setContactName(event.target.value)}
                        className={orderInputClass}
                        placeholder="Имя и фамилия"
                      />
                    </OrderField>
                    <OrderField label="Телефон">
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
            <div className="mt-6 border-t border-[var(--line)] pt-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h3 className="text-sm font-semibold text-[var(--text)]">Ещё контакты и номера</h3><p className="mt-1 text-xs text-[var(--muted)]">Сохраняются вместе с заказом и появляются в карточке клиента.</p></div>
                <div className="flex flex-wrap gap-2"><button type="button" disabled={extraContacts.length >= 19} onClick={() => setExtraContacts((current) => [...current, { id: crypto.randomUUID(), name: "", position: "", phone: "", email: "", phones: [] }])} className="focus-ring inline-flex min-h-10 items-center gap-1 rounded-xl border border-[var(--line)] px-3 text-xs disabled:opacity-40"><Plus className="size-4" /> Контакт</button><button type="button" disabled={extraPhones.length >= 20} onClick={() => setExtraPhones((current) => [...current, { id: crypto.randomUUID(), label: "", phone: "" }])} className="focus-ring inline-flex min-h-10 items-center gap-1 rounded-xl border border-[var(--line)] px-3 text-xs disabled:opacity-40"><Plus className="size-4" /> Номер</button></div>
              </div>
              {extraContacts.map((item, index) => <div key={item.id} className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--surface-inset)] p-3"><div className="mb-3 flex items-center justify-between"><span className="text-xs font-semibold">Контакт {index + 2}</span><button type="button" aria-label={`Удалить дополнительный контакт ${index + 1}`} onClick={() => setExtraContacts((current) => current.filter((entry) => entry.id !== item.id))} className="focus-ring grid size-9 place-items-center rounded-lg"><X className="size-4" /></button></div><div className="grid gap-3 sm:grid-cols-2"><OrderField label="Имя"><input value={item.name} onChange={(event) => setExtraContacts((current) => current.map((entry) => entry.id === item.id ? { ...entry, name: event.target.value } : entry))} className={orderInputClass} /></OrderField><OrderField label="Телефон"><input value={item.phone} inputMode="tel" onChange={(event) => setExtraContacts((current) => current.map((entry) => entry.id === item.id ? { ...entry, phone: formatPhoneInput(event.target.value) } : entry))} className={orderInputClass} /></OrderField><OrderField label="Должность"><input value={item.position} onChange={(event) => setExtraContacts((current) => current.map((entry) => entry.id === item.id ? { ...entry, position: event.target.value } : entry))} className={orderInputClass} /></OrderField><OrderField label="Email"><input type="email" value={item.email} onChange={(event) => setExtraContacts((current) => current.map((entry) => entry.id === item.id ? { ...entry, email: event.target.value } : entry))} className={orderInputClass} /></OrderField></div>
                {item.phones.map((phone, phoneIndex) => <div key={phone.id} className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]">
                  <OrderField label="Тип номера"><input value={phone.label} onChange={(event) => setExtraContacts((current) => current.map((entry) => entry.id === item.id ? { ...entry, phones: entry.phones.map((number) => number.id === phone.id ? { ...number, label: event.target.value } : number) } : entry))} className={orderInputClass} placeholder="Рабочий, личный" /></OrderField>
                  <OrderField label="Дополнительный номер"><input value={phone.phone} inputMode="tel" onChange={(event) => setExtraContacts((current) => current.map((entry) => entry.id === item.id ? { ...entry, phones: entry.phones.map((number) => number.id === phone.id ? { ...number, phone: formatPhoneInput(event.target.value) } : number) } : entry))} className={orderInputClass} /></OrderField>
                  <button type="button" aria-label={`Удалить номер контакта ${phoneIndex + 1}`} onClick={() => setExtraContacts((current) => current.map((entry) => entry.id === item.id ? { ...entry, phones: entry.phones.filter((number) => number.id !== phone.id) } : entry))} className="focus-ring grid size-10 place-items-center self-end rounded-lg"><X className="size-4" /></button>
                </div>)}
                <button type="button" disabled={item.phones.length >= 10} onClick={() => setExtraContacts((current) => current.map((entry) => entry.id === item.id ? { ...entry, phones: [...entry.phones, { id: crypto.randomUUID(), label: "", phone: "" }] } : entry))} className="focus-ring mt-3 inline-flex min-h-10 items-center gap-1 rounded-xl border border-[var(--line)] px-3 text-xs disabled:opacity-40"><Plus className="size-4" /> Ещё номер контакта</button>
              </div>)}
              {extraPhones.map((item, index) => <div key={item.id} className="mt-3 grid gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface-inset)] p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]"><OrderField label="Тип номера"><input value={item.label} onChange={(event) => setExtraPhones((current) => current.map((entry) => entry.id === item.id ? { ...entry, label: event.target.value } : entry))} className={orderInputClass} placeholder="Рабочий, личный" /></OrderField><OrderField label="Номер"><input value={item.phone} inputMode="tel" onChange={(event) => setExtraPhones((current) => current.map((entry) => entry.id === item.id ? { ...entry, phone: formatPhoneInput(event.target.value) } : entry))} className={orderInputClass} /></OrderField><button type="button" aria-label={`Удалить дополнительный номер ${index + 1}`} onClick={() => setExtraPhones((current) => current.filter((entry) => entry.id !== item.id))} className="focus-ring grid size-10 place-items-center self-end rounded-lg"><X className="size-4" /></button></div>)}
            </div>
            <p className="mt-6 text-xs text-[var(--muted)]">Для заказа достаточно имени или названия. Контактные данные можно добавить позже.</p>
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
                    onSelected={(option) => setSelectedObjectRecord({ id: option.value, clientId, name: option.label, address: option.detail ?? "", areaSquareMeters: option.areaSquareMeters })}
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
            <div className="mt-6 border-t border-[var(--line)] pt-5">
              <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-[var(--text)]">Другие объекты заказа</h3><p className="mt-1 text-xs text-[var(--muted)]">Можно привязать несколько объектов сразу.</p></div><button type="button" disabled={extraObjects.length >= 19} onClick={() => setExtraObjects((current) => [...current, { ...emptyObject, id: crypto.randomUUID() }])} className="focus-ring inline-flex min-h-10 items-center gap-1 rounded-xl border border-[var(--line)] px-3 text-xs disabled:opacity-40"><Plus className="size-4" /> Новый объект</button></div>
              {effectiveObjectMode === "existing" && availableObjects.filter((item) => item.id !== objectId).length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{availableObjects.filter((item) => item.id !== objectId).map((item) => <label key={item.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-inset)] px-3 text-xs"><input type="checkbox" checked={secondaryObjectIds.includes(item.id)} onChange={(event) => setSecondaryObjectIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} className="size-4 accent-[var(--accent)]" /><span className="min-w-0 truncate">{item.name}{item.address ? ` · ${item.address}` : ""}</span></label>)}</div> : null}
              {extraObjects.map((item, index) => <div key={item.id} className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--surface-inset)] p-3"><div className="mb-3 flex items-center justify-between"><span className="text-xs font-semibold">Объект {index + 2}</span><button type="button" aria-label={`Удалить дополнительный объект ${index + 1}`} onClick={() => setExtraObjects((current) => current.filter((entry) => entry.id !== item.id))} className="focus-ring grid size-9 place-items-center rounded-lg"><X className="size-4" /></button></div><ObjectFields value={item} testIds={false} onChange={(next) => setExtraObjects((current) => current.map((entry) => entry.id === item.id ? { ...next, id: item.id } : entry))} /></div>)}
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
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <div className="min-w-60 flex-1"><ServiceChoice value={catalogItemId ?? ""} items={options.catalogItems ?? []} onChange={(value, selectedItem) => {
                const item = selectedItem ?? options.catalogItems?.find((candidate) => candidate.id === value);
                setCatalogItemId(item?.id ?? null);
                if (!item) return;
                const choice = resolveServiceChoice(item, objectArea);
                setCatalogItemId(choice.catalogItemId);
                setServiceName(choice.name);
                setQuantity(choice.quantity);
                setUnitPrice(choice.unitPrice);
              }} /></div>
              <Link href="/services" target="_blank" className="inline-flex min-h-11 items-center rounded-xl border border-[var(--line)] px-4 text-sm">Открыть услуги</Link>
            </div>
            <div className="grid gap-4 border-b border-[var(--line)] pb-6 sm:grid-cols-[minmax(0,2fr)_minmax(4rem,0.5fr)_minmax(6rem,0.8fr)_minmax(6rem,0.8fr)]">
              <div>
                <OrderField label="Товар или услуга">
                  <input
                    data-testid="quick-service-name"
                    value={serviceName}
                    onChange={(event) => { setServiceName(event.target.value); setCatalogItemId(null); }}
                    className={orderInputClass}
                  />
                </OrderField>
              </div>
              <OrderField label="Количество">
                <input
                  inputMode="decimal"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  className={orderInputClass}
                />
              </OrderField>
              <OrderField label="Цена за единицу, ₽">
                <input
                  data-testid="quick-unit-price"
                  inputMode="decimal"
                  value={unitPrice}
                  onChange={(event) => setUnitPrice(event.target.value)}
                  className={orderInputClass}
                    placeholder="Уточняется"
                />
              </OrderField>
              {options.catalogItems?.find((item) => item.id === catalogItemId)?.priceMode === "variable" && !unitPrice && <p className="text-xs text-[var(--muted)] sm:col-span-4">Укажите индивидуальную цену этой позиции в заказе.</p>}
              <div className="self-end pb-3">
                <p className="mb-3 text-xs text-[var(--muted)]">Сумма</p>
                <output className="text-lg font-semibold text-[var(--text)]">
                  {serviceRows.length && serviceRows.every((item) => item.unitPrice.trim()) ? formatMoney(serviceTotal) : "Цена уточняется"}
                </output>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {extraOrderItems.map((item, index) => <div key={item.id} className="rounded-xl border border-[var(--line)] bg-[var(--surface-inset)] p-3">
                <div className="mb-3 flex items-center justify-between"><span className="text-sm font-medium">Дополнительная позиция {index + 1}</span><button type="button" onClick={() => setExtraOrderItems((current) => current.filter((candidate) => candidate.id !== item.id))} className="text-sm text-[var(--muted)]">Удалить</button></div>
                <div className="mb-3"><ServiceChoice label={`Позиция из каталога ${index + 2}`} value={item.catalogItemId ?? ""} items={options.catalogItems ?? []} onChange={(value, selectedItem) => {
                  const selected = selectedItem ?? options.catalogItems?.find((candidate) => candidate.id === value);
                  setExtraOrderItems((current) => current.map((candidate) => candidate.id === item.id ? selected ? { ...candidate, ...resolveServiceChoice(selected, objectArea) } : { ...candidate, catalogItemId: null } : candidate));
                }} /></div>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_6rem_8rem]"><input aria-label={`Название позиции ${index + 2}`} value={item.name} onChange={(event) => setExtraOrderItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, name: event.target.value, catalogItemId: null } : candidate))} placeholder="Название" className={orderInputClass} /><input aria-label={`Количество позиции ${index + 2}`} value={item.quantity} onChange={(event) => setExtraOrderItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, quantity: event.target.value } : candidate))} inputMode="decimal" placeholder="Кол-во" className={orderInputClass} /><input aria-label={`Цена позиции ${index + 2}`} value={item.unitPrice} onChange={(event) => setExtraOrderItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, unitPrice: event.target.value } : candidate))} inputMode="decimal" placeholder="Цена, ₽" className={orderInputClass} /></div>
              </div>)}
              {extraOrderItems.length < 99 && <button type="button" onClick={() => setExtraOrderItems((current) => [...current, { id: crypto.randomUUID(), catalogItemId: null, name: "", quantity: "1", unitPrice: "" }])} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--line)] px-4 text-sm"><Plus className="size-4" /> Добавить товар или услугу</button>}
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
              {canWriteFinance ? <OrderField label="Выплата мастеру" required={Boolean(masterId)}>
                <input
                  inputMode="decimal"
                  disabled={!masterId}
                  value={masterPayment}
                  onChange={(event) => setMasterPayment(event.target.value)}
                  className={orderInputClass}
                  placeholder="4000"
                />
              </OrderField> : null}
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
              title={canScheduleVisit ? "Когда выезжать" : "Проверьте заказ"}
              description={canScheduleVisit ? "Первый выезд можно назначить сейчас или добавить позже из заказа." : "Сохраните заказ. Сотрудник с доступом к календарю сможет назначить выезд позже."}
            />
            {canScheduleVisit ? <>
            <label className="mb-5 flex cursor-pointer items-center gap-3 rounded-[12px] border border-[var(--line)] bg-[var(--surface-inset)] p-4 text-sm font-medium">
              <input type="checkbox" checked={scheduleVisit} onChange={(event) => setScheduleVisit(event.target.checked)} className="size-4 accent-[var(--accent)]" />
              Запланировать первый выезд
            </label>
            {scheduleVisit ? <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex gap-2 sm:col-span-3" role="group" aria-label="Тип времени выезда">
                <button type="button" aria-pressed={arrivalMode === "fixed"} onClick={() => setArrivalMode("fixed")} className={`focus-ring min-h-11 rounded-xl border px-4 text-xs font-semibold ${arrivalMode === "fixed" ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "border-[var(--line)]"}`}>Точное время</button>
                <button type="button" aria-pressed={arrivalMode === "window"} onClick={() => setArrivalMode("window")} className={`focus-ring min-h-11 rounded-xl border px-4 text-xs font-semibold ${arrivalMode === "window" ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "border-[var(--line)]"}`}>Интервал</button>
              </div>
              <OrderField label="Дата">
                <DateInput
                  data-testid="quick-visit-date"
                  name="visitDate"
                  value={visitDate}
                  onChange={setVisitDate}
                />
              </OrderField>
              <OrderField label={arrivalMode === "fixed" ? "Время прибытия" : "Начало интервала"}>
                <TimeInput
                  data-testid="quick-visit-time"
                  name="visitTime"
                  value={visitTime}
                  onChange={setVisitTime}
                />
              </OrderField>
              {arrivalMode === "window" ? <OrderField label="Окончание интервала"><TimeInput name="visitEndTime" value={visitEndTime} onChange={setVisitEndTime} /></OrderField> : null}
              <div className="rounded-[14px] bg-[var(--accent-soft)] p-5 sm:col-span-3">
                <p className="text-lg font-semibold text-[var(--text)]">
                  {formatDraftDate(visitDate)} · {visitTime}{arrivalMode === "window" ? `–${visitEndTime}${visitEndTime < visitTime ? " · следующий день" : ""}` : ""}
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
            </div> : <p className="text-sm text-[var(--muted)]">Выезд не создаётся. Его можно назначить в карточке заказа, когда дата станет известна.</p>}
            </> : <div className="rounded-[14px] bg-[var(--surface-inset)] p-5 text-sm leading-6 text-[var(--text-secondary)]">
              <p><strong className="text-[var(--text)]">Клиент:</strong> {draftClientName}</p>
              <p><strong className="text-[var(--text)]">Объект:</strong> {draftObjectName || "Можно добавить позже"}</p>
              <p><strong className="text-[var(--text)]">Услуги:</strong> {serviceRows.length ? serviceRows.map((item) => item.name).join(" · ") : "Можно добавить позже"}</p>
              <p><strong className="text-[var(--text)]">Стоимость:</strong> {serviceRows.length && serviceRows.every((item) => item.unitPrice.trim()) ? formatMoney(serviceTotal) : "Уточняется"}</p>
            </div>}
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
                  {serviceRows.length && serviceRows.every((item) => item.unitPrice.trim()) ? formatMoney(serviceTotal) : "Цена уточняется"}
                </strong>
              </summary>
              <dl className="mt-3 border-t border-[var(--line)] pt-2">
                <SummaryLine
                  label="Объект"
                  value={[draftObjectName, draftAddress]
                    .filter(Boolean)
                    .join(" · ")}
                />
                <SummaryLine label="Позиции" value={serviceRows.length ? serviceRows.map((item) => item.name).join(" · ") : "Пока не указаны"} />
                <SummaryLine
                  label="Мастер"
                  value={selectedMaster?.name ?? "Назначить позже"}
                />
                <SummaryLine
                  label="Выезд"
                  value={scheduleVisit ? `${formatDraftDate(visitDate)} · ${visitTime}${arrivalMode === "window" ? `–${visitEndTime}` : ""}` : "Пока не назначен"}
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
              {step < workflowSteps.length - 1 ? (
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
                      Создать заказ
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
          className={embedded ? "hidden" : "surface-panel hidden p-5 xl:sticky xl:top-[calc(var(--header-height)+1rem)] xl:block"}
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
                  {completedSections} из 4 шагов проверено
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
              <SummaryLine label="Позиции" value={serviceRows.length ? serviceRows.map((item) => item.name).join(" · ") : "Пока не указаны"} />
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
                {serviceRows.length && serviceRows.every((item) => item.unitPrice.trim()) ? formatMoney(serviceTotal) : "Цена уточняется"}
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
                : "Укажите заказчика и проверьте заполненные поля."}
            </p>
          </div>
        </aside>
      </div>
    </form>
  );
}
