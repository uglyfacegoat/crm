"use client";

import { AtSign, Eye, EyeOff, KeyRound, LoaderCircle, MessageCircleMore, Send } from "lucide-react";
import { useActionState, useState } from "react";
import { loginAction, type LoginState } from "@/app/login/actions";

const initialState: LoginState = { error: null };

const alternativeMethods = [
  {
    id: "telegram",
    label: "Telegram",
    note: "Нужна привязка бота и проверка подписи.",
    icon: Send,
  },
  {
    id: "max",
    label: "MAX",
    note: "Нужна настройка провайдера входа.",
    icon: MessageCircleMore,
  },
  {
    id: "email-code",
    label: "Код из почты",
    note: "Нужен почтовый сервис и одноразовые коды.",
    icon: AtSign,
  },
] as const;

export function LoginForm({ nextPath, preview }: { nextPath: string; preview: boolean }) {
  const [showPassword, setShowPassword] = useState(false);
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return <div className="mt-8 w-full min-w-0">
    <form action={formAction} noValidate>
      <input type="hidden" name="next" value={nextPath} />
      {preview ? <p className="mb-5 border-y border-[var(--line)] px-3 py-2.5 text-center text-[10px] leading-5 text-[var(--text-secondary)]">Режим предпросмотра: учётные данные не требуются.</p> : null}
      <div className="space-y-3">
        <label className="block"><span className="mb-2 block text-center text-[10px] font-medium text-[var(--text-secondary)]">Email или телефон</span><input required={!preview} name="identity" autoComplete="username" placeholder="Email или телефон" className="h-14 w-full border-b border-[var(--line-strong)] bg-transparent px-0 text-center text-sm text-[var(--text)] outline-none transition-colors placeholder:text-[var(--muted-subtle)] focus:border-[var(--accent)]" /></label>
        <label className="relative block pt-2"><span className="mb-2 block text-center text-[10px] font-medium text-[var(--text-secondary)]">Пароль</span><input required={!preview} minLength={8} maxLength={128} name="password" autoComplete="current-password" type={showPassword ? "text" : "password"} placeholder="Пароль" className="h-14 w-full border-b border-[var(--line-strong)] bg-transparent px-9 text-center text-sm text-[var(--text)] outline-none transition-colors placeholder:text-[var(--muted-subtle)] focus:border-[var(--accent)]" /><button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"} className="focus-ring absolute bottom-2 right-0 rounded-lg p-3 text-[var(--muted)] hover:text-[var(--text)]">{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></label>
      </div>
      <div className="mt-4 flex flex-col items-center gap-3 text-center text-xs max-[359px]:text-[10px]"><label className="flex items-center gap-2 text-[var(--text-secondary)]"><input type="checkbox" name="remember" className="size-4 accent-[var(--accent)]" />Запомнить меня</label><span className="text-[var(--muted)]">Восстановление — через администратора</span></div>
      <button type="submit" disabled={pending} className="focus-ring mt-7 flex h-14 w-full items-center justify-center gap-2 rounded-[10px] bg-[var(--accent)] text-sm font-semibold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-strong)] active:translate-y-px disabled:cursor-wait disabled:opacity-70">{pending ? <><LoaderCircle className="size-4 animate-spin" />Проверяем…</> : preview ? "Открыть CRM" : "Войти в CRM"}</button>
      {state.error ? <p role="alert" aria-live="polite" className="mt-4 rounded-[11px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-center text-[10px] leading-5 text-[var(--danger-ink)]">{state.error}</p> : null}
    </form>
    <section aria-labelledby="alternative-login-title" className="mt-7 border-t border-[var(--line)] pt-5">
      <div className="flex items-center justify-center gap-2"><KeyRound className="size-3.5 text-[var(--muted)]" aria-hidden /><h2 id="alternative-login-title" className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Другие способы входа</h2></div>
      <div className="mt-3 grid gap-2">
        {alternativeMethods.map(({ id, label, note, icon: Icon }) => <button key={id} type="button" disabled aria-describedby={`${id}-status`} className="flex min-h-12 w-full items-center gap-3 rounded-[10px] border border-[var(--line)] bg-[var(--surface-raised)] px-3 text-left opacity-60"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--surface-soft)] text-[var(--muted)]"><Icon className="size-3.5" aria-hidden /></span><span className="min-w-0 flex-1"><strong className="block text-xs font-medium text-[var(--text-secondary)]">{label}</strong><span id={`${id}-status`} className="mt-0.5 block text-[9px] leading-4 text-[var(--muted)]">{note}</span></span><span className="text-[9px] text-[var(--muted)]">Не настроено</span></button>)}
      </div>
      <p className="mx-auto mt-3 max-w-sm text-center text-[9px] leading-4 text-[var(--muted)]">Эти варианты станут доступны только после безопасного подключения администратором.</p>
    </section>
  </div>;
}
