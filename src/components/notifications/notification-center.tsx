"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { NotificationItem, NotificationSnapshot } from "@/lib/notifications";
import { fetchNotifications, markAllNotificationsRead, markNotificationRead } from "@/lib/notifications-client";
import { NotificationListItem } from "./notification-item";

const POLL_INTERVAL_MS = 60_000;

export function NotificationCenter() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<NotificationSnapshot | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);

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
    <div className="relative">
      <button onClick={() => setOpen((current) => !current)} className="focus-ring soft-button relative grid size-10 place-items-center rounded-[13px] text-[#8b9499]" aria-label={unreadCount ? `Уведомления: ${unreadCount} непрочитанных` : "Уведомления"} aria-expanded={open}>
        <Bell className="size-[18px]" />
        {unreadCount ? <span className={`absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full px-1 text-[9px] font-bold leading-5 text-white ring-2 ring-[#0b0f12] ${snapshot?.criticalUnreadCount ? "bg-[var(--danger)]" : "bg-[#7f69cb]"}`}>{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
      </button>
      {open ? (
        <div className="surface-panel fixed inset-x-2 top-[4.5rem] z-50 max-h-[calc(100dvh-5.5rem)] overflow-hidden bg-[#10171b] shadow-[0_26px_80px_rgba(0,0,0,0.58)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-[24rem]">
          <header className="flex items-center gap-3 border-b border-white/[0.07] px-4 py-3">
            <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-white">Оперативная лента</p><p className="mt-0.5 text-[9px] uppercase tracking-[0.13em] text-[#5f696f]">Выезды · задачи · документы</p></div>
            {unreadCount ? <button type="button" disabled={pendingId !== null} onClick={markAll} aria-label="Отметить все уведомления прочитанными" title="Прочитать всё" className="focus-ring grid size-9 place-items-center rounded-[10px] text-[#7d878c] hover:bg-white/[0.045] hover:text-white disabled:opacity-45">{pendingId === "all" ? <LoaderCircle className="size-4 animate-spin" /> : <CheckCheck className="size-4" />}</button> : null}
            <button onClick={() => setOpen(false)} className="focus-ring grid size-9 place-items-center rounded-[10px] text-[#778087] hover:bg-white/[0.045] hover:text-white" aria-label="Закрыть уведомления"><X className="size-4" /></button>
          </header>
          <div className="max-h-[calc(100dvh-12rem)] overflow-y-auto p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {status === "loading" && !snapshot ? <div className="flex min-h-52 items-center justify-center gap-2 text-xs text-[#788288]"><LoaderCircle className="size-4 animate-spin text-[var(--accent)]" />Загружаю события…</div> : null}
            {status === "error" && !snapshot ? <div className="grid min-h-52 place-items-center px-6 text-center"><div><p className="text-sm text-[#c8ceca]">Лента временно недоступна</p><button type="button" onClick={() => { setStatus("loading"); void load(); }} className="focus-ring mt-4 inline-flex items-center gap-2 rounded-[11px] border border-white/[0.08] px-3 py-2 text-xs text-white"><RefreshCw className="size-3.5" />Повторить</button></div></div> : null}
            {snapshot && snapshot.items.length ? snapshot.items.map((notification) => <NotificationListItem key={notification.id} notification={notification} compact pending={pendingId === notification.id} onOpen={openNotification} />) : null}
            {snapshot && !snapshot.items.length ? <div className="grid min-h-52 place-items-center px-6 text-center"><div><span className="mx-auto grid size-10 place-items-center rounded-full border border-white/[0.07] bg-white/[0.025] text-[#657078]"><CheckCheck className="size-4" /></span><p className="mt-3 text-sm text-[#a4adb1]">Всё спокойно</p><p className="mt-1 text-xs leading-5 text-[#5f696f]">Новых оперативных событий нет.</p></div></div> : null}
          </div>
          <footer className="border-t border-white/[0.07] p-2"><Link href="/notifications" onClick={() => setOpen(false)} className="focus-ring flex min-h-10 items-center justify-center rounded-[11px] text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent)]/[0.045]">Открыть центр уведомлений</Link></footer>
        </div>
      ) : null}
    </div>
  );
}
