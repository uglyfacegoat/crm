"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { LoaderCircle, Plus, Trash2 } from "lucide-react";
import { createFlexibleOrderAction, type FlexibleOrderState } from "@/app/(workspace)/quick-order/flexible-actions";
import type { OrderCreationOptions } from "@/server/orders/types";
import { ServiceChoice, resolveServiceChoice } from "@/components/catalog/service-choice";

type Phone = { label: string; phone: string };
type Contact = { name: string; position: string; phone: string; email: string; phones: Phone[] };
type ObjectEntry = { name: string; objectType: string; address: string };
type Service = { catalogItemId: string | null; name: string; quantity: string; unitPrice: string; note: string };
const initial: FlexibleOrderState = { status: "idle", message: "", orderId: null, fieldErrors: {} };
const field = "focus-ring min-h-12 w-full min-w-0 rounded-xl border border-[var(--line)] bg-[var(--surface-inset)] px-3 text-base text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)]";
const section = "rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 sm:p-6";
const blankPhone = (): Phone => ({ label: "", phone: "" });
const blankContact = (): Contact => ({ name: "", position: "", phone: "", email: "", phones: [] });
const blankObject = (): ObjectEntry => ({ name: "", objectType: "", address: "" });
const blankService = (): Service => ({ catalogItemId: null, name: "", quantity: "1", unitPrice: "", note: "" });

export function FlexibleOrderWorkspace({ options, idempotencyKey }: { options: OrderCreationOptions; idempotencyKey: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(createFlexibleOrderAction, initial);
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [kind, setKind] = useState<"individual" | "legal_entity">("individual");
  const [name, setName] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientQuery, setClientQuery] = useState("");
  const [clients, setClients] = useState(options.clients);
  const [related, setRelated] = useState<{ contacts: OrderCreationOptions["contacts"]; objects: OrderCreationOptions["objects"] }>({ contacts: [], objects: [] });
  const [existingContactId, setExistingContactId] = useState("");
  const [existingObjectIds, setExistingObjectIds] = useState<string[]>([]);
  const [primaryPhone, setPrimaryPhone] = useState("");
  const [email, setEmail] = useState("");
  const [taxId, setTaxId] = useState("");
  const [primaryContactName, setPrimaryContactName] = useState("");
  const [primaryContactPosition, setPrimaryContactPosition] = useState("");
  const [phones, setPhones] = useState<Phone[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [objects, setObjects] = useState<ObjectEntry[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [manualPrice, setManualPrice] = useState("");
  const [notes, setNotes] = useState("");
  useEffect(() => { if (state.status === "success" && state.orderId) router.push(`/orders/${state.orderId}`); }, [router, state]);
  useEffect(() => {
    if (mode !== "existing" || !clientQuery.trim()) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/v1/orders/options?type=clients&q=${encodeURIComponent(clientQuery)}`, { signal: controller.signal });
        const data = await response.json();
        if (response.ok && Array.isArray(data.data?.items)) setClients((previous) => [...data.data.items, ...previous.filter((item) => item.id === clientId && !data.data.items.some((found: { id: string }) => found.id === item.id))]);
      } catch { /* Search remains usable with already loaded clients. */ }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [clientQuery, mode, clientId]);
  useEffect(() => {
    if (!clientId) { const timer = window.setTimeout(() => setRelated({ contacts: [], objects: [] }), 0); return () => window.clearTimeout(timer); }
    const controller = new AbortController();
    Promise.all(["contacts", "objects"].map(async (type) => {
      const response = await fetch(`/api/v1/orders/options?type=${type}&clientId=${clientId}`, { signal: controller.signal });
      return (await response.json()).data;
    })).then(([contactData, objectData]) => setRelated({ contacts: (contactData?.items ?? []).map((item: { id: string; name: string; detail?: string; clientId?: string; isPrimary?: boolean }) => ({ ...item, clientId: item.clientId ?? clientId, phone: item.detail ?? "", isPrimary: item.isPrimary ?? false })), objects: (objectData?.items ?? []).map((item: { id: string; name: string; detail?: string; clientId?: string }) => ({ ...item, clientId: item.clientId ?? clientId, address: item.detail ?? "" })) })).catch(() => undefined);
    return () => controller.abort();
  }, [clientId]);
  const payload = {
    idempotencyKey,
    client: mode === "new" ? { mode, kind, name, taxId, email, primaryPhone, primaryContactName, primaryContactPosition } : { mode, clientId, existingContactId: existingContactId || null },
    phones: phones.filter((item) => item.phone.trim()), contacts: contacts.filter((item) => item.name.trim()).map((item) => ({ ...item, phones: item.phones.filter((phone) => phone.phone.trim()) })), objects: objects.filter((item) => item.name.trim() || item.address.trim()), existingObjectIds, services: services.filter((item) => item.name.trim()), manualPrice, notes,
  };
  const ready = mode === "new" ? name.trim().length >= 2 : Boolean(clientId);
  const catalog = options.catalogItems ?? [];
  return <div className="mx-auto max-w-4xl pb-28">
    <header className="mb-6"><p className="eyebrow">Операционная работа</p><h1 className="mt-2 font-display text-3xl font-semibold sm:text-4xl">Оформить заказ</h1><p className="mt-2 text-sm text-[var(--muted)]">Достаточно имени заказчика или названия организации. Остальное можно заполнить сейчас или позже.</p></header>
    <form action={action} className="grid gap-4">
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      <section className={section}><h2 className="text-lg font-semibold">Заказчик</h2><p className="mt-1 text-sm text-[var(--muted)]">Единственный обязательный шаг</p>
        <div className="mt-4 flex flex-wrap gap-2">{(["new", "existing"] as const).map((value) => <button key={value} type="button" onClick={() => setMode(value)} aria-pressed={mode === value} className={`min-h-11 rounded-xl border px-4 text-sm ${mode === value ? "border-black bg-black text-white" : "border-[var(--line)]"}`}>{value === "new" ? "Новый заказчик" : "Из CRM"}</button>)}</div>
        {mode === "new" ? <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm">Тип заказчика<select className={field} value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="individual">Человек</option><option value="legal_entity">Организация</option></select></label><label className="grid gap-1 text-sm">{kind === "individual" ? "Имя заказчика" : "Название организации"}<input className={field} value={name} onChange={(event) => setName(event.target.value)} placeholder={kind === "individual" ? "Например, Иван Петров" : "Например, ООО «Пример»"} /></label></div> : <div className="mt-4 grid gap-2"><label className="text-sm">Найти заказчика<input className={`${field} mt-1`} value={clientQuery} onChange={(event) => setClientQuery(event.target.value)} placeholder="Имя или организация" /></label><select aria-label="Выбрать заказчика" className={field} value={clientId} onChange={(event) => { setClientId(event.target.value); setExistingContactId(""); setExistingObjectIds([]); }}><option value="">Выберите заказчика</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></div>}
        {mode === "new" ? <details className="mt-4"><summary className="cursor-pointer text-sm font-medium">Телефон, email, ИНН и основное контактное лицо · необязательно</summary><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm">Телефон<input className={field} type="tel" value={primaryPhone} onChange={(event) => setPrimaryPhone(event.target.value)} placeholder="+7 999 000-00-00" /></label><label className="grid gap-1 text-sm">Email<input className={field} type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>{kind === "legal_entity" ? <label className="grid gap-1 text-sm">ИНН<input className={field} inputMode="numeric" value={taxId} onChange={(event) => setTaxId(event.target.value)} /></label> : null}<label className="grid gap-1 text-sm">Контактное лицо<input className={field} value={primaryContactName} onChange={(event) => setPrimaryContactName(event.target.value)} placeholder="Если отличается от заказчика" /></label><label className="grid gap-1 text-sm">Должность<input className={field} value={primaryContactPosition} onChange={(event) => setPrimaryContactPosition(event.target.value)} /></label></div></details> : null}
        <button type="submit" disabled={!ready || pending} className="mt-5 min-h-12 w-full rounded-xl bg-black px-4 text-sm font-medium text-white disabled:opacity-40 sm:w-auto">{pending ? "Сохраняем…" : "Создать сейчас"}</button>
      </section>
      <section className={section}><div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Контакты и номера</h2><p className="text-sm text-[var(--muted)]">Добавьте столько людей и телефонов, сколько нужно для заказа.</p></div></div>
        {mode === "existing" && related.contacts.length ? <label className="mt-4 grid gap-1 text-sm">Основной контакт из CRM<select className={field} value={existingContactId} onChange={(event) => setExistingContactId(event.target.value)}><option value="">Пока не выбран</option>{related.contacts.map((item) => <option key={item.id} value={item.id}>{item.name}{item.phone ? ` · ${item.phone}` : ""}</option>)}</select></label> : null}
        {phones.map((entry, index) => <div key={index} className="mt-3 grid grid-cols-[1fr_1.4fr_auto] gap-2"><input aria-label="Тип номера" className={field} placeholder="Рабочий, личный" value={entry.label} onChange={(event) => setPhones(phones.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} /><input aria-label="Дополнительный номер" className={field} type="tel" placeholder="+7…" value={entry.phone} onChange={(event) => setPhones(phones.map((item, i) => i === index ? { ...item, phone: event.target.value } : item))} /><button aria-label="Удалить номер" type="button" onClick={() => setPhones(phones.filter((_, i) => i !== index))}><Trash2 className="size-4" /></button></div>)}
        {contacts.map((contact, index) => <div key={index} className="mt-3 rounded-xl border border-[var(--line)] p-3"><div className="mb-3 flex items-center justify-between"><strong className="text-sm">Контакт {index + 1}</strong><button aria-label="Удалить контакт" type="button" onClick={() => setContacts(contacts.filter((_, i) => i !== index))}><Trash2 className="size-4" /></button></div><div className="grid gap-2 sm:grid-cols-2">{([['name','Имя'],['position','Должность'],['phone','Телефон'],['email','Email']] as const).map(([key, label]) => <label key={key} className="grid gap-1 text-sm">{label}<input className={field} type={key === "phone" ? "tel" : key === "email" ? "email" : "text"} value={contact[key]} onChange={(event) => setContacts(contacts.map((item, i) => i === index ? { ...item, [key]: event.target.value } : item))} /></label>)}</div>{contact.phones.map((phone, phoneIndex) => <div key={phoneIndex} className="mt-2 grid grid-cols-[1fr_1.4fr_auto] gap-2"><input aria-label="Тип номера контакта" className={field} placeholder="Тип номера" value={phone.label} onChange={(event) => setContacts(contacts.map((item, i) => i === index ? { ...item, phones: item.phones.map((p, j) => j === phoneIndex ? { ...p, label: event.target.value } : p) } : item))} /><input aria-label="Номер контакта" className={field} type="tel" placeholder="+7…" value={phone.phone} onChange={(event) => setContacts(contacts.map((item, i) => i === index ? { ...item, phones: item.phones.map((p, j) => j === phoneIndex ? { ...p, phone: event.target.value } : p) } : item))} /><button aria-label="Удалить номер контакта" type="button" onClick={() => setContacts(contacts.map((item, i) => i === index ? { ...item, phones: item.phones.filter((_, j) => j !== phoneIndex) } : item))}><Trash2 className="size-4" /></button></div>)}<button type="button" className="mt-3 text-sm underline" onClick={() => setContacts(contacts.map((item, i) => i === index ? { ...item, phones: [...item.phones, blankPhone()] } : item))}>Ещё номер контакта</button></div>)}
        <div className="mt-4 flex flex-wrap gap-2"><button type="button" className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-[var(--line)] px-3 text-sm" onClick={() => setContacts([...contacts, blankContact()])}><Plus className="size-4" /> Контакт</button><button type="button" className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-[var(--line)] px-3 text-sm" onClick={() => setPhones([...phones, blankPhone()])}><Plus className="size-4" /> Номер без контакта</button></div>
      </section>
      <section className={section}><h2 className="text-lg font-semibold">Объекты</h2><p className="text-sm text-[var(--muted)]">Адрес можно оставить пустым и уточнить позже.</p>{mode === "existing" && related.objects.length ? <div className="mt-3 grid gap-2">{related.objects.map((item) => <label key={item.id} className="flex gap-2 text-sm"><input type="checkbox" checked={existingObjectIds.includes(item.id)} onChange={(event) => setExistingObjectIds(event.target.checked ? [...existingObjectIds, item.id] : existingObjectIds.filter((id) => id !== item.id))} />{item.name}{item.address ? ` · ${item.address}` : ""}</label>)}</div> : null}{objects.map((item, index) => <div key={index} className="mt-3 grid gap-2 rounded-xl border border-[var(--line)] p-3 sm:grid-cols-[1fr_1fr_auto]"><input aria-label="Название объекта" className={field} placeholder="Название объекта" value={item.name} onChange={(event) => setObjects(objects.map((entry, i) => i === index ? { ...entry, name: event.target.value } : entry))} /><input aria-label="Адрес объекта" className={field} placeholder="Адрес, если известен" value={item.address} onChange={(event) => setObjects(objects.map((entry, i) => i === index ? { ...entry, address: event.target.value } : entry))} /><button aria-label="Удалить объект" type="button" onClick={() => setObjects(objects.filter((_, i) => i !== index))}><Trash2 className="size-4" /></button></div>)}<button type="button" className="mt-4 inline-flex min-h-11 items-center gap-1 rounded-xl border border-[var(--line)] px-3 text-sm" onClick={() => setObjects([...objects, blankObject()])}><Plus className="size-4" /> Добавить объект</button></section>
      <section className={section}><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">Работы и цена</h2><Link href="/services" target="_blank" className="text-xs underline">Открыть услуги</Link></div><p className="text-sm text-[var(--muted)]">Можно создать заказ без цены. В карточке будет указано, что она уточняется.</p>{services.map((item, index) => <div key={index} className="mt-3 grid gap-2 rounded-xl border border-[var(--line)] p-3 sm:grid-cols-[2fr_1fr_1fr_auto]"><ServiceChoice label="Услуга из каталога" value={item.catalogItemId ?? ""} items={catalog} onChange={(value, selectedItem) => { const found = selectedItem ?? catalog.find((entry) => entry.id === value); setServices(services.map((line, i) => i === index ? found ? { ...line, ...resolveServiceChoice(found, related.objects.find((object) => object.id === existingObjectIds[0])?.areaSquareMeters) } : { ...line, catalogItemId: null } : line)); }} /><input aria-label="Название работы" className={field} placeholder="Название" value={item.name} onChange={(event) => setServices(services.map((line, i) => i === index ? { ...line, catalogItemId: null, name: event.target.value } : line))} /><div className="flex gap-2"><input aria-label="Количество" className={field} inputMode="decimal" placeholder="Кол-во" value={item.quantity} onChange={(event) => setServices(services.map((line, i) => i === index ? { ...line, quantity: event.target.value } : line))} /><input aria-label="Цена за единицу" className={field} inputMode="decimal" placeholder="₽" value={item.unitPrice} onChange={(event) => setServices(services.map((line, i) => i === index ? { ...line, unitPrice: event.target.value } : line))} /></div><button aria-label="Удалить работу" type="button" onClick={() => setServices(services.filter((_, i) => i !== index))}><Trash2 className="size-4" /></button></div>)}<button type="button" className="mt-3 inline-flex min-h-11 items-center gap-1 rounded-xl border border-[var(--line)] px-3 text-sm" onClick={() => setServices([...services, blankService()])}><Plus className="size-4" /> Работа или товар</button><label className="mt-4 grid gap-1 text-sm sm:max-w-xs">Общая цена, ₽ · необязательно<input className={field} inputMode="decimal" placeholder="Уточним позже" value={manualPrice} onChange={(event) => setManualPrice(event.target.value)} /></label><label className="mt-4 grid gap-1 text-sm">Заметка<textarea className={`${field} min-h-24 py-3`} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Что известно о заказе" /></label></section>
      {state.status === "error" ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{state.message}</p> : null}
      <div className="sticky bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-30 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-3 shadow-lg md:bottom-2"><button type="submit" disabled={!ready || pending} className="flex min-h-13 w-full items-center justify-center gap-2 rounded-xl bg-black px-4 font-medium text-white disabled:opacity-40">{pending ? <LoaderCircle className="size-4 animate-spin" /> : null}{pending ? "Сохраняем…" : "Создать заказ"}</button></div>
    </form><p className="mt-4 text-center text-sm text-[var(--muted)]">Нужно сразу назначить выезд? <Link className="underline" href="/quick-order?mode=detailed">Подробное оформление</Link></p>
  </div>;
}
