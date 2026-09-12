"use client";

import { Building2, Check, LoaderCircle, Plus, UserRound } from "lucide-react";
import { useActionState, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClientAction, type CreateClientState } from "@/app/(workspace)/clients/actions";
import { Dialog } from "@/components/ui/dialog";
import { clientCrypto as crypto } from "@/lib/client-id";

const initialCreateClientState: CreateClientState = {
  status: "idle",
  message: null,
  fieldErrors: {},
  clientId: null,
};

const inputClass = "focus-ring h-12 rounded-[12px] border border-[var(--line)] bg-[var(--surface-inset)] px-3.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)]";
const labelClass = "grid gap-2 text-[10px] text-[var(--muted)]";

function FieldError({ errors }: { errors?: string[] }) {
  return errors?.length ? <span className="text-[10px] text-[var(--danger-ink)]">{errors[0]}</span> : null;
}

function CreateClientForm({ requestKey, onComplete }: { requestKey: string; onComplete: () => void }) {
  const [state, formAction, pending] = useActionState(createClientAction, initialCreateClientState);
  const [kind, setKind] = useState<"legal_entity" | "individual">("legal_entity");
  const router = useRouter();

  useEffect(() => {
    if (state.status !== "success") return;
    router.refresh();
    const timeout = window.setTimeout(onComplete, 650);
    return () => window.clearTimeout(timeout);
  }, [onComplete, router, state.status]);

  return (
    <form action={formAction} className="flex flex-1 flex-col">
      <input type="hidden" name="idempotencyKey" value={requestKey} />
      <input type="hidden" name="kind" value={kind} />
      <div className="flex-1 space-y-7 p-5 sm:p-7">
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

        <div className="grid gap-4">
          <label className={labelClass}>
            <span>{kind === "legal_entity" ? "Название организации" : "ФИО клиента"} *</span>
            <input name="legalName" required minLength={2} maxLength={300} placeholder={kind === "legal_entity" ? "ООО «Название»" : "Иванов Иван Иванович"} className={inputClass} />
            <FieldError errors={state.fieldErrors.legalName} />
          </label>
          <label className={labelClass}>
            <span>ИНН {kind === "legal_entity" ? "*" : ""}</span>
            <input name="taxId" required={kind === "legal_entity"} inputMode="numeric" pattern="[0-9]{10}([0-9]{2})?" placeholder="10 или 12 цифр" className={inputClass} />
            <FieldError errors={state.fieldErrors.taxId} />
          </label>
        </div>

        <fieldset>
          <legend className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Основной контакт</legend>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className={`${labelClass} sm:col-span-2`}>
              <span>Контактное лицо *</span>
              <input name="contactName" required minLength={2} maxLength={200} placeholder="Имя сотрудника заказчика" className={inputClass} />
              <FieldError errors={state.fieldErrors.contactName} />
            </label>
            <label className={labelClass}>
              <span>Должность</span>
              <input name="contactPosition" maxLength={120} placeholder="Управляющий" className={inputClass} />
            </label>
            <label className={labelClass}>
              <span>Телефон *</span>
              <input name="phone" required minLength={7} maxLength={40} inputMode="tel" placeholder="+7 999 000-00-00" className={inputClass} />
              <FieldError errors={state.fieldErrors.phone} />
            </label>
            <label className={`${labelClass} sm:col-span-2`}>
              <span>Email</span>
              <input name="email" type="email" maxLength={254} placeholder="contact@company.ru" className={inputClass} />
              <FieldError errors={state.fieldErrors.email} />
            </label>
          </div>
        </fieldset>

        {state.message ? (
          <p role="status" className={`rounded-[12px] border p-3 text-xs leading-5 ${state.status === "success"
            ? "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]"
            : "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-ink)]"}`}>
            {state.status === "success" ? <Check className="mr-2 inline size-4" /> : null}
            {state.message}
          </p>
        ) : null}
      </div>

      <footer className="sticky bottom-0 flex gap-2 border-t border-[var(--line)] bg-[var(--surface-raised)] p-4 sm:px-7">
        <button type="button" onClick={onComplete} disabled={pending} className="focus-ring h-12 flex-1 rounded-[12px] border border-[var(--line)] text-xs text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]">
          Отмена
        </button>
        <button type="submit" disabled={pending || state.status === "success"} className="focus-ring flex h-12 flex-[1.4] items-center justify-center gap-2 rounded-[12px] bg-[var(--accent)] text-xs font-semibold text-[var(--on-accent)] disabled:cursor-wait disabled:opacity-65">
          {pending ? <><LoaderCircle className="size-4 animate-spin" />Сохраняем…</> : state.status === "success" ? <><Check className="size-4" />Сохранено</> : "Создать клиента"}
        </button>
      </footer>
    </form>
  );
}

export function CreateClientButton() {
  const [requestKey, setRequestKey] = useState<string | null>(null);
  const close = useCallback(() => setRequestKey(null), []);

  return (
    <>
      <button onClick={() => setRequestKey(crypto.randomUUID())} className="focus-ring flex h-11 items-center gap-2 rounded-[13px] bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--on-accent)]">
        <Plus className="size-4" />
        Новый клиент
      </button>
      <Dialog open={requestKey !== null} onClose={close} title="Новый клиент" description="Клиент и основной контакт сохраняются одной транзакцией.">
        {requestKey ? <CreateClientForm requestKey={requestKey} onComplete={close} /> : null}
      </Dialog>
    </>
  );
}
