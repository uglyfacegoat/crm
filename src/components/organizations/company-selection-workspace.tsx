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
    <section aria-label="Структура компаний" className="mt-6 space-y-5">
      <nav
        aria-label="Компании"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
      >
        {organizations.map((organization, index) => {
          const cityCount = organization.units.filter(
            (unit) => unit.kind === "city",
          ).length;
          const selected = organization.id === selectedOrganization.id;
          return (
            <button
              key={organization.id}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                setSelectedOrganizationId(organization.id);
                setSelectedCityId(null);
                setSelectedAreaId(null);
              }}
              className={`surface-panel focus-ring flex min-h-24 items-center gap-4 p-4 text-left transition-colors ${selected ? "!border-[var(--accent)] !bg-[var(--accent-soft)]" : "hover:bg-[var(--surface-soft)]"}`}
            >
              <span className="text-xs tabular-nums text-[var(--muted)]">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-[var(--text)]">
                  {organization.name}
                </span>
                <span className="mt-2 block text-xs text-[var(--muted)]">
                  {organization.kind === "center"
                    ? "Центр управления"
                    : `${cityCount} городов`}
                </span>
              </span>
              <span className="flex items-center gap-2 text-[10px] text-[var(--text-secondary)]">
                {organization.current
                  ? "Активная база"
                  : selected
                    ? "Выбрана"
                    : ""}
                {selected ? (
                  <Check className="size-4" />
                ) : (
                  <ChevronRight className="size-4" />
                )}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="surface-panel overflow-hidden">
        <div className="grid min-h-[30rem] lg:grid-cols-[16rem_minmax(0,1fr)]">
          <section className="flex min-w-0 flex-col border-b border-[var(--line)] p-5 lg:border-b-0 lg:border-r">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-[var(--text)]">
                Города
              </h2>
              <span className="truncate text-xs text-[var(--muted)]">
                {selectedOrganization.name}
              </span>
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]">
              Выберите город в структуре компании
            </p>
            {cities.length ? (
              <>
                <label className="mt-5 grid gap-2 text-xs text-[var(--muted)] lg:hidden">
                  Город
                  <select
                    value={selectedCityId ?? ""}
                    onChange={(event) => {
                      setSelectedCityId(event.target.value || null);
                      setSelectedAreaId(null);
                    }}
                    className="focus-ring h-12 rounded-[12px] border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]"
                  >
                    <option value="">Вся компания</option>
                    {cities.map((city) => (
                      <option key={city.id} value={city.id}>
                        {city.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="mt-5 hidden space-y-2 lg:block">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCityId(null);
                      setSelectedAreaId(null);
                    }}
                    aria-pressed={!selectedCity}
                    className={`focus-ring flex min-h-12 w-full items-center gap-3 rounded-[12px] px-3 text-left text-xs ${!selectedCity ? "bg-[var(--accent-soft)] text-[var(--text)]" : "text-[var(--muted)] hover:bg-[var(--surface-soft)]"}`}
                  >
                    <Building2 className="size-4" />
                    Вся компания
                  </button>
                  {cities.map((city) => (
                    <button
                      key={city.id}
                      type="button"
                      aria-pressed={city.id === selectedCity?.id}
                      onClick={() => {
                        setSelectedCityId(city.id);
                        setSelectedAreaId(null);
                      }}
                      className={`focus-ring flex min-h-16 w-full items-center gap-3 rounded-[12px] px-3 text-left ${city.id === selectedCity?.id ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--surface-soft)]"}`}
                    >
                      <MapPin className="size-4 shrink-0 text-[var(--muted)]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-[var(--text)]">
                          {city.name}
                        </span>
                        <span className="mt-1 block text-[10px] text-[var(--muted)]">
                          {
                            selectedOrganization.units.filter(
                              (unit) =>
                                unit.kind === "area" &&
                                unit.parentId === city.id,
                            ).length
                          }{" "}
                          районов
                        </span>
                      </span>
                      <ChevronRight className="size-3.5 text-[var(--muted)]" />
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="mt-5">
                <EmptyLevel>
                  {selectedOrganization.kind === "center"
                    ? "Центр объединяет рабочие компании и не делится на города."
                    : "Города ещё не настроены."}
                </EmptyLevel>
              </div>
            )}
            {canEditSelected ? (
              <button
                type="button"
                onClick={() => setDialogKind("city")}
                className="focus-ring mt-5 flex min-h-11 items-center justify-between gap-2 rounded-[12px] border border-[var(--line)] px-3 text-xs text-[var(--text)] lg:mt-auto"
              >
                Добавить город
                <CirclePlus className="size-4" />
              </button>
            ) : null}
          </section>

          <section className="flex min-w-0 flex-col p-5 sm:p-6">
            <nav
              aria-label="Выбранное подразделение"
              className="hidden flex-wrap items-center gap-2 text-xs text-[var(--muted)] lg:flex"
            >
              <Network className="size-4" />
              <span>{selectedOrganization.name}</span>
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
            </nav>
            <header className="hidden flex-wrap items-start justify-between gap-3 lg:mt-6 lg:flex">
              <div>
                <h2 className="font-display text-2xl font-semibold text-[var(--text)]">
                  {selectedCity?.name ?? selectedOrganization.name}
                </h2>
                <p className="mt-2 text-xs text-[var(--muted)]">
                  {selectedCity
                    ? `${areas.length} районов в структуре города`
                    : "Выберите город, чтобы посмотреть его районы"}
                </p>
              </div>
              {canEditSelected && selectedCity ? (
                <button
                  type="button"
                  onClick={() => setDialogKind("area")}
                  className="focus-ring inline-flex h-10 items-center gap-2 rounded-[11px] border border-[var(--line)] px-3 text-xs text-[var(--text)]"
                >
                  <CirclePlus className="size-4" />
                  Добавить район
                </button>
              ) : null}
            </header>
            {areas.length ? (
              <>
                <label className="grid gap-2 text-xs text-[var(--muted)] lg:hidden">
                  Район · необязательно
                  <select
                    value={selectedAreaId ?? ""}
                    onChange={(event) =>
                      setSelectedAreaId(event.target.value || null)
                    }
                    className="focus-ring h-12 rounded-[12px] border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]"
                  >
                    <option value="">Весь город</option>
                    {areas.map((area) => (
                      <option key={area.id} value={area.id}>
                        {area.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="mt-6 hidden gap-3 lg:grid lg:grid-cols-2">
                  {areas.map((area, index) => {
                    const selected = area.id === selectedArea?.id;
                    return (
                      <button
                        key={area.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() =>
                          setSelectedAreaId(selected ? null : area.id)
                        }
                        className={`focus-ring min-h-28 rounded-[14px] border p-4 text-left ${selected ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line)] bg-[var(--surface-inset)] hover:bg-[var(--surface-soft)]"}`}
                      >
                        <span className="flex items-center justify-between text-[10px] text-[var(--muted)]">
                          <span>{String(index + 1).padStart(2, "0")}</span>
                          {selected ? (
                            <Check className="size-4" />
                          ) : (
                            <Map className="size-4" />
                          )}
                        </span>
                        <span className="mt-3 block text-sm font-semibold text-[var(--text)]">
                          {area.name}
                        </span>
                        {area.address ? (
                          <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">
                            {area.address}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="mt-6">
                <EmptyLevel>
                  {selectedCity
                    ? "Районы ещё не добавлены. Можно работать со всей базой компании."
                    : "Город и район — уровни организационной структуры."}
                </EmptyLevel>
              </div>
            )}
            {canEditSelected && selectedCity ? (
              <button
                type="button"
                onClick={() => setDialogKind("area")}
                className="back-link mt-3 lg:hidden"
              >
                <CirclePlus className="size-4" />
                Добавить район
              </button>
            ) : null}
            <p className="mt-6 rounded-[12px] bg-[var(--surface-inset)] p-4 text-xs leading-5 text-[var(--muted)]">
              Город и район не ограничивают данные в реестрах. Открытие базы
              переключает всю рабочую компанию «{selectedOrganization.name}».
            </p>
            <footer className="mt-auto flex flex-wrap items-center justify-between gap-4 border-t border-[var(--line)] pt-5">
              <div className="pt-4">
                <p className="text-[10px] text-[var(--muted)]">Рабочая база</p>
                <p className="mt-1 text-sm font-medium text-[var(--text)]">
                  {selectedOrganization.name}
                </p>
              </div>
              {selectedOrganization.current ? (
                <span className="inline-flex items-center gap-2 text-xs text-[var(--success)]">
                  <Check className="size-4" />
                  База уже открыта
                </span>
              ) : (
                <form action={switchAction}>
                  <input
                    type="hidden"
                    name="organizationId"
                    value={selectedOrganization.id}
                  />
                  <button
                    type="submit"
                    disabled={switching}
                    className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-[12px] bg-[var(--accent)] px-4 text-xs font-semibold text-[var(--on-accent)] disabled:opacity-60"
                  >
                    {switching ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <Network className="size-4" />
                    )}
                    Открыть рабочую базу
                    <ChevronRight className="size-4" />
                  </button>
                </form>
              )}
            </footer>
          </section>
        </div>
      </div>
      {switchState.status === "error" && switchState.message ? (
        <p
          role="alert"
          className="rounded-[12px] border border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-3 text-xs text-[var(--danger-ink)]"
        >
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
