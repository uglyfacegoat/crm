"use client";

import { Building2, CalendarClock, Check, CheckSquare2, ClipboardList, Globe2, LoaderCircle, Plus, ShieldCheck, UsersRound, WalletCards } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { switchOrganizationAction } from "@/app/(workspace)/actions";
import { createOrganizationAction, type OrganizationMutationState } from "@/app/(workspace)/settings/organization-actions";
import { OrderField, OrderFormFooter, orderInputClass } from "@/components/orders/order-form-parts";
import { Dialog } from "@/components/ui/dialog";
import { clientCrypto as crypto } from "@/lib/client-id";
import { formatMoneyMinor } from "@/lib/format";
import type { OrganizationSummary } from "@/server/organizations/types";

const initialState: OrganizationMutationState = { status: "idle", message: null, fieldErrors: {} };

function CreateOrganizationForm({ requestKey, onComplete }: { requestKey: string; onComplete: () => void }) {
  const [state, action, pending] = useActionState(createOrganizationAction, initialState);
  const router = useRouter();
  useEffect(() => {
    if (state.status !== "success") return;
    router.refresh();
    const timeout = window.setTimeout(onComplete, 650);
    return () => window.clearTimeout(timeout);
  }, [onComplete, router, state.status]);

  return <form action={action} className="flex min-h-full flex-1 flex-col">
    <input type="hidden" name="idempotencyKey" value={requestKey} />
    <div className="flex-1 space-y-5 p-5 sm:p-7">
      <OrderField label="Название компании" required errors={state.fieldErrors.name}><input name="name" required minLength={2} maxLength={200} autoFocus className={orderInputClass} placeholder="Например, ТехСтройИнвест" /></OrderField>
      <OrderField label="Рабочий часовой пояс" required errors={state.fieldErrors.timezone}><select name="timezone" defaultValue="Europe/Moscow" className={orderInputClass}><option value="Europe/Kaliningrad">Калининград</option><option value="Europe/Moscow">Москва</option><option value="Europe/Samara">Самара</option><option value="Asia/Yekaterinburg">Екатеринбург</option><option value="Asia/Novosibirsk">Новосибирск</option><option value="Asia/Vladivostok">Владивосток</option></select></OrderField>
      <div className="flex gap-3 rounded-[13px] border border-[#65b7ee]/15 bg-[#65b7ee]/[0.04] p-4"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#65b7ee]" /><p className="text-[10px] leading-5 text-[#7892a1]">Компания получает отдельное рабочее пространство. Клиенты, заказы, финансы и документы не смешиваются с другими компаниями.</p></div>
      {state.message ? <p role="status" className={`rounded-[12px] border p-3 text-xs ${state.status === "success" ? "border-[#69d3a4]/20 text-[#83d4b1]" : "border-[#ef646a]/20 text-[#dc8b90]"}`}>{state.status === "success" ? <Check className="mr-2 inline size-4" /> : null}{state.message}</p> : null}
    </div>
    <OrderFormFooter pending={pending} saved={state.status === "success"} onCancel={onComplete} submitLabel="Создать компанию" />
  </form>;
}

function OpenOrganizationButton({ organization }: { organization: OrganizationSummary }) {
  const [pending, startTransition] = useTransition();
  if (organization.current) return <span className="rounded-full bg-[#69d3a4]/[0.08] px-2 py-1 text-[9px] text-[#78cfa8]">Открыта</span>;
  return <form onSubmit={(event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      await switchOrganizationAction(formData);
      window.location.reload();
    });
  }}>
    <input type="hidden" name="organizationId" value={organization.id} />
    <button type="submit" disabled={pending} className="focus-ring flex h-9 items-center gap-2 rounded-[10px] border border-white/[0.08] px-3 text-[10px] text-[#a9b2b6] hover:bg-white/[0.04] disabled:opacity-55">{pending ? <LoaderCircle className="size-3.5 animate-spin" /> : null}Открыть</button>
  </form>;
}

export function OrganizationPanel({ organizations, preview }: { organizations: OrganizationSummary[]; preview: boolean }) {
  const [requestKey, setRequestKey] = useState<string | null>(null);
  const close = useCallback(() => setRequestKey(null), []);
  const current = organizations.find((organization) => organization.current);
  const canCreate = !preview && current?.kind === "center";
  const totals = useMemo(() => organizations.reduce((summary, organization) => ({
    clients: summary.clients + organization.clientCount,
    orders: summary.orders + organization.orderCount,
    activeOrders: summary.activeOrders + organization.activeOrderCount,
    visits: summary.visits + organization.upcomingVisitCount,
    tasks: summary.tasks + organization.openTaskCount,
    receivedMinor: summary.receivedMinor === null || organization.receivedMinor === null ? null : summary.receivedMinor + organization.receivedMinor,
  }), { clients: 0, orders: 0, activeOrders: 0, visits: 0, tasks: 0, receivedMinor: 0 as number | null }), [organizations]);

  return <div className="mt-5 space-y-4">
    <section className="surface-panel flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
      <span className="grid size-12 shrink-0 place-items-center rounded-[14px] bg-[var(--accent)]/[0.08] text-[var(--accent)]"><Building2 className="size-5" /></span>
      <div className="min-w-0 flex-1"><h2 className="font-display text-base font-semibold text-white">Центр и компании</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-[#727c82]">Центр показывает общую картину, а переход в компанию открывает только её клиентов, заказы, финансы и документы.</p></div>
      <button type="button" disabled={!canCreate} onClick={() => setRequestKey(crypto.randomUUID())} className="focus-ring flex min-h-11 items-center justify-center gap-2 rounded-[13px] bg-[var(--accent)] px-4 text-xs font-semibold text-[#111509] disabled:cursor-not-allowed disabled:opacity-40"><Plus className="size-4" />Новая компания</button>
    </section>

    {current?.kind === "center" ? <section className="surface-panel overflow-hidden"><div className="border-b border-white/[0.06] px-5 py-4"><p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-[var(--accent)]">Сводка группы</p><h3 className="mt-1 text-sm font-semibold text-white">Все доступные компании</h3></div><div className="grid gap-px bg-white/[0.055] sm:grid-cols-3 xl:grid-cols-6">{[
      { icon: UsersRound, label: "Клиенты", value: totals.clients, tone: "text-[#69d3a4]" },
      { icon: ClipboardList, label: "Все заказы", value: totals.orders, tone: "text-[#a892ec]" },
      { icon: ClipboardList, label: "Активные", value: totals.activeOrders, tone: "text-[#efb56a]" },
      { icon: CalendarClock, label: "Будущие выезды", value: totals.visits, tone: "text-[#65b7ee]" },
      { icon: CheckSquare2, label: "Открытые задачи", value: totals.tasks, tone: "text-[#ef8b67]" },
      { icon: WalletCards, label: "Получено", value: totals.receivedMinor === null ? "Скрыто правами" : formatMoneyMinor(totals.receivedMinor), tone: "text-[var(--accent)]" },
    ].map(({ icon: Icon, label, value, tone }) => <div key={label} className="bg-[#10171b] p-4"><Icon className={`size-4 ${tone}`} /><p className="mt-4 text-[9px] uppercase tracking-[0.12em] text-[#5f6a70]">{label}</p><p className="mt-1 font-display text-lg font-semibold text-white">{value}</p></div>)}</div></section> : null}

    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{organizations.map((organization) => <article key={organization.id} className={`surface-panel overflow-hidden ${organization.current ? "border-[var(--accent)]/20 bg-[var(--accent)]/[0.025]" : ""}`}><div className="p-5"><div className="flex items-start justify-between gap-3"><span className={`grid size-10 place-items-center rounded-[12px] ${organization.kind === "center" ? "bg-[var(--accent)]/[0.08] text-[var(--accent)]" : "bg-[#65b7ee]/[0.08] text-[#65b7ee]"}`}>{organization.kind === "center" ? <Building2 className="size-4" /> : <Globe2 className="size-4" />}</span><OpenOrganizationButton organization={organization} /></div><h3 className="mt-4 text-sm font-medium text-white">{organization.name}</h3><p className="mt-1 text-[10px] text-[#667178]">{organization.kind === "center" ? "Управление группой компаний" : "Изолированное рабочее пространство"}</p></div><dl className="grid grid-cols-3 gap-px bg-white/[0.05] text-center"><div className="bg-[#10171b] px-2 py-3"><dt className="text-[8px] uppercase text-[#59656b]">Клиенты</dt><dd className="mt-1 text-xs text-white">{organization.clientCount}</dd></div><div className="bg-[#10171b] px-2 py-3"><dt className="text-[8px] uppercase text-[#59656b]">Заказы</dt><dd className="mt-1 text-xs text-white">{organization.orderCount}</dd></div><div className="bg-[#10171b] px-2 py-3"><dt className="text-[8px] uppercase text-[#59656b]">Активные</dt><dd className="mt-1 text-xs text-white">{organization.activeOrderCount}</dd></div></dl></article>)}</section>

    {!canCreate && current?.kind === "company" ? <p className="text-[10px] text-[#69747a]">Вернитесь в «Центр компаний» через переключатель слева, чтобы добавить ещё одну компанию.</p> : null}
    <Dialog open={requestKey !== null} onClose={close} title="Новая компания" description="Создание отдельного рабочего пространства без смешивания данных.">{requestKey ? <CreateOrganizationForm requestKey={requestKey} onComplete={close} /> : null}</Dialog>
  </div>;
}
