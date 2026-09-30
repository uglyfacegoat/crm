"use client";

import { ArrowLeft, BellOff, Bot, Download, FileText, Hash, Image as ImageIcon, MessageCircle, MessageSquareText, Mic, PanelLeftClose, PanelLeftOpen, Paperclip, Pin, PinOff, Plus, RefreshCw, Search, Send, Share2, ShieldCheck, Square, Trash2, UsersRound, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useDeferredValue, useEffect, useId, useRef, useState, useTransition } from "react";
import type { FormEvent } from "react";
import { markChatChannelReadAction, sendChatMessageAction, toggleChatChannelPinAction, toggleChatReactionAction, type ChatMutationState } from "@/app/(workspace)/chat/actions";
import { ChatChannelSettingsButton } from "@/components/chat/chat-channel-settings-dialog";
import { ChatPhotoAttachment } from "@/components/chat/chat-photo-attachment";
import { ChatCreationActions } from "@/components/chat/create-chat-group-dialog";
import { ChatEntityPicker } from "@/components/chat/chat-entity-picker";
import { Dialog } from "@/components/ui/dialog";
import { ChatEntityIcon, ChatSharedEntityCard } from "@/components/chat/chat-shared-entity-card";
import { EmojiPicker } from "@/components/chat/emoji-picker";
import { ManageChatMembersButton } from "@/components/chat/manage-chat-members-dialog";
import { useVoiceRecorder } from "@/components/chat/use-voice-recorder";
import { VoiceMessagePlayer, VoiceWaveform } from "@/components/chat/voice-message-player";
import { Avatar } from "@/components/ui/avatar";
import { quickReactionEmojis } from "@/lib/chat-emojis";
import { matchesSearchText } from "@/lib/search-normalization";
import { useNavigationState } from "@/components/navigation/use-navigation-state";
import type { ChatChannel, ChatMessage, ChatSharedEntity, ChatWorkspaceData } from "@/server/chat/types";

const initialState: ChatMutationState = { status: "idle", message: null, fieldErrors: {}, entityId: null };
const timeFormatter = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
const dayFormatter = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Moscow" });
const shortDateFormatter = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", timeZone: "Europe/Moscow" });
const roleLabels = { owner: "Владелец", developer: "Разработчик", deputy: "Заместитель", finance_controller: "Финконтроль", sales_lead: "Руководитель продаж", sales_specialist: "Менеджер продаж", regional_director: "Региональный директор", crm_coordinator: "Координатор CRM", tender_specialist: "Тендерный отдел", foreman: "Бригадир", admin: "Администратор", dispatcher: "Диспетчер", manager: "Менеджер", accountant: "Бухгалтер", master: "Мастер" } as const;

function formatRecordingTime(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function ChatComposer({ channelId, requestKey, entityOptions }: { channelId: string; requestKey: string; entityOptions: ChatSharedEntity[] }) {
  const [messageRequestKey, setMessageRequestKey] = useState(requestKey);
  const fileRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const fileInputId = useId();
  const [selectedEntity, setSelectedEntity] = useState<ChatSharedEntity | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [entityPickerOpen, setEntityPickerOpen] = useState(false);
  const [attachedFileName, setAttachedFileName] = useState<string | null>(null);
  const [photoDraftUrl, setPhotoDraftUrl] = useState<string | null>(null);
  const [messageText, setMessageText] = useState("");
  const voice = useVoiceRecorder();
  const sendVoiceWhenReadyRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const voiceReady = voice.phase === "ready" && Boolean(voice.file && voice.previewUrl);
  const [state, setState] = useState<ChatMutationState>(initialState);
  const [pending, startSubmitTransition] = useTransition();
  useEffect(() => () => { if (photoDraftUrl) URL.revokeObjectURL(photoDraftUrl); }, [photoDraftUrl]);
  useEffect(() => {
    if (voice.phase === "failed") sendVoiceWhenReadyRef.current = false;
    if (voiceReady && sendVoiceWhenReadyRef.current) {
      sendVoiceWhenReadyRef.current = false;
      formRef.current?.requestSubmit();
    }
  }, [voice.phase, voiceReady]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    if (voice.file) formData.set("file", voice.file, voice.file.name);
    startSubmitTransition(async () => {
      try {
        const result = await sendChatMessageAction(state, formData);
        startSubmitTransition(() => {
          if (result.status === "success") {
            setMessageText("");
            if (fileRef.current) fileRef.current.value = "";
            setAttachedFileName(null);
            setPhotoDraftUrl(null);
            setSelectedEntity(null);
            voice.resetDraft();
            setMessageRequestKey(crypto.randomUUID());
          }
          setState(result);
        });
      } catch {
        startSubmitTransition(() => setState({
          status: "error",
          message: "Не удалось получить ответ сервера. Проверьте переписку перед повторной отправкой.",
          fieldErrors: {},
          entityId: null,
        }));
      }
    });
  };
  const recordingActive = voice.phase === "recording" || voice.phase === "paused";
  const hasSendableContent = Boolean(messageText.trim() || selectedEntity || attachedFileName);
  return <form ref={formRef} onSubmit={submit} className="border-t border-[var(--line)] bg-[var(--surface-raised)] p-3 sm:p-4">
    <fieldset disabled={pending} aria-busy={pending} className="mx-auto min-w-0 max-w-3xl">
    <input type="hidden" name="idempotencyKey" value={messageRequestKey} />
    <input type="hidden" name="channelId" value={channelId} />
    <input type="hidden" name="sharedEntityType" value={selectedEntity?.type ?? ""} />
    <input type="hidden" name="sharedEntityId" value={selectedEntity?.id ?? ""} />
    <input ref={fileRef} id={fileInputId} name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,.webm,.m4a,.mp3,.wav" onChange={(event) => { const file = event.target.files?.[0]; setAttachedFileName(file?.name ?? null); setPhotoDraftUrl(file?.type.startsWith("image/") ? URL.createObjectURL(file) : null); }} className="sr-only" />
    {attachedFileName ? <div className="mb-2 flex min-w-0 items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface-inset)] px-3 py-2 text-xs text-[var(--text-secondary)]">{photoDraftUrl ? <img src={photoDraftUrl} alt="Предпросмотр выбранного фото" className="size-16 shrink-0 rounded-lg object-cover" /> : <Paperclip className="size-4 shrink-0" />}<span className="min-w-0 flex-1 truncate">{attachedFileName}</span><button type="button" aria-label="Убрать файл" onClick={() => { if (fileRef.current) fileRef.current.value = ""; setAttachedFileName(null); setPhotoDraftUrl(null); }}><X className="size-4" /></button></div> : null}
    {selectedEntity ? <div className="mb-2 flex items-center gap-3 rounded-[14px] border border-[var(--accent)]/35 bg-[var(--accent-soft)] p-2.5"><span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[var(--surface-raised)] text-[var(--accent-ink)]"><ChatEntityIcon type={selectedEntity.type} /></span><span className="min-w-0 flex-1"><span className="block text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--accent-ink)]">{selectedEntity.typeLabel}</span><span className="mt-1 block truncate text-xs font-medium text-[var(--text)]">{selectedEntity.title}</span></span><button type="button" onClick={() => setSelectedEntity(null)} className="focus-ring grid size-9 shrink-0 place-items-center rounded-[10px] text-[var(--muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)]" aria-label="Убрать объект из сообщения"><X className="size-4" /></button></div> : null}
    {voice.phase === "processing" || voice.phase === "failed" ? <div className="flex min-h-[3.75rem] items-center gap-3 rounded-[18px] border border-[var(--line)] p-3">
      <button type="button" onClick={voice.discard} className="focus-ring grid size-10 shrink-0 place-items-center rounded-[12px] text-[var(--danger-ink)]" aria-label="Удалить голосовой черновик"><Trash2 className="size-4" /></button>
      <span role="status" className="min-w-0 flex-1 text-xs">{voice.phase === "processing" ? "Подготовка голосового…" : "Запись не отправлена"}</span>
      {voice.phase === "failed" ? <button type="button" onClick={() => void voice.prepareDraft()} className="focus-ring rounded-lg border border-[var(--line)] px-3 py-2 text-xs">Повторить подготовку</button> : null}
    </div> : recordingActive ? <div className="flex min-h-[3.75rem] min-w-0 items-center gap-2 rounded-[18px] border border-[var(--line)] bg-[var(--surface-inset)] p-2 text-[var(--text)]">
      <button type="button" onClick={() => { sendVoiceWhenReadyRef.current = false; voice.discard(); }} className="focus-ring grid size-8 shrink-0 place-items-center rounded-[10px] text-[var(--muted)] transition-colors hover:bg-[var(--danger-bg)] hover:text-[var(--danger-ink)]" aria-label="Отменить запись"><Trash2 className="size-4" /></button>
      <span className={`size-2.5 shrink-0 rounded-full bg-[var(--accent)] ${voice.phase === "recording" ? "animate-pulse" : "opacity-35"}`} aria-hidden="true" />
      <span className="shrink-0 text-xs font-medium tabular-nums">{formatRecordingTime(voice.elapsedMs)}</span>
      <VoiceWaveform levels={voice.waveform} seed="live-recording" live />
      <button type="button" onClick={voice.finish} className="focus-ring grid size-9 shrink-0 place-items-center rounded-full border border-[var(--line-strong)] bg-[var(--surface-raised)] text-[var(--text)]" aria-label="Остановить запись и прослушать"><Square className="size-3 fill-current" /></button>
      <button type="button" onClick={() => { sendVoiceWhenReadyRef.current = true; voice.finish(); }} className="focus-ring grid size-10 shrink-0 place-items-center rounded-full bg-[var(--accent)] text-[var(--on-accent)]" aria-label="Завершить и отправить голосовое"><Send className="size-4" /></button>
    </div> : voiceReady && voice.previewUrl ? <div className="flex min-h-[3.75rem] items-center gap-2 rounded-[18px] border border-[var(--accent)]/35 bg-[var(--accent-soft)] p-2 text-[var(--accent-ink)] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]">
      <button type="button" onClick={voice.discard} className="focus-ring grid size-10 shrink-0 place-items-center rounded-[12px] text-[var(--danger-ink)] transition-colors hover:bg-[var(--danger-bg)]" aria-label="Удалить голосовой черновик"><Trash2 className="size-4" /></button>
      <div className="min-w-0 flex-1"><VoiceMessagePlayer src={voice.previewUrl} seed={voice.file?.name ?? "voice-draft"} levels={voice.waveform} durationHintMs={voice.elapsedMs} /></div>
      <button type="submit" disabled={pending} className="focus-ring grid size-11 shrink-0 place-items-center rounded-[13px] bg-[var(--accent)] text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-strong)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50" aria-label="Отправить голосовое сообщение"><Send className="size-4" /></button>
    </div> : <div className="flex min-w-0 items-end gap-1.5 rounded-[16px] border border-[var(--line-strong)] bg-[var(--surface-inset)] p-1.5 transition-colors focus-within:border-[var(--accent)] sm:gap-2 sm:p-2">
      <button type="button" onClick={() => setActionsOpen(true)} className="focus-ring grid size-10 shrink-0 place-items-center rounded-[12px] border border-[var(--line)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-soft)] hover:text-[var(--text)] sm:size-11" aria-label="Добавить в сообщение"><Plus className="size-5" /></button>
      <textarea ref={messageRef} name="body" value={messageText} onChange={(event) => setMessageText(event.target.value)} onKeyDown={(event) => {
        if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || window.matchMedia("(pointer: coarse)").matches) return;
        event.preventDefault();
        if (!pending && hasSendableContent) event.currentTarget.form?.requestSubmit();
      }} required={!selectedEntity && !attachedFileName} maxLength={4000} rows={1} placeholder={selectedEntity ? "Комментарий…" : "Сообщение…"} className="max-h-28 min-h-10 min-w-0 flex-1 resize-none bg-transparent px-1 py-2.5 text-sm leading-5 text-[var(--text)] outline-none placeholder:text-[var(--text-secondary)] sm:min-h-11 sm:px-2 sm:py-3" />
      {hasSendableContent ? <button type="submit" disabled={pending} className="focus-ring grid size-10 shrink-0 place-items-center rounded-[12px] bg-[var(--accent)] text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-strong)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 sm:size-11" aria-label="Отправить сообщение"><Send className="size-4" /></button> : <button type="button" disabled={voice.starting} onClick={() => void voice.start()} className="focus-ring grid size-10 shrink-0 place-items-center rounded-[12px] bg-[var(--accent)] text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-strong)] disabled:cursor-wait disabled:opacity-50 sm:size-11" aria-label={voice.starting ? "Подключение микрофона" : "Записать голосовое сообщение"}><Mic className={`size-4 ${voice.starting ? "animate-pulse" : ""}`} /></button>}
    </div>}
    <div className="mt-2 flex min-w-0 items-center justify-between gap-3 px-1"><p className="min-w-0 truncate text-[9px] text-[var(--muted)]">{voice.starting ? "Подключаю микрофон…" : voice.phase === "recording" ? "Запись идёт · можно поставить на паузу" : voice.phase === "paused" ? "Запись приостановлена · продолжите или завершите" : voiceReady ? "Прослушайте голосовое перед отправкой" : "До 4000 символов · файл до 15 МБ"}</p>{voice.error || state.status === "error" ? <p role="alert" className="text-right text-[10px] text-[var(--danger-ink)]">{voice.error ?? state.message}</p> : null}</div>
    </fieldset>
    <Dialog open={actionsOpen} onClose={() => setActionsOpen(false)} title="Добавить в сообщение" compact>
      <div className="grid gap-2 px-5 pb-5 sm:px-7 sm:pb-7">
        <button type="button" onClick={() => { setActionsOpen(false); if (fileRef.current) { fileRef.current.accept = "image/jpeg,image/png,image/webp"; fileRef.current.click(); } }} className="focus-ring flex min-h-16 items-center gap-4 rounded-[14px] border border-[var(--line)] bg-[var(--surface-raised)] px-4 text-left hover:border-[var(--accent)]/40 hover:bg-[var(--surface-soft)]"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-ink)]"><ImageIcon className="size-5" /></span><span><span className="block text-sm font-medium text-[var(--text)]">Фото</span><span className="mt-1 block text-xs text-[var(--muted)]">Появится в переписке с предпросмотром</span></span></button>
        <button type="button" onClick={() => { setActionsOpen(false); if (fileRef.current) { fileRef.current.accept = ".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,.webm,.m4a,.mp3,.wav"; fileRef.current.click(); } }} className="focus-ring flex min-h-16 items-center gap-4 rounded-[14px] border border-[var(--line)] bg-[var(--surface-raised)] px-4 text-left hover:border-[var(--accent)]/40 hover:bg-[var(--surface-soft)]"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-ink)]"><Paperclip className="size-5" /></span><span><span className="block text-sm font-medium text-[var(--text)]">Файл</span><span className="mt-1 block text-xs text-[var(--muted)]">Документ или аудио до 15 МБ</span></span></button>
        <button type="button" onClick={() => { setActionsOpen(false); setEntityPickerOpen(true); }} className="focus-ring flex min-h-16 items-center gap-4 rounded-[14px] border border-[var(--line)] bg-[var(--surface-raised)] px-4 text-left hover:border-[var(--accent)]/40 hover:bg-[var(--surface-soft)]"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-ink)]"><Share2 className="size-5" /></span><span><span className="block text-sm font-medium text-[var(--text)]">Объект системы</span><span className="mt-1 block text-xs text-[var(--muted)]">Заказ, клиент, выезд и другое</span></span></button>
      </div>
    </Dialog>
    <ChatEntityPicker options={entityOptions} selected={selectedEntity} onSelect={setSelectedEntity} open={entityPickerOpen} onOpenChange={setEntityPickerOpen} />
    {state.status === "success" && state.refreshRequired ? <p role="status" className="mx-auto mt-2 max-w-3xl rounded-[12px] border border-[var(--line)] bg-[var(--surface-inset)] p-3 text-xs text-[var(--text)]">{state.message}</p> : null}
  </form>;
}

function formatAttachmentSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} КБ` : `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function MessageAttachment({ attachment, mine, sentAt }: { attachment: NonNullable<ChatWorkspaceData["messages"][number]["attachment"]>; mine: boolean; sentAt?: string }) {
  if (attachment.mimeType.startsWith("audio/")) return <VoiceMessagePlayer src={`/api/v1/chat/attachments/${attachment.id}/download${attachment.mimeType === "audio/webm" ? "?format=mp3" : ""}`} seed={attachment.id} mine={mine} sentAt={sentAt} />;
  if (attachment.mimeType.startsWith("image/")) return <ChatPhotoAttachment attachment={attachment} sentAt={sentAt ?? ""} />;
  return <a href={`/api/v1/chat/attachments/${attachment.id}/download`} className={`focus-ring mt-2 flex min-h-12 items-center gap-3 rounded-[11px] border px-3 ${mine ? "border-[var(--on-accent)]/35 bg-[var(--accent-strong)]/20 text-[var(--on-accent)]" : "border-[var(--line)] bg-[var(--surface-inset)] text-[var(--text-secondary)]"}`}><FileText className="size-4 shrink-0" /><span className="min-w-0 flex-1"><span className="block truncate text-[10px] font-medium">{attachment.filename}</span><span className={`mt-0.5 block text-[9px] ${mine ? "text-[var(--on-accent)]/75" : "text-[var(--muted)]"}`}>{attachment.extension.toUpperCase()} · {formatAttachmentSize(attachment.sizeBytes)}</span></span><Download className="size-3.5 shrink-0" /></a>;
}

function MessageReactions({ message }: { message: ChatMessage }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function react(emoji: string) { startTransition(async () => { await toggleChatReactionAction(message.id, emoji); router.refresh(); }); }
  return <div className={`${message.reactions.length ? "mt-1 flex flex-wrap items-center gap-1.5" : "pointer-events-none absolute -top-9 z-10 flex"} ${message.mine ? "right-0 justify-end" : "left-0 justify-start"}`}>
    {message.reactions.map((reaction) => <button key={reaction.emoji} type="button" disabled={pending} onClick={() => react(reaction.emoji)} aria-pressed={reaction.mine} className={`focus-ring flex h-8 min-w-10 items-center justify-center gap-1 rounded-[11px] border px-2 text-sm shadow-sm transition-transform hover:-translate-y-0.5 ${reaction.mine ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "border-[var(--line)] bg-[var(--surface-raised)] text-[var(--text-secondary)]"}`}><span>{reaction.emoji}</span><span className="text-[9px] font-semibold tabular-nums">{reaction.count}</span></button>)}
    <div className={`flex items-center gap-0.5 rounded-[11px] border border-[var(--line)] bg-[var(--surface-raised)] p-0.5 shadow-sm ${message.reactions.length ? "" : "pointer-events-none opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100"}`}>{quickReactionEmojis.slice(0, 3).map((emoji) => <button key={emoji} type="button" disabled={pending} onClick={() => react(emoji)} className="focus-ring grid size-7 place-items-center rounded-[8px] text-sm transition-transform hover:scale-110 hover:bg-[var(--accent-soft)]" aria-label={`Поставить реакцию ${emoji}`}>{emoji}</button>)}<EmojiPicker onSelect={react} label="Все реакции" align={message.mine ? "right" : "left"} compact /></div>
  </div>;
}

function groupMessages(messages: ChatMessage[]) {
  const groups: ChatMessage[][] = [];
  for (const message of messages) {
    const current = groups[groups.length - 1];
    const previous = current?.[current.length - 1];
    const sameAuthor = previous?.kind === "user" && message.kind === "user" && previous.authorId === message.authorId && previous.mine === message.mine;
    const sameDay = previous && dayFormatter.format(new Date(previous.createdAt)) === dayFormatter.format(new Date(message.createdAt));
    const closeInTime = previous && Math.abs(new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime()) <= 5 * 60_000;
    if (sameAuthor && sameDay && closeInTime) current.push(message);
    else groups.push([message]);
  }
  return groups;
}

function MessageGroup({ messages, showDay, showAuthor }: { messages: ChatMessage[]; showDay: boolean; showAuthor: boolean }) {
  const first = messages[0];
  if (!first) return null;
  return <div>
    {showDay ? <div className="my-5 flex items-center gap-3"><span className="h-px flex-1 bg-[var(--line)]" /><span className="text-[9px] uppercase tracking-[0.12em] text-[var(--muted)]">{dayFormatter.format(new Date(first.createdAt))}</span><span className="h-px flex-1 bg-[var(--line)]" /></div> : null}
    {first.kind === "system" ? <article className="mx-auto flex max-w-xl items-start gap-3 rounded-[14px] border border-[var(--info-border)]/45 bg-[var(--info-bg)] px-4 py-3"><span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[var(--info)]/10 text-[var(--info)]"><Bot className="size-4" /></span><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--info)]">Системное напоминание</span><span className="text-[9px] text-[var(--muted)]">{timeFormatter.format(new Date(first.createdAt))}</span></div><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[var(--text-secondary)]">{first.body}</p></div></article> :
      <article data-chat-message-group data-chat-author={first.authorName} className={`flex items-stretch gap-2 ${first.mine ? "justify-end" : "justify-start"}`}>
        {!first.mine ? <span className="relative flex w-8 shrink-0 flex-col justify-end self-stretch"><span className="sticky bottom-2"><Avatar name={first.authorName} size="sm" tone="violet" src={first.authorAvatarUrl ?? undefined} /></span></span> : null}
        <div className={`flex max-w-[min(38rem,calc(100%-2.5rem))] min-w-0 flex-col gap-1.5 ${first.mine ? "items-end" : "items-start"}`}>
          {messages.map((message, index) => {
            const textOnly = Boolean(message.body) && !message.attachment && !message.sharedEntity;
            return <div key={message.id} data-chat-message="user" data-chat-author={message.authorName} className="group relative max-w-full min-w-0">
              <div className={`chat-message-bubble max-w-full rounded-[17px] px-3.5 py-2 text-left ${message.mine ? `bg-[var(--accent)] text-[var(--on-accent)] ${index === messages.length - 1 ? "rounded-br-[5px]" : ""}` : `border border-[var(--line)] bg-[var(--surface-raised)] text-[var(--text-secondary)] ${index === messages.length - 1 ? "rounded-bl-[5px]" : ""}`}`}>
                {showAuthor && index === 0 && !message.mine ? <span data-testid="chat-message-author" className="mb-0.5 block max-w-56 truncate text-[10px] font-semibold text-[var(--accent-ink)]">{message.authorName}</span> : <span data-testid="chat-message-author" className="sr-only">{message.authorName}{message.mine ? " · вы" : ""}</span>}
                {message.attachment?.mimeType.startsWith("audio/") ? null : message.body ? <p className="flow-root whitespace-pre-wrap break-words text-sm leading-5">{message.body}{textOnly ? <time dateTime={message.createdAt} className={`ml-2 float-right whitespace-nowrap pt-1 text-[10px] leading-4 tabular-nums ${message.mine ? "text-[var(--on-accent)]/70" : "text-[var(--muted)]"}`}>{timeFormatter.format(new Date(message.createdAt))}</time> : null}</p> : null}
                {message.attachment ? <MessageAttachment attachment={message.attachment} mine={message.mine} sentAt={timeFormatter.format(new Date(message.createdAt))} /> : null}
                {message.sharedEntity ? <ChatSharedEntityCard entity={message.sharedEntity} mine={message.mine} /> : null}
                {!textOnly && !message.attachment?.mimeType.startsWith("audio/") && !message.attachment?.mimeType.startsWith("image/") ? <time dateTime={message.createdAt} className={`mt-1 block text-right text-[10px] tabular-nums ${message.mine ? "text-[var(--on-accent)]/70" : "text-[var(--muted)]"}`}>{timeFormatter.format(new Date(message.createdAt))}</time> : null}
              </div>
              <MessageReactions message={message} />
            </div>;
          })}
        </div>
      </article>}
  </div>;
}

function ChannelAvatarImage({ url, fallback }: { url: string; fallback: React.ReactNode }) {
  return <span aria-hidden="true" className="relative grid size-full place-items-center">{fallback}<img key={url} src={url} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} className="absolute inset-0 size-full object-cover" /></span>;
}

function OnlineIndicator({ online }: { online: boolean }) {
  return <span aria-label={online ? "В сети" : "Не в сети"} title={online ? "В сети" : "Не в сети"} className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-[var(--surface-raised)] ${online ? "bg-emerald-500" : "bg-[var(--muted)] opacity-55"}`} />;
}

function ChannelRow({ channel, active, collapsed, forceCompact, pending, onSelect, onTogglePin }: { channel: ChatChannel; active: boolean; collapsed: boolean; forceCompact: boolean; pending: boolean; onSelect: (id: string) => void; onTogglePin: (id: string) => void }) {
  const fallbackIcon = channel.audienceKind === "direct" ? <span className="text-lg font-semibold">{channel.name.trim().slice(0, 1).toUpperCase()}</span> : channel.kind === "general" ? <MessageSquareText className="size-5" /> : <Hash className="size-5" />;
  const channelIcon = channel.avatarUrl ? <ChannelAvatarImage url={channel.avatarUrl} fallback={fallbackIcon} /> : fallbackIcon;
  if (collapsed) return <button type="button" disabled={pending} onClick={() => onSelect(channel.id)} title={channel.name} className={`focus-ring relative grid size-9 place-items-center rounded-[11px] transition-colors ${active ? "bg-[var(--accent-soft)] text-[var(--accent-ink)] ring-1 ring-[var(--accent)]/35" : "text-[var(--muted)] hover:bg-[var(--surface-soft)]"}`}><span className="relative grid size-7 place-items-center"><span className="grid size-7 place-items-center overflow-hidden rounded-[9px]">{channelIcon}</span>{channel.audienceKind === "direct" ? <OnlineIndicator online={channel.online} /> : null}</span>{channel.pinned ? <span className="absolute right-0 top-0 size-2 rounded-full bg-[var(--accent)]" aria-label="Закреплён" /> : null}</button>;

  return <div className={`chat-channel-row group/channel flex min-w-0 items-stretch transition-colors ${active ? "is-active" : ""}`}>
    <button type="button" disabled={pending} onClick={() => onSelect(channel.id)} className="focus-ring flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left" aria-current={active ? "page" : undefined}>
      <span className="relative shrink-0"><span className={`chat-channel-avatar grid size-12 place-items-center overflow-hidden rounded-full ${active ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "bg-[var(--surface-inset)] text-[var(--text-secondary)]"}`}>{channelIcon}</span>{channel.audienceKind === "direct" ? <OnlineIndicator online={channel.online} /> : null}</span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2"><span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--text)]">{channel.name}</span>{channel.muted ? <BellOff className="size-3 shrink-0 text-[var(--muted)]" /> : null}<span className="shrink-0 text-[10px] text-[var(--muted)]">{channel.lastMessageAt ? shortDateFormatter.format(new Date(channel.lastMessageAt)) : ""}</span></span>
        <span className="mt-1 flex min-w-0 items-center gap-2"><span className="min-w-0 flex-1 truncate text-[11px] text-[var(--muted)]">{channel.lastAuthor ? `${channel.lastAuthor}: ` : ""}{channel.lastMessage ?? "Сообщений пока нет"}</span>{channel.unreadCount ? <span className="grid min-w-5 shrink-0 place-items-center rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--on-accent)]">{channel.unreadCount > 99 ? "99+" : channel.unreadCount}</span> : channel.pinned ? <Pin className="size-3 shrink-0 text-[var(--muted)]" /> : null}</span>
      </span>
    </button>
    {!forceCompact ? <button type="button" disabled={pending} onClick={() => onTogglePin(channel.id)} className={`focus-ring chat-channel-pin grid w-8 shrink-0 place-items-center transition-colors ${channel.pinned ? "text-[var(--accent-ink)]" : "text-[var(--muted)]"}`} aria-label={channel.pinned ? `Открепить чат ${channel.name}` : `Закрепить чат ${channel.name}`} title={channel.pinned ? "Открепить" : "Закрепить"}>{channel.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}</button> : null}
  </div>;
}

function ChannelList({ data, query, view, onQueryChange, onViewChange, onSelect, onTogglePin, pending, canWrite, canManage, currentMemberId, mobileVisible, forceCompact, collapsed, onToggleCollapsed }: { data: ChatWorkspaceData; query: string; view: "groups" | "direct"; onQueryChange: (query: string) => void; onViewChange: (view: "groups" | "direct") => void; onSelect: (id: string) => void; onTogglePin: (id: string) => void; pending: boolean; canWrite: boolean; canManage: boolean; currentMemberId: string; mobileVisible: boolean; forceCompact: boolean; collapsed: boolean; onToggleCollapsed: () => void }) {
  const deferredQuery = useDeferredValue(query);
  const groupChannels = data.channels.filter((channel) => channel.audienceKind !== "direct");
  const directChannels = data.channels.filter((channel) => channel.audienceKind === "direct");
  const visibleChannels = (view === "direct" ? directChannels : groupChannels).filter((channel) => matchesSearchText(deferredQuery, [channel.name, channel.description, channel.lastMessage]));
  const tabs = [
    { id: "groups" as const, label: "Группы", icon: UsersRound, channels: groupChannels },
    { id: "direct" as const, label: "Личные", icon: MessageCircle, channels: directChannels },
  ];
  return <aside className={`${mobileVisible ? "flex" : "hidden"} chat-channel-list min-h-0 min-w-0 flex-col overflow-hidden border-b border-[var(--line)] bg-[var(--surface-raised)] ${forceCompact ? "" : "lg:flex lg:border-b-0 lg:border-r"}`}>
    <div className={`flex h-[4.5rem] shrink-0 items-center gap-2 border-b border-[var(--line)] ${collapsed ? "justify-center px-2" : "px-4"}`}><div className={collapsed ? "hidden" : "min-w-0 flex-1"}><p className="text-base font-semibold text-[var(--text)]">Сообщения</p><p className="mt-0.5 text-[10px] text-[var(--muted)]">{data.channels.length} диалогов</p></div>{!collapsed && canWrite && !forceCompact ? <ChatCreationActions memberOptions={data.memberOptions} currentMemberId={currentMemberId} canManage={canManage} compact /> : null}{!forceCompact ? <button type="button" onClick={onToggleCollapsed} className="focus-ring hidden size-9 place-items-center rounded-[10px] text-[var(--muted)] hover:bg-[var(--surface-soft)] lg:grid" aria-label={collapsed ? "Развернуть список каналов" : "Свернуть список каналов"}>{collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</button> : null}</div>
    <div role="tablist" aria-label="Разделы чатов" className={`shrink-0 gap-1 border-b border-[var(--line)] bg-[var(--surface-inset)] p-1 ${collapsed ? "mx-2 mt-2 grid" : "mx-3 mt-3 flex rounded-[12px] border"}`}>
      {tabs.map(({ id, label, icon: Icon, channels }) => {
        const active = view === id;
        const unread = channels.reduce((total, channel) => total + channel.unreadCount, 0);
        return <button key={id} type="button" role="tab" aria-selected={active} onClick={() => onViewChange(id)} title={collapsed ? label : undefined} className={`focus-ring relative flex h-9 items-center justify-center gap-2 rounded-[9px] text-[10px] font-medium transition-colors ${collapsed ? "w-9" : "min-w-0 flex-1 px-2"} ${active ? "bg-[var(--accent)] text-[var(--on-accent)] shadow-sm" : "text-[var(--muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)]"}`}><Icon className="size-3.5 shrink-0" /><span className={collapsed ? "sr-only" : "truncate"}>{label}</span>{!collapsed ? <span className="opacity-65">{channels.length}</span> : null}{unread ? <span className={`absolute grid min-w-4 place-items-center rounded-full px-1 text-[8px] ${collapsed ? "-right-1 -top-1 bg-[var(--danger)] text-white" : "right-1 top-0.5 bg-[var(--danger-bg)] text-[var(--danger-ink)]"}`}>{unread > 99 ? "99+" : unread}</span> : null}</button>;
      })}
    </div>
    <label className={`${collapsed ? "hidden" : "mx-3 mt-3 flex"} h-10 items-center gap-2 rounded-[12px] border border-[var(--line-strong)] bg-[var(--surface-inset)] px-3`}><Search className="size-3.5 text-[var(--muted)]" /><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Найти канал" className="min-w-0 flex-1 bg-transparent text-xs text-[var(--text)] outline-none placeholder:text-[var(--text-secondary)]" /></label>
    <div className={`scrollbar-hidden min-h-0 flex-1 overflow-y-auto ${collapsed ? "flex flex-col items-center gap-2 p-3" : "chat-channel-rows mt-2"}`}>{visibleChannels.map((channel) => <ChannelRow key={channel.id} channel={channel} active={channel.id === data.activeChannel?.id} collapsed={collapsed} forceCompact={forceCompact} pending={pending} onSelect={onSelect} onTogglePin={onTogglePin} />)}{!visibleChannels.length && !collapsed ? <div className="p-5 text-center"><p className="text-xs text-[var(--text-secondary)]">{deferredQuery ? "Чаты не найдены" : view === "direct" ? "Личных диалогов пока нет" : "Рабочих групп пока нет"}</p><p className="mt-1 text-[10px] text-[var(--muted)]">{view === "direct" ? "Создайте диалог с сотрудником." : "Создайте группу или используйте общий чат."}</p></div> : null}</div>
  </aside>;
}

export function ChatWorkspace({ data, canWrite, canManage, composerRequestKey, readOnlyPreview = false, openConversationInitially = false }: { data: ChatWorkspaceData; canWrite: boolean; canManage: boolean; composerRequestKey: string; readOnlyPreview?: boolean; openConversationInitially?: boolean }) {
  const router = useRouter();
  const [channelQuery, setChannelQuery] = useState("");
  const [channelViewSelection, setChannelViewSelection] = useState<{ activeChannelId: string | null; view: "groups" | "direct" }>({ activeChannelId: data.activeChannel?.id ?? null, view: data.activeChannel?.audienceKind === "direct" ? "direct" : "groups" });
  const [mobileView, setMobileView] = useState<"channels" | "conversation">(readOnlyPreview || openConversationInitially ? "conversation" : "channels");
  const [pendingChannelId, setPendingChannelId] = useState<string | null>(null);
  const [navigationPending, startNavigation] = useTransition();
  const [pinPending, startPinTransition] = useTransition();
  const { preferences, setPreference } = useNavigationState();
  const channelsCollapsed = preferences["chat.channels.collapsed"] ?? false;
  const membersCollapsed = preferences["chat.members.collapsed"] ?? true;
  const messageListRef = useRef<HTMLDivElement>(null);
  const latestMessageAt = data.channels.reduce<string | null>((latest, channel) => !channel.lastMessageAt ? latest : !latest || channel.lastMessageAt > latest ? channel.lastMessageAt : latest, null);
  const latestMessageAtRef = useRef(latestMessageAt);
  const currentMemberId = data.members.find((member) => member.current)?.id ?? data.memberOptions[0]?.id ?? "";
  const activeChannelId = data.activeChannel?.id ?? null;
  const awaitingChannel = Boolean(pendingChannelId && pendingChannelId !== activeChannelId);
  const channelView = channelViewSelection.activeChannelId === activeChannelId
    ? channelViewSelection.view
    : data.activeChannel?.audienceKind === "direct" ? "direct" : "groups";
  useEffect(() => { if (readOnlyPreview || !activeChannelId) return; startNavigation(async () => { try { await markChatChannelReadAction(activeChannelId); } catch { /* The channel may have been removed between render and acknowledgement. */ } }); }, [activeChannelId, readOnlyPreview]);
  useEffect(() => {
    const messageList = messageListRef.current;
    if (messageList) messageList.scrollTop = messageList.scrollHeight;
  }, [activeChannelId, data.messages]);
  useEffect(() => { latestMessageAtRef.current = latestMessageAt; }, [latestMessageAt]);
  useEffect(() => {
    if (readOnlyPreview) return;
    let disposed = false;
    let inFlight = false;
    const checkMessages = async () => {
      if (disposed || inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const response = await fetch("/api/v1/chat/latest", { cache: "no-store" });
        if (!response.ok) return;
        const result = await response.json() as { latestAt: string | null };
        if (!disposed && result.latestAt !== latestMessageAtRef.current) {
          latestMessageAtRef.current = result.latestAt;
          router.refresh();
        }
      } catch { /* A later poll will retry after a transient network failure. */ }
      finally { inFlight = false; }
    };
    const interval = window.setInterval(() => void checkMessages(), 1_500);
    document.addEventListener("visibilitychange", checkMessages);
    return () => { disposed = true; window.clearInterval(interval); document.removeEventListener("visibilitychange", checkMessages); };
  }, [readOnlyPreview, router]);
  useEffect(() => {
    if (readOnlyPreview) return;
    const refreshPresence = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const interval = window.setInterval(refreshPresence, 15_000);
    document.addEventListener("visibilitychange", refreshPresence);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshPresence);
    };
  }, [readOnlyPreview, router]);
  function selectChannel(channelId: string) {
    if (readOnlyPreview) return;
    setPendingChannelId(channelId);
    setMobileView("conversation");
    startNavigation(async () => { try { await markChatChannelReadAction(channelId); } finally { router.push(`/chat?channel=${channelId}`); } });
  }
  function toggleChannelPin(channelId: string) {
    if (readOnlyPreview) return;
    startPinTransition(async () => {
      await toggleChatChannelPinAction(channelId);
      router.refresh();
    });
  }
  if (!data.activeChannel) return <section className="surface-panel mt-7 grid min-h-[32rem] place-items-center p-8 text-center"><div><MessageSquareText className="mx-auto size-7 text-[var(--accent)]" /><p className="mt-4 text-sm text-[var(--text)]">Доступных каналов нет</p><p className="mt-2 text-xs text-[var(--muted)]">Обратитесь к администратору организации.</p></div></section>;
  const activeChannel = data.activeChannel;
  return <section data-testid="chat-workspace" data-channels-collapsed={channelsCollapsed} data-members-collapsed={membersCollapsed} className={`chat-workspace-layout mt-0 grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-hidden p-0 ${readOnlyPreview ? "chat-workspace-preview surface-panel" : "chat-standalone-workspace"}`}>
    <ChannelList data={data} query={channelQuery} view={channelView} onQueryChange={setChannelQuery} onViewChange={(view) => { setChannelViewSelection({ activeChannelId, view }); setChannelQuery(""); }} onSelect={selectChannel} onTogglePin={toggleChannelPin} pending={navigationPending || pinPending} canWrite={canWrite} canManage={canManage} currentMemberId={currentMemberId} mobileVisible={mobileView === "channels" || awaitingChannel} forceCompact={readOnlyPreview} collapsed={channelsCollapsed} onToggleCollapsed={() => setPreference("chat.channels.collapsed", !channelsCollapsed)} />
    <div className={`${mobileView === "conversation" && !awaitingChannel ? "flex" : "hidden"} chat-conversation min-h-0 min-w-0 flex-col bg-[var(--surface)] ${readOnlyPreview ? "" : "lg:flex"}`}>
      <header className="flex min-h-[4.5rem] items-center gap-2 border-b sm:gap-3 border-[var(--line)] bg-[var(--surface-raised)] px-3.5 sm:px-5">{readOnlyPreview ? null : <button type="button" onClick={() => setMobileView("channels")} className="focus-ring grid size-9 shrink-0 place-items-center rounded-[11px] border border-[var(--line)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-soft)] hover:text-[var(--text)] lg:hidden" aria-label="Вернуться к каналам"><ArrowLeft className="size-4" /></button>}<span className="relative shrink-0"><span className="grid size-9 place-items-center overflow-hidden rounded-[11px] bg-[var(--accent-soft)] text-[var(--accent-ink)]">{activeChannel.avatarUrl ? <ChannelAvatarImage url={activeChannel.avatarUrl} fallback={activeChannel.audienceKind === "direct" ? <MessageCircle className="size-4" /> : <Hash className="size-4" />} /> : activeChannel.audienceKind === "direct" ? <MessageCircle className="size-4" /> : <Hash className="size-4" />}</span>{activeChannel.audienceKind === "direct" ? <OnlineIndicator online={activeChannel.online} /> : null}</span><div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold text-[var(--text)]">{activeChannel.name}</h2><p className="mt-0.5 truncate text-[10px] text-[var(--muted)]">{activeChannel.audienceKind === "direct" ? activeChannel.online ? "В сети" : "Не в сети" : activeChannel.description ?? `${activeChannel.memberCount} участников`}</p></div>{!readOnlyPreview ? <ChatChannelSettingsButton channel={activeChannel} editableDetails={canManage && activeChannel.kind === "group" && !activeChannel.managed} editablePhoto={canManage && activeChannel.audienceKind === "office"} /> : null}{canManage && activeChannel.kind === "group" && !activeChannel.managed ? <ManageChatMembersButton channel={activeChannel} members={data.members} options={data.memberOptions} /> : null}{!readOnlyPreview ? <button type="button" onClick={() => setPreference("chat.members.collapsed", !membersCollapsed)} className="focus-ring hidden size-9 place-items-center rounded-[11px] border border-[var(--line)] text-[var(--muted)] 2xl:grid" aria-label={membersCollapsed ? "Показать участников" : "Скрыть участников"}><UsersRound className="size-3.5" /></button> : null}{readOnlyPreview ? <span className="rounded-full bg-[var(--surface-inset)] px-2.5 py-1 text-[9px] text-[var(--muted)]">Просмотр</span> : <button type="button" onClick={() => router.refresh()} className="focus-ring grid size-9 shrink-0 place-items-center rounded-[11px] border border-[var(--line)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-soft)] hover:text-[var(--text)]" aria-label="Обновить сообщения"><RefreshCw className="size-3.5" /></button>}</header>
      <div ref={messageListRef} data-testid="chat-message-list" className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-3 py-5 sm:px-5">
        <div className="mx-auto max-w-3xl space-y-4">
          {data.messages.length ? groupMessages(data.messages).map((messages, index, groups) => {
            const first = messages[0];
            const previous = groups[index - 1]?.[0];
            const showDay = !previous || dayFormatter.format(new Date(previous.createdAt)) !== dayFormatter.format(new Date(first.createdAt));
            return <MessageGroup key={first.id} messages={messages} showDay={showDay} showAuthor={activeChannel.audienceKind !== "direct"} />;
          }) : <div className="grid min-h-72 place-items-center text-center"><div><MessageSquareText className="mx-auto size-6 text-[var(--muted)]" /><p className="mt-3 text-sm text-[var(--text-secondary)]">Начните разговор</p><p className="mt-1 text-xs text-[var(--muted)]">История останется доступна участникам группы.</p></div></div>}
        </div>
      </div>
      {canWrite && !readOnlyPreview ? <ChatComposer key={activeChannel.id} channelId={activeChannel.id} requestKey={composerRequestKey} entityOptions={data.entityOptions} /> : <p className="border-t border-[var(--line)] bg-[var(--surface-raised)] p-4 text-center text-xs text-[var(--muted)]">{readOnlyPreview ? "В предпросмотре отправка сообщений отключена." : "У вас нет права отправлять сообщения."}</p>}
    </div>
    {readOnlyPreview ? null : <aside className={`hidden min-h-0 flex-col overflow-hidden border-l border-[var(--line)] bg-[var(--surface-raised)] 2xl:flex ${membersCollapsed ? "invisible" : "visible"}`}><div className="flex h-[4.5rem] items-center gap-3 border-b border-[var(--line)] px-4"><UsersRound className="size-4 text-[var(--support)]" /><div><p className="text-xs font-semibold text-[var(--text)]">Участники</p><p className="mt-1 text-[9px] text-[var(--muted)]">{data.members.length} человек</p></div></div><div className="scrollbar-hidden flex-1 space-y-1 overflow-y-auto p-3">{data.members.map((member) => <div key={member.id} className="flex items-center gap-3 rounded-[12px] px-2 py-2.5 transition-colors hover:bg-[var(--surface-soft)]"><span className="relative shrink-0"><Avatar name={member.displayName} size="sm" tone={member.current ? "lime" : "mint"} src={member.avatarUrl ?? undefined} /><OnlineIndicator online={member.online} /></span><div className="min-w-0 flex-1"><p className="truncate text-xs text-[var(--text-secondary)]">{member.displayName}{member.current ? " · вы" : ""}</p><p className="mt-0.5 truncate text-[9px] text-[var(--muted)]">{member.online ? "В сети" : roleLabels[member.role]}</p></div>{member.channelRole === "owner" ? <ShieldCheck className="size-3.5 text-[var(--accent)]" aria-label="Владелец группы" /> : null}</div>)}</div><div className="border-t border-[var(--line)] p-4"><p className="text-[9px] leading-4 text-[var(--muted)]">Сообщения доступны только участникам этого канала. Доступ проверяется сервером.</p></div></aside>}
  </section>;
}
