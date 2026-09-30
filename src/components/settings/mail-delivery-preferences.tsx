"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Mail, Plus, Trash2 } from "lucide-react";
import { addMailDestinationAction, removeMailDestinationAction,
  updateMailDestinationAction, type MailActionState } from "@/app/(workspace)/profile/mail-actions";
import type { MailDestination, MailSource } from "@/server/mail/repository";

const initialState: MailActionState = { status: "idle", message: "" };

export function MailDeliveryPreferences({ destinations, sources, mailReady }: {
  destinations: MailDestination[]; sources: MailSource[]; mailReady: boolean;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(addMailDestinationAction, initialState);
  useEffect(() => { if (state.status === "success") router.refresh(); }, [state.status, router]);
  return <section className="surface-panel mt-5 p-5 sm:p-7">
    <div className="flex items-start gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--surface-soft)] text-[var(--text)]"><Mail className="size-5" /></span>
      <div><p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--muted)]">03 / Почта</p>
        <h2 className="mt-1 font-display text-lg font-semibold text-[var(--text)]">Копии на личный адрес</h2></div>
    </div>
    <p className="mt-4 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">Заявки и письма остаются в CRM. Добавьте личный адрес и выберите, с каких сайтов получать копии. Внутренний чат сюда не входит.</p>
    {!mailReady ? <p className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] p-4 text-xs leading-5 text-[var(--text-secondary)]">Почтовый ящик компании ещё подключается. Адрес можно сохранить сейчас; отправка и подтверждение заработают после подключения исходящей почты.</p> : null}
    <form action={action} className="mt-5 flex flex-col gap-3 sm:flex-row">
      <label className="min-w-0 flex-1"><span className="sr-only">Адрес для копий</span>
        <input name="email" type="email" required maxLength={254} placeholder="Ваш email для копий"
          className="focus-ring h-12 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 text-sm" /></label>
      <button disabled={pending || destinations.length >= 5} className="focus-ring inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-5 text-sm font-medium text-[var(--on-accent)] disabled:opacity-50"><Plus className="size-4" />Добавить адрес</button>
    </form>
    {state.message ? <p role="status" className={`mt-3 text-xs ${state.status === "error" ? "text-[var(--danger-ink)]" : "text-[var(--success)]"}`}>{state.message}</p> : null}
    <div className="mt-5 space-y-3">
      {destinations.map((destination) => <div key={destination.id} className="rounded-xl border border-[var(--line)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0">
          <p className="break-all text-sm font-medium text-[var(--text)]">{destination.email}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">{destination.verified ? "Адрес подтверждён" : "Ожидает подтверждения по письму"}</p>
        </div><form action={removeMailDestinationAction}><input type="hidden" name="id" value={destination.id} />
          <button type="submit" aria-label={`Удалить ${destination.email}`} className="focus-ring grid size-9 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-soft)]"><Trash2 className="size-4" /></button></form></div>
        <form action={updateMailDestinationAction} className="mt-4 space-y-3 text-xs text-[var(--text-secondary)]">
          <input type="hidden" name="id" value={destination.id} />
          {sources.map((source) => {
            const preference = destination.sourcePreferences.find((item) => item.sourceId === source.id);
            return <div key={source.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[var(--surface-soft)] px-3 py-2">
              <div className="min-w-0"><strong className="block text-[var(--text)]">{source.displayName}</strong>
                <span className="break-all text-[var(--muted)]">{source.address}</span></div>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {source.websiteId ? <label className="flex items-center gap-2"><input type="checkbox" name={`source:${source.id}:leads`} defaultChecked={preference?.leadsEnabled ?? false} />Заявки</label> : null}
                <label className="flex items-center gap-2"><input type="checkbox" name={`source:${source.id}:mail`} defaultChecked={preference?.mailEnabled ?? false} />Письма</label>
              </div>
            </div>;
          })}
          {!sources.length ? <p className="text-[var(--muted)]">Почтовые адреса сайтов ещё не подключены.</p> : null}
          <button type="submit" disabled={!sources.length} className="focus-ring rounded-lg border border-[var(--line)] px-3 py-2 font-medium disabled:opacity-50">Сохранить выбор</button>
        </form>
      </div>)}
      {!destinations.length ? <p className="text-xs text-[var(--muted)]">Адреса для копий пока не добавлены.</p> : null}
    </div>
  </section>;
}
