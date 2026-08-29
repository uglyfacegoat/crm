"use client";

import { Eye, EyeOff, KeyRound, LoaderCircle, LockKeyhole, UserRound } from "lucide-react";
import { useActionState, useState } from "react";
import { loginAction, type LoginState } from "@/app/login/actions";

const initialState: LoginState = { error: null };

export function LoginForm({ nextPath, preview }: { nextPath: string; preview: boolean }) {
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState("");
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return <form action={formAction} className="mt-9 w-full min-w-0 max-w-[34rem]" noValidate>
    <input type="hidden" name="next" value={nextPath} />
    {preview ? <p className="mb-4 rounded-[11px] border border-[var(--accent)]/15 bg-[var(--accent)]/[0.04] p-3 text-[10px] leading-5 text-[#b5b985]">Режим предпросмотра: можно открыть CRM без учётных данных. В рабочем окружении включается обязательная серверная авторизация.</p> : null}
    <div className="space-y-3">
      <label className="flex h-14 items-center gap-3 rounded-[13px] border border-white/[0.1] bg-black/15 px-4 focus-within:border-[var(--accent)]/50"><UserRound className="size-5 text-[#7c858b]" /><span className="sr-only">Email или телефон</span><input required={!preview} name="identity" autoComplete="username" placeholder="Email или телефон" className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[#687178]" /></label>
      <label className="flex h-14 items-center gap-3 rounded-[13px] border border-white/[0.1] bg-black/15 px-4 focus-within:border-[var(--accent)]/50"><LockKeyhole className="size-5 text-[#7c858b]" /><span className="sr-only">Пароль</span><input required={!preview} minLength={8} maxLength={128} name="password" autoComplete="current-password" type={showPassword ? "text" : "password"} placeholder="Пароль" className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[#687178]" /><button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"} className="focus-ring rounded-lg p-2 text-[#737d83]">{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></label>
    </div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs max-[359px]:text-[10px]"><label className="flex items-center gap-2 text-[#858e94]"><input type="checkbox" name="remember" className="size-4 accent-[var(--accent)]" />Запомнить меня</label><button type="button" onClick={() => setNotice("Восстановление доступа подключим вместе с почтовым сервисом.")} className="focus-ring shrink-0 rounded-md text-[var(--accent)]">Забыли пароль?</button></div>
    <button type="submit" disabled={pending} className="focus-ring mt-7 flex h-14 w-full items-center justify-center gap-2 rounded-[13px] bg-[var(--accent)] text-sm font-semibold text-[#111509] transition-colors hover:bg-[#f4fa53] disabled:cursor-wait disabled:opacity-70">{pending ? <><LoaderCircle className="size-4 animate-spin" />Проверяем…</> : preview ? "Открыть CRM" : "Войти в CRM"}</button>
    <div className="my-5 flex items-center gap-4 text-[10px] text-[#5f696f]"><span className="h-px flex-1 bg-white/[0.07]" />или<span className="h-px flex-1 bg-white/[0.07]" /></div>
    <button type="button" onClick={() => setNotice("Одноразовые коды будут доступны после настройки второго фактора.")} className="focus-ring flex min-h-14 w-full items-center justify-center gap-2 rounded-[13px] border border-white/[0.1] px-3 text-sm text-[#c6ccc8] hover:bg-white/[0.03] max-[359px]:text-xs"><KeyRound className="size-4 shrink-0" />Войти по одноразовому коду</button>
    {state.error || notice ? <p role="status" aria-live="polite" className="mt-4 rounded-[11px] border border-[#ef646a]/15 bg-[#ef646a]/[0.04] p-3 text-center text-[10px] leading-5 text-[#c69a9c]">{state.error ?? notice}</p> : null}
  </form>;
}
