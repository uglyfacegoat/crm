"use client";

import { Check, Moon, Rows3, Sun, TextCursorInput } from "lucide-react";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { saveAppearanceAction, type AppearanceState } from "@/app/(workspace)/settings/appearance-actions";
import type { AppearanceTheme, DigitStyle, FontScale } from "@/lib/appearance";

const initialState: AppearanceState = { status: "idle", message: null };

const fontScales: Array<{ value: FontScale; label: string; example: string; detail: string }> = [
  { value: "compact", label: "Компактный", example: "Aa 12", detail: "Больше строк и карточек на экране" },
  { value: "standard", label: "Стандартный", example: "Aa 12", detail: "Оптимальный баланс плотности" },
  { value: "large", label: "Крупный", example: "Aa 12", detail: "Увеличенный текст во всей CRM" },
];

const digitStyles: Array<{ value: DigitStyle; label: string; example: string; detail: string }> = [
  { value: "proportional", label: "Обычные цифры", example: "1 248 507 ₽", detail: "Естественная ширина для текста" },
  { value: "tabular", label: "Табличные цифры", example: "1 248 507 ₽", detail: "Разряды ровно стоят в колонках" },
];

const themes: Array<{ value: AppearanceTheme; label: string; detail: string; icon: typeof Sun }> = [
  { value: "light", label: "Светлая", detail: "Белые модули, костяной фон и точечный голубой акцент", icon: Sun },
  { value: "dark", label: "Тёмная", detail: "Чёрный холст, графитовые панели и холодный голубой акцент", icon: Moon },
];

export function AppearancePanel({ theme, fontScale, digitStyle }: { theme: AppearanceTheme; fontScale: FontScale; digitStyle: DigitStyle }) {
  const [state, action, pending] = useActionState(saveAppearanceAction, initialState);
  const router = useRouter();
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.status]);

  return <form action={action} className="mt-5 grid gap-4 xl:grid-cols-2">
    <section className="surface-panel p-5 sm:p-6 xl:col-span-2">
      <div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-[var(--accent-soft)] text-[var(--accent-ink)]"><Sun className="size-4" /></span><div><h2 className="font-display text-base font-semibold text-[var(--text)]">Тема интерфейса</h2><p className="mt-1 text-xs leading-5 text-[var(--muted)]">Тема меняет все рабочие поверхности, текст и контраст. Выбор сохраняется только для этого браузера.</p></div></div>
      <div className="mt-5 grid gap-2 sm:grid-cols-2">{themes.map((option) => { const Icon = option.icon; return <label key={option.value} className="focus-within:focus-ring flex cursor-pointer items-start gap-3 rounded-[14px] border border-[var(--line)] bg-[var(--surface-inset)] p-4 transition-colors has-[:checked]:border-[var(--accent)] has-[:checked]:bg-[var(--accent-soft)]"><input className="peer sr-only" type="radio" name="theme" value={option.value} defaultChecked={theme === option.value} /><span className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-[var(--surface-raised)] text-[var(--text-secondary)] peer-checked:bg-[var(--accent)] peer-checked:text-[var(--on-accent)]"><Icon className="size-4" /></span><span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-[var(--text)]">{option.label}</span><span className="mt-1 block text-[10px] leading-4 text-[var(--muted)]">{option.detail}</span></span><Check className="mt-1 size-4 text-transparent peer-checked:text-[var(--accent-ink)]" /></label>; })}</div>
    </section>
    <section className="surface-panel p-5 sm:p-6">
      <div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-[var(--support-soft)] text-[var(--support-strong)]"><TextCursorInput className="size-4" /></span><div><h2 className="font-display text-base font-semibold text-[var(--text)]">Размер интерфейса</h2><p className="mt-1 text-xs leading-5 text-[var(--muted)]">Настройка применяется ко всем разделам после сохранения.</p></div></div>
      <div className="mt-5 grid gap-2">{fontScales.map((option) => <label key={option.value} className="focus-within:focus-ring flex cursor-pointer items-center gap-4 rounded-[13px] border border-[var(--line)] bg-[var(--surface-inset)] p-4 has-[:checked]:border-[var(--accent)]/30 has-[:checked]:bg-[var(--accent-soft)]"><input className="peer sr-only" type="radio" name="fontScale" value={option.value} defaultChecked={fontScale === option.value} /><span className={`grid w-20 shrink-0 place-items-center rounded-[10px] bg-[var(--surface-raised)] py-3 font-display text-[var(--text)] ${option.value === "compact" ? "text-sm" : option.value === "large" ? "text-xl" : "text-base"}`}>{option.example}</span><span className="min-w-0 flex-1"><span className="block text-xs font-medium text-[var(--text)]">{option.label}</span><span className="mt-1 block text-[10px] text-[var(--muted)]">{option.detail}</span></span><Check className="size-4 text-transparent peer-checked:text-[var(--accent)]" /></label>)}</div>
    </section>
    <section className="surface-panel p-5 sm:p-6">
      <div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-[var(--accent-soft)] text-[var(--accent-ink)]"><Rows3 className="size-4" /></span><div><h2 className="font-display text-base font-semibold text-[var(--text)]">Отображение чисел</h2><p className="mt-1 text-xs leading-5 text-[var(--muted)]">Табличный вариант удобнее для сумм, KPI и реестров.</p></div></div>
      <div className="mt-5 grid gap-2">{digitStyles.map((option) => <label key={option.value} className="focus-within:focus-ring flex cursor-pointer items-center gap-4 rounded-[13px] border border-[var(--line)] bg-[var(--surface-inset)] p-4 has-[:checked]:border-[var(--accent)]/30 has-[:checked]:bg-[var(--accent-soft)]"><input className="peer sr-only" type="radio" name="digitStyle" value={option.value} defaultChecked={digitStyle === option.value} /><span className={`min-w-32 shrink-0 rounded-[10px] bg-[var(--surface-raised)] px-3 py-3 text-center text-sm text-[var(--text)] ${option.value === "tabular" ? "tabular-nums" : "proportional-nums"}`}>{option.example}</span><span className="min-w-0 flex-1"><span className="block text-xs font-medium text-[var(--text)]">{option.label}</span><span className="mt-1 block text-[10px] text-[var(--muted)]">{option.detail}</span></span><Check className="size-4 text-transparent peer-checked:text-[var(--accent)]" /></label>)}</div>
    </section>
    <div className="flex flex-col gap-3 rounded-[15px] border border-[var(--line)] bg-[var(--surface-raised)] p-4 sm:flex-row sm:items-center sm:justify-between xl:col-span-2"><p role="status" className={`text-xs ${state.status === "error" ? "text-[var(--danger-ink)]" : "text-[var(--muted)]"}`}>{state.message ?? "Выбор хранится для текущего браузера и не меняет данные компании."}</p><button type="submit" disabled={pending} className="focus-ring min-h-11 rounded-[13px] bg-[var(--accent)] px-5 text-xs font-semibold text-[var(--on-accent)] disabled:opacity-50">{pending ? "Сохраняю…" : "Сохранить представление"}</button></div>
  </form>;
}
