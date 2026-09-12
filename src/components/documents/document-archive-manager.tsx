"use client";

import {
  ArrowRight,
  Check,
  ChevronRight,
  Download,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GripVertical,
  Home,
  LoaderCircle,
  MoveRight,
  Search,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useActionState,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import {
  createDocumentFolderAction,
  moveArchiveItemsAction,
  type DocumentArchiveActionState,
} from "@/app/(workspace)/documents/actions";
import { Dialog } from "@/components/ui/dialog";
import { matchesSearchText } from "@/lib/search-normalization";
import type {
  DocumentFolder,
  DocumentListItem,
} from "@/server/documents/types";

const initialState: DocumentArchiveActionState = {
  status: "idle",
  message: null,
};
type SelectionKey = `folder:${string}` | `document:${string}`;

function folderPath(
  folderId: string | null,
  foldersById: Map<string, DocumentFolder>,
) {
  const path: DocumentFolder[] = [];
  const visited = new Set<string>();
  let currentId = folderId;
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const folder = foldersById.get(currentId);
    if (!folder) break;
    path.unshift(folder);
    currentId = folder.parentFolderId;
  }
  return path;
}

function selectedIds(selection: Set<SelectionKey>) {
  const folderIds: string[] = [];
  const documentIds: string[] = [];
  selection.forEach((key) => {
    const [kind, id] = key.split(":", 2);
    if (kind === "folder") folderIds.push(id);
    if (kind === "document") documentIds.push(id);
  });
  return { folderIds, documentIds };
}

function CreateFolderDialog({
  open,
  parentFolderId,
  onClose,
}: {
  open: boolean;
  parentFolderId: string | null;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(
    createDocumentFolderAction,
    initialState,
  );
  const router = useRouter();
  useEffect(() => {
    if (state.status !== "success") return;
    const timeout = window.setTimeout(() => {
      onClose();
      router.refresh();
    }, 450);
    return () => window.clearTimeout(timeout);
  }, [onClose, router, state.status]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Новая папка"
      description="Папка появится в текущем разделе архива."
    >
      <form action={action} className="flex min-h-full flex-1 flex-col">
        <input
          type="hidden"
          name="parentFolderId"
          value={parentFolderId ?? ""}
        />
        <div className="flex-1 p-5 sm:p-7">
          <label className="block">
            <span className="mb-2 block text-[10px] font-medium text-[var(--text-secondary)]">
              Название папки
            </span>
            <input
              name="name"
              required
              minLength={1}
              maxLength={120}
              autoFocus
              placeholder="Например, Договоры 2026"
              className="focus-ring h-12 w-full rounded-[12px] border border-[var(--line-strong)] bg-[var(--surface-inset)] px-3.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)]"
            />
          </label>
          {state.message ? (
            <p
              role="status"
              className={`mt-4 rounded-[12px] border p-3 text-xs ${state.status === "error" ? "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-ink)]" : "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]"}`}
            >
              {state.message}
            </p>
          ) : null}
        </div>
        <footer className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 border-t border-[var(--line)] p-4 sm:p-5">
          <button
            type="button"
            onClick={onClose}
            className="focus-ring h-11 rounded-[12px] border border-[var(--line)] px-4 text-xs text-[var(--text-secondary)]"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={pending}
            className="focus-ring flex h-11 items-center justify-center gap-2 rounded-[12px] bg-[var(--accent)] px-4 text-xs font-semibold text-[var(--on-accent)] disabled:opacity-50"
          >
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <FolderPlus className="size-4" />
            )}
            Создать папку
          </button>
        </footer>
      </form>
    </Dialog>
  );
}

function MoveDialog({
  open,
  selection,
  folders,
  onClose,
  onMoved,
}: {
  open: boolean;
  selection: Set<SelectionKey>;
  folders: DocumentFolder[];
  onClose: () => void;
  onMoved: () => void;
}) {
  const [state, action, pending] = useActionState(
    moveArchiveItemsAction,
    initialState,
  );
  const [targetFolderId, setTargetFolderId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const ids = selectedIds(selection);
  const selectedFolderIds = new Set(ids.folderIds);
  const visibleFolders = folders.filter(
    (folder) =>
      !selectedFolderIds.has(folder.id) &&
      matchesSearchText(query, [
        folder.name,
        ...folderPath(
          folder.id,
          new Map(folders.map((entry) => [entry.id, entry])),
        ).map((entry) => entry.name),
      ]),
  );
  useEffect(() => {
    if (state.status !== "success") return;
    const timeout = window.setTimeout(onMoved, 450);
    return () => window.clearTimeout(timeout);
  }, [onMoved, state.status]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Перенести выбранное"
      description={`${selection.size} элементов будут перемещены одной операцией.`}
    >
      <form action={action} className="flex min-h-full flex-1 flex-col">
        <input
          type="hidden"
          name="folderIds"
          value={JSON.stringify(ids.folderIds)}
        />
        <input
          type="hidden"
          name="documentIds"
          value={JSON.stringify(ids.documentIds)}
        />
        <input
          type="hidden"
          name="targetFolderId"
          value={targetFolderId ?? ""}
        />
        <div className="flex min-h-0 flex-1 flex-col p-5 sm:p-7">
          <label className="flex h-11 shrink-0 items-center gap-2 rounded-[12px] border border-[var(--line-strong)] bg-[var(--surface-inset)] px-3">
            <Search className="size-4 text-[var(--muted)]" />
            <span className="sr-only">Быстрый поиск папки</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Быстрый поиск места назначения"
              className="min-w-0 flex-1 bg-transparent text-xs text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)]"
            />
          </label>
          <div
            className="mt-4 min-h-0 flex-1 space-y-1 overflow-y-auto"
            role="radiogroup"
            aria-label="Папка назначения"
          >
            <button
              type="button"
              role="radio"
              aria-checked={targetFolderId === null}
              onClick={() => setTargetFolderId(null)}
              className={`focus-ring flex min-h-11 w-full items-center gap-3 rounded-[11px] px-3 text-left text-xs ${targetFolderId === null ? "bg-[var(--accent)] text-[var(--on-accent)]" : "hover:bg-[var(--surface-soft)] text-[var(--text-secondary)]"}`}
            >
              <Home className="size-4" />
              <span className="flex-1">Корень архива</span>
              {targetFolderId === null ? <Check className="size-4" /> : null}
            </button>
            {visibleFolders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                role="radio"
                aria-checked={targetFolderId === folder.id}
                onClick={() => setTargetFolderId(folder.id)}
                className={`focus-ring flex min-h-11 w-full items-center gap-3 rounded-[11px] px-3 text-left text-xs ${targetFolderId === folder.id ? "bg-[var(--accent)] text-[var(--on-accent)]" : "hover:bg-[var(--surface-soft)] text-[var(--text-secondary)]"}`}
              >
                <Folder className="size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{folder.name}</span>
                  <span className="mt-0.5 block truncate text-[9px] opacity-60">
                    {folderPath(
                      folder.parentFolderId,
                      new Map(folders.map((entry) => [entry.id, entry])),
                    )
                      .map((entry) => entry.name)
                      .join(" / ") || "Корень"}
                  </span>
                </span>
                {targetFolderId === folder.id ? (
                  <Check className="size-4" />
                ) : null}
              </button>
            ))}
          </div>
          {state.message ? (
            <p
              role="status"
              className={`mt-4 rounded-[12px] border p-3 text-xs ${state.status === "error" ? "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-ink)]" : "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]"}`}
            >
              {state.message}
            </p>
          ) : null}
        </div>
        <footer className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 border-t border-[var(--line)] p-4 sm:p-5">
          <button
            type="button"
            onClick={onClose}
            className="focus-ring h-11 rounded-[12px] border border-[var(--line)] px-4 text-xs text-[var(--text-secondary)]"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={pending}
            className="focus-ring flex h-11 items-center justify-center gap-2 rounded-[12px] bg-[var(--accent)] px-4 text-xs font-semibold text-[var(--on-accent)] disabled:opacity-50"
          >
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <MoveRight className="size-4" />
            )}
            Перенести
          </button>
        </footer>
      </form>
    </Dialog>
  );
}

export function DocumentArchiveManager({
  folders,
  documents,
  canWrite,
}: {
  folders: DocumentFolder[];
  documents: DocumentListItem[];
  canWrite: boolean;
}) {
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Set<SelectionKey>>(new Set());
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [moving, startMoving] = useTransition();
  const router = useRouter();
  const foldersById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders],
  );
  const path = folderPath(currentFolderId, foldersById);
  const searching = Boolean(query.trim());
  const visibleFolders = folders.filter((folder) =>
    searching
      ? matchesSearchText(query, [
          folder.name,
          ...folderPath(folder.parentFolderId, foldersById).map(
            (entry) => entry.name,
          ),
        ])
      : folder.parentFolderId === currentFolderId,
  );
  const visibleDocuments = documents.filter((document) =>
    searching
      ? matchesSearchText(query, [
          document.title,
          document.filename,
          document.clientName,
          document.orderNumber,
          document.categoryLabel,
        ])
      : document.folderId === currentFolderId,
  );

  function toggle(key: SelectionKey) {
    setSelection((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function openFolder(folderId: string) {
    setCurrentFolderId(folderId);
    setQuery("");
    setSelection(new Set());
  }

  function moveDragged(key: SelectionKey, targetFolderId: string | null) {
    if (!canWrite || moving) return;
    const keys = selection.has(key) ? selection : new Set([key]);
    const ids = selectedIds(keys);
    const formData = new FormData();
    formData.set("folderIds", JSON.stringify(ids.folderIds));
    formData.set("documentIds", JSON.stringify(ids.documentIds));
    formData.set("targetFolderId", targetFolderId ?? "");
    startMoving(async () => {
      const result = await moveArchiveItemsAction(initialState, formData);
      setMessage(result.message);
      if (result.status === "success") {
        setSelection(new Set());
        router.refresh();
      }
    });
  }

  return (
    <div className="mt-7 space-y-4">
      <section className="surface-panel p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-[12px] border border-[var(--line-strong)] bg-[var(--surface-inset)] px-3 lg:max-w-xl">
            <Search className="size-4 text-[var(--muted)]" />
            <span className="sr-only">Поиск по архиву</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Папка, файл, клиент, заказ или категория"
              className="min-w-0 flex-1 bg-transparent text-xs text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)]"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Очистить поиск"
                className="focus-ring rounded-md p-1 text-[var(--muted)]"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </label>
          <div className="flex flex-wrap gap-2 lg:ml-auto">
            {selection.size ? (
              <button
                type="button"
                onClick={() => setMoveOpen(true)}
                disabled={!canWrite}
                className="focus-ring flex h-11 items-center gap-2 rounded-[12px] bg-[var(--accent)] px-4 text-xs font-semibold text-[var(--on-accent)] disabled:opacity-45"
              >
                <MoveRight className="size-4" />
                Перенести · {selection.size}
              </button>
            ) : null}
            {selection.size ? (
              <button
                type="button"
                onClick={() => setSelection(new Set())}
                className="focus-ring h-11 rounded-[12px] border border-[var(--line)] px-3 text-xs text-[var(--text-secondary)]"
              >
                Снять выбор
              </button>
            ) : null}
            {canWrite ? (
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="focus-ring flex h-11 items-center gap-2 rounded-[12px] border border-[var(--line-strong)] px-4 text-xs font-medium text-[var(--text)]"
              >
                <FolderPlus className="size-4" />
                Новая папка
              </button>
            ) : null}
          </div>
        </div>
        <div className="mt-4 flex min-w-0 items-center gap-1 overflow-x-auto text-[10px] text-[var(--muted)]">
          <button
            type="button"
            onClick={() => {
              setCurrentFolderId(null);
              setSelection(new Set());
            }}
            onDragOver={(event) => {
              if (canWrite) event.preventDefault();
            }}
            onDrop={(event) => {
              const key = event.dataTransfer.getData(
                "text/archive-key",
              ) as SelectionKey;
              if (key) moveDragged(key, null);
            }}
            className="focus-ring flex shrink-0 items-center gap-1.5 rounded-[9px] px-2 py-1.5 hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
          >
            <Home className="size-3.5" />
            Архив
          </button>
          {path.map((folder) => (
            <span key={folder.id} className="flex min-w-0 items-center gap-1">
              <ChevronRight className="size-3 shrink-0" />
              <button
                type="button"
                onClick={() => openFolder(folder.id)}
                className="focus-ring max-w-44 truncate rounded-[9px] px-2 py-1.5 hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
              >
                {folder.name}
              </button>
            </span>
          ))}
          {searching ? (
            <>
              <ChevronRight className="size-3 shrink-0" />
              <span className="shrink-0 text-[var(--text-secondary)]">
                Результаты по всему архиву
              </span>
            </>
          ) : null}
        </div>
        {message ? (
          <p
            role="status"
            className="mt-3 text-[10px] text-[var(--text-secondary)]"
          >
            {message}
          </p>
        ) : null}
      </section>

      <section className="surface-panel min-h-[28rem]">
        <header className="grid grid-cols-[2.5rem_minmax(0,1fr)_8rem_auto] items-center gap-3 border-b border-[var(--line)] px-4 py-3 text-[9px] uppercase tracking-[0.12em] text-[var(--muted)] sm:px-5">
          <span />
          <span>Название</span>
          <span className="hidden sm:block">Тип / связь</span>
          <span>Действие</span>
        </header>
        <div className="divide-y divide-[var(--line)]">
          {visibleFolders.map((folder) => {
            const key: SelectionKey = `folder:${folder.id}`;
            const selected = selection.has(key);
            return (
              <article
                key={folder.id}
                draggable={canWrite}
                onDragStart={(event) =>
                  event.dataTransfer.setData("text/archive-key", key)
                }
                onDragOver={(event) => {
                  if (canWrite) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const source = event.dataTransfer.getData(
                    "text/archive-key",
                  ) as SelectionKey;
                  if (source && source !== key) moveDragged(source, folder.id);
                }}
                className={`grid min-h-16 grid-cols-[2.5rem_minmax(0,1fr)_8rem_auto] items-center gap-3 px-4 py-3 sm:px-5 ${selected ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--surface-soft)]"}`}
              >
                <label className="grid size-8 place-items-center">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggle(key)}
                    disabled={!canWrite}
                    aria-label={`Выбрать папку ${folder.name}`}
                    className="size-4 accent-[var(--accent)]"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => openFolder(folder.id)}
                  className="focus-ring flex min-w-0 items-center gap-3 rounded-[10px] text-left"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[var(--surface-inset)] text-[var(--text-secondary)]">
                    <FolderOpen className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <strong className="block truncate text-xs font-medium text-[var(--text)]">
                      {folder.name}
                    </strong>
                    <span className="mt-1 block text-[9px] text-[var(--muted)]">
                      {folder.documentCount} файлов непосредственно внутри
                    </span>
                  </span>
                </button>
                <span className="hidden text-[10px] text-[var(--muted)] sm:block">
                  Папка
                </span>
                <span className="flex items-center gap-2">
                  {canWrite ? (
                    <GripVertical className="size-4 cursor-grab text-[var(--muted-subtle)]" />
                  ) : null}
                  <button
                    type="button"
                    onClick={() => openFolder(folder.id)}
                    aria-label={`Открыть ${folder.name}`}
                    className="focus-ring grid size-9 place-items-center rounded-[10px] border border-[var(--line)] text-[var(--muted)]"
                  >
                    <ArrowRight className="size-4" />
                  </button>
                </span>
              </article>
            );
          })}
          {visibleDocuments.map((document) => {
            const key: SelectionKey = `document:${document.id}`;
            const selected = selection.has(key);
            return (
              <article
                key={document.id}
                draggable={canWrite}
                onDragStart={(event) =>
                  event.dataTransfer.setData("text/archive-key", key)
                }
                className={`grid min-h-16 grid-cols-[2.5rem_minmax(0,1fr)_8rem_auto] items-center gap-3 px-4 py-3 sm:px-5 ${selected ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--surface-soft)]"}`}
              >
                <label className="grid size-8 place-items-center">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggle(key)}
                    disabled={!canWrite}
                    aria-label={`Выбрать документ ${document.title}`}
                    className="size-4 accent-[var(--accent)]"
                  />
                </label>
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[var(--surface-inset)] text-[var(--muted)]">
                    <FileText className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <strong className="block truncate text-xs font-medium text-[var(--text)]">
                      {document.title}
                    </strong>
                    <span className="mt-1 block truncate text-[9px] text-[var(--muted)]">
                      {document.filename} · заказ {document.orderNumber}
                    </span>
                  </span>
                </div>
                <span className="hidden text-[10px] text-[var(--muted)] sm:block">
                  {document.categoryLabel}
                </span>
                <span className="flex items-center gap-2">
                  {canWrite ? (
                    <GripVertical className="size-4 cursor-grab text-[var(--muted-subtle)]" />
                  ) : null}
                  <a
                    href={`/api/v1/documents/${document.id}/download`}
                    aria-label={`Скачать ${document.title}`}
                    className="focus-ring grid size-9 place-items-center rounded-[10px] border border-[var(--line)] text-[var(--muted)]"
                  >
                    <Download className="size-4" />
                  </a>
                </span>
              </article>
            );
          })}
        </div>
        {!visibleFolders.length && !visibleDocuments.length ? (
          <div className="grid min-h-80 place-items-center p-8 text-center">
            <div>
              <Folder className="mx-auto size-8 text-[var(--muted-subtle)]" />
              <p className="mt-3 text-sm text-[var(--text-secondary)]">
                {searching ? "Ничего не найдено" : "Папка пока пустая"}
              </p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {searching
                  ? "Проверьте запрос или очистите поиск."
                  : "Создайте подпапку или перенесите сюда документы."}
              </p>
            </div>
          </div>
        ) : null}
      </section>
      {moving ? (
        <p className="flex items-center gap-2 text-xs text-[var(--muted)]">
          <LoaderCircle className="size-4 animate-spin" />
          Переносим выбранное…
        </p>
      ) : null}
      <CreateFolderDialog
        key={`${currentFolderId ?? "root"}:${createOpen}`}
        open={createOpen}
        parentFolderId={currentFolderId}
        onClose={() => setCreateOpen(false)}
      />
      <MoveDialog
        key={`${selection.size}:${moveOpen}`}
        open={moveOpen}
        selection={selection}
        folders={folders}
        onClose={() => setMoveOpen(false)}
        onMoved={() => {
          setMoveOpen(false);
          setSelection(new Set());
          router.refresh();
        }}
      />
    </div>
  );
}
