import {
  Building2,
  CalendarClock,
  ClipboardCheck,
  FileSignature,
  FileText,
  Globe2,
  MapPin,
  UserRound,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import type { ChatEntityType, ChatSharedEntity } from "@/server/chat/types";

const entityIcons = {
  order: ClipboardCheck,
  client: Building2,
  object: MapPin,
  visit: CalendarClock,
  contract: FileSignature,
  document: FileText,
  task: ClipboardCheck,
  master: Wrench,
  website: Globe2,
} satisfies Record<ChatEntityType, typeof UserRound>;

const statusClasses: Record<ChatSharedEntity["statusTone"], string> = {
  neutral: "bg-[var(--surface-soft)] text-[var(--muted)]",
  accent: "bg-[var(--accent-soft)] text-[var(--accent-ink)]",
  success: "bg-[var(--success-bg)] text-[var(--success)]",
  warning: "bg-[var(--warning-bg)] text-[var(--warning)]",
  danger: "bg-[var(--danger-bg)] text-[var(--danger-ink)]",
};

export function ChatEntityIcon({ type, className = "size-4" }: { type: ChatEntityType; className?: string }) {
  const Icon = entityIcons[type];
  return <Icon className={className} aria-hidden="true" />;
}

export function ChatSharedEntityCard({ entity, mine = false }: { entity: ChatSharedEntity; mine?: boolean }) {
  return (
    <Link
      href={entity.href}
      className="focus-ring mt-2 block min-w-0 rounded-[13px] border border-[var(--line)] bg-[var(--surface-raised)] p-3 text-left text-[var(--text)] shadow-sm transition-colors hover:border-[var(--accent)]/45 hover:bg-[var(--surface)]"
      aria-label={`Открыть: ${entity.title}${mine ? ". Отправлено вами" : ""}`}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-[var(--accent-soft)] text-[var(--accent-ink)]">
          <ChatEntityIcon type={entity.type} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">{entity.typeLabel}</span>
            <span className={`rounded-full px-2 py-1 text-[9px] font-medium ${statusClasses[entity.statusTone]}`}>{entity.statusLabel}</span>
          </span>
          <span className="mt-2 block truncate text-xs font-semibold">{entity.title}</span>
          <span className="mt-1 block truncate text-[10px] text-[var(--text-secondary)]">{entity.subtitle}</span>
        </span>
      </div>
      {entity.meta.length ? (
        <span className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-[var(--line)] pt-2.5">
          {entity.meta.map((value) => <span key={value} className="truncate text-[9px] text-[var(--muted)]">{value}</span>)}
        </span>
      ) : null}
    </Link>
  );
}
