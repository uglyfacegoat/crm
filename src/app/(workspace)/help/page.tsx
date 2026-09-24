import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowUpRight,
  BookOpenText,
  ChevronRight,
  Clock3,
  LifeBuoy,
  Mail,
  Megaphone,
  Search,
  ShieldCheck,
} from "lucide-react";
import packageJson from "../../../../package.json";
import { SupportRequestDialog } from "@/components/help/support-request-dialog";
import { PageHeading } from "@/components/ui/page-heading";
import { helpSections, releaseNotes } from "@/lib/help-content";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import { getSupportCenterSnapshot } from "@/server/support/repository";
import type { SupportRequestStatus } from "@/server/support/types";

export const metadata: Metadata = { title: "Документация и поддержка" };

const statusLabels: Record<SupportRequestStatus, string> = {
  new: "Новое",
  in_progress: "В работе",
  resolved: "Решено",
  closed: "Закрыто",
};
const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Europe/Moscow",
});

export default async function HelpPage() {
  const member = await requireSession();
  if (!hasPermission(member, "help.read")) redirect("/");
  const support =
    getAuthMode() === "preview"
      ? { developers: [], requests: [] }
      : await getSupportCenterSnapshot(member);

  return (
    <div className="space-y-6">
      <PageHeading
        eyebrow={`База знаний · версия ${packageJson.version}`}
        title="Документация и поддержка"
        description="Пошаговые инструкции для ежедневной работы, системные обновления и обращения без потери истории."
        action={
          getAuthMode() === "preview" || !hasPermission(member, "support.write")
            ? undefined
            : <SupportRequestDialog />
        }
      />

      <section className="surface-panel grid gap-6 p-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(17rem,0.65fr)] sm:p-6">
        <article>
          <div className="flex items-center gap-2">
            <Megaphone className="size-4 text-[var(--accent)]" />
            <p className="eyebrow">Что нового</p>
          </div>
          <div className="mt-4 divide-y divide-[var(--line)]">
            {releaseNotes.map((release, index) => (
              <div
                key={`${release.version}-${release.date}-${index}`}
                className="py-4 first:pt-0 last:pb-0"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 className="font-display text-xl font-semibold text-[var(--text)]">
                    {release.title}
                  </h2>
                  <span className="rounded-full bg-[var(--support-soft)] px-2.5 py-1 text-[9px] font-semibold text-[var(--support-strong)]">
                    v{release.version} · {release.date}
                  </span>
                </div>
                <ul className="mt-3 grid gap-2 text-xs leading-5 text-[var(--text-secondary)]">
                  {release.changes.map((change) => (
                    <li key={change} className="flex gap-2">
                      <span className="mt-2 size-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                      {change}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </article>
        <aside className="border-t border-[var(--line)] pt-5 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
          <div className="flex items-center gap-2">
            <Search className="size-4 text-[var(--support)]" />
            <h2 className="text-sm font-semibold text-[var(--text)]">
              Быстрый поиск
            </h2>
          </div>
          <p className="mt-4 text-xs leading-5 text-[var(--text-secondary)]">
            На любом рабочем экране нажмите{" "}
            <kbd className="rounded-md border border-[var(--line)] bg-[var(--surface-inset)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">
              Ctrl K
            </kbd>
            , чтобы найти клиента, заказ, объект, документ, мастера или дату
            выезда.
          </p>
          <div className="mt-5 flex items-center gap-2 border-y border-[var(--info-border)] py-3 text-[10px] leading-5 text-[var(--info)]">
            <ShieldCheck className="size-4 shrink-0" />
            Результаты учитывают роль и активную компанию пользователя.
          </div>
        </aside>
      </section>

      <section className="grid items-start gap-8 xl:grid-cols-[14rem_minmax(0,1fr)]">
        <aside className="surface-panel p-3 xl:sticky xl:top-24">
          <p className="px-2 py-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
            Содержание
          </p>
          <nav aria-label="Разделы документации" className="grid gap-1">
            {helpSections.map((section) => (
              <Link
                key={section.id}
                href={`#${section.id}`}
                className="focus-ring flex items-center justify-between gap-2 rounded-[10px] px-2.5 py-2.5 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--surface-inset)] hover:text-[var(--text)]"
              >
                <span className="flex items-center gap-2">
                  <section.icon className="size-3.5" />
                  {section.title}
                </span>
                <ChevronRight className="size-3" />
              </Link>
            ))}
          </nav>
        </aside>
        <section aria-label="Материалы помощи" className="space-y-5">
          {helpSections.map((section) => {
            const Icon = section.icon;
            return (
              <section
                key={section.id}
                id={section.id}
                className="surface-panel scroll-mt-24 p-5 sm:p-6"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex max-w-2xl gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-[var(--accent-soft)] text-[var(--accent-ink)]">
                      <Icon className="size-4" />
                    </span>
                    <div>
                      <h2 className="font-display text-xl font-semibold text-[var(--text)]">
                        {section.title}
                      </h2>
                      <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                        {section.description}
                      </p>
                    </div>
                  </div>
                  <Link
                    href={section.route}
                    className="focus-ring inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-[12px] border border-[var(--line)] bg-[var(--surface-raised)] px-3 text-[10px] font-medium text-[var(--text-secondary)] hover:border-[var(--line-strong)] hover:text-[var(--text)]"
                  >
                    {section.routeLabel}
                    <ArrowUpRight className="size-3.5" />
                  </Link>
                </div>
                {section.screenshot ? (
                  <figure className="mt-6 overflow-hidden rounded-[16px] border border-[var(--line)] bg-[var(--surface-inset)] p-3">
                    <figcaption className="mb-3 flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                      <span className="size-1.5 rounded-full bg-[var(--accent)]" />
                      Актуальный снимок интерфейса
                    </figcaption>
                    <Image
                      src={section.screenshot}
                      alt={`Рабочий экран: ${section.title}`}
                      width={1440}
                      height={960}
                      unoptimized
                      sizes="(min-width: 1280px) 68rem, 100vw"
                      className="h-auto w-full rounded-[14px] border border-[var(--line-strong)]"
                    />
                  </figure>
                ) : null}
                <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(13rem,0.42fr)_minmax(0,1fr)]">
                  <aside className="border-l-2 border-[var(--accent)] pl-4">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--accent-ink)]">
                      Ориентир на экране
                    </p>
                    <p className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">
                      {section.visualHint}
                    </p>
                  </aside>
                  <ol className="divide-y divide-[var(--line)]">
                    {section.steps.map((step, index) => (
                      <li
                        key={step.title}
                        className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 py-4 first:pt-0 last:pb-0"
                      >
                        <span className="grid size-7 place-items-center rounded-full bg-[var(--surface-inset)] font-display text-[9px] text-[var(--muted)]">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <div>
                          <h3 className="text-xs font-semibold text-[var(--text)]">
                            {step.title}
                          </h3>
                          <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                            {step.body}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              </section>
            );
          })}
        </section>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="surface-panel p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <LifeBuoy className="size-4 text-[var(--warning)]" />
            <h2 className="text-sm font-semibold text-[var(--text)]">
              Контакты разработчика
            </h2>
          </div>
          {support.developers.length ? (
            <div className="mt-4 divide-y divide-[var(--line)]">
              {support.developers.map((developer) => (
                <a
                  key={developer.email}
                  href={`mailto:${developer.email}`}
                  className="focus-ring flex items-center gap-3 py-3 first:pt-0 last:pb-0 hover:text-[var(--accent-ink)]"
                >
                  <span className="grid size-9 place-items-center rounded-full bg-[var(--warning-bg)] text-[10px] font-semibold text-[var(--warning)]">
                    {developer.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <strong className="block truncate text-xs text-[var(--text)]">
                      {developer.name}
                    </strong>
                    <span className="mt-1 block truncate text-[9px] text-[var(--muted)]">
                      {developer.email}
                    </span>
                  </span>
                  <Mail className="ml-auto size-4 text-[var(--muted)]" />
                </a>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-xs leading-5 text-[var(--text-secondary)]">
              Контакт разработчика пока не настроен.
            </p>
          )}
        </article>
        <article className="surface-panel p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Clock3 className="size-4 text-[var(--support)]" />
              <h2 className="text-sm font-semibold text-[var(--text)]">
                Мои обращения
              </h2>
            </div>
            <span className="text-[9px] text-[var(--muted)]">
              {support.requests.length} последних
            </span>
          </div>
          {support.requests.length ? (
            <div className="mt-4 divide-y divide-[var(--line)]">
              {support.requests.map((request) => (
                <div
                  key={request.id}
                  className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <span className="size-2 shrink-0 rounded-full bg-[var(--support)]" />
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-xs text-[var(--text)]">
                      {request.subject}
                    </strong>
                    <span className="mt-1 block text-[9px] text-[var(--muted)]">
                      {dateFormatter.format(new Date(request.createdAt))}
                    </span>
                  </span>
                  <span className="rounded-full bg-[var(--surface-inset)] px-2 py-1 text-[9px] text-[var(--text-secondary)]">
                    {statusLabels[request.status]}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 border-l-2 border-[var(--line)] py-2 pl-4">
              <BookOpenText className="size-5 text-[var(--muted)]" />
              <p className="mt-2 text-[10px] leading-4 text-[var(--muted)]">
                Обращений пока нет. Сначала проверьте инструкцию выше.
              </p>
            </div>
          )}
        </article>
      </section>
    </div>
  );
}
