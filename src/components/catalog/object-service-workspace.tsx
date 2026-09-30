"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { CalendarDays, Plus, Search, Trash2 } from "lucide-react";
import { saveObjectServiceProfileAction } from "@/app/(workspace)/services/actions";
import { formatMoneyMinor } from "@/lib/format";
import type { CatalogItem } from "@/server/catalog/repository";
import type { ScopedObjectServiceProfile } from "@/server/catalog/object-service-profiles";
import { ServiceChoice } from "@/components/catalog/service-choice";

type Item = CatalogItem & { organizationId: string; organizationName: string };
type ProfileResult = { items: ScopedObjectServiceProfile[]; hasMore: boolean; configuredCount: number };
type DraftRate = { key: string; catalogItemId: string | null; name: string; lineKind: "contract" | "request";
  billingBasis: "area" | "quantity" | "fixed"; quantity: string; unitPrice: string };
const field = "min-h-11 w-full min-w-0 rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none focus:border-black";
const blankRate = (): DraftRate => ({ key: crypto.randomUUID(), catalogItemId: null, name: "", lineKind: "contract", billingBasis: "area", quantity: "1", unitPrice: "" });

export function ObjectServiceWorkspace({ initialProfiles, catalog, destinations, currentOrganizationId, canWrite, remoteEnabled }: {
  initialProfiles: ProfileResult; catalog: Item[]; destinations: Array<{ id: string; name: string }>; currentOrganizationId: string; canWrite: boolean; remoteEnabled: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [result, setResult] = useState(initialProfiles);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const requestGeneration = useRef(0);
  const [selectedKey, setSelectedKey] = useState(initialProfiles.items[0] ? `${initialProfiles.items[0].organizationId}:${initialProfiles.items[0].objectId}` : "");
  const profiles = result.items;
  const selected = profiles.find((profile) => `${profile.organizationId}:${profile.objectId}` === selectedKey) ?? profiles[0];
  const [area, setArea] = useState("");
  const [visits, setVisits] = useState("");
  const [schedule, setSchedule] = useState("");
  const [contractTotal, setContractTotal] = useState("");
  const [notes, setNotes] = useState("");
  const [rates, setRates] = useState<DraftRate[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const canEditSelected = canWrite && Boolean(selected && destinations.some((entry) => entry.id === selected.organizationId));
  const available = catalog.filter((item) => item.organizationId === selected?.organizationId);
  useEffect(() => { const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250); return () => window.clearTimeout(timer); }, [query]);
  useEffect(() => {
    if (!remoteEnabled) return;
    const generation = ++requestGeneration.current;
    const controller = new AbortController();
    queueMicrotask(() => { if (generation === requestGeneration.current) { setLoading(true); setLoadError(""); } });
    const params = new URLSearchParams({ q: debouncedQuery, page: "0" });
    fetch(`/api/v1/services/profiles?${params}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message ?? "Не удалось загрузить объекты.");
        return payload.data as ProfileResult;
      })
      .then((data) => {
        if (generation !== requestGeneration.current) return;
        setResult(data);
        setPage(0);
        setSelectedKey((current) => data.items.some((item) => `${item.organizationId}:${item.objectId}` === current)
          ? current : data.items[0] ? `${data.items[0].organizationId}:${data.items[0].objectId}` : "");
      })
      .catch((error) => { if (generation === requestGeneration.current && !controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Не удалось загрузить объекты."); })
      .finally(() => { if (generation === requestGeneration.current) setLoading(false); });
    return () => controller.abort();
  }, [debouncedQuery, reload, remoteEnabled]);

  async function loadMore() {
    if (loading || !result.hasMore) return;
    const generation = requestGeneration.current;
    const nextPage = page + 1;
    setLoading(true); setLoadError("");
    try {
      const params = new URLSearchParams({ q: debouncedQuery, page: String(nextPage) });
      const response = await fetch(`/api/v1/services/profiles?${params}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Не удалось загрузить объекты.");
      if (generation === requestGeneration.current) {
        const data = payload.data as ProfileResult;
        setResult((current) => ({ ...data, items: [...current.items, ...data.items] }));
        setPage(nextPage);
      }
    } catch (error) {
      if (generation === requestGeneration.current) setLoadError(error instanceof Error ? error.message : "Не удалось загрузить объекты.");
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (!selected) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setArea(selected.areaSquareMeters ?? selected.objectAreaSquareMeters ?? "");
      setVisits(selected.visitsPerMonth?.toString() ?? "");
      setSchedule(selected.serviceSchedule);
      setContractTotal(selected.contractTotalMinor === null ? "" : (selected.contractTotalMinor / 100).toFixed(2));
      setNotes(selected.notes);
      setRates(selected.rates.map((rate) => ({ key: rate.id, catalogItemId: rate.catalogItemId, name: rate.name,
        lineKind: rate.lineKind, billingBasis: rate.billingBasis, quantity: rate.quantity || "1",
        unitPrice: rate.unitPriceMinor === null ? "" : (rate.unitPriceMinor / 100).toFixed(2) })));
      setError("");
    });
    return () => { active = false; };
  }, [selected]);

  const estimate = useMemo(() => rates.reduce((sum, rate) => {
    if (rate.lineKind !== "contract") return sum;
    const line = calculateLineMinor(rate, area);
    return line === null ? sum : sum + line;
  }, 0n), [rates, area]);
  const unpriced = rates.some((rate) => rate.lineKind === "contract" && calculateLineMinor(rate, area) === null);
  const effectiveTotal = contractTotal.trim() ? parseHundredths(contractTotal) : estimate;

  function updateRate(key: string, patch: Partial<DraftRate>) {
    setRates((current) => current.map((rate) => rate.key === key ? { ...rate, ...patch } : rate));
  }

  function save() {
    if (!selected || !canEditSelected) return;
    setError(""); setStatus("");
    startTransition(async () => {
      const result = await saveObjectServiceProfileAction({ organizationId: selected.organizationId, objectId: selected.objectId,
        expectedVersion: selected.version, areaSquareMeters: area, visitsPerMonth: visits ? Number(visits) : null,
        serviceSchedule: schedule, contractTotal, notes,
        rates: rates.map(({ catalogItemId, name, lineKind, billingBasis, quantity, unitPrice }) =>
          ({ catalogItemId, name, lineKind, billingBasis, quantity, unitPrice })) });
      if (result.status === "success") {
        try {
          const response = await fetch(`/api/v1/services/profiles?id=${encodeURIComponent(selected.objectId)}`, { cache: "no-store" });
          if (!response.ok) throw new Error("Profile refresh failed");
          const payload = await response.json();
          const updated = (payload.data as ProfileResult).items[0];
          if (!updated) throw new Error("Profile refresh failed");
          setResult((current) => ({ ...current, configuredCount: payload.data.configuredCount,
            items: current.items.map((item) => item.objectId === updated.objectId ? updated : item) }));
        } catch { setReload((value) => value + 1); }
        setStatus(result.message); router.refresh();
      }
      else setError(result.message);
    });
  }

  return <div className="mt-6 grid min-w-0 gap-5 xl:grid-cols-[minmax(15rem,19rem)_minmax(0,1fr)]">
    <aside className="surface-panel h-fit p-4 sm:p-5">
      <h2 className="text-base font-semibold">Объекты клиентов</h2>
      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Название и площадь берутся из карточки объекта. Условия можно уточнить здесь.</p>
      <label className="mt-4 flex min-h-11 items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3"><Search className="size-4 text-[var(--muted)]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Клиент или объект" className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></label>
      <div className="mt-3 max-h-[34rem] space-y-1 overflow-y-auto">{profiles.map((profile) => {
        const key = `${profile.organizationId}:${profile.objectId}`;
        return <button key={key} type="button" onClick={() => { setSelectedKey(key); setStatus(""); }} className={`focus-ring w-full rounded-xl border p-3 text-left ${key === selectedKey ? "border-black bg-[var(--surface-inset)]" : "border-transparent hover:border-[var(--line)]"}`}>
          <span className="block truncate text-sm font-semibold">{profile.objectName}</span><span className="mt-1 block truncate text-xs text-[var(--muted)]">{profile.clientName}</span>
          <span className="mt-1 block text-[10px] text-[var(--muted)]">{profile.version ? "Условия заполнены" : "Условия ещё не заполнены"}{destinations.length > 1 ? ` · ${profile.organizationName}` : ""}</span>
        </button>;
      })}{!profiles.length && !loading && !loadError ? <p className="p-3 text-xs text-[var(--muted)]">Объект не найден.</p> : null}</div>
      {loadError ? <p role="alert" className="mt-2 text-xs text-red-700">{loadError} <button type="button" className="underline" onClick={() => setReload((value) => value + 1)}>Повторить</button></p> : null}
      {result.hasMore ? <button type="button" onClick={loadMore} disabled={loading} className="mt-3 min-h-10 w-full rounded-xl border border-[var(--line)] bg-white px-3 text-xs disabled:opacity-50">{loading ? "Загружаем…" : "Показать ещё"}</button> : null}
    </aside>

    {selected ? <section aria-label="Условия объекта" className="surface-panel min-w-0 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="eyebrow">{selected.clientName}</p><h2 className="mt-2 break-words font-display text-2xl font-semibold">{selected.objectName}</h2><p className="mt-1 text-xs text-[var(--muted)]">{selected.address || "Адрес ещё не указан"}</p></div><Link href={`/clients/${selected.clientId}`} className="focus-ring rounded-xl border border-[var(--line)] px-3 py-2 text-xs">Карточка клиента</Link></div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Label text="Площадь объекта, м²"><input value={area} onChange={(event) => setArea(event.target.value)} inputMode="decimal" placeholder="Например, 24198,87" disabled={!canEditSelected} className={field} /></Label>
        <Label text="Обслуживаний в месяц"><input value={visits} onChange={(event) => setVisits(event.target.value)} type="number" min="1" max="31" placeholder="Например, 2" disabled={!canEditSelected} className={field} /></Label>
        <Label text="Общий чек по договору, ₽"><input value={contractTotal} onChange={(event) => setContractTotal(event.target.value)} inputMode="decimal" placeholder="Если отличается от расчёта" disabled={!canEditSelected} className={field} /></Label>
        <div className="rounded-xl bg-[var(--surface-inset)] p-3"><p className="text-xs text-[var(--muted)]">{contractTotal ? "Чек по договору" : "Расчёт по строкам"}</p><p className="mt-2 text-lg font-semibold">{effectiveTotal === null ? "—" : formatMoneyMinor(Number(effectiveTotal))}</p>{unpriced ? <p className="mt-1 text-[10px] text-[var(--muted)]">Не все строки оценены</p> : null}</div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2"><Label text="Как часто и когда обслуживаем"><input value={schedule} onChange={(event) => setSchedule(event.target.value)} placeholder="Например, 2 раза в месяц, первая и третья неделя" maxLength={500} disabled={!canEditSelected} className={field} /></Label><Label text="Внутренние подробности"><input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Что важно знать по договору" maxLength={2000} disabled={!canEditSelected} className={field} /></Label></div>
      <div className="mt-6 border-t border-[var(--line)] pt-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-base font-semibold">Услуги и цены</h3><p className="mt-1 text-xs text-[var(--muted)]">Каждая цена стоит рядом со своей услугой. Разделяйте договорные и разовые работы.</p></div>{canEditSelected ? <button type="button" onClick={() => setRates((current) => [...current, blankRate()])} className="focus-ring inline-flex min-h-10 items-center gap-1 rounded-xl border border-[var(--line)] px-3 text-xs"><Plus className="size-4" /> Строка услуги</button> : null}</div>
        <div className="mt-4 space-y-3">{rates.map((rate, index) => <div key={rate.key} className="rounded-xl border border-[var(--line)] bg-[var(--surface-inset)] p-3">
          <div className="flex items-start justify-between gap-2"><span className="text-xs font-semibold text-[var(--muted)]">Услуга {index + 1}</span>{canEditSelected ? <button type="button" onClick={() => setRates((current) => current.filter((item) => item.key !== rate.key))} aria-label="Удалить строку услуги" className="focus-ring text-[var(--muted)]"><Trash2 className="size-4" /></button> : null}</div>
          <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <div className="min-w-0"><ServiceChoice label="Наименование услуги" value={rate.catalogItemId ?? ""} items={available} organizationId={selected.organizationId} disabled={!canEditSelected} onChange={(value, selectedItem) => { const item = selectedItem ?? available.find((candidate) => candidate.id === value); updateRate(rate.key, { catalogItemId: item?.id ?? null, name: item?.name ?? rate.name, billingBasis: item?.unit.includes("м²") || item?.unit.includes("м2") ? "area" : item?.unit.includes("шт") ? "quantity" : "fixed", unitPrice: item?.defaultPriceMinor === null || item?.defaultPriceMinor === undefined ? rate.unitPrice : (item.defaultPriceMinor / 100).toFixed(2) }); }} /><input aria-label="Название по договору" value={rate.name} onChange={(event) => updateRate(rate.key, { name: event.target.value })} placeholder="Название по договору" maxLength={200} disabled={!canEditSelected} className={`${field} mt-2`} /></div>
            <Label text="Расчёт"><select value={rate.billingBasis} onChange={(event) => updateRate(rate.key, { billingBasis: event.target.value as DraftRate["billingBasis"] })} disabled={!canEditSelected} className={field}><option value="area">За м²</option><option value="quantity">За штуку / количество</option><option value="fixed">Фиксированная сумма</option></select>{rate.billingBasis === "quantity" ? <input value={rate.quantity} onChange={(event) => updateRate(rate.key, { quantity: event.target.value })} inputMode="decimal" placeholder="Количество" disabled={!canEditSelected} className={`${field} mt-2`} /> : null}</Label>
            <Label text={rate.billingBasis === "area" ? "Цена за м², ₽" : rate.billingBasis === "quantity" ? "Цена за единицу, ₽" : "Сумма, ₽"}><input value={rate.unitPrice} onChange={(event) => updateRate(rate.key, { unitPrice: event.target.value })} inputMode="decimal" placeholder="Например, 0,23" disabled={!canEditSelected} className={field} /><span className="mt-1 block text-xs text-[var(--muted)]">Итого: {(() => { const total = calculateLineMinor(rate, area); return total === null ? "—" : formatMoneyMinor(Number(total)); })()}</span></Label>
          </div><div className="mt-3 flex flex-wrap gap-2">{(["contract", "request"] as const).map((kind) => <button type="button" key={kind} disabled={!canEditSelected} onClick={() => updateRate(rate.key, { lineKind: kind })} className={`focus-ring rounded-lg border px-3 py-1.5 text-xs ${rate.lineKind === kind ? "border-black bg-black text-white" : "border-[var(--line)] bg-white"}`}>{kind === "contract" ? "По договору" : "По заявке"}</button>)}</div>
        </div>)}{!rates.length ? <p className="rounded-xl border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]">Для объекта пока не записаны услуги. Добавьте строку или сначала создайте услугу в справочнике.</p> : null}</div>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-5">{canEditSelected ? <button type="button" disabled={pending} onClick={save} className="focus-ring min-h-11 rounded-xl bg-black px-5 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Сохраняем…" : "Сохранить условия"}</button> : null}
        {selected.latestOrderId && selected.organizationId === currentOrganizationId ? <Link href={`/orders/${selected.latestOrderId}?newVisit=1`} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--line)] px-4 text-sm"><CalendarDays className="size-4" /> Запланировать выезд</Link> : null}
        {selected.organizationId === currentOrganizationId ? <Link href="/calendar" className="focus-ring inline-flex min-h-11 items-center rounded-xl border border-[var(--line)] px-4 text-sm">Календарь</Link> : null}
        {selected.nextVisitAt ? <span className="text-xs text-[var(--muted)]">Ближайший выезд: {new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(selected.nextVisitAt))}</span> : null}
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}{status ? <p role="status" className="mt-3 text-sm text-[var(--muted)]">{status}</p> : null}
    </section> : <section className="surface-panel grid min-h-56 place-items-center p-5 text-center text-sm text-[var(--muted)]">{query ? "Объект не найден." : "Объектов пока нет. Добавьте объект в карточке клиента или при оформлении заказа."}</section>}
  </div>;
}

function Label({ text, children }: { text: string; children: React.ReactNode }) {
  return <label className="block min-w-0 text-xs text-[var(--muted)]">{text}<div className="mt-1">{children}</div></label>;
}
function parseHundredths(value: string): bigint | null {
  const normalized = value.trim().replaceAll(" ", "").replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}
function calculateLineMinor(rate: DraftRate, area: string): bigint | null {
  const price = parseHundredths(rate.unitPrice);
  if (price === null) return null;
  if (rate.billingBasis === "fixed") return price;
  const quantity = parseHundredths(rate.billingBasis === "area" ? area : rate.quantity);
  return quantity === null ? null : (price * quantity + 50n) / 100n;
}
