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
  const [loadingMore, setLoadingMore] = useState(false);
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

  async function loadMore() {
    const cursor = snapshot.nextCursor;
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setErrorMessage(null);
    try {
      const page = await fetchNotifications({ limit: 100, cursor });
      setSnapshot((current) => {
        if (current.nextCursor?.id !== cursor.id || current.nextCursor.occurredAt !== cursor.occurredAt) return current;
        const known = new Set(current.items.map((item) => item.id));
        return { ...page, items: [...current.items, ...page.items.filter((item) => !known.has(item.id))] };
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось загрузить старые уведомления.");
    } finally {
      setLoadingMore(false);
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
      <section className="surface-panel panel-stack overflow-hidden">
        <header className="flex flex-col gap-3 border-b border-[var(--line)] p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
          <div className="flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {([
              ["all", "Все", `${snapshot.items.length}${snapshot.nextCursor ? "+" : ""}`],
              ["unread", "Непрочитанные", snapshot.unreadCount],
              ["critical", "Критичные", `${snapshot.items.filter((item) => item.severity === "critical").length}${snapshot.nextCursor ? "+" : ""}`],
            ] as const).map(([value, label, count]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={`focus-ring flex min-h-10 shrink-0 items-center gap-2 rounded-[11px] px-3 text-xs transition-colors ${filter === value ? "bg-[var(--accent)] text-[var(--on-accent)]" : "text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"}`}>{label}<span className={`rounded-full px-1.5 py-0.5 text-[9px] ${filter === value ? "bg-white/15" : "bg-[var(--surface-soft)]"}`}>{count}</span></button>)}
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" disabled={refreshing || loadingMore} onClick={refresh} className="focus-ring soft-button grid size-10 place-items-center rounded-[11px] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-45" aria-label="Обновить уведомления">{refreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}</button>
            <button type="button" disabled={!snapshot.unreadCount || pendingId !== null} onClick={markAll} className="focus-ring flex min-h-10 items-center gap-2 rounded-[11px] border border-[var(--line)] px-3 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40">{pendingId === "all" ? <LoaderCircle className="size-4 animate-spin" /> : <CheckCheck className="size-4" />}Прочитать всё</button>
          </div>
        </header>
        {errorMessage ? <div role="alert" className="border-b border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-3 text-xs text-[var(--danger-ink)]">{errorMessage}</div> : null}
        <div className="divide-y divide-[var(--line)]">
          {filteredItems.map((notification) => <NotificationListItem key={notification.id} notification={notification} pending={pendingId === notification.id} onOpen={openNotification} />)}
        </div>
        {snapshot.nextCursor ? <div className="border-t border-[var(--line)] p-4 text-center"><button type="button" disabled={loadingMore || refreshing} onClick={loadMore} className="focus-ring soft-button min-h-10 rounded-[11px] px-5 text-xs disabled:opacity-50">{loadingMore ? "Загружаю…" : "Показать более старые уведомления"}</button></div> : null}
        {!filteredItems.length ? <div className="grid min-h-72 place-items-center px-6 text-center"><div><span className="mx-auto grid size-12 place-items-center rounded-[15px] border border-[var(--line)] bg-[var(--surface-inset)] text-[var(--muted)]"><CheckCheck className="size-5" /></span><p className="mt-4 text-sm font-medium text-[var(--text-secondary)]">{snapshot.nextCursor ? "В загруженной части совпадений нет" : "Здесь всё разобрано"}</p><p className="mt-1 max-w-sm text-xs leading-5 text-[var(--muted)]">{snapshot.nextCursor ? "Загрузите более старые уведомления, чтобы продолжить поиск." : "Система добавит сюда просроченные задачи, выезды без мастера, договоры и новые документы."}</p></div></div> : null}
      </section>
      <p className="mt-3 text-[10px] leading-5 text-[var(--muted)]">Лента обновляется фоновым процессом раз в минуту. Прочтение персональное: действия одного сотрудника не скрывают событие у остальных.</p>
    </div>
  );
}
