"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LayoutGrid, List, Pencil, Plus, Ruler, Search, Trash2 } from "lucide-react";
import { deleteCatalogItemAction, deleteCatalogUnitAction, saveCatalogItemAction, saveCatalogUnitAction, setCatalogItemActiveAction, type CatalogActionState } from "@/app/(workspace)/catalog/actions";
import type { CatalogUnit, ScopedCatalogItem } from "@/server/catalog/repository";
import { formatMoneyMinor } from "@/lib/format";
import { CatalogUnitsDialog, catalogIconButton } from "./catalog-units-dialog";
import { OrderPicker } from "@/components/orders/order-form-parts";

const initialState: CatalogActionState = { status: "idle", message: "", fieldErrors: {} };
type Filter = "service" | "archived";
const label = { service: "Услуга", product: "Товар" } as const;
type ScopedCatalogUnit = CatalogUnit & { organizationId: string; organizationName: string };

type Inventory = { items: ScopedCatalogItem[]; hasMore: boolean; activeServiceCount: number };

export function CatalogWorkspace({ initialInventory, units, destinations, currentOrganizationId, canWrite, showOrganizations, remoteEnabled }: { currentOrganizationId: string; initialInventory: Inventory; units: ScopedCatalogUnit[]; destinations: Array<{ id: string; name: string }>; canWrite: boolean; showOrganizations: boolean; remoteEnabled: boolean }) {
  const router = useRouter();
  const defaultOrganizationId = destinations.some((destination) => destination.id === currentOrganizationId) ? currentOrganizationId : destinations[0]?.id ?? currentOrganizationId;
  const [unitsOpen, setUnitsOpen] = useState(false);
  const [unitsOrganizationId, setUnitsOrganizationId] = useState(currentOrganizationId);
  const unitOrganizations = Array.from(new Map([...units.map((unit) => ({ id: unit.organizationId, name: unit.organizationName })), ...destinations].map((organization) => [organization.id, organization])).values());
  const [filter, setFilter] = useState<Filter>("service");
  const [view, setView] = useState<"table" | "cards">("table");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [inventory, setInventory] = useState(initialInventory);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const requestGeneration = useRef(0);
  const [editing, setEditing] = useState<ScopedCatalogItem | "new" | null>(null);
  const [editingUnit, setEditingUnit] = useState<ScopedCatalogUnit | "new" | null>(null);
  const [unitSymbol, setUnitSymbol] = useState("");
  const [unitLabel, setUnitLabel] = useState("");
  const [unitOrganizationId, setUnitOrganizationId] = useState(defaultOrganizationId);
  const [itemOrganizationId, setItemOrganizationId] = useState(defaultOrganizationId);
  const [itemUnit, setItemUnit] = useState("усл.");
  const [kind, setKind] = useState<"service" | "product">("service");
  const [priceMode, setPriceMode] = useState<"fixed" | "variable">("fixed");
  const [state, action, pending] = useActionState(saveCatalogItemAction, initialState);
  const [busy, startTransition] = useTransition();
  const [notice, setNotice] = useState("");
  useEffect(() => { const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250); return () => window.clearTimeout(timer); }, [search]);
  useEffect(() => {
    if (!remoteEnabled) return;
    const generation = ++requestGeneration.current;
    const controller = new AbortController();
    queueMicrotask(() => { if (generation === requestGeneration.current) { setLoading(true); setLoadError(""); } });
    const params = new URLSearchParams({ q: debouncedSearch, filter, kind: "service", page: "0" });
    fetch(`/api/v1/services/inventory?${params}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message ?? "Не удалось загрузить список.");
        return payload.data as Inventory;
      })
      .then((data) => { if (generation === requestGeneration.current) { setInventory(data); setPage(0); } })
      .catch((error) => { if (generation === requestGeneration.current && !controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Не удалось загрузить список."); })
      .finally(() => { if (generation === requestGeneration.current) setLoading(false); });
    return () => controller.abort();
  }, [debouncedSearch, filter, reload, remoteEnabled]);
  useEffect(() => { if (state.status === "success") { const timer = window.setTimeout(() => { setEditing(null); setReload((value) => value + 1); router.refresh(); }, 0); return () => window.clearTimeout(timer); } }, [state, router]);
  const visible = inventory.items;
  async function loadMore() {
    if (loading || !inventory.hasMore) return;
    const generation = requestGeneration.current;
    const nextPage = page + 1;
    setLoading(true);
    setLoadError("");
    try {
      const params = new URLSearchParams({ q: debouncedSearch, filter, kind: "service", page: String(nextPage) });
      const response = await fetch(`/api/v1/services/inventory?${params}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Не удалось загрузить список.");
      if (generation === requestGeneration.current) {
        const data = payload.data as Inventory;
        setInventory((current) => ({ ...data, items: [...current.items, ...data.items] }));
        setPage(nextPage);
      }
    } catch (error) {
      if (generation === requestGeneration.current) setLoadError(error instanceof Error ? error.message : "Не удалось загрузить список.");
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }
  function open(item: ScopedCatalogItem | "new") { setKind(item === "new" ? "service" : item.kind); setPriceMode(item === "new" ? "fixed" : item.priceMode); setItemOrganizationId(item === "new" ? defaultOrganizationId : item.organizationId); setItemUnit(item === "new" ? "усл." : item.unit); setEditing(item); setNotice(""); }
  function openUnit(item: ScopedCatalogUnit | "new") { setEditingUnit(item); setUnitSymbol(item === "new" ? "" : item.symbol); setUnitLabel(item === "new" ? "" : item.label); setUnitOrganizationId(item === "new" ? unitsOrganizationId : item.organizationId); setNotice(""); }
  function toggle(item: ScopedCatalogItem) {
    startTransition(async () => { const result = await setCatalogItemActiveAction(item.organizationId, item.id, item.version, !item.active); setNotice(result.message); if (result.status === "success") { setEditing(null); setReload((value) => value + 1); router.refresh(); } });
  }
  function remove(item: ScopedCatalogItem) {
    if (!window.confirm(`Удалить «${item.name}» из справочника? Если позиция уже использовалась, она останется в истории и уйдёт в архив.`)) return;
    startTransition(async () => { const result = await deleteCatalogItemAction(item.organizationId, item.id, item.version); setNotice(result.message); if (result.status === "success") { setReload((value) => value + 1); router.refresh(); } });
  }
  function saveUnit() {
    startTransition(async () => {
      const result = await saveCatalogUnitAction(unitOrganizationId, { id: editingUnit === "new" ? undefined : editingUnit?.id, expectedVersion: editingUnit === "new" ? undefined : editingUnit?.version, symbol: unitSymbol, label: unitLabel });
      setNotice(result.message); if (result.status === "success") { setEditingUnit(null); router.refresh(); }
    });
  }
  function removeUnit(unit: ScopedCatalogUnit) {
    if (!window.confirm(`Удалить единицу «${unit.symbol}» из списка?`)) return;
    startTransition(async () => { const result = await deleteCatalogUnitAction(unit.organizationId, unit.id, unit.version); setNotice(result.message); if (result.status === "success") router.refresh(); });
  }
  return <div className="mt-6 space-y-5">
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-4 sm:max-w-md"><Search className="size-4 text-[var(--muted)]" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Найти по названию или артикулу" className="min-w-0 flex-1 bg-transparent outline-none" /></label>
      <button type="button" onClick={() => { setNotice(""); setUnitsOpen(true); }} className="focus-ring inline-flex min-h-12 items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 text-sm"><Ruler className="size-4" />Единицы измерения</button>
      {canWrite && <button type="button" onClick={() => open("new")} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-black px-5 text-sm font-medium text-white"><Plus className="size-4" /> Добавить услугу</button>}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-2" role="tablist" aria-label="Фильтр каталога">{(["service", "archived"] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={filter === value} onClick={() => setFilter(value)} className={`min-h-10 rounded-xl border px-4 text-sm ${filter === value ? "border-black bg-black text-white" : "border-[var(--line)] bg-white"}`}>{({ all: "Все", service: "Услуги", product: "Товары", archived: "Архив" })[value]}</button>)}</div><div className="hidden gap-1 rounded-xl border border-[var(--line)] bg-white p-1 md:flex" aria-label="Вид перечня"><button type="button" aria-label="Таблица" aria-pressed={view === "table"} onClick={() => setView("table")} className={`grid size-9 place-items-center rounded-lg ${view === "table" ? "bg-black text-white" : ""}`}><List className="size-4" /></button><button type="button" aria-label="Карточки" aria-pressed={view === "cards"} onClick={() => setView("cards")} className={`grid size-9 place-items-center rounded-lg ${view === "cards" ? "bg-black text-white" : ""}`}><LayoutGrid className="size-4" /></button></div></div>

    {notice && <p role="status" className="text-sm text-[var(--muted)]">{notice}</p>}
    {view === "table" && visible.length > 0 ? <div className="hidden overflow-hidden rounded-2xl border border-[var(--line)] bg-white md:block"><table className="w-full table-fixed text-left text-sm"><thead className="bg-[var(--surface-inset)] text-xs text-[var(--muted)]"><tr><th className="w-[38%] p-4 font-medium">Наименование</th><th className="w-[13%] p-4 font-medium">Единица</th><th className="w-[23%] p-4 font-medium">Цена / правило</th><th className="w-[12%] p-4 font-medium">Статус</th><th className="w-32 p-4 font-medium">Действия</th></tr></thead><tbody className="divide-y divide-[var(--line)]">{visible.map((item) => <tr key={item.id}><td className="p-4 align-top"><strong className="block break-words font-medium">{item.name}</strong>{item.description ? <span className="mt-1 block line-clamp-2 text-xs text-[var(--muted)]">{item.description}</span> : null}{showOrganizations ? <span className="mt-1 block text-[10px] text-[var(--muted)]">{item.organizationName}</span> : null}</td><td className="p-4 align-top">{item.unit}</td><td className="p-4 align-top">{item.priceMode === "fixed" ? formatMoneyMinor(item.defaultPriceMinor ?? 0) : item.defaultPriceMinor === null ? "По заказу" : `По заказу · ориентир ${formatMoneyMinor(item.defaultPriceMinor)}`}</td><td className="p-4 align-top">{item.active ? "Активна" : "Архив"}</td><td className="p-4 align-top">{canWrite && destinations.some((destination) => destination.id === item.organizationId) ? <div className="flex flex-nowrap gap-2"><button type="button" aria-label={`Изменить услугу ${item.name}`} title="Изменить" onClick={() => open(item)} className={catalogIconButton}><Pencil className="size-4" /></button><button type="button" aria-label={`Удалить услугу ${item.name}`} title="Удалить" disabled={busy} onClick={() => remove(item)} className={catalogIconButton}><Trash2 className="size-4" /></button></div> : null}</td></tr>)}</tbody></table></div> : null}
    <div className={`grid gap-3 ${view === "table" ? "md:hidden" : "md:grid-cols-2 xl:grid-cols-3"}`}>{visible.map((item) => <article key={item.id} className="flex min-h-52 flex-col rounded-2xl border border-[var(--line)] bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{label[item.kind]} · {item.unit}</p><h2 className="mt-2 break-words text-lg font-semibold">{item.name}</h2></div><span className="shrink-0 rounded-lg bg-[var(--surface-soft)] px-2 py-1 text-xs">{item.sku ?? "Без артикула"}</span></div>
      {showOrganizations && <p className="mt-2 text-xs text-[var(--muted)]">{item.organizationName}</p>}
      {item.description && <p className="mt-3 line-clamp-2 text-sm text-[var(--muted)]">{item.description}</p>}
      <div className="mt-auto pt-5"><p className="text-sm font-semibold">{item.priceMode === "fixed" ? formatMoneyMinor(item.defaultPriceMinor ?? 0) : item.defaultPriceMinor === null ? "Цена при оформлении" : `Цена при оформлении · ориентир ${formatMoneyMinor(item.defaultPriceMinor)}`}</p>
      {canWrite && destinations.some((destination) => destination.id === item.organizationId) && <div className="mt-4 flex items-center gap-2"><button type="button" aria-label={`Изменить услугу ${item.name}`} title="Изменить" onClick={() => open(item)} className={catalogIconButton}><Pencil className="size-4" /></button><button type="button" aria-label={`Удалить услугу ${item.name}`} title="Удалить" disabled={busy} onClick={() => remove(item)} className={catalogIconButton}><Trash2 className="size-4" /></button></div>}</div>
    </article>)}</div>
    {visible.length === 0 && !loading && !loadError && <div className="rounded-2xl border border-dashed border-[var(--line)] bg-white p-8 text-center text-sm text-[var(--muted)]">{search || filter !== "service" ? "По этому запросу ничего не найдено." : "Пока нет услуг. Добавьте первую услугу."}</div>}
    {loadError && <p role="alert" className="text-sm text-red-700">{loadError} <button type="button" className="underline" onClick={() => setReload((value) => value + 1)}>Повторить</button></p>}
    {inventory.hasMore && <button type="button" onClick={loadMore} disabled={loading} className="min-h-11 rounded-xl border border-[var(--line)] bg-white px-5 text-sm disabled:opacity-50">{loading ? "Загружаем…" : "Показать ещё"}</button>}
    <CatalogUnitsDialog open={unitsOpen && !editingUnit} onClose={() => setUnitsOpen(false)} units={units} organizations={unitOrganizations} organizationId={unitsOrganizationId} onOrganizationChange={setUnitsOrganizationId} canWrite={canWrite && destinations.some((destination) => destination.id === unitsOrganizationId)} busy={busy} notice={notice} onEdit={openUnit} onDelete={removeUnit} onAdd={() => openUnit("new")} />
    {editing && <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-5" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}><div role="dialog" aria-modal="true" aria-label={editing === "new" ? "Новая позиция" : "Изменить позицию"} className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl sm:p-7">
      <div className="flex items-center justify-between"><h2 className="text-xl font-semibold">{editing === "new" ? "Новая позиция" : "Изменить позицию"}</h2><button type="button" onClick={() => setEditing(null)} aria-label="Закрыть" className="text-2xl">×</button></div>
      <form key={editing === "new" ? "new" : editing.id} action={action} className="mt-5 grid gap-4">
        {editing === "new" && destinations.length > 1 ? <div><input type="hidden" name="organizationId" value={itemOrganizationId} /><OrderPicker label="Компания *" value={itemOrganizationId} onChange={(nextId) => { setItemOrganizationId(nextId); setItemUnit(units.find((unit) => unit.organizationId === nextId && unit.symbol === (kind === "service" ? "усл." : "шт."))?.symbol ?? units.find((unit) => unit.organizationId === nextId)?.symbol ?? ""); }} options={destinations.map((destination) => ({ value: destination.id, label: destination.name }))} placeholder="Выберите компанию" searchPlaceholder="Найти компанию" /></div> : <input type="hidden" name="organizationId" value={editing === "new" ? defaultOrganizationId : editing.organizationId} />}
        {editing !== "new" && <><input type="hidden" name="id" value={editing.id} /><input type="hidden" name="expectedVersion" value={editing.version} /></>}
        <input type="hidden" name="kind" value="service" />
        <Field label="Название *" error={state.fieldErrors.name?.[0]}><input name="name" required minLength={2} maxLength={200} defaultValue={editing === "new" ? "" : editing.name} className={inputClass} placeholder={kind === "service" ? "Например, обработка помещения" : "Например, ловушка для насекомых"} /></Field>
        <div className="grid grid-cols-2 gap-3"><div className="min-w-0"><input type="hidden" name="unit" value={itemUnit} /><OrderPicker label="Единица *" value={itemUnit} onChange={setItemUnit} options={units.filter((unit) => unit.organizationId === itemOrganizationId).map((unit) => ({ value: unit.symbol, label: unit.symbol, detail: unit.label }))} placeholder="Выберите единицу" searchPlaceholder="Единица измерения" placement="top" errors={state.fieldErrors.unit} /></div><Field label="Артикул"><input name="sku" maxLength={80} defaultValue={editing === "new" ? "" : editing.sku ?? ""} className={inputClass} placeholder="Необязательно" /></Field></div>
        <Field label="Описание"><textarea name="description" maxLength={2000} rows={3} defaultValue={editing === "new" ? "" : editing.description ?? ""} className={inputClass} placeholder="Что входит в позицию" /></Field>
        <fieldset><legend className="mb-2 text-sm font-medium">Как определяется цена</legend><div className="grid gap-2 sm:grid-cols-2"><label className={`cursor-pointer rounded-xl border p-3 text-sm ${priceMode === "fixed" ? "border-black" : "border-[var(--line)]"}`}><input type="radio" name="priceMode" value="fixed" checked={priceMode === "fixed"} onChange={() => setPriceMode("fixed")} /> <span className="font-medium">Фиксированная</span><span className="mt-1 block text-xs text-[var(--muted)]">Подставится в заказ автоматически.</span></label><label className={`cursor-pointer rounded-xl border p-3 text-sm ${priceMode === "variable" ? "border-black" : "border-[var(--line)]"}`}><input type="radio" name="priceMode" value="variable" checked={priceMode === "variable"} onChange={() => setPriceMode("variable")} /> <span className="font-medium">Переменная</span><span className="mt-1 block text-xs text-[var(--muted)]">Точную цену укажут в заказе.</span></label></div></fieldset>
        <Field label={priceMode === "fixed" ? "Цена, ₽ *" : "Ориентир цены, ₽"} error={state.fieldErrors.defaultPrice?.[0]}><input name="defaultPrice" required={priceMode === "fixed"} inputMode="decimal" defaultValue={editing === "new" ? "" : editing.defaultPriceMinor === null ? "" : (editing.defaultPriceMinor / 100).toFixed(2)} className={inputClass} placeholder={priceMode === "fixed" ? "2500" : "Необязательно"} /></Field>
        {state.status === "error" && <p role="alert" className="text-sm text-red-700">{state.message}</p>}
        {editing !== "new" && !editing.active ? <button type="button" disabled={busy} onClick={() => toggle(editing)} className="min-h-11 rounded-xl border border-[var(--line)] text-sm">Восстановить услугу</button> : null}
        <div className="flex gap-2 pt-2"><button type="button" onClick={() => setEditing(null)} className="min-h-12 flex-1 rounded-xl border border-[var(--line)]">Отмена</button><button type="submit" disabled={pending} className="min-h-12 flex-1 rounded-xl bg-black text-white disabled:opacity-50">{pending ? "Сохраняем…" : "Сохранить"}</button></div>
      </form>
    </div></div>}
    {editingUnit && <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/45 sm:items-center sm:p-5" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingUnit(null); }}><div role="dialog" aria-modal="true" aria-label="Единица измерения" className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl"><h2 className="text-lg font-semibold">{editingUnit === "new" ? "Новая единица" : "Изменить единицу"}</h2>{editingUnit === "new" && destinations.length > 1 ? <div className="mt-4"><OrderPicker label="Компания" value={unitOrganizationId} onChange={setUnitOrganizationId} options={destinations.map((destination) => ({ value: destination.id, label: destination.name }))} placeholder="Выберите компанию" searchPlaceholder="Найти компанию" /></div> : null}<div className="mt-4 grid gap-3"><Field label="Обозначение"><input value={unitSymbol} onChange={(event) => setUnitSymbol(event.target.value)} maxLength={40} placeholder="м²" className={inputClass} /></Field><Field label="Название"><input value={unitLabel} onChange={(event) => setUnitLabel(event.target.value)} maxLength={100} placeholder="квадратный метр" className={inputClass} /></Field></div><div className="mt-5 flex gap-2"><button type="button" onClick={() => setEditingUnit(null)} className="min-h-11 flex-1 rounded-xl border border-[var(--line)]">Отмена</button><button type="button" disabled={busy || !unitSymbol.trim() || !unitLabel.trim()} onClick={saveUnit} className="min-h-11 flex-1 rounded-xl bg-black text-white disabled:opacity-50">Сохранить</button></div></div></div>}
  </div>;
}

const inputClass = "min-h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-3 py-2 outline-none focus:border-black";
function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) { return <label className="grid gap-1.5 text-sm"><span className="font-medium">{label}</span>{children}{error && <span className="text-xs text-red-700">{error}</span>}</label>; }
