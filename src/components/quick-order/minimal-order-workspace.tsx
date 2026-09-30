"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { createMinimalOrderAction, type MinimalOrderState } from "@/app/(workspace)/quick-order/actions";

const initialState: MinimalOrderState = { status: "idle", message: null, orderId: null, fieldErrors: {} };
const inputClass = "focus-ring h-14 w-full rounded-[13px] border border-[var(--line)] bg-[var(--surface-inset)] px-4 text-base text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)]";

export function MinimalOrderWorkspace({ idempotencyKey }: { idempotencyKey: string }) {
  const [state, action, pending] = useActionState(createMinimalOrderAction, initialState);
  const [kind, setKind] = useState<"legal_entity" | "individual">("legal_entity");
  const router = useRouter();
  useEffect(() => { if (state.status === "success" && state.orderId) router.push(`/orders/${state.orderId}`); }, [router, state.orderId, state.status]);

  return <div className="mx-auto max-w-3xl pb-24">
    <header className="mb-7">
      <p className="eyebrow">Операционная работа</p>
      <h1 className="mt-3 font-display text-3xl font-semibold text-[var(--text)] sm:text-4xl">Оформить заказ</h1>
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">Для создания нужны заказчик, телефон и цена. Остальное добавите в карточке.</p>
    </header>
    <form action={action} className="surface-panel p-5 sm:p-7">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="clientKind" value={kind} />
      <fieldset>
        <legend className="text-xs font-medium text-[var(--text)]">Тип заказчика</legend>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {([["legal_entity", "Организация"], ["individual", "Человек"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={kind === value} onClick={() => setKind(value)} className={`focus-ring min-h-12 rounded-xl border px-3 text-sm ${kind === value ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text)]" : "border-[var(--line)] text-[var(--muted)]"}`}>{label}</button>)}
        </div>
      </fieldset>
      <div className="mt-6 grid gap-5">
        <label className="grid gap-2 text-xs font-medium text-[var(--text)]"><span>{kind === "legal_entity" ? "Название заказчика" : "Имя заказчика"} *</span><input name="clientName" required minLength={2} maxLength={300} autoComplete="organization" className={inputClass} placeholder={kind === "legal_entity" ? "Название организации" : "Имя и фамилия"} /><span className="text-[var(--danger-ink)]">{state.fieldErrors.clientName?.[0]}</span></label>
        <label className="grid gap-2 text-xs font-medium text-[var(--text)]"><span>Телефон *</span><input name="phone" required inputMode="tel" autoComplete="tel" className={inputClass} placeholder="+7 999 000-00-00" /><span className="text-[var(--danger-ink)]">{state.fieldErrors.phone?.[0]}</span></label>
        <label className="grid gap-2 text-xs font-medium text-[var(--text)]"><span>Цена заказа, ₽ *</span><input name="price" required inputMode="decimal" className={inputClass} placeholder="12 000" /><span className="text-[var(--danger-ink)]">{state.fieldErrors.price?.[0]}</span></label>
      </div>
      {state.message ? <p role="status" className="mt-5 text-sm text-[var(--danger-ink)]">{state.message}</p> : null}
      <button type="submit" disabled={pending} className="focus-ring mt-7 flex min-h-14 w-full items-center justify-center gap-2 rounded-[13px] bg-[var(--accent)] px-5 text-sm font-semibold text-[var(--on-accent)] disabled:opacity-50">{pending ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}{pending ? "Сохраняем…" : "Создать заказ"}</button>
      <p className="mt-4 text-center text-xs leading-5 text-[var(--muted)]">Объект, контактное лицо, работы, мастер и выезд пока не требуются.</p>
    </form>
    <p className="mt-5 text-center text-sm text-[var(--muted)]">Уже знаете адрес, состав работ и дату выезда? <Link href="/quick-order?mode=detailed" className="font-medium text-[var(--text)] underline underline-offset-4">Подробное оформление</Link></p>
  </div>;
}
