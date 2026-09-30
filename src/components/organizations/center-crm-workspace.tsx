"use client";

import { ArrowRight, Check, LoaderCircle, Search } from "lucide-react";
import { useActionState } from "react";
import { openCenterRecordAction } from "@/app/(workspace)/companies/center-actions";
import { switchOrganizationAction, type OrganizationSwitchState } from "@/app/(workspace)/actions";
import type { CenterFeed } from "@/server/organizations/center-feed";
import type { OrganizationOption } from "@/server/organizations/types";

const initialSwitchState: OrganizationSwitchState = { status: "idle", message: null };
const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow",
});
const leadLabels = { new: "Новая", reviewing: "На проверке", accepted: "Принята", rejected: "Отклонена" };
const orderLabels = { new: "Новый", approval: "Согласование", scheduled: "Запланирован", in_progress: "В работе", completed: "Выполнен", overdue: "Просрочен", cancelled: "Отменён" };

export function CenterCrmWorkspace({
  organization, feed, query, error, preview, canSwitch, searchAction = "/companies",
}: {
  organization: OrganizationOption;
  feed: CenterFeed;
  query: string;
  error: boolean;
  preview: boolean;
  canSwitch: boolean;
  searchAction?: "/" | "/companies";
}) {
  const [switchState, switchAction, switching] = useActionState(switchOrganizationAction, initialSwitchState);
  return (
    <section className="surface-panel p-5 sm:p-6" aria-label="Центр CRM">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">Центр CRM</p>
          <h2 className="mt-2 font-display text-xl font-semibold text-[var(--text)]">Работа по всем компаниям</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--muted)]">
            Здесь собраны заявки и заказы доступных компаний. Записи открываются в Центре CRM без смены рабочего контура.
          </p>
        </div>
        {organization.current ? (
          <span className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-3 py-2 text-xs text-[var(--text-secondary)]"><Check className="size-4" />Центр открыт</span>
        ) : preview || !canSwitch ? null : (
          <form action={switchAction}>
            <input type="hidden" name="organizationId" value={organization.id} />
            <button type="submit" disabled={switching} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-[12px] bg-[var(--text)] px-4 text-xs font-semibold text-[var(--canvas)] disabled:opacity-60">
              {switching ? <LoaderCircle className="size-4 animate-spin" /> : null}Открыть центр CRM
            </button>
          </form>
        )}
      </div>

      {error || switchState.status === "error" ? (
        <p role="alert" className="mt-4 rounded-[12px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-xs text-[var(--danger-ink)]">
          {switchState.message ?? "Запись больше не доступна. Обновите страницу и попробуйте ещё раз."}
        </p>
      ) : null}

      <form action={searchAction} method="get" className="mt-6 flex gap-2">
        <label className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-3.5 size-4 text-[var(--muted)]" />
          <span className="sr-only">Поиск по заявкам и заказам компаний</span>
          <input name="centerQuery" defaultValue={query} maxLength={100} placeholder="Компания, клиент, номер заказа, телефон…" className="focus-ring h-11 w-full rounded-[12px] border border-[var(--line)] bg-[var(--surface-inset)] pl-10 pr-3 text-xs text-[var(--text)] outline-none" />
        </label>
        <button type="submit" className="focus-ring rounded-[12px] border border-[var(--line)] px-4 text-xs font-medium text-[var(--text)]">Найти</button>
      </form>

      <div className="mt-6 grid min-w-0 gap-5 xl:grid-cols-2">
        <section className="min-w-0 rounded-[14px] border border-[var(--line)] bg-[var(--surface-inset)] p-4 sm:p-5" aria-label="Заявки всех компаний">
          <div className="flex items-baseline justify-between gap-3"><h3 className="text-sm font-semibold text-[var(--text)]">Заявки</h3><span className="text-xs text-[var(--muted)]">{feed.leads.length} в списке</span></div>
          <div className="mt-4 grid gap-2">
            {feed.leads.length ? feed.leads.map((lead) => (
              <article key={lead.id} className="min-w-0 rounded-[12px] border border-[var(--line)] bg-[var(--surface)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-[var(--muted)]"><span>{lead.organizationName}</span><span>{leadLabels[lead.status]} · {dateFormatter.format(new Date(lead.receivedAt))}</span></div>
                <p className="mt-2 truncate text-sm font-semibold text-[var(--text)]" title={lead.contact}>{lead.contact}</p>
                <p className="mt-1 truncate text-xs text-[var(--text-secondary)]" title={lead.service}>{lead.service}</p>
                {preview || !canSwitch ? null : <form action={openCenterRecordAction} className="mt-3">
                  <input type="hidden" name="kind" value="lead" /><input type="hidden" name="organizationId" value={lead.organizationId} /><input type="hidden" name="recordId" value={lead.id} />
                  <button type="submit" className="focus-ring inline-flex min-h-9 items-center gap-2 text-xs font-medium text-[var(--text)]">Открыть заявку <ArrowRight className="size-3.5" /></button>
                </form>}
              </article>
            )) : <p className="rounded-[12px] border border-dashed border-[var(--line)] p-6 text-center text-xs text-[var(--muted)]">{query ? "По запросу заявок нет" : "Заявок пока нет"}</p>}
          </div>
        </section>
        <section className="min-w-0 rounded-[14px] border border-[var(--line)] bg-[var(--surface-inset)] p-4 sm:p-5" aria-label="Заказы всех компаний">
          <div className="flex items-baseline justify-between gap-3"><h3 className="text-sm font-semibold text-[var(--text)]">Заказы</h3><span className="text-xs text-[var(--muted)]">{feed.orders.length} в списке</span></div>
          <div className="mt-4 grid gap-2">
            {feed.orders.length ? feed.orders.map((order) => (
              <article key={order.id} className="min-w-0 rounded-[12px] border border-[var(--line)] bg-[var(--surface)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-[var(--muted)]"><span>{order.organizationName}</span><span>{orderLabels[order.status]} · {dateFormatter.format(new Date(order.createdAt))}</span></div>
                <p className="mt-2 truncate text-sm font-semibold text-[var(--text)]" title={order.number}>{order.number}</p>
                <p className="mt-1 truncate text-xs text-[var(--text-secondary)]" title={order.client}>{order.client}</p>
                {preview || !canSwitch ? null : <form action={openCenterRecordAction} className="mt-3">
                  <input type="hidden" name="kind" value="order" /><input type="hidden" name="organizationId" value={order.organizationId} /><input type="hidden" name="recordId" value={order.id} />
                  <button type="submit" className="focus-ring inline-flex min-h-9 items-center gap-2 text-xs font-medium text-[var(--text)]">Открыть заказ <ArrowRight className="size-3.5" /></button>
                </form>}
              </article>
            )) : <p className="rounded-[12px] border border-dashed border-[var(--line)] p-6 text-center text-xs text-[var(--muted)]">{query ? "По запросу заказов нет" : "Заказов пока нет"}</p>}
          </div>
        </section>
      </div>
    </section>
  );
}
