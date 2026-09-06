"use client";

import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useActionState, useState } from "react";
import { loginAction, type LoginState } from "@/app/login/actions";

const initialState: LoginState = { error: null };

export function LoginForm({ nextPath, preview }: { nextPath: string; preview: boolean }) {
  const [showPassword, setShowPassword] = useState(false);
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return <form action={formAction} className="mt-8 w-full min-w-0" noValidate>
    <input type="hidden" name="next" value={nextPath} />
    {preview ? <p className="mb-5 border-l-2 border-[var(--accent)] pl-3 text-[10px] leading-5 text-[#a9b4b1]">Режим предпросмотра: учётные данные не требуются.</p> : null}
    <div className="space-y-3">
      <label className="block"><span className="mb-2 block text-[10px] font-medium text-[#9ca5a3]">Email или телефон</span><input required={!preview} name="identity" autoComplete="username" placeholder="Email или телефон" className="h-14 w-full border-b border-white/[0.14] bg-transparent px-0 text-sm text-white outline-none transition-colors placeholder:text-[#5f6665] focus:border-[var(--accent)]" /></label>
      <label className="relative block pt-2"><span className="mb-2 block text-[10px] font-medium text-[#9ca5a3]">Пароль</span><input required={!preview} minLength={8} maxLength={128} name="password" autoComplete="current-password" type={showPassword ? "text" : "password"} placeholder="Пароль" className="h-14 w-full border-b border-white/[0.14] bg-transparent px-0 pr-11 text-sm text-white outline-none transition-colors placeholder:text-[#5f6665] focus:border-[var(--accent)]" /><button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"} className="focus-ring absolute bottom-2 right-0 rounded-lg p-3 text-[#78817f] hover:text-white">{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></label>
    </div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs max-[359px]:text-[10px]"><label className="flex items-center gap-2 text-[#858e94]"><input type="checkbox" name="remember" className="size-4 accent-[var(--accent)]" />Запомнить меня</label><span className="text-[#687178]">Восстановление — через администратора</span></div>
    <button type="submit" disabled={pending} className="focus-ring mt-8 flex h-14 w-full items-center justify-center gap-2 rounded-[8px] bg-[var(--accent)] text-sm font-semibold text-[#101308] transition-colors hover:bg-[var(--accent-strong)] disabled:cursor-wait disabled:opacity-70">{pending ? <><LoaderCircle className="size-4 animate-spin" />Проверяем…</> : preview ? "Открыть CRM" : "Войти в CRM"}</button>
    {state.error ? <p role="alert" aria-live="polite" className="mt-4 rounded-[11px] border border-[#ef646a]/15 bg-[#ef646a]/[0.04] p-3 text-center text-[10px] leading-5 text-[#c69a9c]">{state.error}</p> : null}
  </form>;
}
