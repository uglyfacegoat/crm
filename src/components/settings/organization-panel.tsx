"use client";

import { Building2, Check, Globe2, Plus, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useState } from "react";
import { createOrganizationAction, type OrganizationMutationState } from "@/app/(workspace)/settings/organization-actions";
import { clientCrypto as crypto } from "@/lib/client-id";
import { OrderField, OrderFormFooter, orderInputClass } from "@/components/orders/order-form-parts";
import { Dialog } from "@/components/ui/dialog";
import type { OrganizationOption } from "@/server/organizations/types";

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

export function OrganizationPanel({ organizations, preview }: { organizations: OrganizationOption[]; preview: boolean }) {
  const [requestKey, setRequestKey] = useState<string | null>(null);
  const close = useCallback(() => setRequestKey(null), []);
  const current = organizations.find((organization) => organization.current);
  const canCreate = !preview && current?.kind === "center";
  return <div className="mt-5 space-y-4">
    <section className="surface-panel flex flex-col gap-4 p-5 sm:flex-row sm:items-center"><span className="grid size-12 shrink-0 place-items-center rounded-[14px] bg-[var(--accent)]/[0.08] text-[var(--accent)]"><Building2 className="size-5" /></span><div className="min-w-0 flex-1"><h2 className="font-display text-base font-semibold text-white">Центр и компании</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-[#727c82]">Центр управляет доступными компаниями. Переключатель слева меняет активную компанию для всех реестров и операций.</p></div><button type="button" disabled={!canCreate} onClick={() => setRequestKey(crypto.randomUUID())} className="focus-ring flex min-h-11 items-center justify-center gap-2 rounded-[13px] bg-[var(--accent)] px-4 text-xs font-semibold text-[#111509] disabled:cursor-not-allowed disabled:opacity-40"><Plus className="size-4" />Новая компания</button></section>
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{organizations.map((organization) => <article key={organization.id} className={`surface-panel p-5 ${organization.current ? "border-[var(--accent)]/20 bg-[var(--accent)]/[0.025]" : ""}`}><div className="flex items-start justify-between gap-3"><span className={`grid size-10 place-items-center rounded-[12px] ${organization.kind === "center" ? "bg-[var(--accent)]/[0.08] text-[var(--accent)]" : "bg-[#65b7ee]/[0.08] text-[#65b7ee]"}`}>{organization.kind === "center" ? <Building2 className="size-4" /> : <Globe2 className="size-4" />}</span>{organization.current ? <span className="rounded-full bg-[#69d3a4]/[0.08] px-2 py-1 text-[9px] text-[#78cfa8]">Открыта</span> : null}</div><h3 className="mt-4 text-sm font-medium text-white">{organization.name}</h3><p className="mt-1 text-[10px] text-[#667178]">{organization.kind === "center" ? "Управление группой компаний" : "Изолированный рабочий контур"}</p></article>)}</section>
    {!canCreate && current?.kind === "company" ? <p className="text-[10px] text-[#69747a]">Вернитесь в «Центр компаний» через переключатель слева, чтобы добавить ещё одну компанию.</p> : null}
    <Dialog open={requestKey !== null} onClose={close} title="Новая компания" description="Создание отдельного рабочего пространства без смешивания данных.">{requestKey ? <CreateOrganizationForm requestKey={requestKey} onComplete={close} /> : null}</Dialog>
  </div>;
}
