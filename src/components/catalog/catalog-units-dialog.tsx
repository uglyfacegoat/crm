"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { OrderPicker } from "@/components/orders/order-form-parts";
import type { CatalogUnit } from "@/server/catalog/repository";

type Unit = CatalogUnit & { organizationId: string; organizationName: string };
export const catalogIconButton = "focus-ring grid size-10 shrink-0 place-items-center rounded-xl border border-[var(--line)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-soft)] disabled:opacity-40";

export function CatalogUnitsDialog({ open, onClose, units, organizations, organizationId, onOrganizationChange, canWrite, busy, notice, onEdit, onDelete, onAdd }: {
  open: boolean; onClose: () => void; units: Unit[]; organizations: Array<{id: string; name: string}>;
  organizationId: string; onOrganizationChange: (id: string) => void; canWrite: boolean; busy: boolean;
  notice: string; onEdit: (unit: Unit) => void; onDelete: (unit: Unit) => void; onAdd: () => void;
}) {
  const visible = units.filter((unit) => unit.organizationId === organizationId);
  return <Dialog open={open} onClose={onClose} title="Единицы измерения" description="Обозначения для расчёта количества и цены услуг." bodyClassName="gap-5 px-5 pb-5 sm:px-7 sm:pb-7">
    <div className="flex flex-wrap items-end justify-between gap-3">
      {organizations.length > 1 ? <div className="min-w-0 flex-1 sm:max-w-sm"><OrderPicker label="Компания" value={organizationId} onChange={onOrganizationChange} options={organizations.map((organization) => ({value: organization.id, label: organization.name}))} placeholder="Выберите компанию" searchPlaceholder="Найти компанию" /></div> : <p className="text-sm text-[var(--muted)]">{organizations[0]?.name}</p>}
      {canWrite ? <button type="button" onClick={onAdd} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--text)] px-4 text-sm font-medium text-[var(--canvas)]"><Plus className="size-4" />Добавить единицу</button> : null}
    </div>
    <p className="text-xs text-[var(--muted)]">{visible.length} единиц в выбранной компании</p>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {visible.map((unit) => <article key={unit.id} className="flex min-w-0 flex-col gap-4 rounded-2xl border border-[var(--line)] bg-[var(--surface-inset)] p-4">
        <div className="min-w-0"><h3 className="break-words text-xl font-semibold">{unit.symbol}</h3><p className="mt-1 break-words text-sm text-[var(--muted)]">{unit.label}</p></div>
        {canWrite ? <div className="mt-auto flex justify-end gap-2"><button type="button" aria-label={`Изменить единицу ${unit.symbol}`} title="Изменить" onClick={() => onEdit(unit)} className={catalogIconButton}><Pencil className="size-4" /></button><button type="button" aria-label={`Удалить единицу ${unit.symbol}`} title="Удалить" onClick={() => onDelete(unit)} disabled={busy} className={catalogIconButton}><Trash2 className="size-4" /></button></div> : null}
      </article>)}
    </div>
    {!visible.length ? <p className="py-5 text-center text-sm text-[var(--muted)]">В этой компании пока нет единиц измерения.</p> : null}
    {notice ? <p role="status" className="text-sm text-[var(--muted)]">{notice}</p> : null}
  </Dialog>;
}
