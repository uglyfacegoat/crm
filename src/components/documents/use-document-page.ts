"use client";
import { useEffect, useState } from "react";
import { documentListParams, type DocumentListPage, type DocumentListQuery } from "@/lib/document-list";

export function useDocumentPage(initialPage: DocumentListPage, query: DocumentListQuery, initialQuery: DocumentListQuery) {
  const key = documentListParams(query).toString();
  const initialKey = documentListParams(initialQuery).toString();
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{key: string; retry: number; data?: DocumentListPage; error?: string} | null>(null);
  useEffect(() => {
    if (key === initialKey && retry === 0) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/v1/documents?${key}`, { signal: controller.signal, cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message ?? "Не удалось загрузить документы.");
        if (!controller.signal.aborted) setResult({ key, retry, data: payload.data });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ key, retry, error: error instanceof Error ? error.message : "Не удалось загрузить документы." });
      }
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [key, initialKey, initialPage, retry]);
  const current = result?.key === key && result.retry === retry ? result : null;
  const data = key === initialKey && retry === 0 ? initialPage : current?.data;
  return { data, loading: !data && !current?.error, error: current?.error, retry: () => setRetry(value => value + 1) };
}
