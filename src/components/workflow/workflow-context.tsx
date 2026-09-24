"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { MessageSquare, Search } from "lucide-react";
import { addWorkflowCommentAction, findWorkflowResourcesAction, getWorkflowCommentsAction } from "@/app/(workspace)/workflow/actions";
import type { WorkflowComment, WorkflowMemberOption, WorkflowResourceOption } from "@/server/workflow/context-repository";
import type { WorkflowNode } from "@/server/workflow/schemas";

const resourceKinds = [
  { kind: "client", label: "Клиент", path: "/clients" },
  { kind: "order", label: "Заказ", path: "/orders" },
  { kind: "contract", label: "Договор", path: "/contracts" },
] as const;
type ResourceKind = (typeof resourceKinds)[number]["kind"];

export function WorkflowNodeContext({ mapId, node, members, canWrite, onChange }: {
  mapId: string;
  node: WorkflowNode;
  members: WorkflowMemberOption[];
  canWrite: boolean;
  onChange: (patch: Partial<WorkflowNode>) => void;
}) {
  const [kind, setKind] = useState<ResourceKind>(node.resource?.kind ?? "client");
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<WorkflowResourceOption[]>([]);
  const [feedback, setFeedback] = useState("");
  const [pending, startTransition] = useTransition();
  const resource = node.resource;
  const path = resourceKinds.find((item) => item.kind === resource?.kind)?.path;

  function search() {
    startTransition(async () => {
      const result = await findWorkflowResourcesAction({ mapId, kind, query });
      if (result.status === "error") { setOptions([]); setFeedback(result.message); return; }
      setOptions(result.options);
      setFeedback(result.options.length === 0 ? "Записей не найдено или нет права на их просмотр." : "");
    });
  }

  return <div className="grid gap-4 border-t border-[var(--line)] pt-4">
    <div>
      <p className="mb-2 text-xs font-medium text-[var(--text)]">Ответственный</p>
      <select aria-label="Ответственный за блок" value={node.ownerMemberId ?? ""}
        onChange={(event) => onChange({ ownerMemberId: event.target.value || null })}
        disabled={!canWrite} className="focus-ring h-10 w-full rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-2 text-xs disabled:opacity-60">
        <option value="">Не назначен</option>
        {node.ownerMemberId && !members.some((item) => item.id === node.ownerMemberId) &&
          <option value={node.ownerMemberId}>Сотрудник неактивен</option>}
        {members.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </div>
    <label className="grid gap-1.5 text-xs text-[var(--text-secondary)]">Регламент блока
      <textarea value={node.regulation ?? ""} onChange={(event) => onChange({ regulation: event.target.value })}
        disabled={!canWrite} maxLength={4000} rows={5} placeholder="Что делать на этом этапе, кто проверяет результат и когда передавать дальше"
        className="focus-ring min-w-0 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-3 disabled:opacity-60" />
    </label>
    <div>
      <p className="mb-2 text-xs font-medium text-[var(--text)]">Связанная карточка CRM</p>
      {resource && path ? <div className="grid gap-2 rounded-[10px] border border-[var(--line)] p-3 text-xs">
        <Link href={`${path}/${resource.id}`} className="focus-ring break-all text-[var(--accent-ink)] underline underline-offset-2">
          {resourceKinds.find((item) => item.kind === resource.kind)?.label} · {resource.id.slice(0, 8)} →
        </Link>
        {canWrite && <button type="button" onClick={() => onChange({ resource: null })} className="focus-ring text-left text-[var(--muted)]">Убрать ссылку</button>}
      </div> : <p className="text-[10px] text-[var(--muted)]">Карточка не привязана.</p>}
      {canWrite && <div className="mt-3 grid gap-2">
        <select aria-label="Тип карточки CRM" value={kind} onChange={(event) => { setKind(event.target.value as ResourceKind); setOptions([]); }}
          className="focus-ring h-10 w-full rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-2 text-xs">
          {resourceKinds.map((item) => <option key={item.kind} value={item.kind}>{item.label}</option>)}
        </select>
        <div className="flex gap-2"><input aria-label="Поиск карточки CRM" value={query} maxLength={100}
          onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); search(); } }}
          placeholder="Название или номер" className="focus-ring h-10 min-w-0 flex-1 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-3 text-xs" />
          <button type="button" onClick={search} disabled={pending} aria-label="Найти карточку"
            className="focus-ring grid size-10 shrink-0 place-items-center rounded-[10px] border border-[var(--line)] disabled:opacity-50"><Search className="size-4" /></button></div>
        {feedback && <p role="status" className="text-[10px] leading-4 text-[var(--muted)]">{feedback}</p>}
        {options.length > 0 && <div className="max-h-40 overflow-y-auto rounded-[10px] border border-[var(--line)] bg-[var(--surface)]">
          {options.map((item) => <button key={item.id} type="button" onClick={() => { onChange({ resource: { kind, id: item.id } }); setOptions([]); setFeedback(""); }}
            className="focus-ring block w-full border-b border-[var(--line)] px-3 py-2 text-left text-xs last:border-0 hover:bg-[var(--surface-soft)]">{item.label}</button>)}
        </div>}
      </div>}
      <p className="mt-2 text-[10px] leading-4 text-[var(--muted)]">Ссылка показывает текущую карточку. Её содержимое остаётся в CRM и открывается только с нужным правом.</p>
    </div>
  </div>;
}

export function WorkflowDiscussion({ mapId, comments, hasMore, canComment }: {
  mapId: string;
  comments: WorkflowComment[];
  hasMore: boolean;
  canComment: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [feedback, setFeedback] = useState("");
  const [older, setOlder] = useState<WorkflowComment[]>([]);
  const [more, setMore] = useState(hasMore);
  const [pending, startTransition] = useTransition();
  const visibleComments = [...comments, ...older.filter((item) => !comments.some((current) => current.id === item.id))];
  function submit() {
    startTransition(async () => {
      const result = await addWorkflowCommentAction({ id: crypto.randomUUID(), mapId, body });
      setFeedback(result.message);
      if (result.status === "success") { setBody(""); router.refresh(); }
    });
  }
  function loadOlder() {
    const beforeId = visibleComments.at(-1)?.id;
    if (!beforeId) return;
    startTransition(async () => {
      const result = await getWorkflowCommentsAction({ mapId, beforeId });
      if (result.status === "error") { setFeedback(result.message); return; }
      setOlder((current) => [...current, ...result.page.comments]);
      setMore(result.page.hasMore);
    });
  }
  return <div className="mt-5 border-t border-[var(--line)] pt-4">
    <h3 className="flex items-center gap-2 text-xs font-medium text-[var(--text)]"><MessageSquare className="size-3.5" />Обсуждение</h3>
    {canComment && <form className="mt-3 grid gap-2" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <textarea aria-label="Комментарий к карте" value={body} onChange={(event) => setBody(event.target.value)}
        maxLength={2000} rows={3} placeholder="Вопрос или замечание по процессу"
        className="focus-ring min-w-0 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-3 text-xs" />
      <button type="submit" disabled={pending || body.trim().length < 2}
        className="focus-ring min-h-9 rounded-[9px] border border-[var(--line)] px-3 text-xs disabled:opacity-50">Добавить комментарий</button>
    </form>}
    {feedback && <p role="status" className="mt-2 text-[10px] text-[var(--muted)]">{feedback}</p>}
    <div className="mt-3 grid gap-2">{visibleComments.map((comment) => <div key={comment.id} className="rounded-[10px] border border-[var(--line)] p-3">
      <p className="text-[10px] text-[var(--muted)]">{comment.authorName} · {new Date(comment.createdAt).toLocaleString("ru-RU")}</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-[var(--text-secondary)]">{comment.body}</p>
    </div>)}{visibleComments.length === 0 && <p className="text-[10px] text-[var(--muted)]">Комментариев пока нет.</p>}</div>
    {more && <button type="button" onClick={loadOlder} disabled={pending} className="focus-ring mt-3 min-h-9 text-xs text-[var(--accent-ink)] disabled:opacity-50">Показать более ранние</button>}
  </div>;
}
