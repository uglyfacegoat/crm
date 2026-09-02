"use client";

import { Check, LoaderCircle, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useState } from "react";
import { createTaskAction, type CreateTaskState } from "@/app/(workspace)/tasks/actions";
import { Dialog } from "@/components/ui/dialog";
import { clientCrypto as crypto } from "@/lib/client-id";
import type { TaskAssigneeOption } from "@/server/tasks/types";

const initialState: CreateTaskState = { status: "idle", message: null, fieldErrors: {}, taskId: null };

function FieldError({ errors }: { errors?: string[] }) {
  return errors?.length ? <span className="text-[10px] text-[#ef8a8f]">{errors[0]}</span> : null;
}

const roleLabels = { admin: "Администратор", dispatcher: "Диспетчер", manager: "Менеджер", accountant: "Бухгалтер", master: "Мастер" } as const;

function CreateTaskForm({ requestKey, assigneeOptions, currentMemberId, onComplete }: { requestKey: string; assigneeOptions: TaskAssigneeOption[]; currentMemberId: string; onComplete: () => void }) {
  const [state, action, pending] = useActionState(createTaskAction, initialState);
  const router = useRouter();
  useEffect(() => {
    if (state.status !== "success") return;
    router.refresh();
    const timeout = window.setTimeout(onComplete, 550);
    return () => window.clearTimeout(timeout);
  }, [onComplete, router, state.status]);

  return <form action={action} className="flex flex-1 flex-col">
    <input type="hidden" name="idempotencyKey" value={requestKey} />
    <div className="flex-1 space-y-5 p-5 sm:p-7">
      <label className="grid gap-2 text-[10px] text-[#7b858b]"><span>Название *</span><input name="title" required minLength={2} maxLength={240} placeholder="Например, отправить акт клиенту" className="focus-ring h-12 rounded-[12px] border border-white/[0.08] bg-black/15 px-3.5 text-sm text-white outline-none placeholder:text-[#566067]" /><FieldError errors={state.fieldErrors.title} /></label>
      <label className="grid gap-2 text-[10px] text-[#7b858b]"><span>Описание</span><textarea name="description" maxLength={4000} rows={5} placeholder="Контекст, результат и важные детали" className="focus-ring resize-none rounded-[12px] border border-white/[0.08] bg-black/15 p-3.5 text-sm leading-6 text-white outline-none placeholder:text-[#566067]" /><FieldError errors={state.fieldErrors.description} /></label>
      <label className="grid gap-2 text-[10px] text-[#7b858b]"><span>Ответственный</span><select name="assignedMemberId" defaultValue={currentMemberId} className="focus-ring h-12 rounded-[12px] border border-white/[0.08] bg-[#0b1115] px-3.5 text-sm text-white outline-none"><option value="">Без ответственного</option>{assigneeOptions.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.displayName} · {roleLabels[assignee.role]}</option>)}</select><FieldError errors={state.fieldErrors.assignedMemberId} /></label>
      <fieldset><legend className="text-[10px] text-[#7b858b]">Приоритет</legend><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">{([['low','Низкий'],['normal','Обычный'],['high','Высокий'],['critical','Критичный']] as const).map(([value,label]) => <label key={value} className="focus-within:ring-2 focus-within:ring-[var(--accent)]/50"><input type="radio" name="priority" value={value} defaultChecked={value === "normal"} className="peer sr-only" /><span className="grid min-h-11 cursor-pointer place-items-center rounded-[11px] border border-white/[0.08] text-[10px] text-[#7b858b] peer-checked:border-[var(--accent)]/35 peer-checked:bg-[var(--accent)]/[0.07] peer-checked:text-white">{label}</span></label>)}</div></fieldset>
      <fieldset><legend className="text-[10px] text-[#7b858b]">Срок (необязательно)</legend><div className="mt-2 grid gap-3 sm:grid-cols-2"><label className="grid gap-2 text-[10px] text-[#69737a]"><span>Дата</span><input type="date" name="localDate" className="focus-ring h-12 rounded-[12px] border border-white/[0.08] bg-black/15 px-3.5 text-sm text-white outline-none [color-scheme:dark]" /><FieldError errors={state.fieldErrors.localDate} /></label><label className="grid gap-2 text-[10px] text-[#69737a]"><span>Время</span><input type="time" name="localTime" className="focus-ring h-12 rounded-[12px] border border-white/[0.08] bg-black/15 px-3.5 text-sm text-white outline-none [color-scheme:dark]" /><FieldError errors={state.fieldErrors.localTime} /></label></div></fieldset>
      {state.message ? <p role="status" className={`rounded-[12px] border p-3 text-xs ${state.status === "success" ? "border-[#69d3a4]/20 bg-[#69d3a4]/[0.05] text-[#8ed7b8]" : "border-[#ef646a]/20 bg-[#ef646a]/[0.05] text-[#d89599]"}`}>{state.status === "success" ? <Check className="mr-2 inline size-4" /> : null}{state.message}</p> : null}
    </div>
    <footer className="sticky bottom-0 flex gap-2 border-t border-white/[0.07] bg-[#0d1317]/94 p-4 backdrop-blur-xl sm:px-7"><button type="button" onClick={onComplete} disabled={pending} className="focus-ring h-12 flex-1 rounded-[12px] border border-white/[0.08] text-xs text-[#8b959b]">Отмена</button><button type="submit" disabled={pending || state.status === "success"} className="focus-ring flex h-12 flex-[1.4] items-center justify-center gap-2 rounded-[12px] bg-[var(--accent)] text-xs font-semibold text-[#111509] disabled:opacity-65">{pending ? <><LoaderCircle className="size-4 animate-spin" />Сохраняем…</> : state.status === "success" ? <><Check className="size-4" />Сохранено</> : "Создать задачу"}</button></footer>
  </form>;
}

export function CreateTaskButton({ assigneeOptions, currentMemberId }: { assigneeOptions: TaskAssigneeOption[]; currentMemberId: string }) {
  const [requestKey, setRequestKey] = useState<string | null>(null);
  const close = useCallback(() => setRequestKey(null), []);
  return <><button onClick={() => setRequestKey(crypto.randomUUID())} className="focus-ring flex h-11 items-center gap-2 rounded-[13px] bg-[var(--accent)] px-4 text-sm font-semibold text-[#101308]"><Plus className="size-4" />Новая задача</button><Dialog open={requestKey !== null} onClose={close} title="Новая задача" description="Задача сохраняется в CRM и сразу появляется у ответственного сотрудника.">{requestKey ? <CreateTaskForm requestKey={requestKey} assigneeOptions={assigneeOptions} currentMemberId={currentMemberId} onComplete={close} /> : null}</Dialog></>;
}
