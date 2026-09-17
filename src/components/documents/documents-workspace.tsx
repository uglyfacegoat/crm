"use client";

import {
  Archive,
  CalendarRange,
  Check,
  Download,
  FileCheck2,
  FileImage,
  FileSpreadsheet,
  FileText,
  History,
  LoaderCircle,
  ReceiptText,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Star,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { favoriteDocumentAction } from "@/app/(workspace)/documents/actions";
import {
  DocumentArchiveNavigator,
  getArchiveSelectionTitle,
} from "@/components/documents/document-archive-navigator";
import { EmptyDocumentsAction } from "@/components/documents/upload-document-dialog";
import { UploadDocumentVersionButton } from "@/components/documents/upload-document-version-dialog";
import { Dialog } from "@/components/ui/dialog";
import { formatDateInput, parseDateInput } from "@/lib/date-input";
import { matchesSearchText } from "@/lib/search-normalization";
import type {
  DocumentArchiveSelection,
  DocumentArchiveTree,
} from "@/server/documents/archive";
import {
  documentCategories,
  documentCategoryLabels,
  type DocumentCategory,
  type DocumentListItem,
  type DocumentUploadOptions,
} from "@/server/documents/types";

const categoryPresentation: Record<
  DocumentCategory,
  { icon: typeof FileText; color: string }
> = {
  contract: { icon: FileText, color: "var(--accent)" },
  act: { icon: FileCheck2, color: "var(--support)" },
  visit_card: { icon: FileCheck2, color: "var(--warning)" },
  invoice: { icon: ReceiptText, color: "var(--accent-strong)" },
  receipt: { icon: FileSpreadsheet, color: "var(--warning)" },
  photo: { icon: FileImage, color: "var(--support-strong)" },
  other: { icon: FileText, color: "var(--muted)" },
};

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Moscow",
});
type FavoriteFilter = "all" | "favorite" | "plain";
type DocumentSort = "newest" | "oldest" | "size-desc" | "size-asc";
type DocumentFilters = {
  category: "all" | DocumentCategory;
  favorite: FavoriteFilter;
  dateFrom: string;
  dateTo: string;
  sort: DocumentSort;
};
const defaultFilters: DocumentFilters = {
  category: "all",
  favorite: "all",
  dateFrom: "",
  dateTo: "",
  sort: "newest",
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} КБ`;
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(bytes / 1024 ** 2)} МБ`;
}

function FavoriteButton({ document }: { document: DocumentListItem }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={(event) => {
        event.stopPropagation();
        const formData = new FormData();
        formData.set("documentId", document.id);
        formData.set("favorite", String(!document.favorite));
        startTransition(async () => {
          await favoriteDocumentAction(formData);
          router.refresh();
        });
      }}
      aria-label={
        document.favorite ? "Убрать из избранного" : "Добавить в избранное"
      }
      className="focus-ring rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--accent)] disabled:opacity-45"
    >
      <Star
        className={`size-4 ${document.favorite ? "fill-[var(--accent)] text-[var(--accent)]" : ""}`}
      />
    </button>
  );
}

function SelectionButton({
  checked,
  label,
  onToggle,
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className={`focus-ring grid size-5 shrink-0 place-items-center rounded-[6px] border transition-colors ${checked ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--on-accent)]" : "border-[var(--line-strong)] bg-[var(--surface-inset)] text-transparent hover:border-[var(--accent)]/55"}`}
    >
      <Check className="size-3" strokeWidth={3} />
    </button>
  );
}

function FilterChoice<T extends string>({
  value,
  current,
  label,
  onChange,
}: {
  value: T;
  current: T;
  label: string;
  onChange: (value: T) => void;
}) {
  const selected = value === current;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onChange(value)}
      className={`focus-ring min-h-10 rounded-[11px] border px-3 text-left text-xs transition-colors ${selected ? "border-[var(--accent)]/35 bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "border-[var(--line)] text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"}`}
    >
      {label}
    </button>
  );
}

function DocumentDetails({
  document,
  related,
  canWrite,
  onClose,
  onSelect,
}: {
  document: DocumentListItem;
  related: DocumentListItem[];
  canWrite: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const presentation = categoryPresentation[document.category];
  const Icon = presentation.icon;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 p-2 sm:p-3 2xl:sticky 2xl:top-[5.25rem] 2xl:z-auto 2xl:h-[calc(100dvh-6.5rem)] 2xl:self-start 2xl:bg-transparent 2xl:p-0"
      onMouseDown={onClose}
    >
      <aside
        className="surface-panel ml-auto flex h-full w-full max-w-md flex-col overflow-y-auto p-4 sm:p-5 2xl:max-w-none"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span
            className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-[var(--surface-soft)]"
            style={{ color: presentation.color }}
          >
            <Icon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-base font-semibold leading-5 text-[var(--text)]">
              {document.title}
            </h2>
            <p className="mt-1 truncate text-xs text-[var(--muted)]">
              {document.clientName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть карточку"
            className="focus-ring rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-5 border-y border-[var(--line)] py-4">
          <p className="text-[9px] uppercase tracking-[0.15em] text-[var(--accent)]">
            Файл · версия {document.versionNumber}
          </p>
          <p className="mt-3 break-all text-sm font-medium text-[var(--text)]">
            {document.filename}
          </p>
          <p className="mt-2 text-[10px] text-[var(--muted)]">
            {formatBytes(document.sizeBytes)} ·{" "}
            {document.extension.toUpperCase()} · SHA‑256{" "}
            {document.sha256.slice(0, 10)}…
          </p>
        </div>
        <div className="mt-3 flex gap-2">
          <a
            href={`/api/v1/documents/${document.id}/download`}
            className="focus-ring flex h-11 flex-1 items-center justify-center gap-2 rounded-[12px] bg-[var(--accent)] px-3 text-xs font-semibold text-[var(--on-accent)]"
          >
            <Download className="size-4" />
            Скачать текущую
          </a>
          {canWrite ? (
            <UploadDocumentVersionButton document={document} />
          ) : null}
        </div>
        <dl className="mt-6 space-y-4 border-t border-[var(--line)] pt-5 text-xs">
          <div className="flex gap-4">
            <dt className="w-20 shrink-0 text-[var(--muted)]">Категория</dt>
            <dd className="text-[var(--text-secondary)]">
              {document.categoryLabel}
            </dd>
          </div>
          <div className="flex gap-4">
            <dt className="w-20 shrink-0 text-[var(--muted)]">Заказ</dt>
            <dd>
              <Link
                href={`/orders/${document.orderId}`}
                className="focus-ring rounded text-[var(--accent)] hover:underline"
              >
                №{document.orderNumber}
              </Link>
            </dd>
          </div>
          <div className="flex gap-4">
            <dt className="w-20 shrink-0 text-[var(--muted)]">Объект</dt>
            <dd className="text-[var(--text-secondary)]">
              {document.objectName}
              <span className="mt-1 block text-[10px] text-[var(--muted)]">
                {document.objectAddress}
              </span>
            </dd>
          </div>
          {document.visitScheduledStartAt ? (
            <div className="flex gap-4">
              <dt className="w-20 shrink-0 text-[var(--muted)]">Выезд</dt>
              <dd className="text-[var(--text-secondary)]">
                {dateFormatter.format(new Date(document.visitScheduledStartAt))}
              </dd>
            </div>
          ) : null}
          <div className="flex gap-4">
            <dt className="w-20 shrink-0 text-[var(--muted)]">Загрузил</dt>
            <dd className="text-[var(--text-secondary)]">
              {document.uploadedBy}
              <span className="mt-1 block text-[10px] text-[var(--muted)]">
                {dateFormatter.format(new Date(document.uploadedAt))}
              </span>
            </dd>
          </div>
          {document.description ? (
            <div className="flex gap-4">
              <dt className="w-20 shrink-0 text-[var(--muted)]">Описание</dt>
              <dd className="whitespace-pre-wrap text-[var(--text-secondary)]">
                {document.description}
              </dd>
            </div>
          ) : null}
        </dl>
        <div className="mt-6 border-t border-[var(--line)] pt-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <History className="size-4 text-[var(--accent)]" />
              <h3 className="text-xs font-semibold text-[var(--text)]">
                История версий
              </h3>
            </div>
            <span className="rounded-full bg-[var(--surface-soft)] px-2 py-1 text-[9px] text-[var(--muted)]">
              {document.versions.length}
            </span>
          </div>
          <ol className="mt-3 divide-y divide-[var(--line)]">
            {document.versions.map((version) => (
              <li key={version.id} className="py-3 first:pt-0">
                <div className="flex items-start gap-3">
                  <span
                    className={`grid size-8 shrink-0 place-items-center rounded-[10px] font-display text-xs font-semibold ${version.current ? "bg-[var(--accent)] text-[var(--on-accent)]" : "bg-[var(--surface-soft)] text-[var(--text-secondary)]"}`}
                  >
                    v{version.versionNumber}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="max-w-full truncate text-xs font-medium text-[var(--text)]">
                        {version.filename}
                      </p>
                      {version.current ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--success-bg)] px-2 py-0.5 text-[8px] uppercase tracking-[0.1em] text-[var(--success)]">
                          <Check className="size-2.5" />
                          Текущая
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[9px] text-[var(--muted)]">
                      {dateFormatter.format(new Date(version.uploadedAt))} ·{" "}
                      {version.uploadedBy}
                    </p>
                    {version.changeNote ? (
                      <p className="mt-2 text-[10px] leading-4 text-[var(--text-secondary)]">
                        {version.changeNote}
                      </p>
                    ) : null}
                    <p className="mt-2 text-[9px] text-[var(--muted-subtle)]">
                      {formatBytes(version.sizeBytes)} ·{" "}
                      {version.extension.toUpperCase()} ·{" "}
                      {version.sha256.slice(0, 10)}…
                    </p>
                  </div>
                  <a
                    href={`/api/v1/documents/${document.id}/versions/${version.id}/download`}
                    aria-label={`Скачать версию ${version.versionNumber}`}
                    title={`Скачать ${version.filename}`}
                    className="focus-ring grid size-9 shrink-0 place-items-center rounded-[10px] border border-[var(--line)] text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
                  >
                    <Download className="size-3.5" />
                  </a>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="mt-6 border-t border-[var(--line)] pt-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold text-[var(--text)]">
              Документы заказчика
            </h3>
            <span className="text-[10px] text-[var(--muted)]">
              {related.length}
            </span>
          </div>
          {related.length ? (
            <div className="mt-3 divide-y divide-[var(--line)]">
              {related.slice(0, 8).map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => onSelect(item.id)}
                  className="focus-ring flex w-full items-center gap-3 px-2.5 py-2.5 text-left hover:bg-[var(--surface-soft)]"
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor:
                        categoryPresentation[item.category].color,
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-[var(--text-secondary)]">
                      {item.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] text-[var(--muted)]">
                      №{item.orderNumber} · {item.objectAddress}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-[10px] leading-4 text-[var(--muted)]">
              Других файлов этого заказчика пока нет.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

export function DocumentsWorkspace({
  documents,
  archive,
  selection,
  uploadOptions,
  canWrite,
  initialDocumentId = null,
}: {
  documents: DocumentListItem[];
  archive: DocumentArchiveTree;
  selection: DocumentArchiveSelection;
  uploadOptions: DocumentUploadOptions;
  canWrite: boolean;
  initialDocumentId?: string | null;
}) {
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState(defaultFilters);
  const [draftFilters, setDraftFilters] = useState(defaultFilters);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    documents.some((document) => document.id === initialDocumentId)
      ? initialDocumentId
      : null,
  );
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const selected =
    documents.find((document) => document.id === selectedId) ?? null;
  const filtered = useMemo(() => {
    const dateFrom = parseDateInput(filters.dateFrom);
    const dateTo = parseDateInput(filters.dateTo);
    const visible = documents.filter((document) => {
      if (filters.category !== "all" && document.category !== filters.category)
        return false;
      if (filters.favorite === "favorite" && !document.favorite) return false;
      if (filters.favorite === "plain" && document.favorite) return false;
      if (dateFrom && document.uploadedAt.slice(0, 10) < dateFrom) return false;
      if (dateTo && document.uploadedAt.slice(0, 10) > dateTo) return false;
      return matchesSearchText(query, [
        document.title,
        document.filename,
        document.clientName,
        document.orderNumber,
        document.objectName,
        document.objectAddress,
        document.categoryLabel,
        document.uploadedBy,
      ]);
    });
    return visible.toSorted((left, right) => {
      if (filters.sort === "oldest")
        return left.uploadedAt.localeCompare(right.uploadedAt);
      if (filters.sort === "size-desc") return right.sizeBytes - left.sizeBytes;
      if (filters.sort === "size-asc") return left.sizeBytes - right.sizeBytes;
      return right.uploadedAt.localeCompare(left.uploadedAt);
    });
  }, [documents, filters, query]);
  const selectedDocuments = documents.filter((document) =>
    selectedDocumentIds.has(document.id),
  );
  const selectedBytes = selectedDocuments.reduce(
    (total, document) => total + document.sizeBytes,
    0,
  );
  const selectedVisible = filtered.filter((document) =>
    selectedDocumentIds.has(document.id),
  ).length;
  const allVisibleSelected =
    filtered.length > 0 && selectedVisible === filtered.length;
  const related = selected
    ? documents.filter(
        (document) =>
          document.clientId === selected.clientId &&
          document.id !== selected.id,
      )
    : [];
  const selectionTitle = getArchiveSelectionTitle(archive, selection);
  const advancedFilterCount = [
    filters.category !== "all",
    filters.favorite !== "all",
    Boolean(filters.dateFrom),
    Boolean(filters.dateTo),
    filters.sort !== "newest",
  ].filter(Boolean).length;

  function applyFilters() {
    const from = draftFilters.dateFrom
      ? parseDateInput(draftFilters.dateFrom)
      : null;
    const to = draftFilters.dateTo ? parseDateInput(draftFilters.dateTo) : null;
    if ((draftFilters.dateFrom && !from) || (draftFilters.dateTo && !to)) {
      setFilterError("Введите дату полностью в формате ДД.ММ.ГГГГ.");
      return;
    }
    if (from && to && from > to) {
      setFilterError("Начальная дата не может быть позже конечной.");
      return;
    }
    setFilters(draftFilters);
    setFiltersOpen(false);
  }

  function resetFilters() {
    setQuery("");
    setFilters(defaultFilters);
    setDraftFilters(defaultFilters);
    setFilterError(null);
  }

  function toggleDocument(documentId: string) {
    setExportError(null);
    if (
      !selectedDocumentIds.has(documentId) &&
      selectedDocumentIds.size >= 30
    ) {
      setExportError("В один архив можно добавить не больше 30 документов.");
      return;
    }
    setSelectedDocumentIds((current) => {
      const next = new Set(current);
      if (next.has(documentId)) next.delete(documentId);
      else next.add(documentId);
      return next;
    });
  }

  function toggleVisibleDocuments() {
    setExportError(null);
    setSelectedDocumentIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected)
        filtered.forEach((document) => next.delete(document.id));
      else {
        for (const document of filtered) {
          if (next.size >= 30) break;
          next.add(document.id);
        }
      }
      return next;
    });
    const visibleSelectionSize = new Set([
      ...selectedDocumentIds,
      ...filtered.map((document) => document.id),
    ]).size;
    if (!allVisibleSelected && visibleSelectionSize > 30)
      setExportError(
        "Выбраны первые 30 документов — это максимум одного архива.",
      );
  }

  async function exportDocuments() {
    if (
      !selectedDocumentIds.size ||
      selectedBytes > 50 * 1024 * 1024 ||
      exporting
    )
      return;
    setExporting(true);
    setExportError(null);
    try {
      const response = await fetch("/api/v1/documents/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentIds: [...selectedDocumentIds] }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(
          payload?.error?.message ?? "Не удалось сформировать архив.",
        );
      }
      const archive = await response.blob();
      const objectUrl = URL.createObjectURL(archive);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `crm-documents-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
    } catch (error) {
      setExportError(
        error instanceof Error
          ? error.message
          : "Не удалось сформировать архив.",
      );
    } finally {
      setExporting(false);
    }
  }

  if (!archive.documentCount)
    return (
      <section className="surface-panel mt-[clamp(1.5rem,1.1rem+0.8vw,2.25rem)] grid min-h-[20rem] place-items-center px-6 py-14 sm:py-20">
        <EmptyDocumentsAction options={uploadOptions} />
      </section>
    );

  return (
    <section
      className={`mt-[clamp(1.5rem,1.1rem+0.8vw,2.25rem)] grid min-h-[36rem] gap-5 ${selected ? "2xl:grid-cols-[20rem_minmax(0,1fr)_23rem]" : "lg:grid-cols-[20rem_minmax(0,1fr)]"}`}
    >
      <aside className="surface-panel min-w-0 p-3 lg:max-h-[calc(100vh-10rem)] lg:overflow-y-auto">
        <div className="mb-3 hidden border-b border-[var(--line)] px-2 pb-3 lg:block">
          <p className="text-[9px] uppercase tracking-[0.14em] text-[var(--accent)]">
            Структура архива
          </p>
          <p className="mt-1 text-[10px] text-[var(--muted)]">
            {archive.clientCount} клиентов · {archive.objectCount} объектов ·{" "}
            {archive.orderCount} заказов
          </p>
        </div>
        <DocumentArchiveNavigator archive={archive} selection={selection} />
      </aside>
      <div className="surface-panel min-w-0 overflow-hidden">
        <div className="border-b border-[var(--line)] p-3 sm:p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="text-[9px] uppercase tracking-[0.13em] text-[var(--muted)]">
                Открытая папка
              </p>
              <h2 className="mt-1 truncate font-display text-sm font-semibold text-[var(--text)]">
                {selectionTitle}
              </h2>
            </div>
            <p className="shrink-0 text-[10px] text-[var(--muted)]">
              {documents.length === 500
                ? "Показаны последние 500 файлов"
                : `${documents.length} файлов`}
            </p>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <label className="soft-button flex h-11 min-w-0 flex-1 items-center gap-2 rounded-[12px] px-3 sm:max-w-md">
              <Search className="size-4 text-[var(--muted)]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Документ, клиент, заказ, адрес или автор"
                className="min-w-0 flex-1 bg-transparent text-xs text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)]"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                setDraftFilters(filters);
                setFilterError(null);
                setFiltersOpen(true);
              }}
              className={`focus-ring flex h-11 shrink-0 items-center justify-center gap-2 rounded-[12px] border px-3 text-xs ${advancedFilterCount ? "border-[var(--accent)]/40 bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "border-[var(--line)] text-[var(--text-secondary)] hover:bg-[var(--surface-soft)]"}`}
            >
              <SlidersHorizontal className="size-4" />
              Фильтры
              {advancedFilterCount ? (
                <span className="grid min-w-5 place-items-center rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--on-accent)]">
                  {advancedFilterCount}
                </span>
              ) : null}
            </button>
            {query.trim() || advancedFilterCount ? (
              <button
                type="button"
                onClick={resetFilters}
                className="focus-ring flex h-11 shrink-0 items-center justify-center gap-2 rounded-[12px] border border-[var(--line)] px-3 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-soft)]"
              >
                <RotateCcw className="size-3.5" />
                Сбросить
              </button>
            ) : null}
            {selectedDocumentIds.size ? (
              <div className="flex min-h-11 flex-wrap items-center gap-2 border-y border-[var(--accent)]/30 bg-[var(--accent-soft)] px-3">
                <Archive className="size-4 text-[var(--accent)]" />
                <span className="text-[10px] text-[var(--text-secondary)]">
                  {selectedDocumentIds.size} · {formatBytes(selectedBytes)}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedDocumentIds(new Set())}
                  className="focus-ring rounded-md px-1.5 py-1 text-[9px] text-[var(--text-secondary)] hover:text-[var(--text)]"
                >
                  Сбросить выбор
                </button>
                <button
                  type="button"
                  disabled={exporting || selectedBytes > 50 * 1024 * 1024}
                  onClick={exportDocuments}
                  className="focus-ring ml-auto flex h-8 items-center gap-1.5 rounded-[9px] bg-[var(--accent)] px-3 text-[10px] font-semibold text-[var(--on-accent)] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {exporting ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : (
                    <Download className="size-3.5" />
                  )}
                  {exporting ? "Архивируем" : "Скачать ZIP"}
                </button>
              </div>
            ) : null}
          </div>
          {selectedBytes > 50 * 1024 * 1024 ? (
            <p
              role="alert"
              className="mt-2 text-[10px] text-[var(--danger-ink)]"
            >
              Общий размер превышает допустимые 50 МБ.
            </p>
          ) : exportError ? (
            <p
              role="alert"
              className="mt-2 text-[10px] text-[var(--danger-ink)]"
            >
              {exportError}
            </p>
          ) : null}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[800px] text-left">
            <thead>
              <tr className="text-[9px] uppercase tracking-[0.11em] text-[var(--muted)]">
                <th className="w-12 px-4 py-3 font-medium">
                  <SelectionButton
                    checked={allVisibleSelected}
                    label={
                      allVisibleSelected
                        ? "Снять выбор со всех видимых документов"
                        : "Выбрать все видимые документы"
                    }
                    onToggle={toggleVisibleDocuments}
                  />
                </th>
                <th className="px-3 py-3 font-medium">Название</th>
                <th className="px-3 py-3 font-medium">Тип</th>
                <th className="px-3 py-3 font-medium">Связан с</th>
                <th className="px-3 py-3 font-medium">Загружен</th>
                <th className="px-4 py-3 text-right font-medium">Размер</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {filtered.map((document) => {
                const presentation = categoryPresentation[document.category];
                const Icon = presentation.icon;
                return (
                  <tr
                    key={document.id}
                    onClick={() => setSelectedId(document.id)}
                    className={`cursor-pointer transition-colors hover:bg-[var(--surface-raised)] ${selectedId === document.id ? "bg-[var(--surface-soft)]" : ""}`}
                  >
                    <td className="px-4 py-3">
                      <SelectionButton
                        checked={selectedDocumentIds.has(document.id)}
                        label={`${selectedDocumentIds.has(document.id) ? "Исключить" : "Добавить"} ${document.title} ${selectedDocumentIds.has(document.id) ? "из" : "в"} архив`}
                        onToggle={() => toggleDocument(document.id)}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[var(--surface-soft)]"
                          style={{ color: presentation.color }}
                        >
                          <Icon className="size-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-[var(--text)]">
                            {document.title}
                          </p>
                          <p className="mt-1 truncate text-[10px] text-[var(--muted)]">
                            {document.clientName}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs text-[var(--text-secondary)]">
                      {document.categoryLabel}
                    </td>
                    <td className="px-3 py-3">
                      <p className="text-xs text-[var(--text-secondary)]">
                        Заказ №{document.orderNumber}
                      </p>
                      <p className="mt-1 max-w-56 truncate text-[10px] text-[var(--muted)]">
                        {document.objectAddress}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <p className="text-xs text-[var(--text-secondary)]">
                        {dateFormatter.format(new Date(document.uploadedAt))}
                      </p>
                      <p className="mt-1 text-[10px] text-[var(--muted)]">
                        {document.uploadedBy}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-3">
                        <span className="text-xs text-[var(--text-secondary)]">
                          {formatBytes(document.sizeBytes)}
                        </span>
                        <FavoriteButton document={document} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="divide-y divide-[var(--line)] md:hidden">
          {filtered.map((document) => {
            const Icon = categoryPresentation[document.category].icon;
            return (
              <article key={document.id} className="flex items-start gap-3 p-4">
                <SelectionButton
                  checked={selectedDocumentIds.has(document.id)}
                  label={`${selectedDocumentIds.has(document.id) ? "Исключить" : "Добавить"} ${document.title} ${selectedDocumentIds.has(document.id) ? "из" : "в"} архив`}
                  onToggle={() => toggleDocument(document.id)}
                />
                <button
                  type="button"
                  onClick={() => setSelectedId(document.id)}
                  className="focus-ring flex min-w-0 flex-1 items-start gap-3 text-left"
                >
                  <span
                    className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-[10px] bg-[var(--surface-soft)]"
                    style={{
                      color: categoryPresentation[document.category].color,
                    }}
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-[var(--text)]">
                      {document.title}
                    </span>
                    <span className="mt-1 block truncate text-xs text-[var(--muted)]">
                      {document.clientName}
                    </span>
                    <span className="mt-2 block text-[10px] text-[var(--muted-subtle)]">
                      №{document.orderNumber} ·{" "}
                      {formatBytes(document.sizeBytes)}
                    </span>
                  </span>
                </button>
              </article>
            );
          })}
        </div>
        {!filtered.length ? (
          <div className="border-y border-[var(--line)] px-6 py-12 text-center">
            <p className="text-sm text-[var(--muted)]">
              Документы по выбранным условиям не найдены
            </p>
            <button
              type="button"
              onClick={resetFilters}
              className="focus-ring mt-4 rounded-[10px] border border-[var(--line)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-soft)]"
            >
              Сбросить фильтры
            </button>
          </div>
        ) : null}
        <footer className="flex items-center justify-between gap-3 border-t border-[var(--line)] px-4 py-3 text-[10px] text-[var(--muted)]">
          <span>
            Показано {filtered.length} из {documents.length}
          </span>
          <span>
            {advancedFilterCount
              ? `${advancedFilterCount} активных условий`
              : "Без ограничений"}
          </span>
        </footer>
      </div>
      {selected ? (
        <DocumentDetails
          document={selected}
          related={related}
          canWrite={canWrite}
          onClose={() => setSelectedId(null)}
          onSelect={setSelectedId}
        />
      ) : null}
      <Dialog
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Фильтры документов"
        description="Отберите файлы по категории, избранному, дате загрузки и порядку отображения."
      >
        <div className="space-y-7 p-5 sm:p-7">
          <fieldset>
            <legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">
              Категория
            </legend>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
              <FilterChoice
                value="all"
                current={draftFilters.category}
                label="Все категории"
                onChange={(category) =>
                  setDraftFilters((current) => ({ ...current, category }))
                }
              />
              {documentCategories.map((category) => (
                <FilterChoice
                  key={category}
                  value={category}
                  current={draftFilters.category}
                  label={documentCategoryLabels[category]}
                  onChange={(selectedCategory) =>
                    setDraftFilters((current) => ({
                      ...current,
                      category: selectedCategory,
                    }))
                  }
                />
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">
              Избранное
            </legend>
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
              <FilterChoice
                value="all"
                current={draftFilters.favorite}
                label="Все файлы"
                onChange={(favorite) =>
                  setDraftFilters((current) => ({ ...current, favorite }))
                }
              />
              <FilterChoice
                value="favorite"
                current={draftFilters.favorite}
                label="Только избранные"
                onChange={(favorite) =>
                  setDraftFilters((current) => ({ ...current, favorite }))
                }
              />
              <FilterChoice
                value="plain"
                current={draftFilters.favorite}
                label="Без отметки"
                onChange={(favorite) =>
                  setDraftFilters((current) => ({ ...current, favorite }))
                }
              />
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">
              <CalendarRange className="size-3.5" />
              Дата загрузки
            </legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                <span className="mb-2 block text-[10px] text-[var(--muted)]">
                  С даты
                </span>
                <input
                  inputMode="numeric"
                  value={draftFilters.dateFrom}
                  onChange={(event) =>
                    setDraftFilters((current) => ({
                      ...current,
                      dateFrom: formatDateInput(event.target.value),
                    }))
                  }
                  placeholder="ДД.ММ.ГГГГ"
                  className="focus-ring h-11 w-full rounded-[12px] border border-[var(--line-strong)] bg-[var(--surface-inset)] px-3 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)] focus:border-[var(--accent)]/55"
                />
              </label>
              <label>
                <span className="mb-2 block text-[10px] text-[var(--muted)]">
                  По дату
                </span>
                <input
                  inputMode="numeric"
                  value={draftFilters.dateTo}
                  onChange={(event) =>
                    setDraftFilters((current) => ({
                      ...current,
                      dateTo: formatDateInput(event.target.value),
                    }))
                  }
                  placeholder="ДД.ММ.ГГГГ"
                  className="focus-ring h-11 w-full rounded-[12px] border border-[var(--line-strong)] bg-[var(--surface-inset)] px-3 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)] focus:border-[var(--accent)]/55"
                />
              </label>
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">
              Сортировка
            </legend>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
              <FilterChoice
                value="newest"
                current={draftFilters.sort}
                label="Сначала новые"
                onChange={(sort) =>
                  setDraftFilters((current) => ({ ...current, sort }))
                }
              />
              <FilterChoice
                value="oldest"
                current={draftFilters.sort}
                label="Сначала старые"
                onChange={(sort) =>
                  setDraftFilters((current) => ({ ...current, sort }))
                }
              />
              <FilterChoice
                value="size-desc"
                current={draftFilters.sort}
                label="Сначала большие"
                onChange={(sort) =>
                  setDraftFilters((current) => ({ ...current, sort }))
                }
              />
              <FilterChoice
                value="size-asc"
                current={draftFilters.sort}
                label="Сначала маленькие"
                onChange={(sort) =>
                  setDraftFilters((current) => ({ ...current, sort }))
                }
              />
            </div>
          </fieldset>
          {filterError ? (
            <p
              role="alert"
              className="rounded-[12px] border border-[var(--danger-border)]/45 bg-[var(--danger-bg)] p-3 text-xs text-[var(--danger-ink)]"
            >
              {filterError}
            </p>
          ) : null}
        </div>
        <footer className="sticky bottom-0 mt-auto grid shrink-0 grid-cols-[auto_minmax(0,1fr)] gap-2 border-t border-[var(--line)] bg-[var(--surface-raised)] p-4 backdrop-blur-xl sm:p-5">
          <button
            type="button"
            onClick={() => {
              setDraftFilters(defaultFilters);
              setFilterError(null);
            }}
            className="focus-ring h-11 rounded-[12px] border border-[var(--line-strong)] px-4 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-soft)]"
          >
            <RotateCcw className="mr-2 inline size-3.5" />
            Очистить
          </button>
          <button
            type="button"
            onClick={applyFilters}
            className="focus-ring h-11 rounded-[12px] bg-[var(--accent)] px-4 text-xs font-semibold text-[var(--on-accent)]"
          >
            Показать документы
          </button>
        </footer>
      </Dialog>
    </section>
  );
}
