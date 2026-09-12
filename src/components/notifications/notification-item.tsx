"use client";

import { AlertTriangle, CalendarClock, ClipboardCheck, FileUp, FileWarning, UserRoundSearch } from "lucide-react";
import type { NotificationItem } from "@/lib/notifications";

const kindPresentation = {
  visit_upcoming: { icon: CalendarClock, label: "Выезд", tone: "border-[var(--support-strong)] bg-[var(--support-soft)] text-[var(--support-strong)]" },
  visit_unassigned: { icon: UserRoundSearch, label: "Назначение", tone: "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)]" },
  closing_act_overdue: { icon: FileWarning, label: "Документы", tone: "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-ink)]" },
  task_overdue: { icon: ClipboardCheck, label: "Задача", tone: "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-ink)]" },
  contract_renewal: { icon: AlertTriangle, label: "Договор", tone: "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)]" },
  document_uploaded: { icon: FileUp, label: "Файл", tone: "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-ink)]" },
} satisfies Record<NotificationItem["kind"], { icon: typeof CalendarClock; label: string; tone: string }>;

const relativeFormatter = new Intl.RelativeTimeFormat("ru", { numeric: "auto" });

function relativeTime(value: string) {
  const difference = new Date(value).getTime() - Date.now();
  const minutes = Math.round(difference / 60_000);
  if (Math.abs(minutes) < 60) return relativeFormatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relativeFormatter.format(hours, "hour");
  return relativeFormatter.format(Math.round(hours / 24), "day");
}

export function NotificationListItem({ notification, compact = false, pending = false, onOpen }: {
  notification: NotificationItem;
  compact?: boolean;
  pending?: boolean;
  onOpen: (notification: NotificationItem) => void;
}) {
  const presentation = kindPresentation[notification.kind];
  const Icon = presentation.icon;
  const unread = notification.readAt === null;
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => onOpen(notification)}
      className={`focus-ring group relative flex w-full items-start gap-3 rounded-[14px] text-left transition-colors hover:bg-[var(--surface-soft)] disabled:cursor-wait disabled:opacity-60 ${compact ? "px-3 py-3" : "px-4 py-4 sm:px-5"}`}
    >
      <span className={`grid shrink-0 place-items-center rounded-[11px] border ${presentation.tone} ${compact ? "size-9" : "size-10"}`}><Icon className="size-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-start gap-2">
          <span className={`min-w-0 flex-1 text-sm leading-5 ${unread ? "font-semibold text-[var(--text)]" : "font-medium text-[var(--text-secondary)]"}`}>{notification.title}</span>
          {unread ? <span className={`mt-1.5 size-2 shrink-0 rounded-full ${notification.severity === "critical" ? "bg-[var(--danger)]" : "bg-[var(--accent)]"}`} /> : null}
        </span>
        <span className={`mt-1 block whitespace-pre-line text-xs leading-5 text-[var(--muted)] ${compact ? "line-clamp-2" : ""}`}>{notification.body}</span>
        <span className="mt-2 flex items-center gap-2 text-[9px] uppercase tracking-[0.11em] text-[var(--muted-subtle)]"><span>{presentation.label}</span><span className="size-0.5 rounded-full bg-[var(--muted-subtle)]" /><time dateTime={notification.occurredAt}>{relativeTime(notification.occurredAt)}</time></span>
      </span>
    </button>
  );
}
