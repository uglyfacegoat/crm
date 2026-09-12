"use client";

import {
  ArrowLeft,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileText,
  History,
  MapPin,
  Pencil,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  ContractDialogs,
  type ContractDialogMode,
} from "@/components/contracts/contract-dialogs";
import type {
  ContractHistoryEvent,
  ContractListItem,
} from "@/server/contracts/types";
import type { DocumentListItem } from "@/server/documents/types";

const statusPresentation = {
  draft: {
    label: "Черновик",
    className:
      "border-[var(--line-strong)] bg-[var(--surface-inset)] text-[var(--text-secondary)]",
  },
  active: {
    label: "Действует",
    className:
      "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]",
  },
  suspended: {
    label: "Приостановлен",
    className:
      "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)]",
  },
  completed: {
    label: "Завершён",
    className:
      "border-[var(--info-border)] bg-[var(--info-bg)] text-[var(--info)]",
  },
  cancelled: {
    label: "Отменён",
    className:
      "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-ink)]",
  },
} as const;
const eventLabels = {
  created: "Договор создан",
  updated: "Данные изменены",
  status_changed: "Статус изменён",
  renewed: "Создано продление",
} as const;
const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});
const eventFormatter = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Moscow",
});

function formatDate(value: string) {
  return dateFormatter.format(new Date(`${value}T12:00:00Z`));
}

function DocumentPreview({ document }: { document: DocumentListItem }) {
  const source = `/api/v1/documents/${document.id}/download?disposition=inline`;
  const wordPreview = document.extension === "docx";
  const previewable =
    document.mimeType === "application/pdf" ||
    document.mimeType.startsWith("image/") ||
    wordPreview;
  if (!previewable)
    return (
      <div className="grid h-full min-h-[32rem] place-items-center p-8 text-center">
        <div>
          <FileText className="mx-auto size-10 text-[var(--muted-subtle)]" />
          <p className="mt-4 text-sm font-medium text-[var(--text)]">
            Формат {document.extension.toUpperCase()} открывается во внешнем
            редакторе
          </p>
          <a
            href={`/api/v1/documents/${document.id}/download`}
            className="focus-ring mt-5 inline-flex h-11 items-center gap-2 rounded-[12px] bg-[var(--accent)] px-4 text-xs font-semibold text-[var(--on-accent)]"
          >
            <Download className="size-4" />
            Скачать файл
          </a>
        </div>
      </div>
    );
  if (wordPreview)
    return (
      <iframe
        src={`/api/v1/documents/${document.id}/preview`}
        title={`Просмотр документа ${document.title}`}
        sandbox="allow-same-origin"
        className="h-full min-h-[32rem] w-full bg-white"
      />
    );
  return (
    <object
      data={source}
      type={document.mimeType}
      aria-label={`Просмотр документа ${document.title}`}
      className="h-full min-h-[32rem] w-full bg-white"
    >
      <div className="grid h-full place-items-center p-8 text-center">
        <p className="text-sm text-black">Браузер не смог показать файл.</p>
        <a
          href={`/api/v1/documents/${document.id}/download`}
          className="mt-3 text-sm text-black underline"
        >
          Скачать документ
        </a>
      </div>
    </object>
  );
}

export function ContractDetailWorkspace({
  contract,
  documents,
  history,
  canWrite,
  currentDate,
}: {
  contract: ContractListItem;
  documents: DocumentListItem[];
  history: ContractHistoryEvent[];
  canWrite: boolean;
  currentDate: string;
}) {
  const [documentIndex, setDocumentIndex] = useState(0);
  const [dialogMode, setDialogMode] = useState<ContractDialogMode>(null);
  const currentDocument = documents[documentIndex] ?? null;
  const presentation = statusPresentation[contract.status];
  const start = Date.parse(`${contract.startsOn}T00:00:00Z`);
  const end = Date.parse(`${contract.endsOn}T00:00:00Z`);
  const today = Date.parse(`${currentDate}T00:00:00Z`);
  const periodPercent = Math.max(
    0,
    Math.min(
      100,
      Math.round(((today - start) / Math.max(1, end - start)) * 100),
    ),
  );

  return (
    <div className="space-y-5">
      <Link
        href="/contracts"
        className="focus-ring inline-flex items-center gap-2 rounded-[9px] text-xs text-[var(--muted)] hover:text-[var(--text)]"
      >
        <ArrowLeft className="size-4" />К договорам
      </Link>
      <header className="surface-panel p-5 sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full border px-2.5 py-1 text-[9px] ${presentation.className}`}
              >
                {presentation.label}
              </span>
              <span className="text-[10px] text-[var(--muted)]">
                Версия {contract.version}
              </span>
            </div>
            <h1 className="mt-4 font-display text-[clamp(1.8rem,1.3rem+1.5vw,3rem)] font-semibold tracking-[-0.05em] text-[var(--text)]">
              {contract.contractNumber}
            </h1>
            <p className="mt-3 text-sm text-[var(--text-secondary)]">
              {contract.clientName}
            </p>
            <p className="mt-2 flex items-center gap-2 text-xs text-[var(--muted)]">
              <MapPin className="size-4" />
              {contract.objectName} · {contract.objectAddress}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canWrite ? (
              <button
                type="button"
                onClick={() => setDialogMode("edit")}
                className="focus-ring flex h-11 items-center gap-2 rounded-[12px] bg-[var(--accent)] px-4 text-xs font-semibold text-[var(--on-accent)]"
              >
                <Pencil className="size-4" />
                Данные и статус
              </button>
            ) : null}
            {canWrite &&
            !contract.renewedByContractId &&
            !["draft", "cancelled"].includes(contract.status) ? (
              <button
                type="button"
                onClick={() => setDialogMode("renew")}
                className="focus-ring flex h-11 items-center gap-2 rounded-[12px] border border-[var(--line-strong)] px-4 text-xs text-[var(--text-secondary)]"
              >
                <RefreshCw className="size-4" />
                Продлить
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setDialogMode("history")}
              className="focus-ring flex h-11 items-center gap-2 rounded-[12px] border border-[var(--line)] px-4 text-xs text-[var(--text-secondary)]"
            >
              <History className="size-4" />
              История
            </button>
          </div>
        </div>
        <div className="mt-7 grid gap-4 border-t border-[var(--line)] pt-5 md:grid-cols-3">
          <div>
            <p className="text-[9px] uppercase tracking-[0.13em] text-[var(--muted)]">
              Период
            </p>
            <p className="mt-2 text-xs text-[var(--text)]">
              {formatDate(contract.startsOn)} — {formatDate(contract.endsOn)}
            </p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--surface-inset)]">
              <div
                className="h-full rounded-full bg-[var(--text)]"
                style={{ width: `${periodPercent}%` }}
              />
            </div>
          </div>
          <div>
            <p className="text-[9px] uppercase tracking-[0.13em] text-[var(--muted)]">
              План работ
            </p>
            <p className="mt-2 text-xs text-[var(--text)]">
              {contract.schedule
                ? `Каждые ${contract.schedule.frequencyInterval} ${contract.schedule.frequencyUnit === "month" ? "мес." : "нед."} · ${contract.schedule.localTime}`
                : "График не задан"}
            </p>
            <p className="mt-2 text-[10px] text-[var(--muted)]">
              {contract.schedule
                ? `${contract.schedule.visitCount} выездов · ${contract.schedule.defaultMasterName ?? "мастер назначается вручную"}`
                : "Можно задать при продлении"}
            </p>
          </div>
          <div>
            <p className="text-[9px] uppercase tracking-[0.13em] text-[var(--muted)]">
              Следующий выезд
            </p>
            <p className="mt-2 flex items-center gap-2 text-xs text-[var(--text)]">
              <CalendarClock className="size-4" />
              {contract.nextVisitAt
                ? eventFormatter.format(new Date(contract.nextVisitAt))
                : "Не запланирован"}
            </p>
            <Link
              href="/calendar"
              className="focus-ring mt-2 inline-block rounded text-[10px] text-[var(--muted)] hover:text-[var(--text)]"
            >
              Открыть календарь
            </Link>
          </div>
        </div>
      </header>

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.35fr)_minmax(22rem,0.65fr)]">
        <section className="surface-panel min-w-0">
          <header className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] p-4 sm:px-5">
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-[var(--text)]">
                Документ договора
              </h2>
              <p className="mt-1 truncate text-[10px] text-[var(--muted)]">
                {currentDocument
                  ? `${currentDocument.title} · ${currentDocument.filename}`
                  : "Файл договора пока не привязан"}
              </p>
            </div>
            {currentDocument ? (
              <>
                <button
                  type="button"
                  disabled={documentIndex === 0}
                  onClick={() => setDocumentIndex((value) => value - 1)}
                  aria-label="Предыдущий файл"
                  className="focus-ring grid size-9 place-items-center rounded-[10px] border border-[var(--line)] text-[var(--muted)] disabled:opacity-35"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <span className="text-[10px] tabular-nums text-[var(--muted)]">
                  {documentIndex + 1} / {documents.length}
                </span>
                <button
                  type="button"
                  disabled={documentIndex >= documents.length - 1}
                  onClick={() => setDocumentIndex((value) => value + 1)}
                  aria-label="Следующий файл"
                  className="focus-ring grid size-9 place-items-center rounded-[10px] border border-[var(--line)] text-[var(--muted)] disabled:opacity-35"
                >
                  <ChevronRight className="size-4" />
                </button>
                <a
                  href={`/api/v1/documents/${currentDocument.id}/download`}
                  aria-label="Скачать документ"
                  className="focus-ring grid size-9 place-items-center rounded-[10px] border border-[var(--line)] text-[var(--muted)]"
                >
                  <Download className="size-4" />
                </a>
              </>
            ) : null}
          </header>
          <div className="bg-[var(--surface-inset)] p-3 sm:p-5">
            <div className="mx-auto aspect-[210/297] w-full max-w-[52rem] overflow-hidden border border-[var(--line-strong)] bg-white">
              {currentDocument ? (
                <DocumentPreview document={currentDocument} />
              ) : (
                <div className="grid h-full min-h-[32rem] place-items-center p-8 text-center">
                  <div>
                    <FileText className="mx-auto size-10 text-[#6b6b6b]" />
                    <p className="mt-4 text-sm font-medium text-black">
                      Добавьте документ категории «Договоры»
                    </p>
                    <p className="mt-2 max-w-sm text-xs leading-5 text-[#555]">
                      При загрузке выберите этот договор. PDF можно листать,
                      масштабировать, выделять и копировать прямо в просмотрщике
                      браузера.
                    </p>
                    <Link
                      href="/documents"
                      className="mt-5 inline-flex h-10 items-center rounded-[10px] bg-black px-4 text-xs text-white"
                    >
                      Открыть документы
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        <aside className="space-y-5">
          <section className="surface-panel p-5">
            <div className="flex items-center gap-2">
              <Copy className="size-4 text-[var(--muted)]" />
              <h2 className="text-sm font-semibold text-[var(--text)]">
                Условия
              </h2>
            </div>
            <p className="mt-4 whitespace-pre-wrap text-xs leading-6 text-[var(--text-secondary)]">
              {contract.notes ?? "Дополнительные условия не указаны."}
            </p>
            <dl className="mt-5 space-y-3 border-t border-[var(--line)] pt-4 text-xs">
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--muted)]">Напомнить о продлении</dt>
                <dd className="text-[var(--text)]">
                  за {contract.renewalNoticeDays} дней
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--muted)]">Файлов договора</dt>
                <dd className="text-[var(--text)]">{documents.length}</dd>
              </div>
            </dl>
          </section>
          <section className="surface-panel p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-[var(--text)]">
                Последние изменения
              </h2>
              <span className="text-[9px] text-[var(--muted)]">
                {history.length}
              </span>
            </div>
            <ol className="mt-4 divide-y divide-[var(--line)]">
              {history.slice(0, 6).map((event) => (
                <li key={event.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="text-xs text-[var(--text)]">
                    {eventLabels[event.eventType]}
                  </p>
                  <p className="mt-1 text-[9px] text-[var(--muted)]">
                    {event.actorName ?? "Система"} ·{" "}
                    {eventFormatter.format(new Date(event.createdAt))}
                  </p>
                  {event.reason ? (
                    <p className="mt-2 text-[10px] leading-4 text-[var(--text-secondary)]">
                      {event.reason}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
      <ContractDialogs
        mode={dialogMode}
        contract={contract}
        objectOptions={[]}
        masterOptions={[]}
        onClose={() => setDialogMode(null)}
      />
    </div>
  );
}
