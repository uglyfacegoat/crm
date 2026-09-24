"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Archive, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, GitBranch, Link2, Plus, Save, Trash2 } from "lucide-react";
import { archiveWorkflowMapAction, createWorkflowMapAction, saveWorkflowMapAction } from "@/app/(workspace)/workflow/actions";
import { WorkflowLifecycle } from "./workflow-lifecycle";
import { WorkflowDiscussion, WorkflowNodeContext } from "./workflow-context";
import { WorkflowCollaboration } from "./workflow-collaboration";
import type { WorkflowMap, WorkflowMapSummary, WorkflowRevisionSummary } from "@/server/workflow/repository";
import type { WorkflowComment, WorkflowMemberOption } from "@/server/workflow/context-repository";
import type { WorkflowActivity } from "@/server/workflow/collaboration-repository";
import type { WorkflowDraft, WorkflowNode } from "@/server/workflow/schemas";

const blockKinds = [
  { kind: "event", label: "Событие", tone: "border-[var(--accent)]/35 bg-[var(--accent-soft)]" },
  { kind: "crm_card", label: "Карточка CRM", tone: "border-[var(--support)]/35 bg-[var(--support-soft)]" },
  { kind: "condition", label: "Условие", tone: "border-[var(--warning)]/35 bg-[var(--warning-bg)]" },
  { kind: "action", label: "Действие", tone: "border-[var(--success)]/35 bg-[var(--success-bg)]" },
  { kind: "note", label: "Заметка", tone: "border-[var(--line)] bg-[var(--surface)]" },
] as const;
const blockLabel = Object.fromEntries(blockKinds.map((item) => [item.kind, item.label]));
const blockTone = Object.fromEntries(blockKinds.map((item) => [item.kind, item.tone]));
const nodeWidth = 196;
const nodeHeight = 126;

export function WorkflowEditor({ maps, selected, revisions, comments, commentsHasMore, members, watching, activity, canWrite, canComment, canWatch, canReview, canPublish, currentMemberId, preview }: {
  maps: WorkflowMapSummary[];
  selected: WorkflowMap | null;
  revisions: WorkflowRevisionSummary[];
  comments: WorkflowComment[];
  commentsHasMore: boolean;
  members: WorkflowMemberOption[];
  watching: boolean;
  activity: WorkflowActivity[];
  canWrite: boolean;
  canComment: boolean;
  canWatch: boolean;
  canReview: boolean;
  canPublish: boolean;
  currentMemberId: string;
  preview: boolean;
}) {
  const router = useRouter();
  const canEdit = canWrite && (selected?.contextEditable ?? true);
  const [pending, startTransition] = useTransition();
  const [newTitle, setNewTitle] = useState("");
  const [title, setTitle] = useState(selected?.title ?? "");
  const [description, setDescription] = useState(selected?.description ?? "");
  const [draft, setDraft] = useState<WorkflowDraft>(selected?.draft ?? { nodes: [], edges: [] });
  const [version, setVersion] = useState(selected?.version ?? 1);
  const remoteVersionAvailable = selected !== null && selected.version > version;
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState("");
  const [edgeLabel, setEdgeLabel] = useState("");
  const [dirty, setDirty] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const currentNode = draft.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const canvasWidth = Math.max(1080, ...draft.nodes.map((node) => node.x + nodeWidth + 40));
  const canvasHeight = Math.max(620, ...draft.nodes.map((node) => node.y + nodeHeight + 40));

  function changeDraft(next: WorkflowDraft) {
    setDraft(next);
    setDirty(true);
    setFeedback(null);
  }

  function createMap() {
    const cleaned = newTitle.trim();
    if (cleaned.length < 2 || cleaned.length > 120) {
      setFeedback({ error: true, message: "Введите название от 2 до 120 символов." });
      return;
    }
    const id = crypto.randomUUID();
    startTransition(async () => {
      const result = await createWorkflowMapAction({ id, title: cleaned });
      setFeedback({ error: result.status === "error", message: result.message });
      if (result.status === "success") router.push(`/workflow?map=${id}`);
    });
  }

  function addNode(kind: WorkflowNode["kind"]) {
    const index = draft.nodes.length;
    const node: WorkflowNode = {
      id: crypto.randomUUID(), kind, title: `Новый блок ${index + 1}`, description: "",
      x: 72 + (index % 4) * 250, y: 100 + Math.floor(index / 4) * 180,
    };
    changeDraft({ ...draft, nodes: [...draft.nodes, node] });
    setSelectedNodeId(node.id);
  }

  function updateNode(patch: Partial<WorkflowNode>) {
    if (!currentNode) return;
    changeDraft({ ...draft, nodes: draft.nodes.map((node) => node.id === currentNode.id ? { ...node, ...patch } : node) });
  }

  function removeNode() {
    if (!currentNode) return;
    changeDraft({ ...draft, nodes: draft.nodes.filter((node) => node.id !== currentNode.id),
      edges: draft.edges.filter((edge) => edge.sourceId !== currentNode.id && edge.targetId !== currentNode.id) });
    setSelectedNodeId(null);
  }

  function addEdge() {
    if (!currentNode || !targetId || targetId === currentNode.id || draft.edges.some((edge) => edge.sourceId === currentNode.id && edge.targetId === targetId)) {
      setFeedback({ error: true, message: "Выберите другой блок, с которым ещё нет связи." });
      return;
    }
    changeDraft({ ...draft, edges: [...draft.edges, { id: crypto.randomUUID(), sourceId: currentNode.id, targetId, label: edgeLabel.trim() }] });
    setTargetId("");
    setEdgeLabel("");
  }

  function saveMap() {
    if (!selected) return;
    if (remoteVersionAvailable) {
      setFeedback({ error: true, message: "Карту изменил другой сотрудник. Загрузите новую версию перед сохранением." });
      return;
    }
    startTransition(async () => {
      const result = await saveWorkflowMapAction({ id: selected.id, expectedVersion: version, title, description, draft });
      setFeedback({ error: result.status === "error", message: result.message });
      if (result.status === "success" && result.version) {
        setVersion(result.version);
        setDirty(false);
        router.refresh();
      }
    });
  }

  function loadLatestVersion() {
    if (!selected || (dirty && !window.confirm("Несохранённые изменения будут потеряны. Загрузить новую версию?"))) return;
    setTitle(selected.title);
    setDescription(selected.description);
    setDraft(selected.draft);
    setVersion(selected.version);
    setSelectedNodeId(null);
    setTargetId("");
    setEdgeLabel("");
    setDirty(false);
    setFeedback(null);
  }

  function archiveMap() {
    if (!selected) return;
    startTransition(async () => {
      const result = await archiveWorkflowMapAction({ id: selected.id, expectedVersion: version });
      setFeedback({ error: result.status === "error", message: result.message });
      if (result.status === "success") router.push("/workflow");
      else setConfirmArchive(false);
    });
  }

  return <section className="surface-panel flex min-h-[680px] min-w-0 flex-1 flex-col overflow-hidden p-0" aria-label="Карты процессов">
    <div className="grid min-h-0 flex-1 lg:grid-cols-[14rem_minmax(0,1fr)_17rem]">
      <aside className="border-b border-[var(--line)] bg-[var(--surface-raised)] p-4 lg:border-b-0 lg:border-r">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">Карты процессов</h2>
        {canWrite && <form className="mt-4 flex gap-2" onSubmit={(event) => { event.preventDefault(); createMap(); }}>
          <input aria-label="Название новой карты" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} maxLength={120}
            placeholder="Новая карта" className="focus-ring min-w-0 flex-1 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-2 text-xs" />
          <button type="submit" disabled={pending} aria-label="Создать карту" className="focus-ring grid size-10 shrink-0 place-items-center rounded-[10px] bg-[var(--accent)] text-[var(--on-accent)] disabled:opacity-50"><Plus className="size-4" /></button>
        </form>}
        <nav aria-label="Список карт" className="mt-4 grid gap-1">
          {maps.map((map) => <Link key={map.id} href={`/workflow?map=${map.id}`} onClick={(event) => {
            if (dirty && map.id !== selected?.id && !window.confirm("Несохранённые изменения будут потеряны. Перейти к другой карте?")) event.preventDefault();
          }} aria-current={map.id === selected?.id ? "page" : undefined}
            className={`focus-ring rounded-[11px] px-3 py-3 text-xs transition-colors ${map.id === selected?.id ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-soft)]"}`}>
            <span className="block truncate font-medium">{map.title}</span>
            <span className="mt-1 block text-[10px] opacity-65">Версия {map.version}</span>
          </Link>)}
          {maps.length === 0 && <p className="rounded-[12px] border border-dashed border-[var(--line-strong)] p-3 text-xs leading-5 text-[var(--muted)]">{preview ? "В предпросмотре карты не сохраняются." : "Карт пока нет. Создайте первую карту процесса."}</p>}
        </nav>
        {selected && canEdit && <div className="mt-6 border-t border-[var(--line)] pt-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">Добавить блок</p>
          <div className="mt-3 grid gap-2">{blockKinds.map(({ kind, label }) => <button key={kind} type="button" onClick={() => addNode(kind)} disabled={pending || draft.nodes.length >= 60}
            className="focus-ring flex min-h-10 items-center gap-2 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-3 text-left text-xs text-[var(--text-secondary)] hover:border-[var(--line-strong)] disabled:opacity-50"><Plus className="size-3.5" />{label}</button>)}</div>
          <p className="mt-3 text-[10px] leading-4 text-[var(--muted)]">Блоки пока описывают процесс. Они не меняют данные CRM и не запускают действия.</p>
        </div>}
      </aside>

      <div className="flex min-w-0 flex-col bg-[var(--surface-inset)] lg:min-h-[520px]">
        {selected ? <>
          <header className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] bg-[var(--surface-raised)] px-4 py-3">
            <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold text-[var(--text)]">{title || "Без названия"}</h2><p className="mt-1 text-[10px] text-[var(--muted)]">Черновик · версия {version} · {draft.nodes.length} блоков · {draft.edges.length} связей</p></div>
            {canEdit && <button type="button" onClick={saveMap} disabled={pending || !dirty} className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-[10px] bg-[var(--accent)] px-4 text-xs font-medium text-[var(--on-accent)] disabled:opacity-50"><Save className="size-3.5" />{pending ? "Сохраняем…" : dirty ? "Сохранить" : "Сохранено"}</button>}
          </header>
          {remoteVersionAvailable && <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-[var(--warning-border)] bg-[var(--warning-bg)] px-4 py-3 text-xs text-[var(--text-secondary)]">
            <span className="min-w-0 flex-1">Карту сохранил другой сотрудник: доступна версия {selected.version}. Текущие несохранённые правки останутся на экране до загрузки новой версии.</span>
            <button type="button" onClick={loadLatestVersion}
              className="focus-ring min-h-9 rounded-[9px] border border-[var(--warning-border)] px-3 font-medium">Загрузить новую версию</button>
          </div>}
          <div className="grid gap-3 p-4 lg:hidden">
            {draft.nodes.map((node, index) => <button key={node.id} type="button" onClick={() => setSelectedNodeId(node.id)}
              className={`focus-ring rounded-[14px] border p-4 text-left ${blockTone[node.kind]} ${node.id === selectedNodeId ? "ring-2 ring-[var(--accent)]" : ""}`}>
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">{blockLabel[node.kind]} · {String(index + 1).padStart(2, "0")}</span>
              <strong className="mt-3 block text-sm text-[var(--text)]">{node.title}</strong>
              {node.description && <span className="mt-1 block text-xs text-[var(--muted)]">{node.description}</span>}
              {draft.edges.filter((edge) => edge.sourceId === node.id).map((edge) => <span key={edge.id} className="mt-2 block text-[10px] text-[var(--text-secondary)]">→ {draft.nodes.find((target) => target.id === edge.targetId)?.title}{edge.label ? ` · ${edge.label}` : ""}</span>)}
            </button>)}
            {draft.nodes.length === 0 && <p className="rounded-[14px] border border-dashed border-[var(--line-strong)] bg-[var(--surface-raised)] p-4 text-xs leading-5 text-[var(--muted)]">Карта пуста. Добавьте первый блок из библиотеки выше.</p>}
          </div>
          <div className="hidden min-h-0 flex-1 overflow-auto lg:block" style={{ backgroundImage: "radial-gradient(var(--line-strong) 1px, transparent 1px)", backgroundSize: "24px 24px" }}>
            <div className="relative" style={{ width: canvasWidth, height: canvasHeight }}>
              <svg className="pointer-events-none absolute inset-0" width={canvasWidth} height={canvasHeight} aria-hidden="true">
                <defs><marker id="workflow-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0 0 L9 4.5 L0 9" fill="none" stroke="var(--muted)" strokeWidth="1.5" /></marker></defs>
                {draft.edges.map((edge) => {
                  const source = draft.nodes.find((node) => node.id === edge.sourceId);
                  const target = draft.nodes.find((node) => node.id === edge.targetId);
                  if (!source || !target) return null;
                  const sx = source.x + nodeWidth / 2; const sy = source.y + nodeHeight / 2;
                  const tx = target.x + nodeWidth / 2; const ty = target.y + nodeHeight / 2;
                  const dx = tx - sx; const dy = ty - sy; const distance = Math.hypot(dx, dy) || 1;
                  const x1 = sx + dx / distance * 74; const y1 = sy + dy / distance * 48;
                  const x2 = tx - dx / distance * 85; const y2 = ty - dy / distance * 55;
                  return <g key={edge.id}><line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--muted)" strokeWidth="1.6" markerEnd="url(#workflow-arrow)" />
                    {edge.label && <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 8} textAnchor="middle" fill="var(--text-secondary)" fontSize="11">{edge.label}</text>}</g>;
                })}
              </svg>
              {draft.nodes.map((node, index) => <button key={node.id} type="button" onClick={() => setSelectedNodeId(node.id)}
                style={{ left: node.x, top: node.y, width: nodeWidth, minHeight: nodeHeight }}
                className={`focus-ring absolute rounded-[16px] border p-4 text-left shadow-[0_12px_32px_rgba(20,24,33,0.08)] ${blockTone[node.kind]} ${node.id === selectedNodeId ? "ring-2 ring-[var(--accent)]" : ""}`}>
                <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">{blockLabel[node.kind]} · {String(index + 1).padStart(2, "0")}</span>
                <strong className="mt-4 block line-clamp-2 text-sm text-[var(--text)]">{node.title}</strong>
                <span className="mt-1 block line-clamp-2 text-[10px] leading-4 text-[var(--muted)]">{node.description || "Без описания"}</span>
              </button>)}
              {draft.nodes.length === 0 && <div className="absolute left-10 top-14 max-w-sm rounded-[15px] border border-dashed border-[var(--line-strong)] bg-[var(--surface-raised)] p-5 text-sm leading-6 text-[var(--muted)]">Карта пуста. Добавьте первый блок из библиотеки слева, затем соедините его с другим блоком.</div>}
            </div>
          </div>
        </> : <div className="grid min-h-[520px] flex-1 place-items-center p-8 text-center text-sm text-[var(--muted)]">Выберите карту слева или создайте новую.</div>}
      </div>

      <aside className="border-t border-[var(--line)] bg-[var(--surface-raised)] p-4 lg:border-l lg:border-t-0">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">{currentNode ? "Выбранный блок" : "Свойства карты"}</h2>
        {selected && <div className="mt-4 grid gap-4">
          {currentNode ? <>
            <label className="grid gap-1.5 text-xs text-[var(--text-secondary)]">Название блока<input value={currentNode.title} onChange={(event) => updateNode({ title: event.target.value })} disabled={!canEdit} maxLength={100} className="focus-ring h-10 min-w-0 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-3 disabled:opacity-60" /></label>
            <label className="grid gap-1.5 text-xs text-[var(--text-secondary)]">Описание<textarea aria-label="Описание блока" value={currentNode.description} onChange={(event) => updateNode({ description: event.target.value })} disabled={!canEdit} maxLength={500} rows={3} className="focus-ring min-w-0 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-3 disabled:opacity-60" /></label>
            {canEdit && <><div><p className="mb-2 text-xs text-[var(--text-secondary)]">Положение на карте</p><div className="flex flex-wrap gap-2">
              {[[ArrowLeft, -40, 0, "Влево"], [ArrowRight, 40, 0, "Вправо"], [ArrowUp, 0, -40, "Вверх"], [ArrowDown, 0, 40, "Вниз"]].map(([Icon, dx, dy, label]) => {
                const MoveIcon = Icon as typeof ArrowLeft;
                return <button key={label as string} type="button" aria-label={label as string} onClick={() => updateNode({ x: Math.max(0, Math.min(5000, currentNode.x + Number(dx))), y: Math.max(0, Math.min(5000, currentNode.y + Number(dy))) })} className="focus-ring grid size-9 place-items-center rounded-[9px] border border-[var(--line)]"><MoveIcon className="size-4" /></button>;
              })}</div></div>
              <div className="border-t border-[var(--line)] pt-4"><p className="mb-2 flex items-center gap-2 text-xs font-medium text-[var(--text)]"><Link2 className="size-3.5" />Связать с блоком</p>
                <select aria-label="Следующий блок" value={targetId} onChange={(event) => setTargetId(event.target.value)} className="focus-ring h-10 w-full rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-2 text-xs"><option value="">Выберите блок</option>{draft.nodes.filter((node) => node.id !== currentNode.id).map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</select>
                <input aria-label="Подпись связи" value={edgeLabel} onChange={(event) => setEdgeLabel(event.target.value)} maxLength={80} placeholder="Подпись (необязательно)" className="focus-ring mt-2 h-10 w-full rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-3 text-xs" />
                <button type="button" onClick={addEdge} disabled={!targetId || draft.edges.length >= 120} className="focus-ring mt-2 min-h-9 rounded-[9px] border border-[var(--line)] px-3 text-xs disabled:opacity-50">Добавить связь</button>
              </div></>}
            <div className="border-t border-[var(--line)] pt-4"><p className="mb-2 text-xs font-medium text-[var(--text)]">Связи блока</p>{draft.edges.filter((edge) => edge.sourceId === currentNode.id || edge.targetId === currentNode.id).map((edge) => <div key={edge.id} className="mb-2 flex items-center gap-2 rounded-[9px] border border-[var(--line)] p-2 text-[10px] text-[var(--text-secondary)]"><GitBranch className="size-3 shrink-0" /><span className="min-w-0 flex-1 truncate">{draft.nodes.find((node) => node.id === edge.sourceId)?.title} → {draft.nodes.find((node) => node.id === edge.targetId)?.title}</span>{canEdit && <button type="button" aria-label="Удалить связь" onClick={() => changeDraft({ ...draft, edges: draft.edges.filter((item) => item.id !== edge.id) })}><Trash2 className="size-3.5" /></button>}</div>)}
              {draft.edges.every((edge) => edge.sourceId !== currentNode.id && edge.targetId !== currentNode.id) && <p className="text-[10px] text-[var(--muted)]">Связей пока нет.</p>}
            </div>
            <WorkflowNodeContext mapId={selected.id} node={currentNode} members={members} canWrite={canEdit} onChange={updateNode} />
            {canEdit && <button type="button" onClick={removeNode} className="focus-ring flex min-h-10 items-center gap-2 rounded-[10px] border border-[var(--danger)]/40 px-3 text-xs text-[var(--danger)]"><Trash2 className="size-3.5" />Удалить блок</button>}
            <button type="button" onClick={() => setSelectedNodeId(null)} className="focus-ring min-h-9 text-left text-xs text-[var(--muted)]">Вернуться к карте</button>
          </> : <>
            <label className="grid gap-1.5 text-xs text-[var(--text-secondary)]">Название<input value={title} onChange={(event) => { setTitle(event.target.value); setDirty(true); }} disabled={!canEdit} maxLength={120} className="focus-ring h-10 min-w-0 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-3 disabled:opacity-60" /></label>
            <label className="grid gap-1.5 text-xs text-[var(--text-secondary)]">Описание<textarea aria-label="Описание" value={description} onChange={(event) => { setDescription(event.target.value); setDirty(true); }} disabled={!canEdit} maxLength={1000} rows={4} className="focus-ring min-w-0 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-3 disabled:opacity-60" /></label>
            <label className="grid gap-1.5 text-xs text-[var(--text-secondary)]">Общий регламент<textarea aria-label="Общий регламент" value={draft.regulations ?? ""} onChange={(event) => changeDraft({ ...draft, regulations: event.target.value })} disabled={!canEdit} maxLength={8000} rows={5} placeholder="Правила и критерии выполнения процесса" className="focus-ring min-w-0 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-3 disabled:opacity-60" /></label>
            <p className="text-[10px] leading-4 text-[var(--muted)]">Последнее изменение: {new Date(selected.updatedAt).toLocaleString("ru-RU")} · {selected.updatedByName}</p>
            {canEdit && <div className="border-t border-[var(--line)] pt-4">{confirmArchive ? <div className="grid gap-2"><p className="text-xs text-[var(--text-secondary)]">Архивировать карту? Она исчезнет из списка.</p><button type="button" onClick={archiveMap} disabled={pending} className="focus-ring min-h-9 rounded-[9px] bg-[var(--danger)] px-3 text-xs text-white disabled:opacity-50">Подтвердить архивирование</button><button type="button" onClick={() => setConfirmArchive(false)} className="focus-ring min-h-9 text-xs">Отмена</button></div> : <button type="button" onClick={() => setConfirmArchive(true)} className="focus-ring flex min-h-9 items-center gap-2 text-xs text-[var(--muted)]"><Archive className="size-3.5" />В архив</button>}</div>}
          </>}
        </div>}
        {selected && !currentNode && <WorkflowLifecycle map={selected} currentVersion={version}
          currentTitle={title} currentDescription={description} currentDraft={draft}
          revisions={revisions} canWrite={canEdit} canReview={canReview}
          canPublish={canPublish} currentMemberId={currentMemberId} dirty={dirty} />}
        {selected && <WorkflowDiscussion mapId={selected.id} comments={comments} hasMore={commentsHasMore} canComment={canComment} />}
        {selected && <WorkflowCollaboration mapId={selected.id} watching={watching} canWatch={canWatch} activity={activity} />}
        {feedback && <p role={feedback.error ? "alert" : "status"} className={`mt-5 rounded-[10px] border p-3 text-xs leading-5 ${feedback.error ? "border-[var(--danger)]/40 text-[var(--danger)]" : "border-[var(--success)]/40 text-[var(--success)]"}`}>{feedback.message}</p>}
      </aside>
    </div>
  </section>;
}
