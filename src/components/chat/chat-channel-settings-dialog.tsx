"use client";

import { Bell, BellOff, Camera, LoaderCircle, Settings2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useState } from "react";
import { type ChatMutationState, updateChatChannelSettingsAction } from "@/app/(workspace)/chat/actions";
import { Dialog } from "@/components/ui/dialog";
import type { ChatChannel } from "@/server/chat/types";

const initialState: ChatMutationState = { status: "idle", message: null, fieldErrors: {}, entityId: null };

function SettingsForm({ channel, editableDetails, onComplete }: { channel: ChatChannel; editableDetails: boolean; onComplete: () => void }) {
  const [state, action, pending] = useActionState(updateChatChannelSettingsAction, initialState);
  const router = useRouter();
  const [muted, setMuted] = useState(channel.muted);
  const direct = channel.audienceKind === "direct";
  useEffect(() => {
    if (state.status !== "success" || state.refreshRequired) return;
    const timeout = window.setTimeout(() => { onComplete(); router.refresh(); }, 500);
    return () => window.clearTimeout(timeout);
  }, [onComplete, router, state.status, state.refreshRequired]);
  return <form action={action} className="flex min-h-full flex-1 flex-col">
    <input type="hidden" name="channelId" value={channel.id} />
    <input type="hidden" name="expectedVersion" value={channel.version} />
    <div className="flex-1 space-y-5 p-5 sm:p-7">
      {direct ? <><input type="hidden" name="name" value={channel.name} /><input type="hidden" name="description" value="" /><div className="flex items-center gap-4 rounded-[14px] border border-[var(--line)] bg-[var(--surface-inset)] p-4"><span className="grid size-12 place-items-center rounded-full bg-[var(--accent-soft)] font-semibold text-[var(--accent-ink)]">{channel.name.slice(0, 2).toUpperCase()}</span><div><p className="text-sm font-semibold text-[var(--text)]">{channel.name}</p><p className="mt-1 text-[10px] text-[var(--muted)]">Личная переписка · только два участника</p></div></div></> : <><div className="flex items-center gap-4">
        <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-[18px] bg-[var(--accent-soft)] text-lg font-semibold text-[var(--accent-ink)]">{channel.avatarUrl ? <span aria-hidden="true" className="size-full bg-cover bg-center" style={{ backgroundImage: `url(${JSON.stringify(channel.avatarUrl).slice(1, -1)})` }} /> : channel.name.slice(0, 2).toUpperCase()}</span>
        <label className={`focus-within:focus-ring flex min-h-11 items-center gap-2 rounded-[12px] border border-[var(--line)] px-3 text-xs ${editableDetails ? "cursor-pointer text-[var(--text-secondary)]" : "cursor-not-allowed opacity-45"}`}><Camera className="size-4" />Изменить фото<input name="avatar" type="file" accept=".jpg,.jpeg,.png,.webp" disabled={!editableDetails} className="sr-only" /></label>
      </div>
      <label className="grid gap-2 text-xs text-[var(--text-secondary)]">Название<input name="name" required minLength={2} maxLength={120} defaultValue={channel.name} readOnly={!editableDetails} className="focus-ring h-11 rounded-[12px] border border-[var(--line)] bg-[var(--surface-inset)] px-3 text-sm read-only:opacity-60" /></label>
      <label className="grid gap-2 text-xs text-[var(--text-secondary)]">Описание<textarea name="description" maxLength={1000} rows={3} defaultValue={channel.description ?? ""} readOnly={!editableDetails} className="focus-ring rounded-[12px] border border-[var(--line)] bg-[var(--surface-inset)] p-3 text-sm read-only:opacity-60" /></label></>}
      <label className="flex cursor-pointer items-center gap-3 rounded-[13px] border border-[var(--line)] p-4"><input type="checkbox" name="muted" checked={muted} onChange={(event) => setMuted(event.target.checked)} className="peer sr-only" /><span className="grid size-10 place-items-center rounded-[11px] bg-[var(--surface-inset)] text-[var(--muted)] peer-checked:bg-[var(--accent-soft)] peer-checked:text-[var(--accent-ink)]">{muted ? <BellOff className="size-4" /> : <Bell className="size-4" />}</span><span className="min-w-0 flex-1"><span className="block text-xs font-medium text-[var(--text)]">Отключить уведомления</span><span className="mt-1 block text-[10px] text-[var(--muted)]">Сообщения останутся непрочитанными, но канал не будет беспокоить.</span></span></label>
      {!editableDetails ? <p className="text-[10px] leading-5 text-[var(--muted)]">{direct ? "Состав личного диалога неизменяем. Персональное отключение уведомлений доступно всегда." : "Название и фото системного канала управляются CRM. Персональное отключение уведомлений доступно всегда."}</p> : null}
      {state.message ? <p role="status" className={`rounded-[12px] border p-3 text-xs ${state.status === "error" ? "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-ink)]" : "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]"}`}>{state.message}</p> : null}
    </div>
    <footer className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 border-t border-[var(--line)] p-4 sm:p-5"><button type="button" onClick={onComplete} className="focus-ring h-11 rounded-[12px] border border-[var(--line)] px-4 text-xs text-[var(--text-secondary)]">Отмена</button><button type="submit" disabled={pending || state.status === "success"} className="focus-ring flex h-11 items-center justify-center gap-2 rounded-[12px] bg-[var(--accent)] px-4 text-xs font-semibold text-[var(--on-accent)] disabled:opacity-50">{pending ? <LoaderCircle className="size-4 animate-spin" /> : null}{state.status === "success" ? "Сохранено" : "Сохранить"}</button></footer>
  </form>;
}

export function ChatChannelSettingsButton({ channel, editableDetails }: { channel: ChatChannel; editableDetails: boolean }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const direct = channel.audienceKind === "direct";
  return <><button type="button" onClick={() => setOpen(true)} className="focus-ring grid size-9 place-items-center rounded-[11px] border border-[var(--line)] text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]" aria-label={direct ? "Настройки личного чата" : "Настройки группы"} title={direct ? "Настройки личного чата" : "Настройки группы"}><Settings2 className="size-3.5" /></button><Dialog open={open} onClose={close} title={direct ? "Настройки личного чата" : "Настройки группы"} description={direct ? "Уведомления и сведения о личном диалоге." : "Название, фото и персональные уведомления канала."}>{open ? <SettingsForm channel={channel} editableDetails={editableDetails} onComplete={close} /> : null}</Dialog></>;
}
