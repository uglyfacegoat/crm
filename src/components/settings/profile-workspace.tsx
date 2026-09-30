"use client";

import { useActionState, useEffect, useState } from "react";
import { Camera, Check, ShieldCheck, UserRound } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { updateProfileAction, type ProfileActionState } from "@/app/(workspace)/profile/actions";
import { roleGrades, type OrganizationRole } from "@/server/auth/types";
import type { MailDestination, MailSource } from "@/server/mail/repository";
import { MailDeliveryPreferences } from "./mail-delivery-preferences";

const initialState: ProfileActionState = { status: "idle", message: "" };
const roleLabels: Record<OrganizationRole, string> = {
  owner: "Владелец", developer: "Разработчик", deputy: "Заместитель", finance_controller: "Финконтроль", sales_lead: "Руководитель продаж", sales_specialist: "Менеджер продаж", regional_director: "Региональный директор", crm_coordinator: "Координатор CRM", tender_specialist: "Тендерный отдел", foreman: "Бригадир", admin: "Администратор", dispatcher: "Диспетчер",
  manager: "Менеджер", accountant: "Бухгалтер", master: "Мастер",
};

export function ProfileWorkspace({ displayName, email, role, destinations, mailSources, canConfigureMail, mailReady }: {
  displayName: string; email: string; role: OrganizationRole; destinations: MailDestination[]; mailSources: MailSource[];
  canConfigureMail: boolean; mailReady: boolean;
}) {
  const [state, action, pending] = useActionState(updateProfileAction, initialState);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [draftName, setDraftName] = useState(displayName);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => {
    if (state.status === "success") window.location.reload();
  }, [state.status]);

  return <div className="mx-auto max-w-5xl pb-24">
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="eyebrow">Личные настройки / 01</p>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-[var(--text)] sm:text-4xl">Мой профиль</h1>
      </div>
      <span className="rounded-full border border-[var(--line)] px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
        Ваша учётная запись
      </span>
    </div>

    <section className="relative overflow-hidden rounded-[20px] bg-[#202227] px-6 py-7 text-white sm:px-9 sm:py-9">
      <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-24 size-72 rotate-12 rounded-[44px] border border-white/15 sm:right-8 sm:size-80" />
      <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-10 size-72 rotate-12 rounded-[44px] border border-white/10 sm:right-0 sm:size-80" />
      <div className="relative flex flex-wrap items-center gap-5 sm:gap-7">
        <div className="rounded-full border border-white/30 p-1.5">
          {previewUrl
            ? <img src={previewUrl} alt="Предпросмотр фото" className="size-16 rounded-full object-cover sm:size-20" />
            : <div className="sm:[&>span]:!size-20"><Avatar name={draftName || displayName} size="lg" tone="lime" src="/api/v1/profile/avatar" /></div>}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/55">Профиль сотрудника</p>
          <p className="mt-2 break-words font-display text-2xl font-semibold leading-tight sm:text-3xl">{draftName.trim() || displayName}</p>
          <p className="mt-1 break-all text-xs text-white/65">{email}</p>
        </div>
        <div className="w-full sm:w-auto">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-2 text-xs font-medium backdrop-blur-sm">
            {role === "developer" || role === "owner" ? <ShieldCheck className="size-4" /> : <UserRound className="size-4" />}
            Уровень {roleGrades[role]} · {roleLabels[role]}
          </span>
        </div>
      </div>
      <div className="relative mt-8 flex items-center gap-3 border-t border-white/15 pt-4 text-[11px] text-white/60">
        <span className="font-semibold text-white">01</span>
        <span className="h-px w-8 bg-white/35" />
        Настройте имя и фото, которые используются в вашем профиле.
      </div>
    </section>

    <form action={action} className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="surface-panel min-w-0 p-5 sm:p-7">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--surface-soft)] text-[var(--text)]"><UserRound className="size-5" /></span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--muted)]">01 / Отображение</p>
            <h2 className="mt-1 font-display text-lg font-semibold text-[var(--text)]">Как вас видят в CRM</h2>
          </div>
        </div>
        <p className="mt-5 text-xs leading-5 text-[var(--muted)]">Имя появится у коллег в рабочих разделах. Email закреплён за учётной записью.</p>
        <label className="mt-5 block space-y-2 text-xs font-medium text-[var(--text)]">
          <span>Имя или ник</span>
          <input name="displayName" type="text" required minLength={2} maxLength={200} value={draftName}
            onChange={(event) => setDraftName(event.currentTarget.value)}
            className="focus-ring block h-12 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 text-sm" />
        </label>
        <div className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-4 py-3">
          <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--muted)]">Email для входа</p>
          <p className="mt-1 break-all text-sm text-[var(--text)]">{email}</p>
        </div>
      </section>

      <section className="surface-panel min-w-0 p-5 sm:p-7">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--surface-soft)] text-[var(--text)]"><Camera className="size-5" /></span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--muted)]">02 / Изображение</p>
            <h2 className="mt-1 font-display text-lg font-semibold text-[var(--text)]">Фото профиля</h2>
          </div>
        </div>
        <p className="mt-5 text-xs leading-5 text-[var(--muted)]">Фото показывается в вашем профиле и меню. Подойдёт PNG, JPEG или WebP до 2 МБ.</p>
        <label className="mt-5 block space-y-2 text-xs font-medium text-[var(--text)]">
          <span>Выбрать фото</span>
          <input name="photo" type="file" accept="image/png,image/jpeg,image/webp"
            onChange={(event) => setPreviewUrl(event.currentTarget.files?.[0] ? URL.createObjectURL(event.currentTarget.files[0]) : null)}
            className="focus-ring block w-full rounded-xl border border-dashed border-[var(--line-strong)] bg-[var(--surface-soft)] p-3 text-xs text-[var(--text-secondary)] file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--accent)] file:px-3 file:py-2.5 file:text-xs file:font-medium file:text-[var(--on-accent)]" />
        </label>
        <label className="mt-5 flex items-center gap-2.5 text-xs text-[var(--text-secondary)]">
          <input type="checkbox" name="removePhoto" className="size-4 accent-[var(--accent)]" /> Удалить текущее фото
        </label>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-4 lg:col-span-2">
        <p className="max-w-xl text-xs leading-5 text-[var(--muted)]">Роль и рабочие доступы на этой странице не меняются.</p>
        <button type="submit" disabled={pending} className="focus-ring inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-6 text-xs font-semibold text-[var(--on-accent)] disabled:opacity-50">
          {pending ? "Сохраняем…" : <><Check className="size-4" />Сохранить профиль</>}
        </button>
        {state.message ? <p role="status" className={`w-full text-xs ${state.status === "error" ? "text-[var(--danger-ink)]" : "text-[var(--success)]"}`}>{state.message}</p> : null}
      </div>
    </form>
    {canConfigureMail ? <MailDeliveryPreferences destinations={destinations} sources={mailSources} mailReady={mailReady} /> : null}
  </div>;
}
