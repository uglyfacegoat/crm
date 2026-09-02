"use client";

import { Archive, Check, Download, FileCheck2, FileImage, FileSpreadsheet, FileText, History, LoaderCircle, ReceiptText, Search, Star, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { favoriteDocumentAction } from "@/app/(workspace)/documents/actions";
import { DocumentArchiveNavigator, getArchiveSelectionTitle } from "@/components/documents/document-archive-navigator";
import { EmptyDocumentsAction } from "@/components/documents/upload-document-dialog";
import { UploadDocumentVersionButton } from "@/components/documents/upload-document-version-dialog";
import type { DocumentArchiveSelection, DocumentArchiveTree } from "@/server/documents/archive";
import type { DocumentCategory, DocumentListItem, DocumentUploadOptions } from "@/server/documents/types";

const categoryPresentation: Record<DocumentCategory, { icon: typeof FileText; color: string }> = {
  contract: { icon: FileText, color: "#9c82e8" },
  act: { icon: FileCheck2, color: "#69d3a4" },
  visit_card: { icon: FileCheck2, color: "#edf43b" },
  invoice: { icon: ReceiptText, color: "#66b6eb" },
  receipt: { icon: FileSpreadsheet, color: "#efb454" },
  photo: { icon: FileImage, color: "#ef9a54" },
  other: { icon: FileText, color: "#8f999f" },
};

const dateFormatter = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Moscow" });

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} КБ`;
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(bytes / 1024 ** 2)} МБ`;
}

function FavoriteButton({ document }: { document: DocumentListItem }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <button type="button" disabled={pending} onClick={(event) => { event.stopPropagation(); const formData = new FormData(); formData.set("documentId", document.id); formData.set("favorite", String(!document.favorite)); startTransition(async () => { await favoriteDocumentAction(formData); router.refresh(); }); }} aria-label={document.favorite ? "Убрать из избранного" : "Добавить в избранное"} className="focus-ring rounded-lg p-1.5 disabled:opacity-45"><Star className={`size-4 ${document.favorite ? "fill-[var(--accent)] text-[var(--accent)]" : "text-[#5f696f]"}`} /></button>;
}

function SelectionButton({ checked, label, onToggle }: { checked: boolean; label: string; onToggle: () => void }) {
  return <button type="button" role="checkbox" aria-checked={checked} aria-label={label} onClick={(event) => { event.stopPropagation(); onToggle(); }} className={`focus-ring grid size-5 shrink-0 place-items-center rounded-[6px] border transition-colors ${checked ? "border-[var(--accent)] bg-[var(--accent)] text-[#111509]" : "border-white/[0.13] bg-black/10 text-transparent hover:border-white/25"}`}><Check className="size-3" strokeWidth={3} /></button>;
}

function DocumentDetails({ document, related, canWrite, onClose, onSelect }: { document: DocumentListItem; related: DocumentListItem[]; canWrite: boolean; onClose: () => void; onSelect: (id: string) => void }) {
  const presentation = categoryPresentation[document.category];
  const Icon = presentation.icon;
  return <div className="fixed inset-0 z-50 bg-black/70 p-2 backdrop-blur-sm sm:p-3 2xl:static 2xl:z-auto 2xl:bg-transparent 2xl:p-0 2xl:backdrop-blur-none" onMouseDown={onClose}>
    <aside className="surface-panel ml-auto flex h-full w-full max-w-md flex-col overflow-y-auto bg-[#10171b] p-4 sm:p-5 2xl:max-w-none" onMouseDown={(event) => event.stopPropagation()}>
      <div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-white/[0.04]" style={{ color: presentation.color }}><Icon className="size-4" /></span><div className="min-w-0 flex-1"><h2 className="font-display text-base font-semibold leading-5 text-white">{document.title}</h2><p className="mt-1 truncate text-xs text-[#707a80]">{document.clientName}</p></div><button type="button" onClick={onClose} aria-label="Закрыть карточку" className="focus-ring rounded-lg p-2 text-[#798389] hover:bg-white/[0.05]"><X className="size-4" /></button></div>
      <div className="mt-5 rounded-[14px] border border-white/[0.07] bg-black/15 p-4"><p className="text-[9px] uppercase tracking-[0.15em] text-[var(--accent)]">Файл · версия {document.versionNumber}</p><p className="mt-3 break-all text-sm font-medium text-white">{document.filename}</p><p className="mt-2 text-[10px] text-[#6d777d]">{formatBytes(document.sizeBytes)} · {document.extension.toUpperCase()} · SHA‑256 {document.sha256.slice(0, 10)}…</p></div>
      <div className="mt-3 flex gap-2"><a href={`/api/v1/documents/${document.id}/download`} className="focus-ring flex h-11 flex-1 items-center justify-center gap-2 rounded-[12px] bg-[var(--accent)] px-3 text-xs font-semibold text-[#101308]"><Download className="size-4" />Скачать текущую</a>{canWrite ? <UploadDocumentVersionButton document={document} /> : null}</div>
      <dl className="mt-6 space-y-4 border-t border-white/[0.06] pt-5 text-xs">
        <div className="flex gap-4"><dt className="w-20 shrink-0 text-[#687279]">Категория</dt><dd className="text-[#c9cfcb]">{document.categoryLabel}</dd></div>
        <div className="flex gap-4"><dt className="w-20 shrink-0 text-[#687279]">Заказ</dt><dd><Link href={`/orders/${document.orderId}`} className="focus-ring rounded text-[var(--accent)] hover:underline">№{document.orderNumber}</Link></dd></div>
        <div className="flex gap-4"><dt className="w-20 shrink-0 text-[#687279]">Объект</dt><dd className="text-[#c9cfcb]">{document.objectName}<span className="mt-1 block text-[10px] text-[#687279]">{document.objectAddress}</span></dd></div>
        {document.visitScheduledStartAt ? <div className="flex gap-4"><dt className="w-20 shrink-0 text-[#687279]">Выезд</dt><dd className="text-[#c9cfcb]">{dateFormatter.format(new Date(document.visitScheduledStartAt))}</dd></div> : null}
        <div className="flex gap-4"><dt className="w-20 shrink-0 text-[#687279]">Загрузил</dt><dd className="text-[#c9cfcb]">{document.uploadedBy}<span className="mt-1 block text-[10px] text-[#687279]">{dateFormatter.format(new Date(document.uploadedAt))}</span></dd></div>
        {document.description ? <div className="flex gap-4"><dt className="w-20 shrink-0 text-[#687279]">Описание</dt><dd className="whitespace-pre-wrap text-[#c9cfcb]">{document.description}</dd></div> : null}
      </dl>
      <div className="mt-6 border-t border-white/[0.06] pt-5"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><History className="size-4 text-[var(--accent)]" /><h3 className="text-xs font-semibold text-white">История версий</h3></div><span className="rounded-full bg-white/[0.04] px-2 py-1 text-[9px] text-[#687279]">{document.versions.length}</span></div><ol className="mt-3 space-y-2">{document.versions.map((version) => <li key={version.id} className={`rounded-[13px] border p-3 ${version.current ? "border-[var(--accent)]/15 bg-[var(--accent)]/[0.035]" : "border-white/[0.06] bg-black/10"}`}><div className="flex items-start gap-3"><span className={`grid size-8 shrink-0 place-items-center rounded-[10px] font-display text-xs font-semibold ${version.current ? "bg-[var(--accent)] text-[#111509]" : "bg-white/[0.05] text-[#8b959b]"}`}>v{version.versionNumber}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="max-w-full truncate text-xs font-medium text-[#dbe0dc]">{version.filename}</p>{version.current ? <span className="inline-flex items-center gap-1 rounded-full bg-[#69d3a4]/[0.08] px-2 py-0.5 text-[8px] uppercase tracking-[0.1em] text-[#79cda8]"><Check className="size-2.5" />Текущая</span> : null}</div><p className="mt-1 text-[9px] text-[#626c72]">{dateFormatter.format(new Date(version.uploadedAt))} · {version.uploadedBy}</p>{version.changeNote ? <p className="mt-2 text-[10px] leading-4 text-[#929ca1]">{version.changeNote}</p> : null}<p className="mt-2 text-[9px] text-[#59636a]">{formatBytes(version.sizeBytes)} · {version.extension.toUpperCase()} · {version.sha256.slice(0, 10)}…</p></div><a href={`/api/v1/documents/${document.id}/versions/${version.id}/download`} aria-label={`Скачать версию ${version.versionNumber}`} title={`Скачать ${version.filename}`} className="focus-ring grid size-9 shrink-0 place-items-center rounded-[10px] border border-white/[0.07] text-[#7b858b] hover:bg-white/[0.04] hover:text-white"><Download className="size-3.5" /></a></div></li>)}</ol></div>
      <div className="mt-6 border-t border-white/[0.06] pt-5"><div className="flex items-center justify-between gap-3"><h3 className="text-xs font-semibold text-white">Документы заказчика</h3><span className="text-[10px] text-[#687279]">{related.length}</span></div>{related.length ? <div className="mt-3 space-y-1">{related.slice(0, 8).map((item) => <button type="button" key={item.id} onClick={() => onSelect(item.id)} className="focus-ring flex w-full items-center gap-3 rounded-[11px] px-2.5 py-2.5 text-left hover:bg-white/[0.04]"><span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: categoryPresentation[item.category].color }} /><span className="min-w-0 flex-1"><span className="block truncate text-xs text-[#d4d9d6]">{item.title}</span><span className="mt-0.5 block truncate text-[10px] text-[#687279]">№{item.orderNumber} · {item.objectAddress}</span></span></button>)}</div> : <p className="mt-3 text-[10px] leading-4 text-[#687279]">Других файлов этого заказчика пока нет.</p>}</div>
    </aside>
  </div>;
}

export function DocumentsWorkspace({ documents, archive, selection, uploadOptions, canWrite, initialDocumentId = null }: { documents: DocumentListItem[]; archive: DocumentArchiveTree; selection: DocumentArchiveSelection; uploadOptions: DocumentUploadOptions; canWrite: boolean; initialDocumentId?: string | null }) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(() => documents.some((document) => document.id === initialDocumentId) ? initialDocumentId : null);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<Set<string>>(() => new Set());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const selected = documents.find((document) => document.id === selectedId) ?? null;
  const filtered = useMemo(() => { const normalized = query.trim().toLocaleLowerCase("ru"); return documents.filter((document) => !normalized || [document.title, document.filename, document.clientName, document.orderNumber, document.objectName, document.objectAddress, document.categoryLabel].some((value) => value.toLocaleLowerCase("ru").includes(normalized))); }, [documents, query]);
  const selectedDocuments = documents.filter((document) => selectedDocumentIds.has(document.id));
  const selectedBytes = selectedDocuments.reduce((total, document) => total + document.sizeBytes, 0);
  const selectedVisible = filtered.filter((document) => selectedDocumentIds.has(document.id)).length;
  const allVisibleSelected = filtered.length > 0 && selectedVisible === filtered.length;
  const related = selected ? documents.filter((document) => document.clientId === selected.clientId && document.id !== selected.id) : [];
  const selectionTitle = getArchiveSelectionTitle(archive, selection);

  function toggleDocument(documentId: string) {
    setExportError(null);
    if (!selectedDocumentIds.has(documentId) && selectedDocumentIds.size >= 30) {
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
      if (allVisibleSelected) filtered.forEach((document) => next.delete(document.id));
      else {
        for (const document of filtered) {
          if (next.size >= 30) break;
          next.add(document.id);
        }
      }
      return next;
    });
    const visibleSelectionSize = new Set([...selectedDocumentIds, ...filtered.map((document) => document.id)]).size;
    if (!allVisibleSelected && visibleSelectionSize > 30) setExportError("Выбраны первые 30 документов — это максимум одного архива.");
  }

  async function exportDocuments() {
    if (!selectedDocumentIds.size || selectedBytes > 50 * 1024 * 1024 || exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const response = await fetch("/api/v1/documents/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentIds: [...selectedDocumentIds] }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(payload?.error?.message ?? "Не удалось сформировать архив.");
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
      setExportError(error instanceof Error ? error.message : "Не удалось сформировать архив.");
    } finally {
      setExporting(false);
    }
  }

  if (!archive.documentCount) return <section className="surface-panel mt-[clamp(1.5rem,1.1rem+0.8vw,2.25rem)] grid min-h-[30rem] place-items-center p-6"><EmptyDocumentsAction options={uploadOptions} /></section>;

  return <section className={`mt-[clamp(1.5rem,1.1rem+0.8vw,2.25rem)] grid min-h-[36rem] gap-4 ${selected ? "2xl:grid-cols-[20rem_minmax(0,1fr)_23rem]" : "lg:grid-cols-[20rem_minmax(0,1fr)]"}`}>
    <aside className="surface-panel min-w-0 p-3 lg:max-h-[calc(100vh-10rem)] lg:overflow-y-auto"><div className="mb-3 hidden border-b border-white/[0.055] px-2 pb-3 lg:block"><p className="text-[9px] uppercase tracking-[0.14em] text-[var(--accent)]">Структура архива</p><p className="mt-1 text-[10px] text-[#667178]">{archive.clientCount} клиентов · {archive.objectCount} объектов · {archive.orderCount} заказов</p></div><DocumentArchiveNavigator archive={archive} selection={selection} /></aside>
    <div className="surface-panel min-w-0 overflow-hidden">
      <div className="border-b border-white/[0.06] p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div className="min-w-0"><p className="text-[9px] uppercase tracking-[0.13em] text-[#606b72]">Открытая папка</p><h2 className="mt-1 truncate font-display text-sm font-semibold text-white">{selectionTitle}</h2></div><p className="shrink-0 text-[10px] text-[#6d777d]">{documents.length === 500 ? "Показаны последние 500 файлов" : `${documents.length} файлов`}</p></div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row"><label className="soft-button flex h-11 min-w-0 flex-1 items-center gap-2 rounded-[12px] px-3 sm:max-w-md"><Search className="size-4 text-[#69737a]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Документ, клиент, заказ или адрес" className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-[#626c72]" /></label>{selectedDocumentIds.size ? <div className="flex min-h-11 flex-wrap items-center gap-2 rounded-[12px] border border-[var(--accent)]/15 bg-[var(--accent)]/[0.045] px-3"><Archive className="size-4 text-[var(--accent)]" /><span className="text-[10px] text-[#aeb6ac]">{selectedDocumentIds.size} · {formatBytes(selectedBytes)}</span><button type="button" onClick={() => setSelectedDocumentIds(new Set())} className="focus-ring rounded-md px-1.5 py-1 text-[9px] text-[#78827d] hover:text-white">Сбросить</button><button type="button" disabled={exporting || selectedBytes > 50 * 1024 * 1024} onClick={exportDocuments} className="focus-ring ml-auto flex h-8 items-center gap-1.5 rounded-[9px] bg-[var(--accent)] px-3 text-[10px] font-semibold text-[#111509] disabled:cursor-not-allowed disabled:opacity-45">{exporting ? <LoaderCircle className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}{exporting ? "Архивируем" : "Скачать ZIP"}</button></div> : null}</div>
        {selectedBytes > 50 * 1024 * 1024 ? <p role="alert" className="mt-2 text-[10px] text-[#e88d92]">Общий размер превышает допустимые 50 МБ.</p> : exportError ? <p role="alert" className="mt-2 text-[10px] text-[#e88d92]">{exportError}</p> : null}
      </div>
      <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[800px] text-left"><thead><tr className="text-[9px] uppercase tracking-[0.11em] text-[#626c72]"><th className="w-12 px-4 py-3 font-medium"><SelectionButton checked={allVisibleSelected} label={allVisibleSelected ? "Снять выбор со всех видимых документов" : "Выбрать все видимые документы"} onToggle={toggleVisibleDocuments} /></th><th className="px-3 py-3 font-medium">Название</th><th className="px-3 py-3 font-medium">Тип</th><th className="px-3 py-3 font-medium">Связан с</th><th className="px-3 py-3 font-medium">Загружен</th><th className="px-4 py-3 text-right font-medium">Размер</th></tr></thead><tbody className="divide-y divide-white/[0.05]">{filtered.map((document) => { const presentation = categoryPresentation[document.category]; const Icon = presentation.icon; return <tr key={document.id} onClick={() => setSelectedId(document.id)} className={`cursor-pointer transition-colors hover:bg-white/[0.035] ${selectedId === document.id ? "bg-white/[0.045]" : ""}`}><td className="px-4 py-3"><SelectionButton checked={selectedDocumentIds.has(document.id)} label={`${selectedDocumentIds.has(document.id) ? "Исключить" : "Добавить"} ${document.title} ${selectedDocumentIds.has(document.id) ? "из" : "в"} архив`} onToggle={() => toggleDocument(document.id)} /></td><td className="px-3 py-3"><div className="flex min-w-0 items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-white/[0.04]" style={{ color: presentation.color }}><Icon className="size-4" /></span><div className="min-w-0"><p className="truncate text-xs font-medium text-white">{document.title}</p><p className="mt-1 truncate text-[10px] text-[#6e787e]">{document.clientName}</p></div></div></td><td className="px-3 py-3 text-xs text-[#8b9499]">{document.categoryLabel}</td><td className="px-3 py-3"><p className="text-xs text-[#9aa3a8]">Заказ №{document.orderNumber}</p><p className="mt-1 max-w-56 truncate text-[10px] text-[#687279]">{document.objectAddress}</p></td><td className="px-3 py-3"><p className="text-xs text-[#8b9499]">{dateFormatter.format(new Date(document.uploadedAt))}</p><p className="mt-1 text-[10px] text-[#687279]">{document.uploadedBy}</p></td><td className="px-4 py-3"><div className="flex items-center justify-end gap-3"><span className="text-xs text-[#8b9499]">{formatBytes(document.sizeBytes)}</span><FavoriteButton document={document} /></div></td></tr>; })}</tbody></table></div>
      <div className="divide-y divide-white/[0.05] md:hidden">{filtered.map((document) => { const Icon = categoryPresentation[document.category].icon; return <article key={document.id} className="flex items-start gap-3 p-4"><SelectionButton checked={selectedDocumentIds.has(document.id)} label={`${selectedDocumentIds.has(document.id) ? "Исключить" : "Добавить"} ${document.title} ${selectedDocumentIds.has(document.id) ? "из" : "в"} архив`} onToggle={() => toggleDocument(document.id)} /><button type="button" onClick={() => setSelectedId(document.id)} className="focus-ring flex min-w-0 flex-1 items-start gap-3 text-left"><span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-[10px] bg-white/[0.04]" style={{ color: categoryPresentation[document.category].color }}><Icon className="size-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm text-white">{document.title}</span><span className="mt-1 block truncate text-xs text-[#737d83]">{document.clientName}</span><span className="mt-2 block text-[10px] text-[#606a70]">№{document.orderNumber} · {formatBytes(document.sizeBytes)}</span></span></button></article>; })}</div>
      {!filtered.length ? <p className="p-10 text-center text-sm text-[#687279]">Документы по выбранным условиям не найдены</p> : null}
    </div>
    {selected ? <DocumentDetails document={selected} related={related} canWrite={canWrite} onClose={() => setSelectedId(null)} onSelect={setSelectedId} /> : null}
  </section>;
}
