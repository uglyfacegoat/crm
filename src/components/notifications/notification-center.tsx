"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { NotificationItem, NotificationSnapshot } from "@/lib/notifications";
import { fetchNotifications, markAllNotificationsRead, markNotificationRead } from "@/lib/notifications-client";
import { useDismissableLayer } from "@/components/ui/use-dismissable-layer";
import { NotificationListItem } from "./notification-item";

const POLL_INTERVAL_MS = 60_000;

export function NotificationCenter() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<NotificationSnapshot | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useDismissableLayer(menuRef, open, () => setOpen(false));

  async function load() {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const nextSnapshot = await fetchNotifications({ limit: 8, signal: controller.signal });
      if (requestRef.current !== controller) return;
      setSnapshot(nextSnapshot);
      setStatus("ready");
    } catch {
      if (controller.signal.aborted || requestRef.current !== controller) return;
      setStatus("error");
    }
  }

  useEffect(() => {
    const initialRequest = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_INTERVAL_MS);
    const handleFocus = () => void load();
    window.addEventListener("focus", handleFocus);
    return () => {
      requestRef.current?.abort();
      window.clearTimeout(initialRequest);
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const openRequest = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(openRequest);
  }, [open]);

  async function openNotification(notification: NotificationItem) {
    setPendingId(notification.id);
    try {
      if (notification.readAt === null) await markNotificationRead(notification.id);
      setSnapshot((current) => current ? {
        ...current,
        unreadCount: Math.max(0, current.unreadCount - (notification.readAt === null ? 1 : 0)),
        criticalUnreadCount: Math.max(0, current.criticalUnreadCount - (notification.readAt === null && notification.severity === "critical" ? 1 : 0)),
        items: current.items.map((item) => item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item),
      } : current);
      setOpen(false);
      router.push(notification.href);
    } catch {
      setStatus("error");
    } finally {
      setPendingId(null);
    }
  }

  async function markAll() {
    if (!snapshot?.unreadCount) return;
    setPendingId("all");
    try {
      await markAllNotificationsRead();
      const readAt = new Date().toISOString();
      setSnapshot((current) => current ? { ...current, unreadCount: 0, criticalUnreadCount: 0, items: current.items.map((item) => ({ ...item, readAt: item.readAt ?? readAt })) } : current);
    } catch {
      setStatus("error");
    } finally {
      setPendingId(null);
    }
  }

  const unreadCount = snapshot?.unreadCount ?? 0;
  return (
    <div ref={menuRef} className="relative">
      <button onClick={() => setOpen((current) => !current)} className="focus-ring soft-button relative grid size-10 place-items-center rounded-[13px] text-[var(--muted)]" aria-label={unreadCount ? `Уведомления: ${unreadCount} непрочитанных` : "Уведомления"} aria-expanded={open}>
        <Bell className="size-[18px]" />
        {unreadCount ? <span className={`absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full px-1 text-[9px] font-bold leading-5 text-[var(--on-accent)] ring-2 ring-[var(--surface-raised)] ${snapshot?.criticalUnreadCount ? "bg-[var(--danger)]" : "bg-[var(--accent)]"}`}>{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
      </button>
      {open ? (
        <div className="surface-panel fixed inset-x-2 top-[4.5rem] z-50 max-h-[calc(100dvh-5.5rem)] overflow-hidden bg-[var(--surface-raised)] shadow-[0_26px_80px_rgba(0,0,0,0.24)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-[24rem]">
          <header className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3">
            <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-[var(--text)]">Оперативная лента</p><p className="mt-0.5 text-[9px] uppercase tracking-[0.13em] text-[var(--muted)]">Выезды · задачи · документы</p></div>
            {unreadCount ? <button type="button" disabled={pendingId !== null} onClick={markAll} aria-label="Отметить все уведомления прочитанными" title="Прочитать всё" className="focus-ring grid size-9 place-items-center rounded-full text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)] disabled:opacity-45">{pendingId === "all" ? <LoaderCircle className="size-4 animate-spin" /> : <CheckCheck className="size-4" />}</button> : null}
            <button onClick={() => setOpen(false)} className="focus-ring grid size-9 place-items-center rounded-full text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]" aria-label="Закрыть уведомления"><X className="size-4" /></button>
          </header>
          <div className="max-h-[calc(100dvh-12rem)] overflow-y-auto p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {status === "loading" && !snapshot ? <div className="flex min-h-52 items-center justify-center gap-2 text-xs text-[var(--muted)]"><LoaderCircle className="size-4 animate-spin text-[var(--accent)]" />Загружаю события…</div> : null}
            {status === "error" && !snapshot ? <div className="grid min-h-52 place-items-center px-6 text-center"><div><p className="text-sm text-[var(--text-secondary)]">Лента временно недоступна</p><button type="button" onClick={() => { setStatus("loading"); void load(); }} className="focus-ring mt-4 inline-flex items-center gap-2 rounded-[11px] border border-[var(--line-strong)] px-3 py-2 text-xs text-[var(--text)]"><RefreshCw className="size-3.5" />Повторить</button></div></div> : null}
            {snapshot && snapshot.items.length ? snapshot.items.map((notification) => <NotificationListItem key={notification.id} notification={notification} compact pending={pendingId === notification.id} onOpen={openNotification} />) : null}
            {snapshot && !snapshot.items.length ? <div className="grid min-h-52 place-items-center px-6 text-center"><div><span className="mx-auto grid size-10 place-items-center rounded-full border border-[var(--line)] bg-[var(--surface)] text-[var(--muted)]"><CheckCheck className="size-4" /></span><p className="mt-3 text-sm text-[var(--text-secondary)]">Всё спокойно</p><p className="mt-1 text-xs leading-5 text-[var(--muted)]">Новых оперативных событий нет.</p></div></div> : null}
          </div>
          <footer className="border-t border-[var(--line)] p-2"><Link href="/notifications" onClick={() => setOpen(false)} className="focus-ring flex min-h-10 items-center justify-center rounded-[11px] text-xs font-medium text-[var(--accent-ink)] hover:bg-[var(--accent-soft)]">Открыть центр уведомлений</Link></footer>
        </div>
      ) : null}
    </div>
  );
}
