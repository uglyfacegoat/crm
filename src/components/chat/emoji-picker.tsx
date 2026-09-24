"use client";

import { Smile } from "lucide-react";
import { useRef, useState } from "react";
import { chatEmojiGroups } from "@/lib/chat-emojis";

export function EmojiPicker({ onSelect, label = "Выбрать эмодзи", align = "left", compact = false }: { onSelect: (emoji: string) => void; label?: string; align?: "left" | "right"; compact?: boolean }) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  const [groupId, setGroupId] = useState<(typeof chatEmojiGroups)[number]["id"]>(chatEmojiGroups[0].id);
  const group = chatEmojiGroups.find((candidate) => candidate.id === groupId) ?? chatEmojiGroups[0];

  function select(emoji: string) {
    onSelect(emoji);
    detailsRef.current?.removeAttribute("open");
    setOpen(false);
  }

  return <details ref={detailsRef} className="relative" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary aria-label={label} title={label} className={`focus-ring grid cursor-pointer list-none place-items-center rounded-[12px] border border-[var(--line)] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent-ink)] [&::-webkit-details-marker]:hidden ${compact ? "size-8" : "size-11"}`}><Smile className={compact ? "size-3.5" : "size-4"} /></summary>
    {open ? <div className={`absolute bottom-[calc(100%+0.6rem)] z-50 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-[18px] border border-[var(--line-strong)] bg-[var(--surface-raised)] shadow-[0_24px_64px_rgba(20,24,33,0.22)] ${align === "right" ? "right-0" : "left-0"}`}>
      <div className="scrollbar-hidden flex gap-1 overflow-x-auto border-b border-[var(--line)] bg-[var(--surface-inset)] p-2" role="tablist" aria-label="Категории эмодзи">{chatEmojiGroups.map((candidate) => <button key={candidate.id} type="button" role="tab" aria-selected={candidate.id === group.id} onClick={() => setGroupId(candidate.id)} className={`focus-ring grid size-9 shrink-0 place-items-center rounded-[10px] text-base ${candidate.id === group.id ? "bg-[var(--accent-soft)] ring-1 ring-[var(--accent)]/35" : "hover:bg-[var(--surface-soft)]"}`} title={candidate.label}>{candidate.icon}</button>)}</div>
      <div className="px-3 pb-1 pt-3"><p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">{group.label}</p></div>
      <div className="scrollbar-hidden grid max-h-56 grid-cols-8 gap-1 overflow-y-auto p-2.5 pt-1">{group.emojis.map((emoji, index) => <button key={`${emoji}-${index}`} type="button" onClick={() => select(emoji)} className="focus-ring grid size-9 place-items-center rounded-[10px] text-xl transition-transform hover:scale-110 hover:bg-[var(--accent-soft)]" aria-label={`Вставить ${emoji}`}>{emoji}</button>)}</div>
    </div> : null}
  </details>;
}
