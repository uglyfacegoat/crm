"use client";

import { Check, Plus, UsersRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useState } from "react";
import { createChatChannelAction, type ChatMutationState } from "@/app/(workspace)/chat/actions";
import { OrderField, OrderFormFooter, OrderFormStatus, orderInputClass, orderTextareaClass } from "@/components/orders/order-form-parts";
import { Avatar } from "@/components/ui/avatar";
import { Dialog } from "@/components/ui/dialog";
import { clientCrypto as crypto } from "@/lib/client-id";
import type { ChatMemberOption } from "@/server/chat/types";

const initialState: ChatMutationState = { status: "idle", message: null, fieldErrors: {}, entityId: null };
const roleLabels = { admin: "Администратор", dispatcher: "Диспетчер", manager: "Менеджер", accountant: "Бухгалтер", master: "Мастер" } as const;

function CreateGroupForm({ requestKey, memberOptions, currentMemberId, onComplete }: { requestKey: string; memberOptions: ChatMemberOption[]; currentMemberId: string; onComplete: () => void }) {
  const [state, formAction, pending] = useActionState(createChatChannelAction, initialState);
  const router = useRouter();
  useEffect(() => {
    if (state.status !== "success" || !state.entityId) return;
    const timeout = window.setTimeout(() => { onComplete(); router.push(`/chat?channel=${state.entityId}`); router.refresh(); }, 500);
    return () => window.clearTimeout(timeout);
  }, [onComplete, router, state.entityId, state.status]);
  return <form action={formAction} className="flex min-h-full flex-1 flex-col">
    <input type="hidden" name="idempotencyKey" value={requestKey} />
    <div className="flex-1 space-y-5 p-5 sm:p-7">
      <OrderField label="Название группы" required errors={state.fieldErrors.name}><input name="name" required minLength={2} maxLength={120} placeholder="Например, Диспетчерская" className={orderInputClass} /></OrderField>
      <OrderField label="Описание" errors={state.fieldErrors.description}><textarea name="description" maxLength={1000} placeholder="Для каких вопросов создана группа" className={orderTextareaClass} /></OrderField>
      <fieldset><legend className="text-[10px] text-[#7b858b]">Участники</legend><p className="mt-1 text-[10px] leading-4 text-[#5f696f]">Вы автоматически станете владельцем группы.</p><div className="mt-3 max-h-72 space-y-1 overflow-y-auto rounded-[14px] border border-white/[0.07] bg-black/10 p-2">{memberOptions.map((member) => { const current = member.id === currentMemberId; return <label key={member.id} className="flex cursor-pointer items-center gap-3 rounded-[11px] px-2.5 py-2.5 hover:bg-white/[0.04]"><input type="checkbox" name="memberIds" value={member.id} defaultChecked={current} disabled={current} className="peer sr-only" /><span className="grid size-5 shrink-0 place-items-center rounded-md border border-white/[0.12] text-transparent peer-checked:border-[var(--accent)] peer-checked:bg-[var(--accent)] peer-checked:text-[#101308]"><Check className="size-3" /></span><Avatar name={member.displayName} size="sm" tone={current ? "lime" : "violet"} /><span className="min-w-0 flex-1"><span className="block truncate text-xs text-white">{member.displayName}{current ? " · вы" : ""}</span><span className="mt-0.5 block truncate text-[10px] text-[#69737a]">{roleLabels[member.role]} · {member.email}</span></span></label>; })}</div>{state.fieldErrors.memberIds?.length ? <p className="mt-2 text-[10px] text-[#ef8a8f]">{state.fieldErrors.memberIds[0]}</p> : null}</fieldset>
      <OrderFormStatus state={state} />
    </div>
    <OrderFormFooter pending={pending} saved={state.status === "success"} onCancel={onComplete} submitLabel="Создать группу" />
  </form>;
}

export function CreateChatGroupButton({ memberOptions, currentMemberId, compact = false }: { memberOptions: ChatMemberOption[]; currentMemberId: string; compact?: boolean }) {
  const [requestKey, setRequestKey] = useState<string | null>(null);
  const close = useCallback(() => setRequestKey(null), []);
  return <>
    <button type="button" onClick={() => setRequestKey(crypto.randomUUID())} className={compact ? "focus-ring grid size-9 place-items-center rounded-[11px] border border-white/[0.08] text-[var(--accent)] hover:bg-white/[0.04]" : "focus-ring flex h-11 items-center gap-2 rounded-[13px] bg-[var(--accent)] px-4 text-sm font-semibold text-[#101308]"} aria-label="Новая группа">{compact ? <Plus className="size-4" /> : <><UsersRound className="size-4" />Новая группа</>}</button>
    <Dialog open={requestKey !== null} onClose={close} title="Новая группа" description="Создайте рабочий канал и выберите сотрудников, которые увидят его историю.">{requestKey ? <CreateGroupForm requestKey={requestKey} memberOptions={memberOptions} currentMemberId={currentMemberId} onComplete={close} /> : null}</Dialog>
  </>;
}
