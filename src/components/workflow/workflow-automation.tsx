"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { enableWorkflowAutomationAction, findWorkflowResourcesAction,
  previewWorkflowAutomationAction, stopWorkflowAutomationAction } from "@/app/(workspace)/workflow/actions";
import type { WorkflowAutomationPreview, WorkflowAutomationState } from "@/server/workflow/automation-repository";
import type { WorkflowResourceOption } from "@/server/workflow/context-repository";

const statusLabels = { pending: "ожидает", running: "выполняется", succeeded: "выполнено",
  failed: "ошибка", stopped: "остановлено" } as const;

export function WorkflowAutomation({ mapId, publishedVersion, canPreview, canStop, state }: {
  mapId: string;
  publishedVersion: number | null;
  canPreview: boolean;
  canStop: boolean;
  state: WorkflowAutomationState;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<WorkflowResourceOption[]>([]);
  const [orderId, setOrderId] = useState("");
  const [result, setResult] = useState<WorkflowAutomationPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function search() {
    startTransition(async () => {
      setResult(null);
      setOrderId("");
      const response = await findWorkflowResourcesAction({ mapId, kind: "order", query });
      if (response.status === "error") { setError(response.message); setOptions([]); }
      else { setError(null); setOptions(response.options); }
    });
  }

  function preview() {
    if (!orderId) return;
    startTransition(async () => {
      const response = await previewWorkflowAutomationAction({ mapId, orderId });
      if (response.status === "error") { setResult(null); setError(response.message); }
      else { setResult(response.preview); setError(null); router.refresh(); }
    });
  }

  function changeActivation(enabled: boolean) {
    if (!publishedVersion && enabled) return;
    startTransition(async () => {
      const response = enabled
        ? await enableWorkflowAutomationAction({ mapId, expectedPublishedVersion: publishedVersion! })
        : await stopWorkflowAutomationAction({ mapId });
      if (response.status === "error") { setError(response.message); setMessage(null); }
      else { setError(null); setMessage(response.message); router.refresh(); }
    });
  }

  return <div className="mt-6 border-t border-[var(--line)] pt-4 text-xs text-[var(--text-secondary)]">
    <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">Автоматизация</h3>
    <p className="mt-2 leading-5">Поддерживается один сценарий: создание заказа → 1–5 связанных задач. Пробный запуск показывает план без создания задач.</p>
    <p className="mt-2 leading-5">{state.activeVersion ? `Включена версия ${state.activeVersion}.` : "Автоматический запуск выключен."}
      {state.activeVersion && publishedVersion && state.activeVersion !== publishedVersion && ` Опубликована новая версия ${publishedVersion}; для неё нужен новый пробный запуск.`}</p>
    {!publishedVersion && <p className="mt-2 text-[var(--muted)]">Сначала опубликуйте карту.</p>}
    {publishedVersion && canPreview && <div className="mt-3 grid gap-2">
      <div className="flex gap-2"><input aria-label="Поиск заказа для пробного запуска" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={100}
        placeholder="Номер заказа" className="focus-ring h-10 min-w-0 flex-1 rounded-[9px] border border-[var(--line)] bg-[var(--surface)] px-2" />
        <button type="button" onClick={search} disabled={pending} className="focus-ring min-h-10 rounded-[9px] border border-[var(--line)] px-3 disabled:opacity-50">Найти</button></div>
      {options.length > 0 && <select aria-label="Заказ для пробного запуска" value={orderId} onChange={(event) => { setOrderId(event.target.value); setResult(null); }}
        className="focus-ring h-10 w-full rounded-[9px] border border-[var(--line)] bg-[var(--surface)] px-2">
        <option value="">Выберите заказ</option>{options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>}
      <button type="button" onClick={preview} disabled={pending || !orderId} className="focus-ring min-h-10 rounded-[9px] bg-[var(--accent)] px-3 text-[var(--on-accent)] disabled:opacity-50">Пробный запуск</button>
    </div>}
    {error && <p role="alert" className="mt-2 text-[var(--danger)]">{error}</p>}
    {result && <div role="status" className="mt-3 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-3 leading-5">
      <strong className="text-[var(--text)]">План для заказа {result.orderNumber} · версия {result.mapVersion}</strong>
      <ol className="mt-2 list-inside list-decimal">{result.tasks.map((task) => <li key={task.nodeId}>{task.title} · {task.priority}{task.assignedMemberId ? " · с исполнителем" : " · без исполнителя"}</li>)}</ol>
      <p className="mt-2 text-[var(--muted)]">Задачи этим пробным запуском не созданы.</p>
    </div>}
    {publishedVersion && canPreview && state.activeVersion !== publishedVersion && <button type="button"
      onClick={() => changeActivation(true)} disabled={pending || !(state.trialReady || result?.mapVersion === publishedVersion)}
      className="focus-ring mt-3 min-h-10 w-full rounded-[9px] border border-[var(--success)]/50 bg-[var(--success-bg)] px-3 text-[var(--text)] disabled:opacity-50">
      {state.activeVersion ? `Включить версию ${publishedVersion}` : "Включить для новых заказов"}
    </button>}
    {state.activeVersion && canStop && <button type="button" onClick={() => changeActivation(false)} disabled={pending}
      className="focus-ring mt-2 min-h-10 w-full rounded-[9px] border border-[var(--danger)]/40 px-3 text-[var(--danger)] disabled:opacity-50">Остановить автоматизацию</button>}
    {state.activeVersion && <p className="mt-2 text-[10px] leading-4 text-[var(--muted)]">Остановка отменяет ожидающие события. Действие, уже завершившееся до остановки, не откатывается.</p>}
    {message && <p role="status" className="mt-2 text-[var(--success)]">{message}</p>}
    {state.jobs.length > 0 && <div className="mt-4 border-t border-[var(--line)] pt-3">
      <h4 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">Последние запуски</h4>
      <ul className="mt-2 grid gap-1">{state.jobs.map((job) => <li key={job.id} className="rounded-[8px] border border-[var(--line)] p-2">
        {job.orderNumber} · версия {job.version} · {statusLabels[job.status]}
        {job.status === "failed" && <span className="block text-[var(--danger)]">Код: {job.errorCode ?? "WORKFLOW_EXECUTION_FAILED"}</span>}
      </li>)}</ul>
    </div>}
  </div>;
}
