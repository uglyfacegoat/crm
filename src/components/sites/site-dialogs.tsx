"use client";

import { Check, KeyRound, LoaderCircle, Plus, ShieldCheck } from "lucide-react";
import { useActionState, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { configureWebsiteIntegrationAction, createWebsiteAction, type WebsiteMutationState } from "@/app/(workspace)/sites/actions";
import { providerLabels } from "@/components/sites/site-card";
import { Dialog } from "@/components/ui/dialog";
import { clientCrypto as crypto } from "@/lib/client-id";
import { websiteProviders, type WebsiteListItem, type WebsiteProvider } from "@/server/sites/types";

const initialState: WebsiteMutationState = { status: "idle", message: null, fieldErrors: {} };
const fieldInputClass = "focus-ring h-12 rounded-[12px] border border-[var(--line)] bg-[var(--surface-inset)] px-3.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)]";

function FieldError({ errors }: { errors?: string[] }) {
  return errors?.[0] ? <span className="text-[10px] text-[var(--danger-ink)]">{errors[0]}</span> : null;
}

function FormFooter({ pending, submitDisabled, complete, submitLabel }: { pending: boolean; submitDisabled: boolean; complete: () => void; submitLabel: string }) {
  return <footer className="sticky bottom-0 flex gap-2 border-t border-[var(--line)] bg-[var(--surface)] p-4 sm:px-7"><button type="button" onClick={complete} disabled={pending} className="focus-ring h-12 flex-1 rounded-[12px] border border-[var(--line)] bg-[var(--surface-raised)] text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-soft)]">Отмена</button><button type="submit" disabled={submitDisabled} className="focus-ring flex h-12 flex-[1.4] items-center justify-center gap-2 rounded-[12px] bg-[var(--accent)] text-xs font-semibold text-[var(--on-accent)] disabled:opacity-65">{pending ? <><LoaderCircle className="size-4 animate-spin" />Сохраняем…</> : submitLabel}</button></footer>;
}

function CreateWebsiteForm({ requestKey, onComplete }: { requestKey: string; onComplete: () => void }) {
  const [state, action, pending] = useActionState(createWebsiteAction, initialState);
  const router = useRouter();
  useEffect(() => {
    if (state.status !== "success") return;
    router.refresh();
    const timeout = window.setTimeout(onComplete, 700);
    return () => window.clearTimeout(timeout);
  }, [onComplete, router, state.status]);

  return <form action={action} className="flex flex-1 flex-col"><input type="hidden" name="idempotencyKey" value={requestKey} /><div className="flex-1 space-y-5 p-5 sm:p-7">
    <div className="rounded-[14px] border border-[var(--accent)] bg-[var(--accent-soft)] p-4"><p className="flex items-center gap-2 text-xs font-medium text-[var(--accent-ink)]"><ShieldCheck className="size-4 text-[var(--accent)]" />Сначала реестр, потом доступы</p><p className="mt-2 text-[10px] leading-5 text-[var(--text-secondary)]">Добавление сайта не подключает аналитику автоматически и не запрашивает токены. Источник данных настраивается отдельно.</p></div>
    <label className="grid gap-2 text-[10px] text-[var(--text-secondary)]"><span>Название сайта *</span><input name="name" required minLength={2} maxLength={200} placeholder="ДезСервис Москва" className={fieldInputClass} /><FieldError errors={state.fieldErrors.name} /></label>
    <label className="grid gap-2 text-[10px] text-[var(--text-secondary)]"><span>Домен *</span><input name="domain" required maxLength={253} autoCapitalize="none" spellCheck={false} placeholder="dez-service.ru" className={`${fieldInputClass} font-mono lowercase`} /><span className="text-[9px] text-[var(--muted)]">Без `https://`, пути и параметров.</span><FieldError errors={state.fieldErrors.domain} /></label>
    {state.message ? <p role="status" className={`rounded-[12px] border p-3 text-xs leading-5 ${state.status === "success" ? "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]" : "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-ink)]"}`}>{state.status === "success" ? <Check className="mr-2 inline size-4" /> : null}{state.message}</p> : null}
  </div><FormFooter pending={pending} submitDisabled={pending || state.status === "success"} complete={onComplete} submitLabel="Добавить сайт" /></form>;
}

export function CreateWebsiteButton({ canWrite }: { canWrite: boolean }) {
  const [requestKey, setRequestKey] = useState<string | null>(null);
  const close = useCallback(() => setRequestKey(null), []);
  return <>{canWrite ? <button type="button" onClick={() => setRequestKey(crypto.randomUUID())} className="focus-ring flex h-11 items-center justify-center gap-2 rounded-[13px] bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--on-accent)]"><Plus className="size-4" />Подключить сайт</button> : null}<Dialog open={requestKey !== null} onClose={close} title="Новый сайт" description="Добавьте домен в рабочий контур организации.">{requestKey ? <CreateWebsiteForm requestKey={requestKey} onComplete={close} /> : null}</Dialog></>;
}

function ConfigureIntegrationForm({ site, requestKey, onComplete }: { site: WebsiteListItem; requestKey: string; onComplete: () => void }) {
  const configured = useMemo(() => new Set(site.integrations.map((integration) => integration.provider)), [site.integrations]);
  const available = websiteProviders.filter((provider) => !configured.has(provider));
  const [provider, setProvider] = useState<WebsiteProvider | null>(available[0] ?? null);
  const [state, action, pending] = useActionState(configureWebsiteIntegrationAction, initialState);
  const router = useRouter();
  useEffect(() => {
    if (state.status !== "success") return;
    router.refresh();
    const timeout = window.setTimeout(onComplete, 700);
    return () => window.clearTimeout(timeout);
  }, [onComplete, router, state.status]);

  if (!provider) return <div className="grid flex-1 place-items-center p-8 text-center"><div><Check className="mx-auto size-7 text-[var(--success)]" /><p className="mt-3 text-sm font-medium text-[var(--text)]">Все четыре источника уже настроены</p><button type="button" onClick={onComplete} className="focus-ring mt-5 h-10 rounded-[11px] border border-[var(--line)] bg-[var(--surface-raised)] px-5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-soft)]">Закрыть</button></div></div>;

  return <form action={action} className="flex flex-1 flex-col"><input type="hidden" name="idempotencyKey" value={requestKey} /><input type="hidden" name="websiteId" value={site.id} /><input type="hidden" name="provider" value={provider} /><div className="flex-1 space-y-6 p-5 sm:p-7">
    <fieldset><legend className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Источник данных</legend><div className="mt-3 grid grid-cols-2 gap-2">{available.map((value) => <button key={value} type="button" onClick={() => setProvider(value)} className={`focus-ring min-h-12 rounded-[12px] border px-3 text-[10px] ${provider === value ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "border-[var(--line)] bg-[var(--surface-raised)] text-[var(--text-secondary)] hover:bg-[var(--surface-soft)]"}`}>{providerLabels[value]}</button>)}</div><FieldError errors={state.fieldErrors.provider} /></fieldset>
    <label className="grid gap-2 text-[10px] text-[var(--text-secondary)]"><span>ID счётчика или ресурса *</span><input name="propertyId" required maxLength={200} placeholder={provider === "yandex_metrica" ? "12345678" : provider === "ga4" ? "properties/123456789" : "sc-domain:example.ru"} className={`${fieldInputClass} font-mono`} /><FieldError errors={state.fieldErrors.propertyId} /></label>
    <label className="grid gap-2 text-[10px] text-[var(--text-secondary)]"><span>Ссылка на серверный секрет *</span><div className="relative"><KeyRound className="pointer-events-none absolute left-3.5 top-4 size-4 text-[var(--muted)]" /><input name="secretReference" required pattern="[A-Z][A-Z0-9_]{2,127}" maxLength={128} autoCapitalize="characters" spellCheck={false} placeholder="YANDEX_METRICA_MAIN_TOKEN" className={`${fieldInputClass} w-full pl-10 pr-3.5 font-mono text-xs uppercase`} /></div><span className="text-[9px] leading-4 text-[var(--muted)]">Введите имя Docker Secret/Vault/env-переменной, а не сам OAuth-токен.</span><FieldError errors={state.fieldErrors.secretReference} /></label>
    <div className="rounded-[12px] border border-[var(--info-border)] bg-[var(--info-bg)] p-3 text-[10px] leading-5 text-[var(--info)]">После сохранения источник получит статус «Ожидает». Статус «Подключён» выставит только worker после успешного запроса к API.</div>
    {state.message ? <p role="status" className={`rounded-[12px] border p-3 text-xs leading-5 ${state.status === "success" ? "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]" : "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-ink)]"}`}>{state.message}</p> : null}
  </div><FormFooter pending={pending} submitDisabled={pending || state.status === "success"} complete={onComplete} submitLabel="Сохранить подключение" /></form>;
}

export type WebsiteIntegrationSelection = { site: WebsiteListItem; requestKey: string };

export function ConfigureIntegrationDialog({ selection, onClose }: { selection: WebsiteIntegrationSelection | null; onClose: () => void }) {
  const site = selection?.site ?? null;
  return <Dialog open={site !== null} onClose={onClose} title={site ? `Подключения · ${site.name}` : "Подключения"} description="CRM хранит ссылку на секрет, но никогда не возвращает учётные данные в браузере.">{selection ? <ConfigureIntegrationForm key={selection.requestKey} site={selection.site} requestKey={selection.requestKey} onComplete={onClose} /> : null}</Dialog>;
}
