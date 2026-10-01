"use client";

import {
  Check,
  KeyRound,
  Plus,
  Search,
  UserRoundCog,
  UsersRound,
} from "lucide-react";
import { clientCrypto as crypto } from "@/lib/client-id";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  createMemberAction,
  resetMemberPasswordAction,
  type MemberMutationState,
  updateMemberAccessAction,
} from "@/app/(workspace)/settings/actions";
import {
  OrderField,
  OrderPicker,
  OrderFormFooter,
  orderInputClass,
} from "@/components/orders/order-form-parts";
import { Avatar } from "@/components/ui/avatar";
import { Dialog } from "@/components/ui/dialog";
import { CustomSelect } from "@/components/ui/custom-select";
import { matchesSearchText } from "@/lib/search-normalization";
import { memberRoleLabels as roleLabels, type MemberDirectoryQuery } from "@/lib/member-directory";
import {
  hasPermission,
  canRoleHavePermission,
  configurablePermissions,
  permissionSections,
  type Permission,
} from "@/server/auth/permissions";
import {
  assignableOrganizationRoles,
  roleGrades,
  type AssignableOrganizationRole,
  type OrganizationRole,
} from "@/server/auth/types";
import type {
  MemberDirectoryPage,
  MemberMasterOption,
  OrganizationMemberListItem,
} from "@/server/members/types";

const initialState: MemberMutationState = {
  status: "idle",
  message: null,
  fieldErrors: {},
};
const assignableRoleOptions = assignableOrganizationRoles.map((value) => ({
  value,
  label: `Уровень ${roleGrades[value]} · ${roleLabels[value]}`,
}));

function MutationStatus({ state }: { state: MemberMutationState }) {
  if (!state.message) return null;
  return (
    <p
      role="status"
      className={`rounded-[12px] border p-3 text-xs leading-5 ${state.status === "success" ? "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]" : "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-ink)]"}`}
    >
      {state.status === "success" ? (
        <Check className="mr-2 inline size-4" />
      ) : null}
      {state.message}
    </p>
  );
}

const permissionChoiceOptions = [
  { value: "inherit", label: "По роли" },
  { value: "allow", label: "Разрешить" },
  { value: "deny", label: "Запретить" },
] as const;

function PermissionChoice({
  label,
  value,
  inheritedAllowed,
  onChange,
}: {
  label: string;
  value: (typeof permissionChoiceOptions)[number]["value"];
  inheritedAllowed: boolean;
  onChange: (value: (typeof permissionChoiceOptions)[number]["value"]) => void;
}) {
  const options = permissionChoiceOptions.map((option) => option.value === "inherit"
    ? { ...option, label: `По роли — ${inheritedAllowed ? "разрешено" : "запрещено"}` }
    : option);
  return <div className="w-44 min-w-0 shrink-0"><OrderPicker searchable={false} label={label} hideLabel value={value}
    onChange={(next) => onChange(next as typeof value)} options={options} placeholder="По роли" /></div>;
}

function PermissionMatrix({
  role,
  overrides,
  onChange,
}: {
  role: OrganizationRole;
  overrides: Partial<Record<Permission, boolean>>;
  onChange: (
    permission: Permission,
    value: "inherit" | "allow" | "deny",
  ) => void;
}) {
  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-[var(--text)]">
            Детальные разрешения
          </h3>
          <p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">
            Матрица охватывает рабочие окна, данные и действия. Статус «По роли»
            показывает базовое разрешение, а исключения проверяются сервером.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[9px]">
          <span className="rounded-full border border-[var(--line)] bg-[var(--surface-inset)] px-2.5 py-1 text-[var(--muted)]">
            {permissionSections.length} разделов · {configurablePermissions.length} функций
          </span>
          <span className="rounded-full border border-[var(--info-border)] bg-[var(--info-bg)] px-2.5 py-1 text-[var(--info)]">
            {Object.keys(overrides).length} исключений
          </span>
        </div>
      </div>
      <input
        type="hidden"
        name="permissionOverrides"
        value={JSON.stringify(overrides)}
      />
      <div className="mt-4 grid items-start gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        {permissionSections.map((section) => (
          <div
            key={section.label}
            className="rounded-[13px] border border-[var(--line)] bg-[var(--surface-inset)]"
          >
            <div className="border-b border-[var(--line)] px-3 py-2.5">
              <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-[var(--text-secondary)]">
                {section.label}
              </p>
              <p className="mt-1 text-[8px] leading-3 text-[var(--muted)]">
                {section.description}
              </p>
            </div>
            <div className="divide-y divide-[var(--line)]">
              {section.permissions.map(([permission, label]) => {
                const available = canRoleHavePermission(role, permission);
                const explicit = overrides[permission];
                const value =
                  explicit === undefined
                    ? "inherit"
                    : explicit
                      ? "allow"
                      : "deny";
                return (
                  <div
                    key={permission}
                    className="flex min-h-12 items-center gap-3 px-3 py-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] text-[var(--text-secondary)]">
                        {label}
                      </span>
                      <span className="mt-0.5 block text-[9px] text-[var(--muted)]">
                        Итог: {!available ? "недоступно на этом уровне" : explicit === undefined
                          ? hasPermission(role, permission) ? "разрешено по роли" : "запрещено по роли"
                          : explicit ? "разрешено вручную" : "запрещено вручную"}
                      </span>
                    </span>
                    {available ? <PermissionChoice
                      label={`${section.label}: ${label}`}
                      value={value}
                      inheritedAllowed={hasPermission(role, permission)}
                      onChange={(nextValue) => onChange(permission, nextValue)}
                    /> : null}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function RoleAndMasterFields({
  role,
  onRoleChange,
  masterOptions,
  currentMemberId,
  defaultMasterId,
  errors,
}: {
  role: OrganizationRole;
  onRoleChange: (role: OrganizationRole) => void;
  masterOptions: MemberMasterOption[];
  currentMemberId?: string;
  defaultMasterId?: string | null;
  errors: Record<string, string[]>;
}) {
  const availableMasters = masterOptions.filter(
    (master) =>
      (master.active || master.id === defaultMasterId) &&
      (!master.linkedMemberId || master.linkedMemberId === currentMemberId),
  );
  const [masterId, setMasterId] = useState(defaultMasterId ?? "");
  return (
    <>
      <OrderField label="Роль" required errors={errors.role}>
        <CustomSelect searchable={false}
          name="role"
          value={role}
          onChange={(value) => onRoleChange(value as AssignableOrganizationRole)}
          ariaLabel="Роль сотрудника"
          options={assignableRoleOptions.some((option) => option.value === role)
            ? assignableRoleOptions
            : [{ value: role, label: `Текущая роль · ${roleLabels[role]}` }, ...assignableRoleOptions]}
          className={orderInputClass}
        />
      </OrderField>
      {role === "master" || role === "foreman" ? (
        <div>
          <input type="hidden" name="masterId" value={masterId} />
          <OrderPicker label="Карточка мастера" required errors={errors.masterId}
            value={masterId} onChange={setMasterId} placeholder="Выберите мастера"
            searchPlaceholder="ФИО или телефон"
            remoteUrl={`/api/v1/settings/masters${currentMemberId ? `?memberId=${currentMemberId}` : ""}`}
            options={[{ value: "", label: "Выберите мастера" }, ...availableMasters.map(master => ({
              value: master.id, label: master.fullName, detail: master.phone,
            }))]} />
        </div>
      ) : (
        <input type="hidden" name="masterId" value="" />
      )}
    </>
  );
}

function CreateMemberForm({
  requestKey,
  masterOptions,
  onComplete,
}: {
  requestKey: string;
  masterOptions: MemberMasterOption[];
  onComplete: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    createMemberAction,
    initialState,
  );
  const [role, setRole] = useState<AssignableOrganizationRole>("sales_specialist");
  const router = useRouter();
  useEffect(() => {
    if (state.status !== "success") return;
    const timeout = window.setTimeout(() => {
      onComplete();
      router.refresh();
    }, 650);
    return () => window.clearTimeout(timeout);
  }, [onComplete, router, state.status]);

  return (
    <form action={formAction} className="flex min-h-full flex-1 flex-col">
      <input type="hidden" name="idempotencyKey" value={requestKey} />
      <div className="flex-1 space-y-6 p-5 sm:p-7">
        <div className="grid gap-4 sm:grid-cols-2">
          <OrderField
            label="Имя сотрудника"
            required
            errors={state.fieldErrors.displayName}
          >
            <input
              name="displayName"
              required
              minLength={2}
              maxLength={200}
              autoComplete="name"
              placeholder="Иван Петров"
              className={orderInputClass}
            />
          </OrderField>
          <OrderField
            label="Рабочий e-mail"
            required
            errors={state.fieldErrors.email}
          >
            <input
              name="email"
              required
              type="email"
              autoComplete="email"
              placeholder="ivan@company.ru"
              className={orderInputClass}
            />
          </OrderField>
          <OrderField label="Телефон" errors={state.fieldErrors.phone}>
            <input
              name="phone"
              inputMode="tel"
              maxLength={40}
              autoComplete="tel"
              placeholder="+7 999 000-00-00"
              className={orderInputClass}
            />
          </OrderField>
          <OrderField
            label="Временный пароль"
            required
            errors={state.fieldErrors.password}
          >
            <input
              name="password"
              required
              type="password"
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              placeholder="Минимум 12 символов"
              className={orderInputClass}
            />
          </OrderField>
          <RoleAndMasterFields
            role={role}
            onRoleChange={(value) => setRole(value as AssignableOrganizationRole)}
            masterOptions={masterOptions}
            errors={state.fieldErrors}
          />
        </div>
        <div className="flex gap-3 rounded-[13px] border border-[var(--line)] bg-[var(--surface-inset)] p-4">
          <KeyRound className="mt-0.5 size-4 shrink-0 text-[var(--accent)]" />
          <p className="text-[10px] leading-5 text-[var(--muted)]">
            Пароль передаётся только серверу и хранится как scrypt-хеш. После
            создания сообщите его сотруднику защищённым каналом.
          </p>
        </div>
        <MutationStatus state={state} />
      </div>
      <OrderFormFooter
        pending={pending}
        saved={state.status === "success"}
        onCancel={onComplete}
        submitLabel="Создать сотрудника"
      />
    </form>
  );
}

export function MemberAccessForm({
  member,
  masterOptions,
  onComplete,
  embedded = false,
}: {
  member: OrganizationMemberListItem;
  masterOptions: MemberMasterOption[];
  onComplete?: () => void;
  embedded?: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    updateMemberAccessAction,
    initialState,
  );
  const [role, setRole] = useState<OrganizationRole>(member.role);
  const [permissionOverrides, setPermissionOverrides] = useState(
    member.permissionOverrides,
  );
  const router = useRouter();
  useEffect(() => {
    if (state.status !== "success") return;
    const timeout = window.setTimeout(() => {
      onComplete?.();
      router.refresh();
    }, 650);
    return () => window.clearTimeout(timeout);
  }, [onComplete, router, state.status]);
  const updatePermission = useCallback(
    (permission: Permission, value: "inherit" | "allow" | "deny") => {
      setPermissionOverrides((current) => {
        const next = { ...current };
        if (value === "inherit") delete next[permission];
        else next[permission] = value === "allow";
        return next;
      });
    },
    [],
  );

  return (
    <form action={formAction} className="flex min-h-full flex-1 flex-col">
      <input type="hidden" name="memberId" value={member.id} />
      <input type="hidden" name="expectedVersion" value={member.version} />
      <div className="flex-1 space-y-6 p-5 sm:p-7">
        <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-raised)] p-4">
          <p className="text-sm font-medium text-[var(--text)]">
            {member.displayName}
          </p>
          <p className="mt-1 break-all text-xs text-[var(--muted)]">
            {member.email}
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <RoleAndMasterFields
            role={role}
            onRoleChange={setRole}
            masterOptions={masterOptions}
            currentMemberId={member.id}
            defaultMasterId={member.masterId}
            errors={state.fieldErrors}
          />
        </div>
        <label className="flex cursor-pointer items-start gap-3 rounded-[13px] border border-[var(--line)] bg-[var(--surface-raised)] p-4">
          <input
            name="active"
            type="checkbox"
            defaultChecked={member.active}
            className="mt-0.5 size-4 accent-[var(--accent)]"
          />
          <span>
            <strong className="block text-xs font-medium text-[var(--text)]">
              Учётная запись активна
            </strong>
            <span className="mt-1 block text-[10px] leading-4 text-[var(--muted)]">
              При отключении или смене роли все активные сессии сотрудника будут
              завершены.
            </span>
          </span>
        </label>
        <PermissionMatrix
          role={role}
          overrides={permissionOverrides}
          onChange={updatePermission}
        />
        <MutationStatus state={state} />
      </div>
      {embedded ? (
        <footer className="flex justify-end border-t border-[var(--line)] p-5">
          <button
            type="submit"
            disabled={pending}
            className="focus-ring h-11 rounded-[9px] bg-[var(--accent)] px-5 text-xs font-semibold text-[var(--on-accent)] disabled:opacity-50"
          >
            {pending ? "Сохраняем…" : "Сохранить доступ"}
          </button>
        </footer>
      ) : (
        <OrderFormFooter
          pending={pending}
          saved={state.status === "success"}
          onCancel={() => onComplete?.()}
          submitLabel="Сохранить доступ"
        />
      )}
    </form>
  );
}

export function ResetMemberPasswordForm({
  member,
  requestKey,
  onComplete,
  embedded = false,
}: {
  member: OrganizationMemberListItem;
  requestKey: string;
  onComplete?: () => void;
  embedded?: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    resetMemberPasswordAction,
    initialState,
  );
  const router = useRouter();
  useEffect(() => {
    if (state.status !== "success") return;
    const timeout = window.setTimeout(() => {
      onComplete?.();
      router.refresh();
    }, 850);
    return () => window.clearTimeout(timeout);
  }, [onComplete, router, state.status]);

  return (
    <form action={formAction} className="flex min-h-full flex-1 flex-col">
      <input type="hidden" name="idempotencyKey" value={requestKey} />
      <input type="hidden" name="memberId" value={member.id} />
      <input type="hidden" name="expectedVersion" value={member.version} />
      <div className="flex-1 space-y-6 p-5 sm:p-7">
        <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-inset)] p-4">
          <p className="text-sm font-medium text-[var(--text)]">
            {member.displayName}
          </p>
          <p className="mt-1 break-all text-xs text-[var(--muted)]">
            {member.email}
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <OrderField
            label="Новый временный пароль"
            required
            errors={state.fieldErrors.password}
          >
            <input
              name="password"
              required
              type="password"
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              placeholder="Минимум 12 символов"
              className={orderInputClass}
            />
          </OrderField>
          <OrderField
            label="Повторите пароль"
            required
            errors={state.fieldErrors.passwordConfirmation}
          >
            <input
              name="passwordConfirmation"
              required
              type="password"
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              placeholder="Тот же пароль"
              className={orderInputClass}
            />
          </OrderField>
        </div>
        <div className="flex gap-3 rounded-[13px] border border-[var(--warning-border)] bg-[var(--warning-bg)] p-4">
          <KeyRound className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" />
          <p className="text-[10px] leading-5 text-[var(--warning)]">
            После сохранения все активные сессии сотрудника завершатся. Новый
            пароль не отображается повторно и не попадает в журнал операций.
          </p>
        </div>
        <MutationStatus state={state} />
      </div>
      {embedded ? (
        <footer className="flex justify-end border-t border-[var(--line)] p-5">
          <button
            type="submit"
            disabled={pending}
            className="focus-ring h-11 rounded-[9px] border border-[var(--accent)]/40 px-5 text-xs font-semibold text-[var(--accent-ink)] disabled:opacity-50"
          >
            {pending ? "Сохраняем…" : "Заменить пароль"}
          </button>
        </footer>
      ) : (
        <OrderFormFooter
          pending={pending}
          saved={state.status === "success"}
          onCancel={() => onComplete?.()}
          submitLabel="Заменить пароль"
        />
      )}
    </form>
  );
}

function CreateMemberButton({
  masterOptions,
  preview,
}: {
  masterOptions: MemberMasterOption[];
  preview: boolean;
}) {
  const [requestKey, setRequestKey] = useState<string | null>(null);
  const close = useCallback(() => setRequestKey(null), []);
  return (
    <>
      <button
        type="button"
        disabled={preview}
        onClick={() => setRequestKey(crypto.randomUUID())}
        className="focus-ring flex min-h-11 items-center justify-center gap-2 rounded-[13px] bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--on-accent)] disabled:cursor-not-allowed disabled:opacity-45"
      >
        <Plus className="size-4" />
        Новый сотрудник
      </button>
      <Dialog
        open={requestKey !== null}
        onClose={close}
        title="Новый сотрудник"
        description="Создание учётной записи, назначение роли и доступов."
      >
        {requestKey ? (
          <CreateMemberForm
            requestKey={requestKey}
            masterOptions={masterOptions}
            onComplete={close}
          />
        ) : null}
      </Dialog>
    </>
  );
}

function formatLastLogin(value: string | null) {
  if (!value) return "Ещё не входил";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
}

export function MemberAdminPanel({
  initialPage,
  masterOptions,
  currentMemberId,
  preview,
}: {
  initialPage: MemberDirectoryPage;
  masterOptions: MemberMasterOption[];
  currentMemberId: string;
  preview: boolean;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<MemberDirectoryQuery["status"]>("active");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(initialPage);
  const [resultKey, setResultKey] = useState(JSON.stringify(["", "active", 1]));
  const requestKey = JSON.stringify([query, status, page]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (preview) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const params = new URLSearchParams({ q: query, status, page: String(page) });
        const response = await fetch(`/api/v1/settings/members?${params}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Member directory failed");
        const payload = await response.json() as { data: MemberDirectoryPage };
        if (!controller.signal.aborted) {
          setResult(payload.data); setResultKey(requestKey);
          const lastPage = Math.max(1, Math.ceil(payload.data.total / payload.data.pageSize));
          if (page > lastPage) setPage(lastPage);
        }
      } catch {
        if (!controller.signal.aborted) setLoadError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, query ? 250 : 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [initialPage, page, preview, query, retry, status, requestKey]);
  const previewItems = useMemo(() => initialPage.items.filter(member =>
    matchesSearchText(query, [member.displayName, member.email, member.phone, member.masterName, roleLabels[member.role]]) &&
    (status === "all" || member.active === (status === "active"))), [initialPage, query, status]);
  const pending = !preview && (loading || (resultKey !== requestKey && !loadError));
  const filteredMembers = preview ? previewItems : resultKey === requestKey ? result.items : [];
  const total = preview ? previewItems.length : result.total;
  const pageCount = Math.max(1, Math.ceil(total / result.pageSize));
  return (
    <div className="mt-5 space-y-4">
      {preview ? (
        <p className="rounded-[13px] border border-[var(--warning-border)] bg-[var(--warning-bg)] px-4 py-3 text-xs text-[var(--warning)]">
          Предпросмотр показывает структуру раздела. Создание и изменение
          учётных записей отключено.
        </p>
      ) : null}
      <div className="grid gap-2 text-xs sm:grid-cols-3">
        <p className="rounded-[12px] border border-[var(--line)] bg-[var(--surface-raised)] p-3"><strong className="block text-[var(--text)]">Уровень 1 · Владельцы</strong><span className="text-[var(--muted)]">Все экраны, права и системные настройки.</span></p>
        <p className="rounded-[12px] border border-[var(--line)] bg-[var(--surface-raised)] p-3"><strong className="block text-[var(--text)]">Уровень 2 · Руководители</strong><span className="text-[var(--muted)]">Рабочие разделы и финансы по специализации.</span></p>
        <p className="rounded-[12px] border border-[var(--line)] bg-[var(--surface-raised)] p-3"><strong className="block text-[var(--text)]">Уровень 3 · Сотрудники</strong><span className="text-[var(--muted)]">Операционная работа без финансов и администрирования.</span></p>
      </div>
      <section className="surface-panel panel-stack overflow-hidden">
        <div className="grid gap-3 border-b border-[var(--line)] p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-5 lg:flex lg:items-center">
          <label className="focus-within:border-[var(--line-strong)] flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-[13px] border border-[var(--line)] bg-[var(--surface-inset)] px-3 sm:col-span-2 lg:max-w-md">
            <Search className="size-4 shrink-0 text-[var(--muted)]" />
            <span className="sr-only">Поиск сотрудников</span>
            <input
              value={query}
              onChange={(event) => { setQuery(event.target.value); setPage(1); }}
              maxLength={100}
              placeholder="Имя, e-mail, телефон или роль"
              className="min-w-0 flex-1 bg-transparent text-xs text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)]"
            />
          </label>
          <CustomSelect searchable={false}
            value={status}
            onChange={(value) => { setStatus(value as typeof status); setPage(1); }}
            ariaLabel="Статус учётной записи"
            options={[
              { value: "all", label: "Все статусы" },
              { value: "active", label: "Активные" },
              { value: "inactive", label: "Отключённые" },
            ]}
            className={`${orderInputClass} min-h-11 sm:w-44`}
          />
          <CreateMemberButton masterOptions={masterOptions} preview={preview} />
        </div>

        {pending || loadError ? <div role="status" className="flex items-center gap-3 border-b border-[var(--line)] px-5 py-3 text-xs text-[var(--muted)]">
          {loadError ? "Не удалось загрузить сотрудников. Повторите запрос." : "Загрузка…"}
          {loadError ? <button type="button" onClick={() => setRetry(value => value + 1)} className="focus-ring rounded-lg border border-[var(--line)] px-3 py-2">Повторить</button> : null}
        </div> : null}
        <div aria-busy={pending} className="divide-y divide-[var(--line)]">
          {filteredMembers.map((member) => (
            <article
              key={member.id}
              className="grid min-w-0 gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(14rem,1.4fr)_minmax(9rem,0.8fr)_minmax(10rem,0.8fr)_auto] lg:items-center"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Avatar
                  name={member.displayName}
                  size="sm"
                  tone={member.active ? "lime" : "violet"}
                  src={`/api/v1/members/${member.id}/avatar`}
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-sm font-medium text-[var(--text)]">
                      {member.displayName}
                    </h3>
                    {member.id === currentMemberId ? (
                      <span className="rounded-full bg-[var(--surface-inset)] px-2 py-0.5 text-[9px] text-[var(--muted)]">
                        Вы
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 truncate text-xs text-[var(--muted)]">
                    {member.email}
                  </p>
                  {member.phone ? (
                    <p className="mt-0.5 text-[10px] text-[var(--muted-subtle)]">
                      {member.phone}
                    </p>
                  ) : null}
                </div>
              </div>
              <div>
                <p className="text-[9px] uppercase tracking-[0.12em] text-[var(--muted)]">
                  Роль и статус
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-[8px] border border-[var(--line)] bg-[var(--surface-inset)] px-2 py-1 text-[10px] text-[var(--text-secondary)]">
                    Уровень {roleGrades[member.role]}
                  </span>
                  <span className="rounded-[8px] border border-[var(--support-strong)]/20 bg-[var(--support-soft)] px-2 py-1 text-[10px] text-[var(--support-strong)]">
                    {roleLabels[member.role]}
                  </span>
                  <span
                    className={`rounded-full px-2 py-1 text-[9px] ${member.active ? "bg-[var(--success-bg)] text-[var(--success)]" : "bg-[var(--danger-bg)] text-[var(--danger-ink)]"}`}
                  >
                    {member.active ? "Активен" : "Отключён"}
                  </span>
                </div>
              </div>
              <div className="min-w-0">
                <p className="text-[9px] uppercase tracking-[0.12em] text-[var(--muted)]">
                  Привязка / вход
                </p>
                <p className="mt-2 truncate text-xs text-[var(--text-secondary)]">
                  {member.masterName ?? "Без карточки мастера"}
                </p>
                <p className="mt-1 text-[10px] text-[var(--muted-subtle)]">
                  {formatLastLogin(member.lastLoginAt)}
                </p>
              </div>
              <div className="flex items-center gap-2 lg:justify-end">
                {member.role === "developer" || member.role === "owner" ? (
                  <span className="inline-flex h-10 items-center rounded-[9px] border border-[var(--line)] bg-[var(--surface-inset)] px-3 text-[10px] text-[var(--muted)]">
                    Системная учётка
                  </span>
                ) : (
                  <Link
                    href={`/settings/users/${member.id}`}
                    aria-label={`Открыть настройки: ${member.displayName}`}
                    className="focus-ring flex h-10 items-center gap-2 rounded-[9px] border border-[var(--line)] px-3 text-[10px] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)]/30 hover:text-[var(--text)]"
                  >
                    <UserRoundCog className="size-4" />
                    Открыть
                  </Link>
                )}
              </div>
            </article>
          ))}
          {!filteredMembers.length && !pending && !loadError ? (
            <div className="grid min-h-52 place-items-center p-8 text-center">
              <div>
                <UsersRound className="mx-auto size-7 text-[var(--muted)]" />
                <p className="mt-3 text-sm text-[var(--text-secondary)]">
                  Сотрудники не найдены
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Измените запрос или фильтр статуса.
                </p>
              </div>
            </div>
          ) : null}
        </div>
        <nav aria-label="Страницы сотрудников" className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] p-4 text-xs text-[var(--muted)]">
          <p aria-live="polite" className={pending || loadError ? "invisible" : undefined}>Найдено: {total} · Страница {result.page} из {pageCount}</p>
          <div className="flex gap-2">
            <button type="button" disabled={pending || loadError || page <= 1} onClick={() => setPage(value => value - 1)} className="focus-ring rounded-lg border border-[var(--line)] px-3 py-2 disabled:opacity-40">Назад</button>
            <button type="button" disabled={pending || loadError || page >= pageCount} onClick={() => setPage(value => value + 1)} className="focus-ring rounded-lg border border-[var(--line)] px-3 py-2 disabled:opacity-40">Далее</button>
          </div>
        </nav>
      </section>
    </div>
  );
}
