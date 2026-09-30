"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Check, Clipboard, Copy, FileText, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import {
  deletePersonalNoteAction, deletePersonalNoteTemplateAction, savePersonalNoteAction,
  savePersonalNoteTemplateAction, searchPersonalNoteTargetsAction, transferPersonalNoteAction,
  searchPersonalNotesAction, searchPersonalNoteTemplatesAction,
} from "@/app/(workspace)/personal-note-actions";
import type { NoteDestinationPage, NotePage, NoteTarget, NoteTemplate, PersonalNote } from "@/server/personal-notes/repository";
import { createClientId } from "@/lib/client-id";
import { useNotePage } from "./use-note-page";
import { formatLizaNote, isStructuredLizaNote, parseLizaNote, type LizaNoteFields } from "@/lib/liza-note";

type Props = {
  target: NoteTarget;
  initialNotes: NotePage<PersonalNote>;
  initialTemplates: NotePage<NoteTemplate>;
  objectName?: string;
  lizaDefaults?: Partial<LizaNoteFields>;
  relatedLinks?: { calendarHref?: string; tasksHref?: string };
};

export function PersonalNotesPanel({ target, initialNotes, initialTemplates, objectName, lizaDefaults, relatedLinks }: Props) {
  const loadNotes = useCallback((query: string, offset: number) => searchPersonalNotesAction(target, query, offset), [target]);
  const noteList = useNotePage(initialNotes, loadNotes);
  const templateList = useNotePage(initialTemplates, searchPersonalNoteTemplatesAction);
  const notes = noteList.items;
  const templates = templateList.items;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [lizaMode, setLizaMode] = useState(false);
  const [lizaFields, setLizaFields] = useState<LizaNoteFields>({ object: "", area: "", serviceRates: [], total: "", maintenance: "" });
  const [templateName, setTemplateName] = useState("");
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [editingTemplateName, setEditingTemplateName] = useState("");
  const [editingTemplateBody, setEditingTemplateBody] = useState("");
  const [showTemplates, setShowTemplates] = useState(false);
  const [transferId, setTransferId] = useState<string | null>(null);
  const [transferMode, setTransferMode] = useState<"copy" | "move">("copy");
  const [query, setQuery] = useState("");
  const [destinations, setDestinations] = useState<(NoteDestinationPage & { query: string; transferId: string }) | null>(null);
  const [destinationOffset, setDestinationOffset] = useState(0);
  const [destinationLoading, setDestinationLoading] = useState(false);
  const [destinationError, setDestinationError] = useState("");
  const [destinationRetry, setDestinationRetry] = useState(0);
  const inFlight = useRef(false);
  const saveRequestKey = useRef<string | null>(null);
  const transferRequestKey = useRef<string | null>(null);
  const [savedTemplateId, setSavedTemplateId] = useState<string | undefined>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();

  const currentDestinations = destinations?.query === query && destinations.transferId === transferId ? destinations : null;
  const visibleTemplates = templates;

  useEffect(() => {
    if (!transferId) return;
    let active = true;
    const timer = setTimeout(async () => {
      setDestinationLoading(true);
      setDestinationError("");
      try {
        const results = await searchPersonalNoteTargetsAction(query, destinationOffset);
        if (active) setDestinations((previous) => ({ ...results, query, transferId,
          items: destinationOffset && previous?.query === query && previous.transferId === transferId
            ? [...previous.items, ...results.items.filter((item) => !previous.items.some((old) => old.kind === item.kind && old.id === item.id))]
            : results.items }));
      } catch {
        if (active) setDestinationError("Не удалось загрузить места назначения. Повторите поиск.");
      } finally {
        if (active) setDestinationLoading(false);
      }
    }, query ? 220 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [query, transferId, destinationOffset, destinationRetry]);

  function beginTransfer(id: string, mode: "copy" | "move") {
    setTransferId(id); setTransferMode(mode); setQuery(""); setDestinationOffset(0);
    setDestinations(null); setDestinationError(""); transferRequestKey.current = null;
  }

  function beginNew(template?: NoteTemplate) {
    saveRequestKey.current = null; setSavedTemplateId(undefined);
    const structuredTemplate = template?.kind === "liza_order" && isStructuredLizaNote(template.body);
    const templateFields = structuredTemplate ? parseLizaNote(template.body) : null;
    setEditingId(null);
    setTitle("");
    setBody(template ? template.body.replaceAll("{{object}}", objectName?.trim() || "") : "");
    setLizaMode(Boolean(structuredTemplate));
    setLizaFields({
      object: lizaDefaults?.object || objectName?.trim() || templateFields?.object || "",
      area: lizaDefaults?.area || templateFields?.area || "",
      serviceRates: lizaDefaults?.serviceRates?.length ? lizaDefaults.serviceRates : templateFields?.serviceRates?.length ? templateFields.serviceRates : [{ name: "", pricePerSquareMeter: "" }],
      total: lizaDefaults?.total || templateFields?.total || "",
      maintenance: lizaDefaults?.maintenance || templateFields?.maintenance || "",
    });
    setEditorOpen(true);
    setSaveAsTemplate(false);
    setTemplateName("");
    setShowTemplates(false);
    setError("");
  }

  function beginEdit(note: PersonalNote) {
    saveRequestKey.current = null; setSavedTemplateId(undefined);
    setEditingId(note.id);
    setTitle(note.title);
    setBody(note.body);
    setLizaMode(false);
    setEditorOpen(true);
    setSaveAsTemplate(false);
    setTemplateName("");
    setError("");
  }

  function run(work: () => Promise<void>) {
    setError("");
    setNotice("");
    if (inFlight.current) return;
    inFlight.current = true;
    startTransition(async () => {
      try { await work(); } catch (cause) { setError(message(cause)); }
      finally { inFlight.current = false; }
    });
  }

  function save() {
    const noteBody = lizaMode ? formatLizaNote(lizaFields) : body;
    if (!noteBody.trim()) { setError("Напишите текст заметки."); return; }
    if (saveAsTemplate && !templateName.trim()) { setError("Укажите название шаблона."); return; }
    run(async () => {
      const templateBody = lizaMode ? formatLizaNote({ ...lizaFields, object: "{{object}}" }) : body;
      saveRequestKey.current ??= createClientId();
      const saved = await savePersonalNoteAction({ target, id: editingId ?? undefined, requestKey: saveRequestKey.current, title, body: noteBody,
        template: saveAsTemplate ? { id: savedTemplateId, name: templateName, body: templateBody, kind: lizaMode ? "liza_order" : "plain" } : undefined });
      noteList.replace(saved.notesPage);
      templateList.replace(saved.templatesPage);
      saveRequestKey.current = null;
      if (saved.mutation.status === "conflict") {
        setEditingId(saved.originalNoteId ?? null);
        setSavedTemplateId(saved.originalTemplateId ?? undefined);
        setNotice(saved.originalNoteId ? "Предыдущий вариант уже сохранён. Ваши новые правки остались в редакторе — сохраните их ещё раз."
          : "Предыдущее сохранение выполнено, но заметка уже удалена или перенесена. Новый текст остался в редакторе.");
        return;
      }
      setEditorOpen(false);
      setNotice(saved.mutation.status === "replayed" ? "Сохранение уже выполнено. Список обновлён." : saveAsTemplate ? "Заметка и шаблон сохранены." : "Заметка сохранена.");
    });
  }

  function remove(note: PersonalNote) {
    if (!window.confirm(`Удалить заметку «${note.title || "Без названия"}»?`)) return;
    run(async () => { noteList.replace(await deletePersonalNoteAction({ target, id: note.id })); });
  }

  function transfer(destination: NoteTarget) {
    if (!transferId) return;
    run(async () => {
      transferRequestKey.current ??= createClientId();
      const result = await transferPersonalNoteAction({ source: target, destination, id: transferId, mode: transferMode, requestKey: transferRequestKey.current });
      noteList.replace(result.notesPage);
      transferRequestKey.current = null;
      setTransferId(null);
      setQuery("");
      setNotice(result.mutation.status === "conflict" ? "Предыдущая операция уже выполнена. Новое место назначения не применялось."
        : transferMode === "move" ? "Заметка перенесена." : "Копия создана.");
    });
  }

  function sameTarget(destination: NoteTarget) {
    return destination.kind === target.kind && destination.organizationId === target.organizationId && destination.id === target.id;
  }

  return (
    <section aria-label="Личные заметки" className="surface-panel min-w-0 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2"><FileText className="size-5" /><h2 className="font-display text-xl font-semibold text-[var(--text)]">Мои заметки</h2></div>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Видны только вам · {target.kind === "dashboard" ? "сохраняются каждый день, пока вы их не измените" : "привязаны к этой карточке"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {relatedLinks?.calendarHref ? <Link href={relatedLinks.calendarHref} className="focus-ring inline-flex min-h-10 items-center rounded-xl border border-[var(--line)] px-4 text-xs">Календарь заказа</Link> : null}
          {relatedLinks?.tasksHref ? <Link href={relatedLinks.tasksHref} className="focus-ring inline-flex min-h-10 items-center rounded-xl border border-[var(--line)] px-4 text-xs">Задачи заказа</Link> : null}
          <button type="button" disabled={pending} onClick={() => beginNew()} className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-xl bg-[var(--text)] px-4 text-xs font-semibold text-[var(--surface)]"><Plus className="size-4" />Новая заметка</button>
          <button type="button" onClick={() => setShowTemplates(!showTemplates)} className="focus-ring min-h-10 rounded-xl border border-[var(--line)] px-4 text-xs">По шаблону</button>
        </div>
      </div>

      {showTemplates ? <div className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] p-3">
        <p className="mb-2 text-xs font-semibold">Быстрые шаблоны</p>
        <label className="mb-3 flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3"><Search className="size-4 shrink-0 text-[var(--muted)]" /><input aria-label="Поиск шаблона" value={templateList.query} onChange={(event) => templateList.search(event.target.value)} placeholder="Название или текст шаблона" maxLength={120} className="min-h-11 min-w-0 flex-1 bg-transparent text-sm outline-none" /></label>
        <div aria-label="Список шаблонов заметок" className="flex max-h-60 flex-wrap gap-2 overflow-y-auto">{visibleTemplates.map((template) => <div key={template.id} className="inline-flex items-center rounded-lg border border-[var(--line)] bg-[var(--surface)]">
          <button type="button" disabled={pending || templateList.loading || Boolean(templateList.error)} onClick={() => beginNew(template)} className="focus-ring px-3 py-2 text-xs">{template.name}</button>
          {<><button type="button" aria-label={`Изменить шаблон ${template.name}`} disabled={pending || templateList.loading || Boolean(templateList.error)} onClick={() => { setEditingTemplateId(template.id); setEditingTemplateName(template.name); setEditingTemplateBody(template.body); setError(""); }} className="focus-ring px-2 text-[var(--muted)]"><Pencil className="size-3.5" /></button><button type="button" aria-label={`Удалить шаблон ${template.name}`} disabled={pending} onClick={() => run(async () => { templateList.replace(await deletePersonalNoteTemplateAction(template.id)); if (editingTemplateId === template.id) setEditingTemplateId(null); })} className="focus-ring px-2 text-[var(--muted)]"><X className="size-3.5" /></button></>}
        </div>)}</div>
        <ListProgress list={templateList} moreLabel="Ещё шаблоны" />
        {!visibleTemplates.length && !templateList.loading && !templateList.error ? <p role="status" className="py-3 text-xs text-[var(--muted)]">{templateList.query ? "Шаблоны не найдены." : "Сохраните заметку в шаблоны, чтобы использовать её снова."}</p> : null}
        {editingTemplateId ? <fieldset disabled={pending} className="mt-3 min-w-0 space-y-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
          <p className="text-xs font-semibold">Изменить шаблон</p>
          <label className="block text-xs text-[var(--muted)]">Название<input value={editingTemplateName} onChange={(event) => setEditingTemplateName(event.target.value)} maxLength={100} className="mt-1 min-h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]" /></label>
          <label className="block text-xs text-[var(--muted)]">Текст шаблона<textarea value={editingTemplateBody} onChange={(event) => setEditingTemplateBody(event.target.value)} maxLength={12000} rows={5} className="mt-1 w-full resize-y rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 text-sm text-[var(--text)]" /></label>
          <div className="flex gap-2"><button type="button" disabled={pending || !editingTemplateName.trim() || !editingTemplateBody.trim()} onClick={() => run(async () => { templateList.replace(await savePersonalNoteTemplateAction({ id: editingTemplateId, name: editingTemplateName, body: editingTemplateBody })); setEditingTemplateId(null); setNotice("Шаблон обновлён."); })} className="focus-ring min-h-10 rounded-xl bg-[var(--text)] px-4 text-xs font-semibold text-[var(--surface)] disabled:opacity-50">Сохранить шаблон</button><button type="button" onClick={() => setEditingTemplateId(null)} className="focus-ring min-h-10 rounded-xl border border-[var(--line)] px-4 text-xs">Отмена</button></div>
        </fieldset> : null}
      </div> : null}

      {editorOpen ? <fieldset disabled={pending} className="mt-4 min-w-0 rounded-2xl border border-[var(--line-strong)] bg-[var(--surface-soft)] p-4">
        <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{editingId ? "Изменить заметку" : "Новая заметка"}</h3><button type="button" aria-label="Закрыть редактор" onClick={() => setEditorOpen(false)}><X className="size-4" /></button></div>
        <label className="mt-3 block text-xs text-[var(--muted)]">Заголовок (необязательно)<input value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} placeholder="Например, детали объекта" className="mt-1 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 text-sm text-[var(--text)]" /></label>
        {lizaMode ? <div className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">{([
            ["object", "Название объекта"], ["area", "Площадь объекта"], ["total", "Общий чек"], ["maintenance", "Обслуживание"],
          ] as const).map(([key, label]) => <label key={key} className="block text-xs text-[var(--muted)]">{label}<input value={lizaFields[key]} onChange={(event) => setLizaFields((current) => ({ ...current, [key]: event.target.value }))} maxLength={1000} className="mt-1 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 text-sm text-[var(--text)]" /></label>)}</div>
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3"><p className="mb-2 text-xs font-medium">Услуги и цены за м²</p>
            <div className="space-y-2">{lizaFields.serviceRates.map((rate, index) => <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_auto]">
              <input aria-label={`Услуга ${index + 1}`} value={rate.name} onChange={(event) => setLizaFields((current) => ({ ...current, serviceRates: current.serviceRates.map((item, row) => row === index ? { ...item, name: event.target.value } : item) }))} placeholder="Услуга" maxLength={1000} className="min-w-0 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 text-sm" />
              <input aria-label={`Цена за м² для услуги ${index + 1}`} value={rate.pricePerSquareMeter} onChange={(event) => setLizaFields((current) => ({ ...current, serviceRates: current.serviceRates.map((item, row) => row === index ? { ...item, pricePerSquareMeter: event.target.value } : item) }))} placeholder="₽/м²" maxLength={80} className="min-w-0 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 text-sm" />
              <button type="button" aria-label={`Убрать услугу ${index + 1}`} onClick={() => setLizaFields((current) => ({ ...current, serviceRates: current.serviceRates.filter((_, row) => row !== index) }))} className="focus-ring min-h-10 rounded-xl border border-[var(--line)] px-3"><X className="size-4" /></button>
            </div>)}</div>
            <button type="button" onClick={() => setLizaFields((current) => ({ ...current, serviceRates: [...current.serviceRates, { name: "", pricePerSquareMeter: "" }] }))} className="focus-ring mt-3 inline-flex min-h-10 items-center gap-1 rounded-xl border border-[var(--line)] px-3 text-xs"><Plus className="size-4" />Добавить услугу</button>
          </div>
          <button type="button" onClick={() => { setBody(formatLizaNote(lizaFields)); setLizaMode(false); }} className="focus-ring w-fit text-xs underline">Редактировать как текст</button>
        </div> : <><label className="mt-3 block text-xs text-[var(--muted)]">Текст<textarea value={body} maxLength={12000} onChange={(event) => setBody(event.target.value)} placeholder="Запишите важное для себя…" rows={7} className="mt-1 w-full resize-y rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 text-sm leading-6 text-[var(--text)]" /></label><div className="mt-2 text-right text-[10px] text-[var(--muted)]">{body.length} / 12 000</div></>}
        <div className="mt-4 border-t border-[var(--line)] pt-4"><label className="inline-flex cursor-pointer items-center gap-3 text-xs font-medium"><input type="checkbox" role="switch" checked={saveAsTemplate} onChange={(event) => setSaveAsTemplate(event.target.checked)} className="peer sr-only" /><span aria-hidden="true" className="relative h-6 w-11 rounded-full bg-[var(--line-strong)] transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-[var(--accent)] peer-checked:after:translate-x-5 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--accent)]" />Сохранить в шаблоны</label>{saveAsTemplate ? <label className="mt-3 block text-xs text-[var(--muted)]">Название шаблона<input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="Например, обслуживание объекта" maxLength={100} className="mt-1 min-h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]" /></label> : null}</div>
        <div className="mt-4 flex flex-wrap items-center gap-2"><button type="button" disabled={pending} onClick={save} className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-xl bg-[var(--text)] px-4 text-xs font-semibold text-[var(--surface)]"><Check className="size-4" />Сохранить</button><button type="button" onClick={() => setEditorOpen(false)} className="focus-ring min-h-10 rounded-xl border border-[var(--line)] px-4 text-xs">Отмена</button></div>
      </fieldset> : null}

      {noteList.total > 20 || noteList.query ? <label className="mt-4 flex items-center gap-2 rounded-xl border border-[var(--line)] px-3"><Search className="size-4 shrink-0 text-[var(--muted)]" /><input aria-label="Поиск заметок" value={noteList.query} maxLength={120} onChange={event => noteList.search(event.target.value)} placeholder="Заголовок или текст заметки" className="min-h-11 min-w-0 flex-1 bg-transparent text-sm outline-none" /></label> : null}
      {notes.length ? <div aria-label="Список личных заметок" className={`mt-4 grid gap-3 lg:grid-cols-2 ${noteList.total > 20 ? "max-h-[32rem] overflow-y-auto" : ""}`}>{notes.map((note) => <article key={note.id} className="min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words text-sm font-semibold">{note.title || "Заметка"}</h3><p className="mt-1 text-[10px] text-[var(--muted)]">{new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(note.updatedAt))}</p></div><button type="button" disabled={pending} onClick={() => remove(note)} aria-label="Удалить заметку" className="focus-ring shrink-0 text-[var(--muted)] hover:text-red-600"><Trash2 className="size-4" /></button></div>
        <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--text-secondary)]">{note.body}</p>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--line)] pt-3">
          <button type="button" disabled={pending} onClick={() => beginEdit(note)} className="focus-ring rounded-lg border border-[var(--line)] px-3 py-2 text-xs">Изменить</button>
          <button type="button" onClick={() => { void navigator.clipboard.writeText([note.title, note.body].filter(Boolean).join("\n\n")).then(() => setNotice("Текст скопирован.")).catch(() => setError("Не удалось скопировать текст.")); }} className="focus-ring inline-flex items-center gap-1 rounded-lg border border-[var(--line)] px-3 py-2 text-xs"><Clipboard className="size-3.5" />Копировать текст</button>
          <button type="button" disabled={pending} onClick={() => beginTransfer(note.id, "copy")} className="focus-ring inline-flex items-center gap-1 rounded-lg border border-[var(--line)] px-3 py-2 text-xs"><Copy className="size-3.5" />Дублировать</button>
          <button type="button" disabled={pending} onClick={() => beginTransfer(note.id, "move")} className="focus-ring rounded-lg border border-[var(--line)] px-3 py-2 text-xs">Перенести</button>
        </div>
      </article>)}</div> : !noteList.loading && !noteList.error ? <p className="mt-4 rounded-xl border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]">{noteList.query ? "Заметки не найдены." : "Заметок пока нет. Добавьте свободную запись или выберите шаблон."}</p> : null}
      <ListProgress list={noteList} moreLabel="Ещё заметки" />

      {transferId ? <div className="mt-4 rounded-2xl border border-[var(--line-strong)] bg-[var(--surface-soft)] p-4">
        <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{transferMode === "move" ? "Перенести заметку" : "Куда дублировать?"}</h3><button type="button" disabled={pending} aria-label="Закрыть выбор" onClick={() => setTransferId(null)}><X className="size-4" /></button></div>
        <label className="mt-3 flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3"><Search className="size-4 shrink-0 text-[var(--muted)]" /><input value={query} disabled={pending} maxLength={120} onChange={(event) => { setQuery(event.target.value); setDestinationOffset(0); setDestinationError(""); }} placeholder="Номер заказа или имя клиента" className="min-h-11 min-w-0 flex-1 bg-transparent text-sm outline-none" /></label>
        <div aria-label="Места назначения заметки" className="mt-2 max-h-60 space-y-1 overflow-y-auto">
          {currentDestinations?.items.filter((item) => transferMode === "copy" || !sameTarget(item)).map((item) => <button type="button" key={`${item.kind}:${item.organizationId}:${item.id}`} disabled={pending || Boolean(destinationError)} onClick={() => transfer(item)} className="focus-ring block w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-[var(--surface)]"><span className="block break-words">{item.label}{sameTarget(item) ? " · здесь" : ""}</span>{item.detail ? <span className="mt-1 block text-[var(--muted)]">{item.detail}</span> : null}</button>)}
          {destinationError ? <div role="alert" className="p-3 text-xs text-red-600"><p>{destinationError}</p><button type="button" onClick={() => setDestinationRetry((value) => value + 1)} className="focus-ring mt-2 rounded-lg border border-[var(--line)] px-3 py-2">Повторить поиск</button></div> : !currentDestinations || destinationLoading ? <p role="status" className="p-3 text-xs text-[var(--muted)]">Поиск…</p> : null}
          {query && currentDestinations?.total === 1 && !destinationLoading && !destinationError ? <p role="status" className="p-3 text-xs text-[var(--muted)]">{transferMode === "move" && target.kind === "dashboard" ? "Заказы и клиенты не найдены. Уточните поиск." : "Заказы и клиенты не найдены. Можно выбрать главную."}</p> : null}
          {currentDestinations?.nextOffset !== null && currentDestinations?.nextOffset !== undefined && !destinationError ? <button type="button" disabled={pending || destinationLoading} onClick={() => setDestinationOffset(currentDestinations.nextOffset!)} className="focus-ring block w-full rounded-lg border border-[var(--line)] px-3 py-2 text-xs disabled:opacity-50">Показать ещё</button> : null}
        </div>
      </div> : null}
      {error ? <p role="alert" className="mt-3 text-xs text-red-600">{error}</p> : null}
      {notice ? <p role="status" className="mt-3 text-xs text-[var(--muted)]">{notice}</p> : null}
    </section>
  );
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "Не удалось выполнить действие. Попробуйте ещё раз.";
}


function ListProgress({ list, moreLabel }: { list: { items: { id: string }[]; total: number; nextOffset: number | null; loading: boolean; error: string; retry(): void; more(): void }; moreLabel: string }) {
  return <div className="mt-3 text-xs text-[var(--muted)]">
    {list.error ? <div role="alert"><p>{list.error}</p><button type="button" onClick={list.retry} className="focus-ring mt-2 rounded-lg border border-[var(--line)] px-3 py-2">Повторить поиск</button></div> : list.loading ? <p role="status">Поиск…</p> : null}
    {list.nextOffset !== null ? <button type="button" disabled={list.loading || Boolean(list.error)} onClick={list.more} className="focus-ring rounded-lg border border-[var(--line)] px-3 py-2 disabled:opacity-50">{moreLabel} · {list.items.length} из {list.total}</button> : null}
  </div>;
}
