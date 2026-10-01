import type { DocumentListPage } from "@/lib/document-list";
export function DocumentPagination({ page, onPage }: { page: DocumentListPage; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(page.total / page.pageSize));
  return <nav aria-label="Страницы документов" className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] px-4 py-3 text-xs text-[var(--muted)]">
    <span>{page.total ? `${(page.page - 1) * page.pageSize + 1}–${(page.page - 1) * page.pageSize + page.items.length}` : "0"} из {page.total} файлов</span>
    <div className="flex items-center gap-2"><button type="button" disabled={page.page <= 1} onClick={() => onPage(page.page - 1)} className="focus-ring min-h-10 rounded-lg border border-[var(--line)] px-3 disabled:opacity-40">Назад</button><span>{page.page} / {pages}</span><button type="button" disabled={page.page >= pages} onClick={() => onPage(page.page + 1)} className="focus-ring min-h-10 rounded-lg border border-[var(--line)] px-3 disabled:opacity-40">Далее</button></div>
  </nav>;
}
export function DocumentListStatus({ loading, error, onRetry }: { loading: boolean; error?: string; onRetry: () => void }) {
  return loading || error ? <div role={error ? "alert" : "status"} className="p-6 text-center text-sm text-[var(--muted)]">{error ?? "Загружаем документы…"}{error ? <button type="button" onClick={onRetry} className="focus-ring ml-3 min-h-10 rounded-lg border border-[var(--line)] px-3">Повторить загрузку</button> : null}</div> : null;
}
