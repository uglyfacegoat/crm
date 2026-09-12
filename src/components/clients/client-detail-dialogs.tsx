"use client";

import { Building2, Check, LoaderCircle, Plus, UserRound } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createClientContactAction,
  createClientObjectAction,
  updateClientAction,
  type ClientMutationState,
} from "@/app/(workspace)/clients/actions";
import { Dialog } from "@/components/ui/dialog";
import { clientCrypto as crypto } from "@/lib/client-id";
import type { ClientDetail } from "@/server/clients/types";

const initialState: ClientMutationState = { status: "idle", message: null, fieldErrors: {} };
const inputClass = "focus-ring h-12 w-full rounded-[12px] border border-[var(--line)] bg-[var(--surface-inset)] px-3.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)]";
const textareaClass = "focus-ring min-h-24 w-full resize-y rounded-[12px] border border-[var(--line)] bg-[var(--surface-inset)] px-3.5 py-3 text-sm leading-5 text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)]";
const labelClass = "grid gap-2 text-[10px] text-[var(--muted)]";

function Field({ label, required, errors, children }: { label: string; required?: boolean; errors?: string[]; children: React.ReactNode }) {
  return (
    <label className={labelClass}>
      <span>{label}{required ? " *" : ""}</span>
      {children}
      {errors?.length ? <span className="text-[var(--danger-ink)]">{errors[0]}</span> : null}
    </label>
  );
}

function FormStatus({ state }: { state: ClientMutationState }) {
  if (!state.message) return null;
  return (
    <p role="status" className={`rounded-[12px] border p-3 text-xs leading-5 ${state.status === "success"
      ? "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]"
      : "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-ink)]"}`}>
      {state.status === "success" ? <Check className="mr-2 inline size-4" /> : null}
      {state.message}
    </p>
  );
}

function FormFooter({ pending, saved, onCancel, submitLabel }: { pending: boolean; saved: boolean; onCancel: () => void; submitLabel: string }) {
  return (
    <footer className="sticky bottom-0 flex gap-2 border-t border-[var(--line)] bg-[var(--surface-raised)] p-4 sm:px-7">
      <button type="button" onClick={onCancel} disabled={pending} className="focus-ring h-12 flex-1 rounded-[12px] border border-[var(--line)] text-xs text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]">
        Отмена
      </button>
      <button type="submit" disabled={pending || saved} className="focus-ring flex h-12 flex-[1.4] items-center justify-center gap-2 rounded-[12px] bg-[var(--accent)] text-xs font-semibold text-[var(--on-accent)] disabled:cursor-wait disabled:opacity-65">
        {pending ? <><LoaderCircle className="size-4 animate-spin" />Сохраняем…</> : saved ? <><Check className="size-4" />Сохранено</> : submitLabel}
      </button>
    </footer>
  );
}

function useCloseAfterSuccess(status: ClientMutationState["status"], onClose: () => void) {
  const router = useRouter();
  useEffect(() => {
    if (status !== "success") return;
    router.refresh();
    const timeout = window.setTimeout(onClose, 550);
    return () => window.clearTimeout(timeout);
  }, [onClose, router, status]);
}

function EditClientForm({ client, onClose }: { client: ClientDetail; onClose: () => void }) {
  const [state, action, pending] = useActionState(updateClientAction, initialState);
  const [kind, setKind] = useState(client.kind);
  useCloseAfterSuccess(state.status, onClose);

  return (
    <form action={action} className="flex flex-1 flex-col">
      <input type="hidden" name="clientId" value={client.id} />
      <input type="hidden" name="expectedVersion" value={client.version} />
      <input type="hidden" name="kind" value={kind} />
      <div className="flex-1 space-y-6 p-5 sm:p-7">
        <fieldset>
          <legend className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Тип клиента</legend>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {([
              ["legal_entity", "Юридическое лицо", Building2],
              ["individual", "Физическое лицо", UserRound],
            ] as const).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                onClick={() => setKind(value)}
                className={`focus-ring flex min-h-12 items-center justify-center gap-2 rounded-[12px] border text-xs ${kind === value
                  ? "border-[var(--accent)]/45 bg-[var(--accent-soft)] text-[var(--accent-ink)]"
                  : "border-[var(--line)] text-[var(--muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)]"}`}
              >
                <Icon className={`size-4 ${kind === value ? "text-[var(--accent)]" : "text-[var(--muted)]"}`} />
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        <Field label={kind === "legal_entity" ? "Название организации" : "ФИО клиента"} required errors={state.fieldErrors.legalName}>
          <input name="legalName" defaultValue={client.legalName} required minLength={2} maxLength={300} className={inputClass} />
        </Field>
        <Field label="ИНН" required={kind === "legal_entity"} errors={state.fieldErrors.taxId}>
          <input name="taxId" defaultValue={client.taxId ?? ""} required={kind === "legal_entity"} inputMode="numeric" pattern="[0-9]{10}([0-9]{2})?" className={inputClass} />
        </Field>
        <FormStatus state={state} />
      </div>
      <FormFooter pending={pending} saved={state.status === "success"} onCancel={onClose} submitLabel="Сохранить изменения" />
    </form>
  );
}

function ContactForm({ clientId, requestKey, onClose }: { clientId: string; requestKey: string; onClose: () => void }) {
  const [state, action, pending] = useActionState(createClientContactAction, initialState);
  const [isPrimary, setIsPrimary] = useState(false);
  useCloseAfterSuccess(state.status, onClose);

  return (
    <form action={action} className="flex flex-1 flex-col">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="idempotencyKey" value={requestKey} />
      {isPrimary ? <input type="hidden" name="isPrimary" value="on" /> : null}
      <div className="flex-1 space-y-5 p-5 sm:p-7">
        <Field label="Контактное лицо" required errors={state.fieldErrors.fullName}>
          <input name="fullName" required minLength={2} maxLength={200} placeholder="Иванова Ирина" className={inputClass} />
        </Field>
        <Field label="Должность" errors={state.fieldErrors.position}>
          <input name="position" maxLength={120} placeholder="Управляющий объектом" className={inputClass} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Телефон" required errors={state.fieldErrors.phone}>
            <input name="phone" required inputMode="tel" placeholder="+7 999 000-00-00" className={inputClass} />
          </Field>
          <Field label="Email" errors={state.fieldErrors.email}>
            <input name="email" type="email" maxLength={254} placeholder="contact@company.ru" className={inputClass} />
          </Field>
        </div>
        <button type="button" role="switch" aria-checked={isPrimary} onClick={() => setIsPrimary((value) => !value)} className="focus-ring flex w-full items-center justify-between gap-4 rounded-[12px] border border-[var(--line)] p-3.5 text-left hover:bg-[var(--surface-raised)]">
          <span>
            <span className="block text-xs text-[var(--text)]">Сделать основным</span>
            <span className="mt-1 block text-[10px] leading-4 text-[var(--muted)]">Телефон и email появятся в списке клиентов и заказах.</span>
          </span>
          <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${isPrimary ? "bg-[var(--accent)]" : "bg-[var(--surface-soft)]"}`}>
            <span className={`absolute top-1 size-4 rounded-full bg-[var(--surface)] transition-transform ${isPrimary ? "translate-x-6" : "translate-x-1"}`} />
          </span>
        </button>
        <FormStatus state={state} />
      </div>
      <FormFooter pending={pending} saved={state.status === "success"} onCancel={onClose} submitLabel="Добавить контакт" />
    </form>
  );
}

function ScorePicker({ name, label, value, onChange, allowZero = false }: { name: string; label: string; value: number; onChange: (value: number) => void; allowZero?: boolean }) {
  const values = allowZero ? [0, 1, 2, 3, 4, 5] : [1, 2, 3, 4, 5];
  return (
    <fieldset>
      <legend className="text-[10px] text-[var(--muted)]">{label}</legend>
      <input type="hidden" name={name} value={value} />
      <div className="mt-2 grid grid-cols-6 gap-1.5">
        {values.map((score) => (
          <button key={score} type="button" onClick={() => onChange(score)} className={`focus-ring h-10 rounded-[10px] border text-xs ${value === score
            ? "border-[var(--accent)]/45 bg-[var(--accent-soft)] text-[var(--accent-ink)]"
            : "border-[var(--line)] text-[var(--muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)]"}`}>
            {score}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function ObjectForm({ clientId, requestKey, onClose }: { clientId: string; requestKey: string; onClose: () => void }) {
  const [state, action, pending] = useActionState(createClientObjectAction, initialState);
  const [risk, setRisk] = useState(2);
  const [infestation, setInfestation] = useState(0);
  useCloseAfterSuccess(state.status, onClose);

  return (
    <form action={action} className="flex flex-1 flex-col">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="idempotencyKey" value={requestKey} />
      <div className="flex-1 space-y-5 p-5 sm:p-7">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Название объекта" required errors={state.fieldErrors.name}>
            <input name="name" required maxLength={240} placeholder="Склад №1" className={inputClass} />
          </Field>
          <Field label="Тип объекта" required errors={state.fieldErrors.objectType}>
            <input name="objectType" required maxLength={100} placeholder="Склад, офис, жилой дом" className={inputClass} />
          </Field>
        </div>
        <Field label="Полный адрес" required errors={state.fieldErrors.address}>
          <input name="address" required maxLength={500} placeholder="Москва, ул. Ленина, 15" className={inputClass} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Площадь, м²" errors={state.fieldErrors.areaSquareMeters}>
            <input name="areaSquareMeters" type="number" min="0.01" step="0.01" placeholder="2500" className={inputClass} />
          </Field>
          <Field label="Количество этажей" errors={state.fieldErrors.floorCount}>
            <input name="floorCount" type="number" min="1" step="1" placeholder="5" className={inputClass} />
          </Field>
        </div>
        <Field label="Контакт на объекте" errors={state.fieldErrors.onsiteContact}>
          <input name="onsiteContact" maxLength={300} placeholder="Имя и телефон ответственного" className={inputClass} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <ScorePicker name="riskLevel" label="Уровень риска · 1–5" value={risk} onChange={setRisk} />
          <ScorePicker name="infestationLevel" label="Заражённость · 0–5" value={infestation} onChange={setInfestation} allowZero />
        </div>
        <Field label="Как попасть на объект" errors={state.fieldErrors.accessInstructions}>
          <textarea name="accessInstructions" maxLength={2000} placeholder="Проходная, пропуск, код ворот…" className={textareaClass} />
        </Field>
        <Field label="Парковка и ограничения" errors={state.fieldErrors.parkingNotes}>
          <textarea name="parkingNotes" maxLength={1000} placeholder="Где оставить машину и оборудование" className={textareaClass} />
        </Field>
        <Field label="Особые условия" errors={state.fieldErrors.restrictions}>
          <textarea name="restrictions" maxLength={2000} placeholder="Режим работы, санитарные требования, запретные зоны…" className={textareaClass} />
        </Field>
        <FormStatus state={state} />
      </div>
      <FormFooter pending={pending} saved={state.status === "success"} onCancel={onClose} submitLabel="Добавить объект" />
    </form>
  );
}

type ActiveDialog = "edit" | "contact" | "object" | null;

export function ClientDetailActions({ client }: { client: ClientDetail }) {
  const [active, setActive] = useState<ActiveDialog>(null);
  const [requestKey, setRequestKey] = useState<string | null>(null);

  function open(dialog: Exclude<ActiveDialog, null>) {
    setRequestKey(dialog === "edit" ? null : crypto.randomUUID());
    setActive(dialog);
  }

  function close() {
    setActive(null);
    setRequestKey(null);
  }

  const secondaryActionClass = "focus-ring h-11 rounded-[13px] border border-[var(--line)] px-4 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)]";

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => open("object")} className="focus-ring flex h-11 items-center gap-2 rounded-[13px] bg-[var(--accent)] px-4 text-xs font-semibold text-[var(--on-accent)]">
          <Plus className="size-4" />
          Новый объект
        </button>
        <button onClick={() => open("contact")} className={secondaryActionClass}>Добавить контакт</button>
        <button onClick={() => open("edit")} className={secondaryActionClass}>Редактировать</button>
      </div>
      <Dialog open={active === "edit"} onClose={close} title="Редактировать клиента" description="Версия карточки проверяется при сохранении, чтобы не затереть чужие изменения.">
        {active === "edit" ? <EditClientForm client={client} onClose={close} /> : null}
      </Dialog>
      <Dialog open={active === "contact"} onClose={close} title="Новый контакт" description="Контакт будет доступен в карточке клиента и при оформлении заказа.">
        {active === "contact" && requestKey ? <ContactForm clientId={client.id} requestKey={requestKey} onClose={close} /> : null}
      </Dialog>
      <Dialog open={active === "object"} onClose={close} title="Новый объект" description="Адрес, доступ и риски сохраняются один раз и переиспользуются в заказах и выездах.">
        {active === "object" && requestKey ? <ObjectForm clientId={client.id} requestKey={requestKey} onClose={close} /> : null}
      </Dialog>
    </>
  );
}
