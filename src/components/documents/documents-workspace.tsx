"use client";

import { Download, FileCheck2, FileImage, FileSpreadsheet, FileText, Folder, ReceiptText, Search, Star, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { favoriteDocumentAction } from "@/app/(workspace)/documents/actions";
import { EmptyDocumentsAction } from "@/components/documents/upload-document-dialog";
import { documentCategoryLabels, type DocumentCategory, type DocumentListItem, type DocumentUploadOptions } from "@/server/documents/types";

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

function DocumentDetails({ document, related, onClose, onSelect }: { document: DocumentListItem; related: DocumentListItem[]; onClose: () => void; onSelect: (id: string) => void }) {
  const presentation = categoryPresentation[document.category];
  const Icon = presentation.icon;
  return <div className="fixed inset-0 z-50 bg-black/70 p-2 backdrop-blur-sm sm:p-3 2xl:static 2xl:z-auto 2xl:bg-transparent 2xl:p-0 2xl:backdrop-blur-none" onMouseDown={onClose}>
    <aside className="surface-panel ml-auto flex h-full w-full max-w-md flex-col overflow-y-auto bg-[#10171b] p-4 sm:p-5 2xl:max-w-none" onMouseDown={(event) => event.stopPropagation()}>
      <div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-white/[0.04]" style={{ color: presentation.color }}><Icon className="size-4" /></span><div className="min-w-0 flex-1"><h2 className="font-display text-base font-semibold leading-5 text-white">{document.title}</h2><p className="mt-1 truncate text-xs text-[#707a80]">{document.clientName}</p></div><button type="button" onClick={onClose} aria-label="Закрыть карточку" className="focus-ring rounded-lg p-2 text-[#798389] hover:bg-white/[0.05]"><X className="size-4" /></button></div>
      <div className="mt-5 rounded-[14px] border border-white/[0.07] bg-black/15 p-4"><p className="text-[9px] uppercase tracking-[0.15em] text-[var(--accent)]">Файл · версия {document.versionNumber}</p><p className="mt-3 break-all text-sm font-medium text-white">{document.filename}</p><p className="mt-2 text-[10px] text-[#6d777d]">{formatBytes(document.sizeBytes)} · {document.extension.toUpperCase()} · SHA‑256 {document.sha256.slice(0, 10)}…</p></div>
      <a href={`/api/v1/documents/${document.id}/download`} className="focus-ring mt-3 flex h-11 items-center justify-center gap-2 rounded-[12px] bg-[var(--accent)] text-xs font-semibold text-[#101308]"><Download className="size-4" />Скачать оригинал</a>
      <dl className="mt-6 space-y-4 border-t border-white/[0.06] pt-5 text-xs">
        <div className="flex gap-4"><dt className="w-20 shrink-0 text-[#687279]">Категория</dt><dd className="text-[#c9cfcb]">{document.categoryLabel}</dd></div>
        <div className="flex gap-4"><dt className="w-20 shrink-0 text-[#687279]">Заказ</dt><dd><Link href={`/orders/${document.orderId}`} className="focus-ring rounded text-[var(--accent)] hover:underline">№{document.orderNumber}</Link></dd></div>
        <div className="flex gap-4"><dt className="w-20 shrink-0 text-[#687279]">Объект</dt><dd className="text-[#c9cfcb]">{document.objectName}<span className="mt-1 block text-[10px] text-[#687279]">{document.objectAddress}</span></dd></div>
        {document.visitScheduledStartAt ? <div className="flex gap-4"><dt className="w-20 shrink-0 text-[#687279]">Выезд</dt><dd className="text-[#c9cfcb]">{dateFormatter.format(new Date(document.visitScheduledStartAt))}</dd></div> : null}
        <div className="flex gap-4"><dt className="w-20 shrink-0 text-[#687279]">Загрузил</dt><dd className="text-[#c9cfcb]">{document.uploadedBy}<span className="mt-1 block text-[10px] text-[#687279]">{dateFormatter.format(new Date(document.uploadedAt))}</span></dd></div>
        {document.description ? <div className="flex gap-4"><dt className="w-20 shrink-0 text-[#687279]">Описание</dt><dd className="whitespace-pre-wrap text-[#c9cfcb]">{document.description}</dd></div> : null}
      </dl>
      <div className="mt-6 border-t border-white/[0.06] pt-5"><div className="flex items-center justify-between gap-3"><h3 className="text-xs font-semibold text-white">Документы заказчика</h3><span className="text-[10px] text-[#687279]">{related.length}</span></div>{related.length ? <div className="mt-3 space-y-1">{related.slice(0, 8).map((item) => <button type="button" key={item.id} onClick={() => onSelect(item.id)} className="focus-ring flex w-full items-center gap-3 rounded-[11px] px-2.5 py-2.5 text-left hover:bg-white/[0.04]"><span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: categoryPresentation[item.category].color }} /><span className="min-w-0 flex-1"><span className="block truncate text-xs text-[#d4d9d6]">{item.title}</span><span className="mt-0.5 block truncate text-[10px] text-[#687279]">№{item.orderNumber} · {item.objectAddress}</span></span></button>)}</div> : <p className="mt-3 text-[10px] leading-4 text-[#687279]">Других файлов этого заказчика пока нет.</p>}</div>
    </aside>
  </div>;
}

export function DocumentsWorkspace({ documents, uploadOptions }: { documents: DocumentListItem[]; uploadOptions: DocumentUploadOptions }) {
  const [category, setCategory] = useState<DocumentCategory | "all">("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = documents.find((document) => document.id === selectedId) ?? null;
  const counts = useMemo(() => new Map(Object.keys(documentCategoryLabels).map((key) => [key, documents.filter((document) => document.category === key).length])), [documents]);
  const filtered = useMemo(() => { const normalized = query.trim().toLocaleLowerCase("ru"); return documents.filter((document) => (category === "all" || document.category === category) && (!normalized || [document.title, document.filename, document.clientName, document.orderNumber, document.objectName, document.objectAddress].some((value) => value.toLocaleLowerCase("ru").includes(normalized)))); }, [category, documents, query]);
  const related = selected ? documents.filter((document) => document.clientId === selected.clientId && document.id !== selected.id) : [];
  const folders: { key: DocumentCategory | "all"; label: string }[] = [{ key: "all", label: "Все документы" }, ...(Object.entries(documentCategoryLabels) as [DocumentCategory, string][]).map(([key, label]) => ({ key, label }))];
  if (!documents.length) return <section className="surface-panel mt-[clamp(1.5rem,1.1rem+0.8vw,2.25rem)] grid min-h-[30rem] place-items-center p-6"><EmptyDocumentsAction options={uploadOptions} /></section>;

  return <section className={`mt-[clamp(1.5rem,1.1rem+0.8vw,2.25rem)] grid min-h-[36rem] gap-4 ${selected ? "2xl:grid-cols-[15rem_minmax(0,1fr)_23rem]" : "lg:grid-cols-[15rem_minmax(0,1fr)]"}`}>
    <aside className="surface-panel min-w-0 p-3"><div className="scrollbar-hidden flex gap-1 overflow-x-auto lg:block">{folders.map(({ key, label }) => { const presentation = key === "all" ? { icon: Folder, color: "var(--accent)" } : categoryPresentation[key]; const Icon = presentation.icon; const count = key === "all" ? documents.length : counts.get(key) ?? 0; return <button type="button" key={key} onClick={() => setCategory(key)} className={`focus-ring flex min-h-11 shrink-0 items-center gap-2.5 rounded-[12px] px-3 text-left text-xs transition-colors lg:w-full ${category === key ? "bg-white/[0.07] text-white" : "text-[#818b91] hover:bg-white/[0.035]"}`}><Icon className="size-4" style={{ color: presentation.color }} /><span className="lg:flex-1">{label}</span><span className="text-[10px] text-[#626c72]">{count}</span></button>; })}</div></aside>
    <div className="surface-panel min-w-0 overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-white/[0.06] p-3 sm:flex-row sm:items-center sm:justify-between"><label className="soft-button flex h-11 min-w-0 flex-1 items-center gap-2 rounded-[12px] px-3 sm:max-w-sm"><Search className="size-4 text-[#69737a]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Документ, клиент, заказ или адрес" className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-[#626c72]" /></label><p className="text-[10px] text-[#6d777d]">Найдено: {filtered.length}</p></div>
      <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[760px] text-left"><thead><tr className="text-[9px] uppercase tracking-[0.11em] text-[#626c72]"><th className="px-4 py-3 font-medium">Название</th><th className="px-3 py-3 font-medium">Тип</th><th className="px-3 py-3 font-medium">Связан с</th><th className="px-3 py-3 font-medium">Загружен</th><th className="px-4 py-3 text-right font-medium">Размер</th></tr></thead><tbody className="divide-y divide-white/[0.05]">{filtered.map((document) => { const presentation = categoryPresentation[document.category]; const Icon = presentation.icon; return <tr key={document.id} onClick={() => setSelectedId(document.id)} className={`cursor-pointer transition-colors hover:bg-white/[0.035] ${selectedId === document.id ? "bg-white/[0.045]" : ""}`}><td className="px-4 py-3"><div className="flex min-w-0 items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-white/[0.04]" style={{ color: presentation.color }}><Icon className="size-4" /></span><div className="min-w-0"><p className="truncate text-xs font-medium text-white">{document.title}</p><p className="mt-1 truncate text-[10px] text-[#6e787e]">{document.clientName}</p></div></div></td><td className="px-3 py-3 text-xs text-[#8b9499]">{document.categoryLabel}</td><td className="px-3 py-3"><p className="text-xs text-[#9aa3a8]">Заказ №{document.orderNumber}</p><p className="mt-1 max-w-56 truncate text-[10px] text-[#687279]">{document.objectAddress}</p></td><td className="px-3 py-3"><p className="text-xs text-[#8b9499]">{dateFormatter.format(new Date(document.uploadedAt))}</p><p className="mt-1 text-[10px] text-[#687279]">{document.uploadedBy}</p></td><td className="px-4 py-3"><div className="flex items-center justify-end gap-3"><span className="text-xs text-[#8b9499]">{formatBytes(document.sizeBytes)}</span><FavoriteButton document={document} /></div></td></tr>; })}</tbody></table></div>
      <div className="divide-y divide-white/[0.05] md:hidden">{filtered.map((document) => { const Icon = categoryPresentation[document.category].icon; return <button type="button" key={document.id} onClick={() => setSelectedId(document.id)} className="focus-ring flex w-full items-start gap-3 p-4 text-left"><span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-[10px] bg-white/[0.04]" style={{ color: categoryPresentation[document.category].color }}><Icon className="size-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm text-white">{document.title}</span><span className="mt-1 block truncate text-xs text-[#737d83]">{document.clientName}</span><span className="mt-2 block text-[10px] text-[#606a70]">№{document.orderNumber} · {formatBytes(document.sizeBytes)}</span></span></button>; })}</div>
      {!filtered.length ? <p className="p-10 text-center text-sm text-[#687279]">Документы по выбранным условиям не найдены</p> : null}
    </div>
    {selected ? <DocumentDetails document={selected} related={related} onClose={() => setSelectedId(null)} onSelect={setSelectedId} /> : null}
  </section>;
}
