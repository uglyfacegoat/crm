"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Bell, BellOff, RefreshCw } from "lucide-react";
import { watchWorkflowMapAction } from "@/app/(workspace)/workflow/actions";
import type { WorkflowActivity } from "@/server/workflow/collaboration-repository";

export function WorkflowCollaboration({ mapId, watching, canWatch, activity }: {
  mapId: string;
  watching: boolean;
  canWatch: boolean;
  activity: WorkflowActivity[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState("");
  function toggle() {
    startTransition(async () => {
      const result = await watchWorkflowMapAction({ mapId, watching: !watching });
      setFeedback(result.message);
      if (result.status === "success") router.refresh();
    });
  }
  return <div className="mt-5 border-t border-[var(--line)] pt-4">
    <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">Совместная работа</h3>
    <p className="mt-2 text-[10px] leading-4 text-[var(--muted)]">Изменения карты появляются в ленте уведомлений у тех, кто за ней следит. Запрос на согласование приходит сотрудникам с правом проверки.</p>
    {canWatch && <button type="button" onClick={toggle} disabled={pending}
      className="focus-ring mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-[10px] border border-[var(--line)] text-xs disabled:opacity-50">
      {watching ? <BellOff className="size-3.5" /> : <Bell className="size-3.5" />}
      {watching ? "Не следить за картой" : "Следить за картой"}
    </button>}
    {feedback && <p role="status" className="mt-2 text-[10px] text-[var(--muted)]">{feedback}</p>}
    <div className="mt-5 flex items-center justify-between gap-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">Последние действия</h3>
      <button type="button" onClick={() => router.refresh()} aria-label="Проверить изменения карты"
        className="focus-ring grid size-8 place-items-center rounded-[8px] text-[var(--muted)] hover:bg-[var(--surface-soft)]"><RefreshCw className="size-3.5" /></button>
    </div>
    <div className="mt-2 grid gap-2">{activity.map((item) => <div key={item.id} className="border-l-2 border-[var(--line-strong)] pl-3 text-[10px] leading-4">
      <p className="font-medium text-[var(--text-secondary)]">{item.actorName} {item.label}</p>
      <time dateTime={item.createdAt} className="text-[var(--muted)]">{new Date(item.createdAt).toLocaleString("ru-RU")}</time>
    </div>)}{activity.length === 0 && <p className="text-[10px] text-[var(--muted)]">Действий пока нет.</p>}</div>
    {activity.length === 30 && <p className="mt-2 text-[10px] text-[var(--muted)]">Показаны последние 30 действий; полная история хранится в аудите.</p>}
  </div>;
}
