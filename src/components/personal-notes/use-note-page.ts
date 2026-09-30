"use client";

import { useEffect, useRef, useState } from "react";
import type { NotePage } from "@/server/personal-notes/repository";

export function useNotePage<T extends { id: string }>(initial: NotePage<T>, load: (query: string, offset: number) => Promise<NotePage<T>>) {
  const [page, setPage] = useState({ ...initial, query: "" });
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const revision = useRef(0);
  useEffect(() => {
    if (!query && !offset && !retry) return;
    let active = true;
    const version = revision.current;
    const timer = setTimeout(async () => {
      setLoading(true); setError("");
      try {
        const result = await load(query, offset);
        if (active && version === revision.current) setPage(previous => ({ ...result, query,
          items: offset && previous.query === query
            ? [...previous.items, ...result.items.filter(item => !previous.items.some(old => old.id === item.id))] : result.items }));
      } catch {
        if (active && version === revision.current) setError("Не удалось загрузить список. Повторите поиск.");
      } finally {
        if (active && version === revision.current) setLoading(false);
      }
    }, query ? 220 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [query, offset, retry, load]);
  const current = page.query === query ? page : null;
  return {
    items: current?.items ?? [], total: current?.total ?? 0, nextOffset: current?.nextOffset ?? null,
    query, loading: loading || (!current && !error), error,
    search(value: string) { setQuery(value); setOffset(0); setError(""); setRetry(value ? 0 : previous => previous + 1); },
    more() { if (current?.nextOffset !== null && current?.nextOffset !== undefined) setOffset(current.nextOffset); },
    retry() { setRetry(value => value + 1); },
    replace(result: NotePage<T>) {
      revision.current += 1;
      setPage({ ...result, query: "" }); setQuery(""); setOffset(0); setRetry(0); setError(""); setLoading(false);
    },
  };
}
