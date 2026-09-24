"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Clock3, GitCompareArrows, RotateCcw, Send, Upload, X } from "lucide-react";
import {
  approveWorkflowReviewAction, getWorkflowRevisionAction, publishWorkflowRevisionAction,
  rejectWorkflowReviewAction, requestWorkflowReviewAction, restoreWorkflowRevisionAction,
} from "@/app/(workspace)/workflow/actions";
import type { WorkflowMap, WorkflowRevisionSummary } from "@/server/workflow/repository";
import type { WorkflowRevision } from "@/server/workflow/versions-repository";
import type { WorkflowDraft } from "@/server/workflow/schemas";

const kindLabels: Record<WorkflowRevisionSummary["changeKind"], string> = {
  created: "Создана", saved: "Сохранена", restored: "Восстановлена",
  archived: "Архивирована", baseline: "Исходный снимок",
};

function changedItems<T extends { id: string }>(before: T[], after: T[]) {
  const oldById = new Map(before.map((item) => [item.id, item]));
  const nextById = new Map(after.map((item) => [item.id, item]));
  return {
    added: after.filter((item) => !oldById.has(item.id)).length,
    removed: before.filter((item) => !nextById.has(item.id)).length,
    changed: after.filter((item) => oldById.has(item.id) && JSON.stringify(oldById.get(item.id)) !== JSON.stringify(item)).length,
  };
}

export function WorkflowLifecycle({ map, currentVersion, currentTitle, currentDescription, currentDraft,
  revisions, canWrite, canReview, canPublish, currentMemberId, dirty }: {
  map: WorkflowMap;
  currentVersion: number;
  currentTitle: string;
  currentDescription: string;
  currentDraft: WorkflowDraft;
  revisions: WorkflowRevisionSummary[];
  canWrite: boolean;
  canReview: boolean;
  canPublish: boolean;
  currentMemberId: string;
  dirty: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const [comparison, setComparison] = useState<WorkflowRevision | null>(null);
  const [restoreVersion, setRestoreVersion] = useState<number | null>(null);
  const isReviewPending = map.reviewVersion === currentVersion && map.approvedVersion !== currentVersion;
  const isApproved = map.approvedVersion === currentVersion;
  const isPublished = map.publishedVersion === currentVersion;

  function perform(operation: "request" | "approve" | "reject" | "publish" | "restore", sourceVersion?: number) {
    startTransition(async () => {
      const input = { id: map.id, expectedVersion: currentVersion };
      const result = operation === "request" ? await requestWorkflowReviewAction(input)
        : operation === "approve" ? await approveWorkflowReviewAction(input)
        : operation === "reject" ? await rejectWorkflowReviewAction({ ...input, reason })
        : operation === "publish" ? await publishWorkflowRevisionAction(input)
        : await restoreWorkflowRevisionAction({ ...input, sourceVersion: sourceVersion! });
      setFeedback({ error: result.status === "error", message: result.message });
      if (result.status === "success") {
        setReason("");
        setRestoreVersion(null);
        if (operation === "restore") window.location.reload();
        else router.refresh();
      }
    });
  }

  function compare(version: number) {
    startTransition(async () => {
      const result = await getWorkflowRevisionAction({ id: map.id, version });
      if (result.status === "error") {
        setFeedback({ error: true, message: result.message });
        return;
      }
      setComparison(result.revision);
      setFeedback(null);
    });
  }

  const nodeChanges = comparison ? changedItems(comparison.draft.nodes, currentDraft.nodes) : null;
  const edgeChanges = comparison ? changedItems(comparison.draft.edges, currentDraft.edges) : null;

  return <div className="mt-6 border-t border-[var(--line)] pt-4">
    <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">Согласование и публикация</h3>
    <div className="mt-3 rounded-[11px] border border-[var(--line)] bg-[var(--surface)] p-3 text-xs leading-5 text-[var(--text-secondary)]">
      {isPublished ? `Версия ${currentVersion} опубликована.`
        : isApproved ? `Версия ${currentVersion} согласована и ожидает публикации.`
        : isReviewPending ? `Версия ${currentVersion} ожидает согласования.`
        : "Черновик не отправлен на согласование."}
      {map.publishedVersion && !isPublished && <span className="mt-1 block text-[var(--muted)]">Действует опубликованная версия {map.publishedVersion}; правки черновика её не меняют.</span>}
    </div>
    {map.publishedVersion && <button type="button" onClick={() => compare(map.publishedVersion!)} disabled={pending}
      className="focus-ring mt-2 min-h-8 text-left text-[10px] text-[var(--accent-ink)] disabled:opacity-50">Посмотреть опубликованную версию {map.publishedVersion}</button>}
    {dirty && <p className="mt-2 text-[10px] leading-4 text-[var(--warning)]">Сначала сохраните изменения черновика.</p>}
    {canWrite && !isReviewPending && !isApproved && !isPublished && <button type="button" onClick={() => perform("request")} disabled={pending || dirty}
      className="focus-ring mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-[10px] border border-[var(--line)] text-xs disabled:opacity-50"><Send className="size-3.5" />Отправить на согласование</button>}
    {isReviewPending && canReview && map.reviewRequestedBy !== currentMemberId && <div className="mt-3 grid gap-2">
      <button type="button" onClick={() => perform("approve")} disabled={pending || dirty} className="focus-ring flex min-h-10 items-center justify-center gap-2 rounded-[10px] bg-[var(--accent)] text-xs text-[var(--on-accent)] disabled:opacity-50"><Check className="size-3.5" />Согласовать версию</button>
      <label className="grid gap-1 text-[10px] text-[var(--muted)]">Причина возврата<input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="Что нужно исправить" className="focus-ring h-10 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-3 text-xs" /></label>
      <button type="button" onClick={() => perform("reject")} disabled={pending || dirty || reason.trim().length < 2} className="focus-ring flex min-h-10 items-center justify-center gap-2 rounded-[10px] border border-[var(--line)] text-xs disabled:opacity-50"><X className="size-3.5" />Вернуть на доработку</button>
    </div>}
    {isReviewPending && map.reviewRequestedBy === currentMemberId && <p className="mt-2 text-[10px] leading-4 text-[var(--muted)]">Согласовать должен другой сотрудник с правом проверки.</p>}
    {isApproved && !isPublished && canPublish && <button type="button" onClick={() => perform("publish")} disabled={pending || dirty} className="focus-ring mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-[10px] bg-[var(--accent)] text-xs text-[var(--on-accent)] disabled:opacity-50"><Upload className="size-3.5" />Опубликовать версию</button>}
    {feedback && <p role={feedback.error ? "alert" : "status"} className={`mt-3 rounded-[10px] border p-2 text-xs leading-5 ${feedback.error ? "border-[var(--danger)]/40 text-[var(--danger)]" : "border-[var(--success)]/40 text-[var(--success)]"}`}>{feedback.message}</p>}

    <h3 className="mt-6 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]"><Clock3 className="size-3.5" />История версий</h3>
    <div className="mt-3 grid max-h-72 gap-2 overflow-auto">
      {revisions.map((revision) => <div key={revision.version} data-testid={`workflow-revision-${revision.version}`} className="rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-3">
        <div className="flex items-center justify-between gap-2 text-xs font-medium text-[var(--text)]"><span>Версия {revision.version}</span>{map.publishedVersion === revision.version && <span className="text-[10px] text-[var(--success)]">Опубликована</span>}</div>
        <p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">{kindLabels[revision.changeKind]} · {revision.savedByName}<br />{new Date(revision.savedAt).toLocaleString("ru-RU")}</p>
        {revision.sourceVersion && <p className="mt-1 text-[10px] text-[var(--muted)]">Из версии {revision.sourceVersion}</p>}
        <div className="mt-2 flex flex-wrap gap-3"><button type="button" onClick={() => compare(revision.version)} disabled={pending} className="focus-ring inline-flex min-h-8 items-center gap-1 text-[10px] text-[var(--accent-ink)] disabled:opacity-50"><GitCompareArrows className="size-3" />Сравнить</button>
          {canWrite && revision.version !== currentVersion && <button type="button" onClick={() => setRestoreVersion(revision.version)} disabled={pending || dirty} className="focus-ring inline-flex min-h-8 items-center gap-1 text-[10px] text-[var(--text-secondary)] disabled:opacity-50"><RotateCcw className="size-3" />Восстановить</button>}</div>
      </div>)}
    </div>
    {restoreVersion !== null && <div className="mt-3 rounded-[10px] border border-[var(--warning)]/40 bg-[var(--warning-bg)] p-3 text-xs leading-5 text-[var(--text-secondary)]">
      Версия {restoreVersion} станет новым черновиком. Опубликованная версия останется прежней.
      <div className="mt-2 flex gap-2"><button type="button" onClick={() => perform("restore", restoreVersion)} disabled={pending || dirty} className="focus-ring min-h-9 rounded-[9px] bg-[var(--accent)] px-3 text-[var(--on-accent)] disabled:opacity-50">Подтвердить</button><button type="button" onClick={() => setRestoreVersion(null)} className="focus-ring min-h-9 px-2">Отмена</button></div>
    </div>}
    {comparison && <div className="mt-3 rounded-[11px] border border-[var(--line)] bg-[var(--surface-inset)] p-3 text-[10px] leading-5 text-[var(--text-secondary)]">
      <div className="flex items-center justify-between gap-2"><strong className="text-xs text-[var(--text)]">Версия {comparison.version} ↔ черновик {currentVersion}</strong><button type="button" aria-label="Закрыть сравнение" onClick={() => setComparison(null)}><X className="size-3.5" /></button></div>
      {dirty && <p className="mt-1 text-[var(--warning)]">Сравнение включает несохранённые правки.</p>}
      <p className="mt-2">Название: {comparison.title === currentTitle ? "без изменений" : `${comparison.title} → ${currentTitle}`}</p>
      <p>Описание: {comparison.description === currentDescription ? "без изменений" : "изменено"}</p>
      <p>Блоки: +{nodeChanges?.added} / −{nodeChanges?.removed} / изменено {nodeChanges?.changed}</p>
      <p>Связи: +{edgeChanges?.added} / −{edgeChanges?.removed} / изменено {edgeChanges?.changed}</p>
      <div className="mt-2 border-t border-[var(--line)] pt-2"><p className="font-medium text-[var(--text)]">Содержимое версии {comparison.version}</p>
        <p className="mt-1">{comparison.title}{comparison.description ? ` · ${comparison.description}` : ""}</p>
        <ol className="mt-2 list-inside list-decimal">{comparison.draft.nodes.map((node) => <li key={node.id}>{node.title}{node.description ? ` — ${node.description}` : ""}</li>)}</ol>
        {comparison.draft.nodes.length === 0 && <p className="mt-1 text-[var(--muted)]">Блоков нет.</p>}
        {comparison.draft.edges.map((edge) => <p key={edge.id} className="mt-1">{comparison.draft.nodes.find((node) => node.id === edge.sourceId)?.title} → {comparison.draft.nodes.find((node) => node.id === edge.targetId)?.title}{edge.label ? ` · ${edge.label}` : ""}</p>)}
      </div>
    </div>}
  </div>;
}
