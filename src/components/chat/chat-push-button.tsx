"use client";

import { Bell, BellOff, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Status = "loading" | "unsupported" | "off" | "on" | "denied" | "busy" | "error";
type Kind = "chat" | "events";
type Settings = {
  publicKey: string;
  subscriptions: Array<{ endpoint: string; chatEnabled: boolean; eventsEnabled: boolean }>;
};

const routes: Record<Kind, string> = {
  chat: "/api/v1/chat/push",
  events: "/api/v1/notifications/push",
};

async function pushRequest(kind: Kind, method: "POST" | "DELETE", subscription: PushSubscription) {
  const response = await fetch(routes[kind], {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(method === "POST" ? subscription.toJSON() : { endpoint: subscription.endpoint }),
  });
  if (!response.ok) throw new Error("Не удалось сохранить настройки уведомлений.");
}

function PushPreferenceButton({ kind, settings = false }: { kind: Kind; settings?: boolean }) {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const publicKey = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (active) setStatus("unsupported");
        return;
      }
      try {
        const response = await fetch(routes[kind], { cache: "no-store" });
        if (!response.ok) throw new Error("Уведомления пока недоступны.");
        const data: Settings = await response.json();
        publicKey.current = data.publicKey;
        const registration = await navigator.serviceWorker.register("/push-sw.js", { scope: "/" });
        const existing = await registration.pushManager.getSubscription();
        const preference = data.subscriptions.find((item) => item.endpoint === existing?.endpoint);
        const enabled = kind === "chat" ? preference?.chatEnabled : preference?.eventsEnabled;
        if (active) setStatus(Notification.permission === "denied" ? "denied" : existing && enabled ? "on" : "off");
      } catch {
        if (active) { setStatus("error"); setError("Не удалось подключить уведомления."); }
      }
    }
    void load();
    return () => { active = false; };
  }, [kind]);

  async function toggle() {
    if (status === "loading" || status === "busy" || status === "unsupported" || status === "error") return;
    if (status === "denied") {
      setError("Разрешите уведомления для этого сайта в настройках браузера.");
      return;
    }
    if (status === "on") {
      setStatus("busy");
      setError(null);
      try {
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        if (existing) await pushRequest(kind, "DELETE", existing);
        setStatus("off");
      } catch {
        setStatus("error");
        setError("Не получилось выключить уведомления. Обновите страницу.");
      }
      return;
    }
    // Permission must be requested before the first await so mobile browsers retain the user gesture.
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setStatus("denied");
      setError("Разрешите уведомления для этого сайта в настройках браузера.");
      return;
    }
    setStatus("busy");
    setError(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      if (!publicKey.current) throw new Error("Нет ключа уведомлений.");
      const subscription = existing ?? await registration.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: publicKey.current,
      });
      try { await pushRequest(kind, "POST", subscription); }
      catch (error) { if (!existing) await subscription.unsubscribe(); throw error; }
      setStatus("on");
    } catch {
      setStatus("error");
      setError("Не получилось включить уведомления. Попробуйте ещё раз.");
    }
  }

  const enabled = status === "on";
  const subject = kind === "chat" ? "сообщениях" : "событиях CRM";
  const label = status === "unsupported" ? "Этот браузер не поддерживает push-уведомления"
    : status === "error" ? "Уведомления недоступны. Обновите страницу."
    : status === "denied" ? "Уведомления запрещены в браузере"
    : enabled ? `Выключить уведомления о ${subject}` : `Включить уведомления о ${subject}`;
  return <div className="relative shrink-0">
    <button type="button" onClick={() => void toggle()} disabled={status === "loading" || status === "busy" || status === "unsupported" || status === "error"}
      aria-label={label} title={label} aria-pressed={enabled}
      className={`focus-ring flex shrink-0 items-center gap-1.5 rounded-[11px] border px-2.5 text-[10px] font-medium transition-colors disabled:opacity-45 ${settings ? "min-h-11 min-w-28 justify-center px-3 text-xs" : kind === "chat" ? "size-9 justify-center px-0 xl:h-9 xl:w-auto xl:px-2.5" : "min-h-9"} ${enabled ? "border-[var(--accent)]/40 bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "border-[var(--line)] text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"}`}>
      {status === "loading" || status === "busy" ? <LoaderCircle className="size-4 animate-spin" /> : enabled ? <Bell className="size-4" /> : <BellOff className="size-4" />}
      {settings ? <span>{status === "loading" || status === "busy" ? "Проверяем…" : enabled ? "Выключить" : "Включить"}</span>
        : kind === "events" ? <span>{enabled ? "События включены" : "События на устройстве"}</span> : <span className="hidden xl:inline">{enabled ? "Уведомления включены" : "Уведомления"}</span>}
    </button>
    {error ? <div role="status" className="absolute right-0 top-11 z-20 w-56 rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] p-3 text-xs text-[var(--text)] shadow-lg">{error}</div> : null}
  </div>;
}

export function PushSettingsPanel({ preview, canChat, canEvents }: { preview: boolean; canChat: boolean; canEvents: boolean }) {
  return <section className="surface-panel p-5 sm:p-7">
    <h2 className="font-display text-xl font-semibold text-[var(--text)]">Уведомления на этом устройстве</h2>
    <p className="mt-2 text-xs leading-5 text-[var(--muted)]">Чат и события CRM настраиваются отдельно. Выбор сохранится после повторного входа на этом устройстве.</p>
    <div className="mt-5 grid gap-3">
      {([
        { kind: "chat" as const, title: "Сообщения чата", description: "Личные сообщения и рабочие группы", allowed: canChat },
        { kind: "events" as const, title: "События CRM", description: "Задачи, выезды, договоры и документы", allowed: canEvents },
      ]).map((item) => <div key={item.kind} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-inset)] p-4">
        <div><h3 className="text-sm font-semibold text-[var(--text)]">{item.title}</h3><p className="mt-1 text-xs text-[var(--muted)]">{item.description}</p></div>
        {preview || !item.allowed ? <span className="text-xs text-[var(--muted)]">{preview ? "Недоступно в демо" : "Недоступно по роли"}</span> : <PushPreferenceButton kind={item.kind} settings />}
      </div>)}
    </div>
    <p className="mt-4 text-xs leading-5 text-[var(--muted)]">При первом включении разрешите уведомления в браузере или установленном приложении. После выхода push приостановятся до следующего входа.</p>
  </section>;
}
