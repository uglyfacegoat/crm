"use client";

import { useActionState } from "react";
import { verifyEmailCodeAction, type VerifyEmailCodeState } from "@/app/login/verify/actions";

const initialState: VerifyEmailCodeState = { error: null };

export function EmailCodeForm({ nextPath }: { nextPath: string }) {
  const [state, action, pending] = useActionState(verifyEmailCodeAction, initialState);
  return <form action={action} className="mt-7">
    <input type="hidden" name="next" value={nextPath} />
    <label className="block text-sm font-medium">Код подтверждения
      <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{7}" minLength={7} maxLength={7}
        required autoFocus placeholder="0000000" className="mt-2 h-14 w-full rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] px-4 text-center text-xl tracking-[0.4em] outline-none focus:border-[var(--accent)]" />
    </label>
    <button type="submit" disabled={pending} className="focus-ring mt-5 h-12 w-full rounded-xl bg-[var(--accent)] text-sm font-semibold text-[var(--on-accent)] disabled:opacity-60">{pending ? "Проверяем…" : "Подтвердить вход"}</button>
    {state.error ? <p role="alert" className="mt-4 text-sm text-[var(--danger-ink)]">{state.error}</p> : null}
  </form>;
}
