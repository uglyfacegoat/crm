"use client";

import { Camera, Check, FileSignature, ImageIcon, LoaderCircle, Upload } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import {
  uploadAssignedVisitEvidenceAction,
  type VisitEvidenceState,
} from "@/app/(workspace)/calendar/actions";
import { clientCrypto as crypto } from "@/lib/client-id";
import type { ServiceVisit } from "@/server/visits/types";

const initialState: VisitEvidenceState = {
  status: "idle",
  message: null,
  fieldErrors: {},
};

export function VisitEvidenceForm({
  visit,
  onClose,
}: {
  visit: ServiceVisit;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(
    uploadAssignedVisitEvidenceAction,
    initialState,
  );
  const [requestKey] = useState(() => crypto.randomUUID());
  const [kind, setKind] = useState<"work_photo" | "contract_photo">("work_photo");
  const [filename, setFilename] = useState<string | null>(null);

  useEffect(() => {
    if (state.status !== "success") return;
    const timeout = window.setTimeout(onClose, 1_100);
    return () => window.clearTimeout(timeout);
  }, [onClose, state.status]);

  return (
    <form action={action} className="flex min-h-0 flex-1 flex-col">
      <input type="hidden" name="idempotencyKey" value={requestKey} />
      <input type="hidden" name="visitId" value={visit.id} />
      <input type="hidden" name="kind" value={kind} />
      <div className="flex-1 space-y-5 overflow-y-auto p-5 sm:p-7">
        <section className="rounded-[16px] border border-[var(--line)] bg-[var(--surface-inset)] p-4">
          <p className="text-sm font-semibold text-[var(--text)]">{visit.client}</p>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{visit.object} · заказ №{visit.orderNumber}</p>
        </section>

        <fieldset>
          <legend className="text-[10px] text-[var(--text-secondary)]">Что загружаете</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {([
              { value: "work_photo", label: "Фото работы", icon: ImageIcon },
              { value: "contract_photo", label: "Фото договора", icon: FileSignature },
            ] as const).map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={kind === option.value}
                onClick={() => setKind(option.value)}
                className={`focus-ring flex min-h-12 items-center justify-center gap-2 rounded-[13px] border text-xs ${kind === option.value ? "border-[var(--accent)] bg-[var(--accent-soft)] font-semibold text-[var(--accent-ink)]" : "border-[var(--line)] bg-[var(--surface-raised)] text-[var(--text-secondary)]"}`}
              >
                <option.icon className="size-4" />
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="grid gap-2 text-[10px] text-[var(--text-secondary)]">
          Фотография *
          <span className="focus-within:outline-focus flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-[16px] border border-dashed border-[var(--line-strong)] bg-[var(--surface-inset)] px-4 py-6 text-center hover:bg-[var(--surface-soft)]">
            <input
              type="file"
              name="file"
              required
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              className="sr-only"
              onChange={(event) => setFilename(event.currentTarget.files?.[0]?.name ?? null)}
            />
            {filename ? <Camera className="size-7 text-[var(--success)]" /> : <Upload className="size-7 text-[var(--muted)]" />}
            <span className="mt-3 max-w-full truncate text-xs text-[var(--text)]">{filename ?? "Снять фото или выбрать файл"}</span>
            <span className="mt-1 text-[9px] text-[var(--muted)]">JPG, PNG или WebP · до 15 МБ</span>
          </span>
          {state.fieldErrors.file?.[0] ? <span className="text-[var(--danger-ink)]">{state.fieldErrors.file[0]}</span> : null}
        </label>

        <label className="grid gap-2 text-[10px] text-[var(--text-secondary)]">
          Комментарий
          <textarea
            name="note"
            maxLength={1_000}
            rows={4}
            placeholder="Что видно на фото или к какой части работ оно относится"
            className="focus-ring resize-none rounded-[14px] border border-[var(--line)] bg-[var(--surface-raised)] p-3 text-xs leading-5 text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)]"
          />
        </label>

        {state.message ? (
          <p role={state.status === "error" ? "alert" : "status"} className={`rounded-[12px] border p-3 text-xs ${state.status === "success" ? "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]" : "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-ink)]"}`}>
            {state.message}
          </p>
        ) : null}
      </div>
      <footer className="flex shrink-0 gap-2 border-t border-[var(--line)] bg-[var(--surface-raised)] p-4 sm:px-7">
        <button type="button" onClick={onClose} disabled={pending} className="focus-ring h-11 flex-1 rounded-[12px] border border-[var(--line-strong)] text-xs text-[var(--text-secondary)]">Отмена</button>
        <button type="submit" disabled={pending || state.status === "success"} className="focus-ring inline-flex h-11 flex-[1.4] items-center justify-center gap-2 rounded-[12px] bg-[var(--accent)] px-4 text-xs font-semibold text-[var(--on-accent)] disabled:opacity-55">
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : state.status === "success" ? <Check className="size-4" /> : <Camera className="size-4" />}
          {pending ? "Сохраняем…" : state.status === "success" ? "Сохранено" : "Добавить материал"}
        </button>
      </footer>
    </form>
  );
}
