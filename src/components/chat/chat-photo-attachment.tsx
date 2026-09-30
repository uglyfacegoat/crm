"use client";

import { Download, ImageOff, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";

type PhotoAttachment = { id: string; filename: string };

export function ChatPhotoAttachment({ attachment, sentAt, compact = false }: { attachment: PhotoAttachment; sentAt: string; compact?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(false);
  const [ratio, setRatio] = useState(4 / 3);
  const downloadUrl = `/api/v1/chat/attachments/${attachment.id}/download`;
  const previewUrl = `${downloadUrl}?preview=1${attempt ? `&retry=${attempt}` : ""}`;

  useEffect(() => {
    const element = containerRef.current;
    if (!element || nearViewport) return;
    if (typeof IntersectionObserver === "undefined") {
      const timer = setTimeout(() => setNearViewport(true), 0);
      return () => clearTimeout(timer);
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setNearViewport(true);
        observer.disconnect();
      }
    }, { rootMargin: "400px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [nearViewport]);

  return <>
    <div ref={containerRef} className={`relative w-[min(21rem,calc(100vw-7rem))] overflow-hidden rounded-[15px] bg-[var(--surface-inset)] ${compact ? "" : "mt-2"}`}>
      <div className="relative w-full" style={{ aspectRatio: ratio, maxHeight: "27rem" }}>
        {nearViewport && !failed ? <img
          key={previewUrl}
          src={previewUrl}
          alt={attachment.filename}
          loading="lazy"
          decoding="async"
          onLoad={(event) => {
            const { naturalWidth, naturalHeight } = event.currentTarget;
            if (naturalWidth && naturalHeight) setRatio(Math.max(0.65, Math.min(2, naturalWidth / naturalHeight)));
            setLoaded(true);
          }}
          onError={() => { setFailed(true); setLoaded(false); }}
          className={`absolute inset-0 size-full object-contain transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"}`}
        /> : null}
        {!loaded && !failed ? <div role="status" aria-label="Загрузка фотографии" className="absolute inset-0 grid place-items-center bg-[var(--surface-inset)]"><LoaderCircle className="size-7 animate-spin text-[var(--muted)]" /></div> : null}
        {failed ? <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-xs text-[var(--muted)]"><ImageOff className="size-6" /><span>Не удалось загрузить фото</span><button type="button" onClick={() => { setFailed(false); setLoaded(false); setAttempt((value) => value + 1); }} className="focus-ring inline-flex items-center gap-1 rounded-lg border border-[var(--line)] px-2 py-1 text-[var(--text)]"><RefreshCw className="size-3" />Повторить</button></div> : null}
        {loaded ? <button type="button" onClick={() => setOpen(true)} aria-label={`Открыть фото ${attachment.filename}`} className="focus-ring absolute inset-0 size-full cursor-zoom-in" /> : null}
        {loaded ? <span className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] tabular-nums text-white">{sentAt}</span> : null}
      </div>
    </div>
    <Dialog open={open} onClose={() => setOpen(false)} title="Фото" bodyClassName="min-h-0">
      <div className="flex min-h-0 flex-col gap-3 px-4 pb-5 sm:px-7 sm:pb-7">
        <div className="flex min-h-0 items-center justify-center overflow-hidden rounded-[14px] bg-[var(--surface-inset)]">
          <img src={`${downloadUrl}?view=inline`} alt={attachment.filename} className="max-h-[calc(100dvh-12rem)] max-w-full object-contain" />
        </div>
        <div className="flex min-w-0 items-center justify-between gap-3"><span className="min-w-0 truncate text-xs text-[var(--muted)]">{attachment.filename}</span><a href={downloadUrl} className="focus-ring inline-flex shrink-0 items-center gap-2 rounded-xl border border-[var(--line)] px-3 py-2 text-xs text-[var(--text)]"><Download className="size-4" />Скачать</a></div>
      </div>
    </Dialog>
  </>;
}
