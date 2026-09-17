"use client";

import { Check, LifeBuoy, LoaderCircle } from "lucide-react";
import { useActionState, useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createSupportRequestAction, type SupportMutationState } from "@/app/(workspace)/help/actions";
import { Dialog } from "@/components/ui/dialog";
import { CustomSelect } from "@/components/ui/custom-select";

const initialState: SupportMutationState = { status: "idle", message: null, fieldErrors: {} };
const inputClass = "focus-ring min-h-11 w-full rounded-[11px] border border-[var(--line)] bg-[var(--surface-raised)] px-3 text-xs text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)]";

function Field({ label, error, children }: { label: string; error?: string[]; children: ReactNode }) {
  return <label className="grid gap-2 text-[10px] text-[var(--text-secondary)]"><span>{label}</span>{children}{error?.[0] ? <span className="text-[var(--danger-ink)]">{error[0]}</span> : null}</label>;
}

function SupportForm({ onComplete }: { onComplete: () => void }) {
  const [state, action, pending] = useActionState(createSupportRequestAction, initialState);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [category, setCategory] = useState("usability");
  const router = useRouter();
  useEffect(() => { if (state.status !== "success") return; router.refresh(); const timeout = window.setTimeout(onComplete, 900); return () => window.clearTimeout(timeout); }, [onComplete, router, state.status]);
  return <form action={action} className="flex flex-1 flex-col"><input type="hidden" name="idempotencyKey" value={idempotencyKey} /><div className="flex-1 space-y-5 p-5 sm:p-7">
    <div className="grid gap-2 text-[10px] text-[var(--text-secondary)]">
      <span>Категория</span>
      <CustomSelect
        name="category"
        value={category}
        onChange={setCategory}
        ariaLabel="Категория обращения"
        options={[
          { value: "usability", label: "Интерфейс и удобство" },
          { value: "data", label: "Данные и отчёты" },
          { value: "access", label: "Доступ и аккаунт" },
          { value: "technical", label: "Техническая ошибка" },
        ]}
        className={inputClass}
      />
    </div>
    <Field label="Тема *" error={state.fieldErrors.subject}><input name="subject" required minLength={5} maxLength={200} placeholder="Коротко: что нужно исправить" className={inputClass} /></Field>
    <Field label="Подробности *" error={state.fieldErrors.description}><textarea name="description" required minLength={20} maxLength={4000} placeholder="Что вы делали, что произошло, какой результат ожидали. Не указывайте пароль или секретный ключ." className={`${inputClass} min-h-40 resize-y p-3 leading-5`} /></Field>
    <div className="rounded-[12px] border border-[var(--info-border)] bg-[var(--info-bg)] p-3 text-[10px] leading-5 text-[var(--info)]">Обращение попадёт в защищённую очередь разработчика. Пароли, токены и персональные данные клиентов прикладывать нельзя.</div>
    {state.message ? <p role="status" className={`rounded-[12px] border p-3 text-xs leading-5 ${state.status === "success" ? "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]" : "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-ink)]"}`}>{state.status === "success" ? <Check className="mr-2 inline size-4" /> : null}{state.message}</p> : null}
  </div><footer className="sticky bottom-0 flex gap-2 border-t border-[var(--line)] bg-[var(--surface)] p-4 backdrop-blur-xl sm:px-7"><button type="button" onClick={onComplete} disabled={pending} className="focus-ring h-11 flex-1 rounded-[11px] border border-[var(--line)] text-xs text-[var(--text-secondary)]">Отмена</button><button type="submit" disabled={pending || state.status === "success"} className="focus-ring flex h-11 flex-[1.5] items-center justify-center gap-2 rounded-[11px] bg-[var(--accent)] text-xs font-semibold text-[var(--on-accent)] disabled:opacity-60">{pending ? <><LoaderCircle className="size-4 animate-spin" />Регистрируем…</> : "Создать обращение"}</button></footer></form>;
}

export function SupportRequestDialog() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return <><button type="button" onClick={() => setOpen(true)} className="focus-ring flex h-11 items-center gap-2 rounded-[13px] bg-[var(--accent)] px-4 text-xs font-semibold text-[var(--on-accent)]"><LifeBuoy className="size-4" />Связаться с поддержкой</button><Dialog open={open} onClose={close} title="Обращение в поддержку" description="Опишите воспроизводимый сценарий — обращение сохранится в CRM.">{open ? <SupportForm onComplete={close} /> : null}</Dialog></>;
}
