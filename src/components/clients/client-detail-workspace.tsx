import Link from "next/link";
import { Building2, CalendarDays, ContactRound, Mail, MapPin, Phone, ShieldAlert, UserRound } from "lucide-react";
import { ClientDetailActions } from "./client-detail-dialogs";
import { BackLink } from "@/components/ui/back-link";
import type { ClientDetail } from "@/server/clients/types";

function DetailStat({ label, value, icon: Icon }: { label: string; value: string | number; icon: typeof Building2 }) {
  return (
    <div className="surface-panel flex min-h-28 items-center gap-4 p-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-[12px] border border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent)]"><Icon className="size-4.5" /></span>
      <div><p className="text-[10px] uppercase tracking-[0.11em] text-[var(--muted)]">{label}</p><p className="mt-2 font-display text-2xl font-semibold text-[var(--text)]">{value}</p></div>
    </div>
  );
}

function EmptySection({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-40 place-items-center rounded-[14px] border border-dashed border-[var(--line-strong)] p-6 text-center text-xs leading-5 text-[var(--muted)]">{children}</div>;
}

export function ClientDetailWorkspace({ client }: { client: ClientDetail }) {
  const createdAt = new Intl.DateTimeFormat("ru-RU", { dateStyle: "long" }).format(new Date(client.createdAt));

  return (
    <div className="pb-8">
      <BackLink href="/clients">К списку клиентов</BackLink>
      <header className="mt-5 flex flex-col gap-5 border-b border-[var(--line)] pb-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-2.5 py-1 text-[9px] uppercase tracking-[0.11em] text-[var(--accent-ink)]">{client.kind === "legal_entity" ? "Юридическое лицо" : "Физическое лицо"}</span>
            <span className="text-[10px] text-[var(--muted)]">Карточка v{client.version}</span>
          </div>
          <h1 className="mt-3 max-w-4xl font-display text-[clamp(1.8rem,1.2rem+1.4vw,3rem)] font-semibold leading-[1.05] tracking-[-0.045em] text-[var(--text)]">{client.legalName}</h1>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[var(--text-secondary)]">
            {client.taxId ? <span>ИНН {client.taxId}</span> : null}
            <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-3.5 text-[var(--support)]" />В базе с {createdAt}</span>
          </div>
        </div>
        <ClientDetailActions client={client} />
      </header>

      <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <DetailStat label="Объекты" value={client.objects.length} icon={Building2} />
        <DetailStat label="Контакты" value={client.contacts.length} icon={ContactRound} />
        <DetailStat label="Заказы" value={client.orderCount} icon={CalendarDays} />
        <DetailStat label="Уровень риска" value={client.objects.length ? `${Math.max(...client.objects.map((object) => object.riskLevel ?? 0))}/5` : "—"} icon={ShieldAlert} />
      </section>

      <div className="mt-5 grid gap-5 2xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.7fr)]">
        <section className="surface-panel p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3"><div><h2 className="font-display text-base font-semibold text-[var(--text)]">Объекты клиента</h2><p className="mt-1 text-[10px] text-[var(--muted)]">Адреса для заказов, выездов и договоров</p></div></div>
          {client.objects.length ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {client.objects.map((object) => (
                <article key={object.id} className="inset-panel p-4">
                  <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-[var(--text)]">{object.name}</p><p className="mt-1 text-[10px] text-[var(--muted)]">{object.objectType}</p></div><span className="shrink-0 rounded-full bg-[var(--surface-soft)] px-2 py-1 text-[9px] text-[var(--muted)]">риск {object.riskLevel ?? "—"}/5</span></div>
                  <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-[var(--text-secondary)]"><MapPin className="mt-0.5 size-3.5 shrink-0 text-[var(--accent)]" />{object.address}</p>
                  <div className="mt-4 grid grid-cols-2 gap-2 border-t border-[var(--line)] pt-3 text-[10px] text-[var(--muted)]"><span>{object.areaSquareMeters ? `${object.areaSquareMeters.toLocaleString("ru-RU")} м²` : "Площадь не указана"}</span><span>{object.floorCount ? `${object.floorCount} эт.` : "Этажи не указаны"}</span></div>
                  {object.onsiteContact ? <p className="mt-3 text-[10px] text-[var(--muted)]">На объекте: {object.onsiteContact}</p> : null}
                </article>
              ))}
            </div>
          ) : <div className="mt-4"><EmptySection>Объекты ещё не добавлены.<br />Создайте первый адрес, чтобы использовать его в заказах.</EmptySection></div>}
        </section>

        <section className="surface-panel p-4 sm:p-5">
          <h2 className="font-display text-base font-semibold text-[var(--text)]">Контакты</h2>
          <p className="mt-1 text-[10px] text-[var(--muted)]">Сотрудники и ответственные заказчика</p>
          {client.contacts.length ? (
            <div className="mt-4 divide-y divide-[var(--line)]">
              {client.contacts.map((contact) => (
                <article key={contact.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--surface-soft)] text-[var(--support)]"><UserRound className="size-4" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-xs font-semibold text-[var(--text)]">{contact.fullName}</p>{contact.isPrimary ? <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[8px] uppercase tracking-[0.08em] text-[var(--accent-ink)]">основной</span> : null}</div>{contact.position ? <p className="mt-1 text-[10px] text-[var(--muted)]">{contact.position}</p> : null}<a href={`tel:${contact.phone}`} className="focus-ring mt-3 flex w-fit items-center gap-2 rounded text-[11px] text-[var(--text-secondary)] hover:text-[var(--text)]"><Phone className="size-3.5 text-[var(--support)]" />{contact.phone}</a>{contact.email ? <a href={`mailto:${contact.email}`} className="focus-ring mt-2 flex w-fit items-center gap-2 rounded text-[11px] text-[var(--text-secondary)] hover:text-[var(--text)]"><Mail className="size-3.5 text-[var(--support)]" />{contact.email}</a> : null}</div></div>
                </article>
              ))}
            </div>
          ) : <div className="mt-4"><EmptySection>Контактов пока нет</EmptySection></div>}
        </section>
      </div>

      <section className="surface-panel mt-5 flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="font-display text-base font-semibold text-[var(--text)]">История заказов</h2><p className="mt-1 text-xs text-[var(--muted)]">Связанные заказы и выезды будут собраны в одном потоке.</p></div>
        <Link href="/orders" className="focus-ring inline-flex h-10 items-center justify-center rounded-[12px] border border-[var(--line)] px-4 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)]">Открыть заказы</Link>
      </section>
    </div>
  );
}
