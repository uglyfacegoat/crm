"use client";

import { Check, Search, Share2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ChatEntityIcon } from "@/components/chat/chat-shared-entity-card";
import { Dialog } from "@/components/ui/dialog";
import { matchesSearchText } from "@/lib/search-normalization";
import type { ChatEntityType, ChatSharedEntity } from "@/server/chat/types";

const typeOrder: ChatEntityType[] = ["order", "client", "object", "visit", "contract", "document", "task", "master", "website"];

export function ChatEntityPicker({ options, selected, onSelect }: {
  options: ChatSharedEntity[];
  selected: ChatSharedEntity | null;
  onSelect: (entity: ChatSharedEntity) => void;
}) {
  const availableTypes = useMemo(() => typeOrder.filter((type) => options.some((option) => option.type === type)), [options]);
  const [open, setOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<ChatEntityType | null>(null);
  const [query, setQuery] = useState("");
  const [searchResponse, setSearchResponse] = useState<{ type: ChatEntityType; query: string; data: ChatSharedEntity[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const activeType = selectedType && availableTypes.includes(selectedType) ? selectedType : availableTypes[0] ?? null;
  const searchTerm = query.trim();
  const remoteSearch = searchTerm.length >= 2;
  const filtered = remoteSearch
    ? searchResponse?.type === activeType && searchResponse.query === searchTerm ? searchResponse.data : []
    : options.filter((option) => option.type === activeType && matchesSearchText(searchTerm, [option.title, option.subtitle, option.statusLabel, ...option.meta]));

  useEffect(() => {
    if (!open || !activeType || !remoteSearch) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      try {
        const params = new URLSearchParams({ type: activeType, q: searchTerm });
        const response = await fetch(`/api/v1/chat/entities?${params}`, { signal: controller.signal });
        if (response.status === 429) throw new Error("Слишком много поисковых запросов. Подождите минуту.");
        if (!response.ok) throw new Error("Поиск временно недоступен. Повторите попытку.");
        const payload = await response.json();
        if (!Array.isArray(payload.data)) throw new Error("Поиск временно недоступен. Повторите попытку.");
        setSearchResponse({ type: activeType, query: searchTerm, data: payload.data as ChatSharedEntity[] });
      } catch (error) {
        if (!controller.signal.aborted) setSearchError(error instanceof Error ? error.message : "Поиск временно недоступен.");
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [activeType, open, remoteSearch, searchTerm]);

  function choose(entity: ChatSharedEntity) {
    onSelect(entity);
    setOpen(false);
    setQuery("");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`focus-ring grid size-11 shrink-0 place-items-center rounded-[13px] border transition-colors ${selected ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "border-[var(--line)] text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"}`}
        aria-label="Добавить объект системы"
        title="Заказ, клиент, выезд или другой объект"
      >
        <Share2 className="size-4" />
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Добавить объект системы"
        description="Карточка останется связана с исходной записью. Получатели увидят только разрешённые им данные."
      >
        <div className="flex min-h-0 flex-1 flex-col p-5 pt-0 sm:p-7 sm:pt-0">
          {availableTypes.length ? (
            <>
              <div role="tablist" aria-label="Тип объекта" className="scrollbar-hidden flex shrink-0 gap-1 overflow-x-auto rounded-[13px] bg-[var(--surface-inset)] p-1">
                {availableTypes.map((type) => {
                  const sample = options.find((option) => option.type === type)!;
                  const active = type === activeType;
                  return (
                    <button
                      key={type}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setSelectedType(type)}
                      className={`focus-ring flex h-10 shrink-0 items-center gap-2 rounded-[10px] px-3 text-xs transition-colors ${active ? "bg-[var(--accent)] text-[var(--on-accent)] shadow-sm" : "text-[var(--muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)]"}`}
                    >
                      <ChatEntityIcon type={type} className="size-3.5" />
                      {sample.typeLabel}
                    </button>
                  );
                })}
              </div>
              <label className="mt-4 flex h-11 shrink-0 items-center gap-2 rounded-[12px] border border-[var(--line-strong)] bg-[var(--surface-inset)] px-3">
                <Search className="size-4 text-[var(--muted)]" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по всем доступным объектам" className="min-w-0 flex-1 bg-transparent text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-secondary)]" />
              </label>
              <p className="mt-2 text-[10px] text-[var(--muted)]">Сначала показаны последние объекты. Введите минимум 2 символа для поиска по всему реестру.</p>
              <div role="tabpanel" className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                {remoteSearch && searching ? <p role="status" className="py-3 text-xs text-[var(--muted)]">Ищу объекты…</p> : null}
                {remoteSearch && searchError ? <p role="alert" className="py-3 text-xs text-[var(--danger-ink)]">{searchError}</p> : null}
                {filtered.map((entity) => {
                  const active = selected?.type === entity.type && selected.id === entity.id;
                  return (
                    <button
                      key={`${entity.type}:${entity.id}`}
                      type="button"
                      onClick={() => choose(entity)}
                      className={`focus-ring flex w-full items-start gap-3 rounded-[14px] border p-3 text-left transition-colors ${active ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line)] bg-[var(--surface-raised)] hover:border-[var(--accent)]/40 hover:bg-[var(--surface)]"}`}
                    >
                      <span className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-[var(--surface-inset)] text-[var(--accent-ink)]"><ChatEntityIcon type={entity.type} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2"><span className="truncate text-xs font-semibold text-[var(--text)]">{entity.title}</span><span className="shrink-0 rounded-full bg-[var(--surface-soft)] px-2 py-1 text-[9px] text-[var(--muted)]">{entity.statusLabel}</span></span>
                        <span className="mt-1 block truncate text-[10px] text-[var(--text-secondary)]">{entity.subtitle}</span>
                        <span className="mt-2 block truncate text-[9px] text-[var(--muted)]">{entity.meta.join(" · ")}</span>
                      </span>
                      {active ? <Check className="mt-1 size-4 shrink-0 text-[var(--accent-ink)]" /> : null}
                    </button>
                  );
                })}
                {!filtered.length && !searching && !searchError ? <div className="grid min-h-44 place-items-center rounded-[14px] border border-dashed border-[var(--line)] text-center"><div><Search className="mx-auto size-5 text-[var(--muted)]" /><p className="mt-3 text-xs text-[var(--text-secondary)]">Подходящих объектов нет</p><p className="mt-1 text-[10px] text-[var(--muted)]">Измените запрос или выберите другую вкладку.</p></div></div> : null}
                {remoteSearch && filtered.length === 20 ? <p className="py-2 text-center text-[10px] text-[var(--muted)]">Показаны первые 20 совпадений. Уточните запрос, чтобы найти остальные.</p> : null}
              </div>
            </>
          ) : (
            <div className="grid min-h-64 place-items-center text-center"><div><Share2 className="mx-auto size-6 text-[var(--muted)]" /><p className="mt-3 text-sm text-[var(--text-secondary)]">Нет доступных объектов</p><p className="mt-1 max-w-sm text-xs leading-5 text-[var(--muted)]">Карточки появятся после создания рабочих записей или выдачи прав на соответствующие разделы.</p></div></div>
          )}
        </div>
      </Dialog>
    </>
  );
}
