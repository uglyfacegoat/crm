"use client";

import { Check, Rows3, TextCursorInput } from "lucide-react";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { saveAppearanceAction, type AppearanceState } from "@/app/(workspace)/settings/appearance-actions";
import type { DigitStyle, FontScale } from "@/lib/appearance";

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

export function AppearancePanel({ fontScale, digitStyle }: { fontScale: FontScale; digitStyle: DigitStyle }) {
  const [state, action, pending] = useActionState(saveAppearanceAction, initialState);
  const router = useRouter();
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.status]);

  return <form action={action} className="mt-5 grid gap-4 xl:grid-cols-2">
    <section className="surface-panel p-5 sm:p-6">
      <div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-[#b8f7e4]/[0.08] text-[#b8f7e4]"><TextCursorInput className="size-4" /></span><div><h2 className="font-display text-base font-semibold text-white">Размер интерфейса</h2><p className="mt-1 text-xs leading-5 text-[#737e84]">Настройка применяется ко всем разделам после сохранения.</p></div></div>
      <div className="mt-5 grid gap-2">{fontScales.map((option) => <label key={option.value} className="focus-within:focus-ring flex cursor-pointer items-center gap-4 rounded-[13px] border border-white/[0.07] bg-black/10 p-4 has-[:checked]:border-[var(--accent)]/30 has-[:checked]:bg-[var(--accent)]/[0.035]"><input className="peer sr-only" type="radio" name="fontScale" value={option.value} defaultChecked={fontScale === option.value} /><span className={`grid w-20 shrink-0 place-items-center rounded-[10px] bg-white/[0.035] py-3 font-display text-white ${option.value === "compact" ? "text-sm" : option.value === "large" ? "text-xl" : "text-base"}`}>{option.example}</span><span className="min-w-0 flex-1"><span className="block text-xs font-medium text-white">{option.label}</span><span className="mt-1 block text-[10px] text-[#69747a]">{option.detail}</span></span><Check className="size-4 text-transparent peer-checked:text-[var(--accent)]" /></label>)}</div>
    </section>
    <section className="surface-panel p-5 sm:p-6">
      <div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-[#b8f7e4]/[0.08] text-[#b8f7e4]"><Rows3 className="size-4" /></span><div><h2 className="font-display text-base font-semibold text-white">Отображение чисел</h2><p className="mt-1 text-xs leading-5 text-[#737e84]">Табличный вариант удобнее для сумм, KPI и реестров.</p></div></div>
      <div className="mt-5 grid gap-2">{digitStyles.map((option) => <label key={option.value} className="focus-within:focus-ring flex cursor-pointer items-center gap-4 rounded-[13px] border border-white/[0.07] bg-black/10 p-4 has-[:checked]:border-[var(--accent)]/30 has-[:checked]:bg-[var(--accent)]/[0.035]"><input className="peer sr-only" type="radio" name="digitStyle" value={option.value} defaultChecked={digitStyle === option.value} /><span className={`min-w-32 shrink-0 rounded-[10px] bg-white/[0.035] px-3 py-3 text-center text-sm text-white ${option.value === "tabular" ? "tabular-nums" : "proportional-nums"}`}>{option.example}</span><span className="min-w-0 flex-1"><span className="block text-xs font-medium text-white">{option.label}</span><span className="mt-1 block text-[10px] text-[#69747a]">{option.detail}</span></span><Check className="size-4 text-transparent peer-checked:text-[var(--accent)]" /></label>)}</div>
    </section>
    <div className="flex flex-col gap-3 rounded-[15px] border border-white/[0.07] bg-[#2b2e34] p-4 sm:flex-row sm:items-center sm:justify-between xl:col-span-2"><p role="status" className={`text-xs ${state.status === "error" ? "text-[#df8589]" : "text-[#778188]"}`}>{state.message ?? "Выбор хранится для текущего браузера и не меняет данные компании."}</p><button type="submit" disabled={pending} className="focus-ring min-h-11 rounded-[13px] bg-[var(--accent)] px-5 text-xs font-semibold text-[#25272c] disabled:opacity-50">{pending ? "Сохраняю…" : "Сохранить представление"}</button></div>
  </form>;
}
