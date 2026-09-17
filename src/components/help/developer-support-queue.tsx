"use client";

import { useRouter } from "next/navigation";
import {
  Building2,
  Check,
  Clock3,
  Inbox,
  LoaderCircle,
  Search,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useActionState, useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  updateSupportRequestStatusAction,
  type SupportStatusMutationState,
} from "@/app/(workspace)/developer/support/actions";
import { matchesSearchText } from "@/lib/search-normalization";
import { CustomSelect } from "@/components/ui/custom-select";
import { PageHeading } from "@/components/ui/page-heading";
import type {
  DeveloperSupportQueue as DeveloperSupportQueueData,
  DeveloperSupportTicket,
  SupportRequestCategory,
  SupportRequestStatus,
} from "@/server/support/types";

const statusLabels: Record<SupportRequestStatus, string> = {
  new: "Новое",
  in_progress: "В работе",
  resolved: "Решено",
  closed: "Закрыто",
};
const categoryLabels: Record<SupportRequestCategory, string> = {
  usability: "Интерфейс и удобство",
  data: "Данные и отчёты",
  access: "Доступ и аккаунт",
  technical: "Техническая ошибка",
};
const statusOptions = Object.entries(statusLabels).map(([value, label]) => ({
  value,
  label,
}));
const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Moscow",
});
const initialState: SupportStatusMutationState = {
  status: "idle",
  message: null,
};

function TicketStatusForm({ ticket }: { ticket: DeveloperSupportTicket }) {
  const [state, action, pending] = useActionState(
    updateSupportRequestStatusAction,
    initialState,
  );
  const [status, setStatus] = useState<SupportRequestStatus>(ticket.status);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);

  return (
    <form action={action} className="grid gap-2 sm:grid-cols-[minmax(9rem,1fr)_auto]">
      <input type="hidden" name="requestId" value={ticket.id} />
      <input type="hidden" name="expectedVersion" value={ticket.version} />
      <CustomSelect
        name="status"
        value={status}
        onChange={(value) => setStatus(value as SupportRequestStatus)}
        ariaLabel={`Статус обращения ${ticket.subject}`}
        options={statusOptions}
        disabled={pending}
        className="h-10 rounded-[11px] border border-[var(--line-strong)] bg-[var(--surface-raised)] px-3 text-xs text-[var(--text)]"
      />
      <button
        type="submit"
        disabled={pending || status === ticket.status}
        className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-[11px] bg-[var(--text)] px-4 text-xs font-semibold text-[var(--canvas)] disabled:opacity-40"
      >
        {pending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
        Сохранить
      </button>
      {state.message ? (
        <p className={`text-[10px] sm:col-span-2 ${state.status === "error" ? "text-[var(--danger-ink)]" : "text-[var(--success)]"}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function DeveloperSupportQueue({
  queue,
}: {
  queue: DeveloperSupportQueueData;
}) {
  const [status, setStatus] = useState<SupportRequestStatus | "all">("all");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const tickets = useMemo(
    () =>
      queue.tickets.filter(
        (ticket) =>
          (status === "all" || ticket.status === status) &&
          matchesSearchText(deferredQuery, [
            ticket.subject,
            ticket.description,
            ticket.organizationName,
            ticket.requesterName,
            ticket.requesterEmail,
            categoryLabels[ticket.category],
          ]),
      ),
    [deferredQuery, queue.tickets, status],
  );

  return (
    <div className="space-y-5">
      <PageHeading
        eyebrow="Системный контур"
        title="Очередь обращений"
        description="Все обращения из CRM в одном защищённом списке. Доступ определяется системной учётной записью и не входит в права организаций."
      />

      <section className="surface-panel surface-panel-popover p-4 sm:p-5">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <nav aria-label="Фильтр обращений" className="flex min-w-0 flex-wrap gap-1">
            {(["all", "new", "in_progress", "resolved", "closed"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatus(value)}
                className={`focus-ring inline-flex h-10 shrink-0 items-center gap-2 rounded-[11px] px-3 text-xs ${status === value ? "bg-[var(--accent)] font-semibold text-[var(--on-accent)]" : "bg-[var(--surface-inset)] text-[var(--text-secondary)] hover:bg-[var(--surface-soft)]"}`}
              >
                {value === "all" ? "Все" : statusLabels[value]}
                <span className="opacity-70">{queue.counts[value]}</span>
              </button>
            ))}
          </nav>
          <label className="flex h-10 items-center gap-2 rounded-[11px] border border-[var(--line-strong)] bg-[var(--surface-raised)] px-3">
            <Search className="size-4 text-[var(--muted)]" />
            <span className="sr-only">Поиск обращений</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Тема, компания, автор…"
              className="min-w-0 flex-1 bg-transparent text-xs text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)]"
            />
          </label>
        </div>
      </section>

      {tickets.length ? (
        <section className="grid items-start gap-4 xl:grid-cols-2">
          {tickets.map((ticket) => (
            <article key={ticket.id} className="surface-panel surface-panel-popover relative p-5 focus-within:z-20 sm:p-6">
              <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line)] pb-4">
                <div className="min-w-0">
                  <p className="eyebrow">{categoryLabels[ticket.category]}</p>
                  <h2 className="mt-2 text-base font-semibold leading-6 text-[var(--text)]">
                    {ticket.subject}
                  </h2>
                </div>
                <span className="rounded-full bg-[var(--surface-inset)] px-2.5 py-1 text-[10px] text-[var(--text-secondary)]">
                  {statusLabels[ticket.status]}
                </span>
              </header>
              <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-[var(--text-secondary)]">
                {ticket.description}
              </p>
              <dl className="mt-5 grid gap-3 border-y border-[var(--line)] py-4 text-[10px] text-[var(--muted)] sm:grid-cols-2 [&>div]:min-w-0">
                <div className="flex items-center gap-2">
                  <Building2 className="size-3.5" />
                  <span className="truncate">{ticket.organizationName}</span>
                </div>
                <div className="flex items-center gap-2">
                  <UserRound className="size-3.5" />
                  <span className="truncate">{ticket.requesterName} · {ticket.requesterEmail}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock3 className="size-3.5" />
                  <time dateTime={ticket.createdAt}>{dateFormatter.format(new Date(ticket.createdAt))}</time>
                </div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="size-3.5" />
                  <span className="truncate">{ticket.handledByEmail ?? "Ещё не взято в работу"}</span>
                </div>
              </dl>
              <div className="mt-4">
                <TicketStatusForm ticket={ticket} />
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="surface-panel grid min-h-64 place-items-center p-8 text-center">
          <div>
            <Inbox className="mx-auto size-8 text-[var(--muted)]" />
            <h2 className="mt-4 text-sm font-semibold text-[var(--text)]">Обращения не найдены</h2>
            <p className="mt-2 text-xs text-[var(--muted)]">Измените статус или поисковый запрос.</p>
          </div>
        </section>
      )}
    </div>
  );
}
