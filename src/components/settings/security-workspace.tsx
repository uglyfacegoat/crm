"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { KeyRound, LockKeyhole, MailCheck, MessageCircle, ShieldCheck } from "lucide-react";
import { beginEmailOtpAction, changePasswordAction, confirmEmailOtpAction, disableEmailOtpAction, type SecurityActionState } from "@/app/(workspace)/settings/security/actions";

const initialState: SecurityActionState = { status: "idle", message: "" };
const fieldClass = "focus-ring mt-2 h-12 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 text-sm text-[var(--text)]";
const buttonClass = "focus-ring inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--accent)] px-5 text-xs font-semibold text-[var(--on-accent)] disabled:opacity-50";

function ActionMessage({ state }: { state: SecurityActionState }) {
  return state.message ? <p role={state.status === "error" ? "alert" : "status"}
    className={`mt-4 text-xs leading-5 ${state.status === "error" ? "text-[var(--danger-ink)]" : "text-[var(--success)]"}`}>{state.message}</p> : null;
}

export function SecurityWorkspace({ email, initialEnabled, initialPending, mailReady, preview, embedded = false }: {
  email: string; initialEnabled: boolean; initialPending: boolean; mailReady: boolean; preview: boolean; embedded?: boolean;
}) {
  const enabled = initialEnabled;
  const pending = initialPending;
  const [passwordState, passwordAction, passwordBusy] = useActionState(changePasswordAction, initialState);
  const [beginState, beginAction, beginBusy] = useActionState(beginEmailOtpAction, initialState);
  const [confirmState, confirmAction, confirmBusy] = useActionState(confirmEmailOtpAction, initialState);
  const [disableState, disableAction, disableBusy] = useActionState(disableEmailOtpAction, initialState);
  useEffect(() => {
    if (beginState.status === "success" || confirmState.status === "success" || disableState.status === "success") window.location.reload();
  }, [beginState, confirmState, disableState]);

  return <div className="mx-auto max-w-5xl pb-24">
    {!embedded ? <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div><p className="eyebrow">Личные настройки / Безопасность</p>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-[var(--text)] sm:text-4xl">Безопасность</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--text-secondary)]">Пароль и способы подтверждения входа в ваш аккаунт.</p></div>
      <Link href="/profile" className="focus-ring rounded-xl border border-[var(--line)] px-4 py-3 text-xs text-[var(--text-secondary)]">К моему профилю</Link>
    </div> : null}

    <div className="grid gap-5 lg:grid-cols-2">
      <section className="surface-panel min-w-0 p-5 sm:p-7">
        <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-[var(--surface-soft)]"><KeyRound className="size-5" /></span>
          <div><p className="text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">01 / Доступ</p><h2 className="font-display text-xl font-semibold">Смена пароля</h2></div></div>
        <p className="mt-4 text-xs leading-5 text-[var(--text-secondary)]">После смены пароля другие устройства выйдут из аккаунта. Этот сеанс останется открытым.</p>
        <form action={passwordAction} className="mt-5 space-y-4">
          <label className="block text-xs font-medium">Текущий пароль<input name="currentPassword" type="password" autoComplete="current-password" required className={fieldClass} /></label>
          <label className="block text-xs font-medium">Новый пароль<input name="newPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={128} className={fieldClass} /></label>
          <label className="block text-xs font-medium">Повторите новый пароль<input name="confirmation" type="password" autoComplete="new-password" required minLength={12} maxLength={128} className={fieldClass} /></label>
          <button disabled={preview || passwordBusy} className={buttonClass}>{passwordBusy ? "Сохраняем…" : "Обновить пароль"}</button>
          <ActionMessage state={passwordState} />
        </form>
      </section>

      <section className="surface-panel min-w-0 p-5 sm:p-7">
        <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-[var(--surface-soft)]"><ShieldCheck className="size-5" /></span>
          <div><p className="text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">02 / Второй шаг</p><h2 className="font-display text-xl font-semibold">Код на почту</h2></div></div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-4 py-3">
          <div className="min-w-0"><p className="text-xs font-semibold">{enabled ? "Защита включена" : pending ? "Ждём подтверждения" : "Защита выключена"}</p><p className="mt-1 break-all text-xs text-[var(--muted)]">{email}</p></div>
          <span className={`rounded-full px-3 py-1 text-[10px] font-semibold ${enabled ? "bg-[var(--success-bg)] text-[var(--success)]" : "bg-[var(--surface)] text-[var(--muted)]"}`}>{enabled ? "Включено" : "Выключено"}</span>
        </div>
        <p className="mt-4 text-xs leading-5 text-[var(--text-secondary)]">При входе потребуется семизначный код. Подключение начнётся только после подтверждения адреса кодом из письма.</p>
        {!enabled ? <>
          <form action={beginAction} className="mt-5"><button disabled={preview || !mailReady || beginBusy} className={buttonClass}>{beginBusy ? "Готовим письмо…" : pending ? "Отправить новый код" : "Подключить по почте"}</button><ActionMessage state={beginState} /></form>
          {!mailReady ? <p className="mt-3 text-xs leading-5 text-[var(--muted)]">Отправка почты пока не настроена. Подключение станет доступно после проверки исходящих писем.</p> : null}
          {pending ? <form action={confirmAction} className="mt-5 border-t border-[var(--line)] pt-5">
            <label className="block text-xs font-medium">Код из письма<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{7}" minLength={7} maxLength={7} required placeholder="0000000" className={`${fieldClass} text-center tracking-[0.25em]`} /></label>
            <button disabled={preview || confirmBusy} className={`${buttonClass} mt-4`}>{confirmBusy ? "Проверяем…" : "Подтвердить и включить"}</button><ActionMessage state={confirmState} />
          </form> : null}
        </> : <form action={disableAction} className="mt-5 border-t border-[var(--line)] pt-5">
          <label className="block text-xs font-medium">Для отключения введите пароль<input name="password" type="password" autoComplete="current-password" required className={fieldClass} /></label>
          <button disabled={preview || disableBusy} className="focus-ring mt-4 min-h-11 rounded-xl border border-[var(--line-strong)] px-5 text-xs font-semibold text-[var(--text)] disabled:opacity-50">{disableBusy ? "Отключаем…" : "Отключить защиту"}</button><ActionMessage state={disableState} />
        </form>}
      </section>
    </div>

    <section className="surface-panel mt-5 p-5 sm:p-7">
      <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-[var(--surface-soft)]"><LockKeyhole className="size-5" /></span>
        <div><p className="text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">03 / Позже</p><h2 className="font-display text-xl font-semibold">Другие способы</h2></div></div>
      <p className="mt-4 text-xs leading-5 text-[var(--text-secondary)]">Эти способы ещё не подключены к CRM.</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <button type="button" disabled className="flex min-h-16 items-center gap-3 rounded-xl border border-[var(--line)] px-4 text-left text-sm opacity-60"><MessageCircle className="size-5" />Telegram <span className="ml-auto text-[10px]">Скоро</span></button>
        <button type="button" disabled className="flex min-h-16 items-center gap-3 rounded-xl border border-[var(--line)] px-4 text-left text-sm opacity-60"><MailCheck className="size-5" />MAX <span className="ml-auto text-[10px]">Скоро</span></button>
      </div>
    </section>
  </div>;
}
