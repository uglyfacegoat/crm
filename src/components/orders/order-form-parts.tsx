"use client";

import { Check, ChevronDown, LoaderCircle } from "lucide-react";
import type { OrderMutationState } from "@/app/(workspace)/orders/actions";

export const orderInputClass = "focus-ring h-12 w-full rounded-[12px] border border-white/[0.08] bg-black/15 px-3.5 text-sm text-white outline-none placeholder:text-[#566067] disabled:cursor-not-allowed disabled:opacity-45";
export const orderTextareaClass = "focus-ring min-h-24 w-full resize-y rounded-[12px] border border-white/[0.08] bg-black/15 px-3.5 py-3 text-sm leading-5 text-white outline-none placeholder:text-[#566067]";

export function OrderField({ label, required, errors, children }: { label: string; required?: boolean; errors?: string[]; children: React.ReactNode }) {
  return <label className="grid gap-2 text-[10px] text-[#7b858b]"><span>{label}{required ? " *" : ""}</span>{children}{errors?.length ? <span className="text-[#ef8a8f]">{errors[0]}</span> : null}</label>;
}

type PickerOption = { value: string; label: string; detail?: string };

export function OrderPicker({ label, value, options, onChange, placeholder, disabled, required, errors, placement }: {
  label: string;
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
  required?: boolean;
  errors?: string[];
  placement?: "top" | "bottom";
}) {
  const selected = options.find((option) => option.value === value);
  const menuPosition = (placement ?? (label === "Контакт" ? "top" : "bottom")) === "top" ? "bottom-[3.25rem]" : "top-[3.25rem]";
  return <div className="grid gap-2 text-[10px] text-[#7b858b]"><span>{label}{required ? " *" : ""}</span><details className="group relative"><summary aria-label={label} aria-disabled={disabled} onClick={(event) => { if (disabled) event.preventDefault(); }} className={`focus-ring flex h-12 list-none items-center justify-between gap-3 rounded-[12px] border border-white/[0.08] bg-black/15 px-3.5 text-left text-sm [&::-webkit-details-marker]:hidden ${disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer"}`}><span className={selected ? "truncate text-white" : "truncate text-[#566067]"}>{selected?.label ?? placeholder}</span><ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" /></summary>{!disabled ? <div className={`absolute left-0 right-0 z-50 max-h-[min(16rem,42dvh)] overflow-y-auto rounded-[13px] border border-white/[0.09] bg-[#11181c] p-1.5 shadow-2xl ${menuPosition}`}>{options.length ? options.map((option) => <button key={option.value} type="button" onClick={(event) => { onChange(option.value); event.currentTarget.closest("details")?.removeAttribute("open"); }} className={`focus-ring block w-full rounded-[10px] px-3 py-2.5 text-left ${option.value === value ? "bg-[var(--accent)]/[0.09] text-white" : "text-[#9aa3a8] hover:bg-white/[0.045] hover:text-white"}`}><span className="block text-xs">{option.label}</span>{option.detail ? <span className="mt-1 block truncate text-[10px] text-[#667078]">{option.detail}</span> : null}</button>) : <p className="px-3 py-4 text-xs text-[#687279]">Нет доступных вариантов</p>}</div> : null}</details>{errors?.length ? <span className="text-[#ef8a8f]">{errors[0]}</span> : null}</div>;
}

export function OrderFormStatus({ state }: { state: Pick<OrderMutationState, "status" | "message"> }) {
  if (!state.message) return null;
  return <p role="status" className={`rounded-[12px] border p-3 text-xs leading-5 ${state.status === "success" ? "border-[#b8f7e4]/20 bg-[#b8f7e4]/[0.05] text-[#8ed7b8]" : "border-[#ef646a]/20 bg-[#ef646a]/[0.05] text-[#d89599]"}`}>{state.status === "success" ? <Check className="mr-2 inline size-4" /> : null}{state.message}</p>;
}

export function OrderFormFooter({ pending, saved, onCancel, submitLabel, disabled }: { pending: boolean; saved: boolean; onCancel: () => void; submitLabel: string; disabled?: boolean }) {
  return <footer className="mt-auto flex shrink-0 gap-2 border-t border-white/[0.07] bg-[#25272c] p-4 sm:px-7"><button type="button" onClick={onCancel} disabled={pending} className="focus-ring h-12 flex-1 rounded-[12px] border border-white/[0.08] text-xs text-[#8b959b] hover:bg-white/[0.04]">Отмена</button><button type="submit" disabled={pending || saved || disabled} className="focus-ring flex h-12 flex-[1.4] items-center justify-center gap-2 rounded-[12px] bg-[var(--accent)] text-xs font-semibold text-[#25272c] disabled:cursor-not-allowed disabled:opacity-50">{pending ? <><LoaderCircle className="size-4 animate-spin" />Сохраняем…</> : saved ? <><Check className="size-4" />Сохранено</> : submitLabel}</button></footer>;
}
