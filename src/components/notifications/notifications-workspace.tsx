"use client";

import { useRouter } from "next/navigation";
import { CheckCheck, LoaderCircle, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import type { NotificationItem, NotificationSnapshot } from "@/lib/notifications";
import { fetchNotifications, markAllNotificationsRead, markNotificationRead } from "@/lib/notifications-client";
import { NotificationListItem } from "./notification-item";

type Filter = "all" | "unread" | "critical";

export function NotificationsWorkspace({ initialSnapshot }: { initialSnapshot: NotificationSnapshot }) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [filter, setFilter] = useState<Filter>("all");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const filteredItems = useMemo(() => snapshot.items.filter((item) => {
    if (filter === "unread") return item.readAt === null;
    if (filter === "critical") return item.severity === "critical";
    return true;
  }), [filter, snapshot.items]);


  async function refresh() {
    setRefreshing(true);
    setErrorMessage(null);
    try {
      setSnapshot(await fetchNotifications({ limit: 100 }));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось обновить ленту.");
    } finally {
      setRefreshing(false);
    }
  }

  async function openNotification(notification: NotificationItem) {
    setPendingId(notification.id);
    setErrorMessage(null);
    try {
      if (notification.readAt === null) await markNotificationRead(notification.id);
      const readAt = notification.readAt ?? new Date().toISOString();
      setSnapshot((current) => ({
        ...current,
        unreadCount: Math.max(0, current.unreadCount - (notification.readAt === null ? 1 : 0)),
        criticalUnreadCount: Math.max(0, current.criticalUnreadCount - (notification.readAt === null && notification.severity === "critical" ? 1 : 0)),
        items: current.items.map((item) => item.id === notification.id ? { ...item, readAt } : item),
      }));
      router.push(notification.href);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось открыть событие.");
    } finally {
      setPendingId(null);
    }
  }

  async function markAll() {
    if (!snapshot.unreadCount) return;
    setPendingId("all");
    setErrorMessage(null);
    try {
      await markAllNotificationsRead();
      const readAt = new Date().toISOString();
      setSnapshot((current) => ({ ...current, unreadCount: 0, criticalUnreadCount: 0, items: current.items.map((item) => ({ ...item, readAt: item.readAt ?? readAt })) }));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось обновить ленту.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="mt-[clamp(1.5rem,1.1rem+0.8vw,2.25rem)]">
      <section className="surface-panel overflow-hidden">
        <header className="flex flex-col gap-3 border-b border-white/[0.07] p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
          <div className="flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {([
              ["all", "Все", snapshot.items.length],
              ["unread", "Непрочитанные", snapshot.unreadCount],
              ["critical", "Критичные", snapshot.items.filter((item) => item.severity === "critical").length],
            ] as const).map(([value, label, count]) => <button key={value} type="button" onClick={() => setFilter(value)} className={`focus-ring flex min-h-10 shrink-0 items-center gap-2 rounded-[11px] px-3 text-xs transition-colors ${filter === value ? "bg-[var(--accent)] text-[#25272c]" : "text-[#838d92] hover:bg-white/[0.04] hover:text-white"}`}>{label}<span className={`rounded-full px-1.5 py-0.5 text-[9px] ${filter === value ? "bg-black/10" : "bg-white/[0.05]"}`}>{count}</span></button>)}
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" disabled={refreshing} onClick={refresh} className="focus-ring soft-button grid size-10 place-items-center rounded-[11px] text-[#838d92] hover:text-white disabled:opacity-45" aria-label="Обновить уведомления">{refreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}</button>
            <button type="button" disabled={!snapshot.unreadCount || pendingId !== null} onClick={markAll} className="focus-ring flex min-h-10 items-center gap-2 rounded-[11px] border border-white/[0.08] px-3 text-xs text-[#adb5b8] hover:bg-white/[0.04] hover:text-white disabled:cursor-not-allowed disabled:opacity-40">{pendingId === "all" ? <LoaderCircle className="size-4 animate-spin" /> : <CheckCheck className="size-4" />}Прочитать всё</button>
          </div>
        </header>
        {errorMessage ? <div role="alert" className="border-b border-[#ef646a]/15 bg-[#ef646a]/[0.045] px-4 py-3 text-xs text-[#e38b90]">{errorMessage}</div> : null}
        <div className="divide-y divide-white/[0.055]">
          {filteredItems.map((notification) => <NotificationListItem key={notification.id} notification={notification} pending={pendingId === notification.id} onOpen={openNotification} />)}
        </div>
        {!filteredItems.length ? <div className="grid min-h-72 place-items-center px-6 text-center"><div><span className="mx-auto grid size-12 place-items-center rounded-[15px] border border-white/[0.07] bg-white/[0.025] text-[#657078]"><CheckCheck className="size-5" /></span><p className="mt-4 text-sm font-medium text-[#b3babd]">Здесь всё разобрано</p><p className="mt-1 max-w-sm text-xs leading-5 text-[#626c72]">Система добавит сюда просроченные задачи, выезды без мастера, договоры и новые документы.</p></div></div> : null}
      </section>
      <p className="mt-3 text-[10px] leading-5 text-[#586269]">Лента обновляется фоновым процессом раз в минуту. Прочтение персональное: действия одного сотрудника не скрывают событие у остальных.</p>
    </div>
  );
}
