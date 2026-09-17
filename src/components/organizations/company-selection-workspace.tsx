"use client";

import {
  Building2,
  Check,
  ChevronRight,
  CirclePlus,
  LoaderCircle,
  Map,
  MapPin,
  Network,
} from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import {
  createOrganizationUnitAction,
  type OrganizationUnitActionState,
} from "@/app/(workspace)/companies/actions";
import {
  switchOrganizationAction,
  type OrganizationSwitchState,
} from "@/app/(workspace)/actions";
import { Dialog } from "@/components/ui/dialog";
import type {
  OrganizationOption,
  OrganizationUnit,
} from "@/server/organizations/types";

const initialSwitchState: OrganizationSwitchState = {
  status: "idle",
  message: null,
};
const initialUnitState: OrganizationUnitActionState = {
  status: "idle",
  message: null,
};

function EmptyLevel({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-32 place-items-center rounded-[14px] border border-dashed border-[var(--line)] bg-[var(--surface-inset)] p-5 text-center text-xs leading-5 text-[var(--muted)]">
      {children}
    </div>
  );
}

function UnitDialog({
  kind,
  organization,
  city,
  onClose,
}: {
  kind: "city" | "area";
  organization: OrganizationOption;
  city: OrganizationUnit | null;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(
    createOrganizationUnitAction,
    initialUnitState,
  );

  useEffect(() => {
    if (state.status === "success") onClose();
  }, [onClose, state.status]);

  return (
    <Dialog
      open
      onClose={onClose}
      title={kind === "area" ? "Новый район" : "Новый город"}
      description={
        kind === "area" && city
          ? `${organization.name} · ${city.name}`
          : `Добавьте следующий уровень структуры для ${organization.name}.`
      }
    >
      <form action={action} className="flex min-h-full flex-col">
        <input type="hidden" name="organizationId" value={organization.id} />
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="parentUnitId" value={city?.id ?? ""} />
        <div className="grid gap-5 p-5 sm:p-7">
          <label className="grid gap-2 text-xs font-medium text-[var(--text-secondary)]">
            Название {kind === "area" ? "района" : "города"}
            <input
              required
              name="name"
              maxLength={120}
              placeholder={
                kind === "area" ? "Например, Юг" : "Например, Москва"
              }
              className="focus-ring h-12 rounded-[12px] border border-[var(--line)] bg-[var(--surface-inset)] px-4 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)]"
            />
          </label>
          <label className="grid gap-2 text-xs font-medium text-[var(--text-secondary)]">
            Адрес или пояснение
            <input
              name="address"
              maxLength={300}
              placeholder="Необязательно"
              className="focus-ring h-12 rounded-[12px] border border-[var(--line)] bg-[var(--surface-inset)] px-4 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)]"
            />
          </label>
          {state.status === "error" && state.message ? (
            <p className="rounded-[12px] border border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-3 text-xs text-[var(--danger-ink)]">
              {state.message}
            </p>
          ) : null}
        </div>
        <footer className="mt-auto flex gap-3 border-t border-[var(--line)] p-5 sm:p-7">
          <button
            type="button"
            onClick={onClose}
            className="focus-ring h-12 flex-1 rounded-[12px] border border-[var(--line)] text-sm font-semibold text-[var(--text-secondary)]"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={pending || (kind === "area" && !city)}
            className="focus-ring inline-flex h-12 flex-[1.35] items-center justify-center gap-2 rounded-[12px] bg-[var(--text)] px-5 text-sm font-semibold text-[var(--canvas)] disabled:opacity-50"
          >
            {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
            Добавить
          </button>
        </footer>
      </form>
    </Dialog>
  );
}

export function CompanySelectionWorkspace({
  organizations,
  canManage,
}: {
  organizations: OrganizationOption[];
  canManage: boolean;
}) {
  const initialOrganization =
    organizations.find((organization) => organization.current) ??
    organizations[0] ??
    null;
  const [selectedOrganizationId, setSelectedOrganizationId] = useState(
    initialOrganization?.id ?? "",
  );
  const [selectedCityId, setSelectedCityId] = useState<string | null>(null);
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [dialogKind, setDialogKind] = useState<"city" | "area" | null>(null);
  const [switchState, switchAction, switching] = useActionState(
    switchOrganizationAction,
    initialSwitchState,
  );

  const selectedOrganization =
    organizations.find(
      (organization) => organization.id === selectedOrganizationId,
    ) ?? initialOrganization;
  const cities =
    selectedOrganization?.units.filter((unit) => unit.kind === "city") ?? [];
  const selectedCity =
    selectedCityId === null
      ? null
      : (cities.find((city) => city.id === selectedCityId) ?? null);
  const areas =
    selectedOrganization?.units.filter(
      (unit) => unit.kind === "area" && unit.parentId === selectedCity?.id,
    ) ?? [];
  const selectedArea =
    selectedAreaId === null
      ? null
      : (areas.find((area) => area.id === selectedAreaId) ?? null);
  const canEditSelected = Boolean(
    canManage &&
    selectedOrganization?.current &&
    selectedOrganization.kind === "company",
  );

  if (!selectedOrganization) {
    return (
      <div className="mt-8 rounded-[var(--radius-panel)] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-5 text-sm text-[var(--danger-ink)]">
        Доступных компаний не найдено. Обновите сессию или обратитесь к
        администратору.
      </div>
    );
  }

  return (
    <section aria-label="Структура компаний" className="mt-6 space-y-4">
      <header className="surface-panel flex flex-col gap-4 p-5 sm:p-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="eyebrow">Организационная структура</p>
          <h2 className="mt-2 font-display text-xl font-semibold tracking-[-0.04em] text-[var(--text)]">
            Рабочие контуры и зоны присутствия
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            Сначала выберите компанию. Город и зона необязательны: можно
            остановиться на любом уровне и не сужать рабочий контур дальше.
          </p>
        </div>
        <dl className="flex items-center gap-5 rounded-[14px] bg-[var(--surface-inset)] px-4 py-3 text-right">
          <div>
            <dt className="text-[9px] uppercase tracking-[0.12em] text-[var(--muted)]">
              Компаний
            </dt>
            <dd className="mt-1 font-display text-lg font-semibold text-[var(--text)]">
              {organizations.length}
            </dd>
          </div>
          <div>
            <dt className="text-[9px] uppercase tracking-[0.12em] text-[var(--muted)]">
              Уровней
            </dt>
            <dd className="mt-1 font-display text-lg font-semibold text-[var(--text)]">
              3
            </dd>
          </div>
        </dl>
      </header>

      <div className="space-y-4">
        <aside className="surface-panel overflow-hidden">
          <header className="flex flex-wrap items-end justify-between gap-3 px-5 py-4 sm:px-6">
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
              Рабочие контуры
            </p>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              {organizations.length} доступно
            </p>
          </header>
          <nav aria-label="Компании" className="scrollbar-hidden flex gap-2 overflow-x-auto border-t border-[var(--line)] p-3">
            {organizations.map((organization, index) => {
              const cityCount = organization.units.filter(
                (unit) => unit.kind === "city",
              ).length;
              const selected = organization.id === selectedOrganization.id;
              return (
                <button
                  key={organization.id}
                  type="button"
                  onClick={() => {
                    setSelectedOrganizationId(organization.id);
                    setSelectedCityId(null);
                    setSelectedAreaId(null);
                  }}
                  className={`focus-ring group grid min-h-20 min-w-[15rem] flex-1 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] border px-4 py-3 text-left transition-[background-color,border-color,transform] active:translate-y-px ${selected ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text)]" : "border-[var(--line)] bg-[var(--surface-raised)] text-[var(--text)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-soft)]"}`}
                >
                  <span
                    className={`font-display text-[10px] tabular-nums ${selected ? "text-[var(--accent-ink)]" : "text-[var(--muted-subtle)]"}`}
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold">
                      {organization.name}
                    </span>
                    <span
                      className={`mt-1 block text-[9px] ${selected ? "text-[var(--accent-ink)]" : "text-[var(--muted)]"}`}
                    >
                      {organization.kind === "center"
                        ? "Центр управления"
                        : `${cityCount} городов`}
                      {organization.current ? " · активна" : ""}
                    </span>
                  </span>
                  <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="surface-panel min-w-0 overflow-hidden">
          <header className="flex flex-col gap-4 border-b border-[var(--line)] px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-[10px] text-[var(--muted)]">
                <Building2 className="size-3.5" />
                <span className="font-semibold text-[var(--text)]">
                  {selectedOrganization.name}
                </span>
                {selectedCity ? (
                  <>
                    <ChevronRight className="size-3" />
                    <span>{selectedCity.name}</span>
                  </>
                ) : null}
                {selectedArea ? (
                  <>
                    <ChevronRight className="size-3" />
                    <span>{selectedArea.name}</span>
                  </>
                ) : null}
              </div>
              <h2 className="mt-2 font-display text-xl font-semibold tracking-[-0.03em] text-[var(--text)]">
                Карта присутствия
              </h2>
              <p className="mt-2 text-[10px] text-[var(--muted)]">
                Уровень выбора: {selectedArea ? "зона" : selectedCity ? "город" : "вся компания"}
              </p>
            </div>
            {!selectedOrganization.current ? (
              <form action={switchAction}>
                <input
                  type="hidden"
                  name="organizationId"
                  value={selectedOrganization.id}
                />
                <button
                  type="submit"
                  disabled={switching}
                  className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-[11px] bg-[var(--text)] px-4 text-xs font-semibold text-[var(--canvas)] disabled:opacity-60"
                >
                  {switching ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <Network className="size-4" />
                  )}
                  Открыть базу
                </button>
              </form>
            ) : (
              <span className="inline-flex h-10 items-center gap-2 rounded-[11px] border border-[var(--line)] px-3 text-[10px] font-semibold text-[var(--text-secondary)]">
                <Check className="size-3.5" />
                Активный контур
              </span>
            )}
          </header>

          <div className="grid lg:grid-cols-[minmax(19rem,0.8fr)_minmax(0,1.2fr)]">
            <section className="border-b border-[var(--line)] p-5 lg:border-b-0 lg:border-r sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                    Города
                  </p>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    Выберите узел маршрута
                  </p>
                </div>
                {canEditSelected ? (
                  <button
                    type="button"
                    onClick={() => setDialogKind("city")}
                    aria-label="Добавить город"
                    className="focus-ring grid size-9 place-items-center rounded-full border border-[var(--line-strong)] text-[var(--text-secondary)] hover:bg-[var(--text)] hover:text-[var(--canvas)]"
                  >
                    <CirclePlus className="size-4" />
                  </button>
                ) : null}
              </div>
              {cities.length ? (
                <ol className="mt-5 grid gap-2">
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCityId(null);
                        setSelectedAreaId(null);
                      }}
                      aria-current={selectedCity === null ? "true" : undefined}
                      className={`focus-ring group grid min-h-16 w-full grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] border px-3 py-2.5 text-left transition-[background-color,border-color,transform] active:translate-y-px ${selectedCity === null ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text)]" : "border-[var(--line)] bg-[var(--surface)] text-[var(--text-secondary)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-soft)]"}`}
                    >
                      <span className={`grid size-9 place-items-center rounded-[11px] ${selectedCity === null ? "bg-[var(--accent)] text-[var(--on-accent)]" : "bg-[var(--surface-inset)] text-[var(--muted)]"}`}>
                        <Building2 className="size-4" />
                      </span>
                      <span>
                        <span className="block text-sm font-semibold">Вся компания</span>
                        <span className="mt-1 block text-[9px] text-[var(--muted)]">Без ограничения по городу</span>
                      </span>
                      <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                    </button>
                  </li>
                  {cities.map((city) => {
                    const areaCount = selectedOrganization.units.filter(
                      (unit) =>
                        unit.kind === "area" && unit.parentId === city.id,
                    ).length;
                    const selected = city.id === selectedCity?.id;
                    return (
                      <li key={city.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCityId(city.id);
                            setSelectedAreaId(null);
                          }}
                          className={`focus-ring group grid min-h-16 w-full grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] border px-3 py-2.5 text-left transition-[background-color,border-color,transform] active:translate-y-px ${selected ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text)]" : "border-[var(--line)] bg-[var(--surface)] text-[var(--text-secondary)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-soft)]"}`}
                        >
                          <span
                            className={`grid size-9 place-items-center rounded-[11px] ${selected ? "bg-[var(--accent)] text-[var(--on-accent)]" : "bg-[var(--surface-inset)] text-[var(--muted)]"}`}
                          >
                            <MapPin className="size-4" />
                          </span>
                          <span>
                            <span className="block text-sm font-semibold">
                              {city.name}
                            </span>
                            <span className="mt-1 block text-[9px] text-[var(--muted)]">
                              {areaCount} районов
                            </span>
                          </span>
                          <ChevronRight
                            className={`size-3.5 transition-transform ${selected ? "translate-x-0.5" : "group-hover:translate-x-0.5"}`}
                          />
                        </button>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <div className="mt-6">
                  <EmptyLevel>
                    {selectedOrganization.kind === "center"
                      ? "Выберите рабочую компанию — центр не делится на городские подразделения."
                      : canEditSelected
                        ? "Добавьте первый город кнопкой выше."
                        : "Города ещё не настроены."}
                  </EmptyLevel>
                </div>
              )}
            </section>

            <section className="relative min-w-0 p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                    Районы и зоны
                  </p>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    {selectedCity
                      ? selectedCity.name
                      : "Сначала выберите город"}
                  </p>
                </div>
                {canEditSelected && selectedCity ? (
                  <button
                    type="button"
                    onClick={() => setDialogKind("area")}
                    aria-label="Добавить район"
                    className="focus-ring inline-flex h-9 items-center gap-2 rounded-[10px] border border-[var(--line-strong)] px-3 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--surface-soft)]"
                  >
                    <CirclePlus className="size-3.5" />
                    Добавить
                  </button>
                ) : null}
              </div>
              {areas.length ? (
                <div className="mt-6 grid gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedAreaId(null)}
                    aria-current={selectedArea === null ? "true" : undefined}
                    className={`focus-ring flex min-h-14 items-center gap-3 rounded-[14px] border px-3 text-left transition-[background-color,border-color,transform] active:translate-y-px ${selectedArea === null ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line)] bg-[var(--surface)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-soft)]"}`}
                  >
                    <span className={`grid size-8 shrink-0 place-items-center rounded-[10px] ${selectedArea === null ? "bg-[var(--accent)] text-[var(--on-accent)]" : "bg-[var(--surface-inset)] text-[var(--muted)]"}`}>
                      <Map className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-[var(--text)]">Весь город</span>
                      <span className="mt-0.5 block text-[9px] text-[var(--muted)]">Без ограничения по зоне</span>
                    </span>
                    <ChevronRight className="size-3.5 text-[var(--muted)]" />
                  </button>
                  <div className="overflow-hidden rounded-[16px] border border-[var(--line)]">
                    <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] bg-[var(--surface-inset)] px-4 py-3 text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
                      <span>№</span>
                      <span>Зона</span>
                      <span>Адрес</span>
                    </div>
                    {areas.map((area, index) => {
                      const selected = area.id === selectedArea?.id;
                      return (
                        <button
                          key={area.id}
                          type="button"
                          onClick={() => setSelectedAreaId(area.id)}
                          className={`focus-ring grid w-full grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center border-t border-[var(--line)] px-4 py-4 text-left transition-colors ${selected ? "bg-[var(--surface-soft)]" : "bg-[var(--surface)] hover:bg-[var(--surface-raised)]"}`}
                        >
                          <span className="font-display text-[10px] tabular-nums text-[var(--muted-subtle)]">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <span className="flex min-w-0 items-center gap-2">
                            <Map className="size-3.5 shrink-0 text-[var(--muted)]" />
                            <span className="truncate text-sm font-semibold text-[var(--text)]">
                              {area.name}
                            </span>
                          </span>
                          <span className="max-w-48 truncate pl-3 text-[10px] text-[var(--muted)]">
                            {area.address ?? "Рабочая зона"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="mt-6">
                  <EmptyLevel>
                    {selectedCity
                      ? canEditSelected
                        ? "Добавьте первый район или рабочую зону."
                        : "Районы для города ещё не настроены."
                      : "Выберите город слева, чтобы открыть его зоны."}
                  </EmptyLevel>
                </div>
              )}
              {selectedArea ? (
                <div className="mt-5 flex items-start gap-3 border-t border-[var(--line)] pt-5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--text)] text-[var(--canvas)]">
                    <MapPin className="size-4" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-[var(--text)]">
                      {selectedArea.name}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                      {selectedArea.address ??
                        "Адрес или пояснение для этой рабочей зоны пока не указаны."}
                    </p>
                  </div>
                </div>
              ) : null}
            </section>
          </div>
        </div>
      </div>

      {switchState.status === "error" && switchState.message ? (
        <p className="rounded-[12px] border border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-3 text-xs text-[var(--danger-ink)]">
          {switchState.message}
        </p>
      ) : null}

      {dialogKind ? (
        <UnitDialog
          key={`${dialogKind}:${selectedOrganization.id}:${selectedCity?.id ?? "root"}`}
          kind={dialogKind}
          organization={selectedOrganization}
          city={dialogKind === "area" ? selectedCity : null}
          onClose={() => setDialogKind(null)}
        />
      ) : null}
    </section>
  );
}
