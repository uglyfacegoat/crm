"use client";

import Link from "next/link";
import {
  CalendarDays,
  Check,
  Link2,
  LoaderCircle,
  MapPin,
  Plus,
  Unplug,
} from "lucide-react";
import {
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  linkOrderAction,
  type OrderMutationState,
} from "@/app/(workspace)/orders/actions";
import { Dialog } from "@/components/ui/dialog";
import type { OrderRelations } from "@/server/orders/types";
import { OrderFormStatus } from "./order-form-parts";

const initialState: OrderMutationState = {
  status: "idle",
  message: null,
  fieldErrors: {},
};

function formatVisitDate(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: timezone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function LinkOrderForm({
  orderId,
  relations,
  onClose,
}: {
  orderId: string;
  relations: OrderRelations;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(
    linkOrderAction,
    initialState,
  );
  const [relatedOrderId, setRelatedOrderId] = useState(
    relations.candidates[0]?.id ?? "",
  );
  useEffect(() => {
    if (state.status !== "success") return;
    const timeout = window.setTimeout(onClose, 650);
    return () => window.clearTimeout(timeout);
  }, [onClose, state.status]);

  return (
    <form action={action} className="flex flex-1 flex-col">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="relatedOrderId" value={relatedOrderId} />
      <div className="flex-1 space-y-5 p-5 sm:p-7">
        <div>
          <p className="text-xs font-medium text-[var(--text)]">
            Заказы этого же клиента
          </p>
          <p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">
            После связи каждая карточка будет показывать актуальные даты выездов
            всей группы.
          </p>
        </div>
        {relations.candidates.length ? (
          <div className="space-y-2">
            {relations.candidates.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                onClick={() => setRelatedOrderId(candidate.id)}
                className={`focus-ring flex w-full items-start gap-3 rounded-[13px] border p-4 text-left ${relatedOrderId === candidate.id ? "border-[var(--accent)]/30 bg-[var(--accent)]/[0.055]" : "border-[var(--line)] bg-[var(--surface-inset)] hover:bg-[var(--surface-soft)]"}`}
              >
                <span
                  className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border ${relatedOrderId === candidate.id ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--on-accent)]" : "border-[var(--line-strong)] text-transparent"}`}
                >
                  <Check className="size-3" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <strong className="font-display text-xs text-[var(--text)]">
                      {candidate.number}
                    </strong>
                    <span className="rounded-full bg-[var(--surface-soft)] px-2 py-1 text-[9px] text-[var(--text-secondary)]">
                      {candidate.status}
                    </span>
                  </span>
                  <span className="mt-2 block truncate text-xs text-[var(--text-secondary)]">
                    {candidate.object}
                  </span>
                  <span className="mt-1 block truncate text-[10px] text-[var(--muted)]">
                    {candidate.address} · {candidate.visitCount} выезд.
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-[13px] border border-[var(--line)] bg-[var(--surface-inset)] p-5 text-center">
            <Unplug className="mx-auto size-5 text-[var(--muted-subtle)]" />
            <p className="mt-3 text-xs text-[var(--text-secondary)]">
              Других заказов этого клиента пока нет
            </p>
            <p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">
              Связать заказ можно будет после создания ещё одной карточки на
              другой объект или чек.
            </p>
          </div>
        )}
        <OrderFormStatus state={state} />
      </div>
      <footer className="mt-auto flex shrink-0 gap-2 border-t border-[var(--line)] bg-[var(--surface-raised)] p-4 sm:px-7">
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="focus-ring h-12 flex-1 rounded-[12px] border border-[var(--line-strong)] text-xs text-[var(--text-secondary)]"
        >
          Отмена
        </button>
        <button
          type="submit"
          disabled={pending || state.status === "success" || !relatedOrderId}
          className="focus-ring flex h-12 flex-[1.4] items-center justify-center gap-2 rounded-[12px] bg-[var(--accent)] text-xs font-semibold text-[var(--on-accent)] disabled:cursor-not-allowed disabled:opacity-45"
        >
          {pending ? (
            <>
              <LoaderCircle className="size-4 animate-spin" />
              Связываем…
            </>
          ) : state.status === "success" ? (
            <>
              <Check className="size-4" />
              Связано
            </>
          ) : (
            "Связать заказы"
          )}
        </button>
      </footer>
    </form>
  );
}

export function OrderRelationsSection({
  orderId,
  relations,
  canWrite,
}: {
  orderId: string;
  relations: OrderRelations;
  canWrite: boolean;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const visits = useMemo(
    () =>
      relations.orders
        .flatMap((order) => order.visits.map((visit) => ({ ...visit, order })))
        .sort((left, right) =>
          left.scheduledStartAt.localeCompare(right.scheduledStartAt),
        ),
    [relations.orders],
  );
  const linked = relations.groupId !== null && relations.orders.length > 1;

  return (
    <section
      className="surface-panel animate-rise overflow-hidden"
      style={{ animationDelay: "175ms" }}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-4 sm:px-6">
        <div>
          <div className="flex items-center gap-2">
            <Link2 className="size-4 text-[var(--accent)]" />
            <h2 className="text-sm font-semibold text-[var(--text)]">
              Связанные заказы
            </h2>
          </div>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {linked
              ? `${relations.orders.length} заказа · ${visits.length} общих дат`
              : "Объедините заказы одного клиента и больше не храните даты в комментариях"}
          </p>
        </div>
        {canWrite ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="focus-ring flex h-9 items-center gap-2 rounded-[11px] border border-[var(--line-strong)] px-3 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-soft)]"
          >
            <Plus className="size-3.5" />
            Связать заказ
          </button>
        ) : null}
      </header>
      {linked ? (
        <div className="grid gap-px bg-[var(--line)] lg:grid-cols-[minmax(15rem,0.75fr)_minmax(0,1.25fr)]">
          <div className="bg-[var(--surface)] p-4 sm:p-6">
            <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">
              Заказы группы
            </p>
            <div className="mt-3 space-y-2">
              {relations.orders.map((order) =>
                order.current ? (
                  <div
                    key={order.id}
                    className="rounded-[12px] border border-[var(--accent)]/20 bg-[var(--accent)]/[0.035] p-3"
                  >
                    <OrderSummary order={order} />
                  </div>
                ) : (
                  <Link
                    key={order.id}
                    href={`/orders/${order.id}`}
                    className="focus-ring block rounded-[12px] border border-[var(--line)] p-3 hover:bg-[var(--surface-soft)]"
                  >
                    <OrderSummary order={order} />
                  </Link>
                ),
              )}
            </div>
          </div>
          <div className="bg-[var(--surface)] p-4 sm:p-6">
            <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">
              Все даты выездов
            </p>
            {visits.length ? (
              <ol className="mt-3 space-y-2">
                {visits.map(({ order, ...visit }) => (
                  <li
                    key={visit.id}
                    className="grid gap-2 rounded-[12px] border border-[var(--line)] bg-[var(--surface-inset)] p-3 min-[500px]:grid-cols-[9.5rem_minmax(0,1fr)_auto] min-[500px]:items-center"
                  >
                    <time className="font-display text-[10px] text-[var(--text)]">
                      {formatVisitDate(visit.scheduledStartAt, visit.timezone)}
                    </time>
                    <div className="min-w-0">
                      <p className="truncate text-xs text-[var(--text-secondary)]">
                        {order.number} · {order.object}
                      </p>
                      <p className="mt-1 truncate text-[9px] text-[var(--muted)]">
                        {order.address}
                      </p>
                    </div>
                    <span className="w-fit rounded-full bg-[var(--surface-soft)] px-2 py-1 text-[9px] text-[var(--muted)]">
                      {visit.status}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="grid min-h-36 place-items-center text-center">
                <div>
                  <CalendarDays className="mx-auto size-6 text-[var(--muted-subtle)]" />
                  <p className="mt-3 text-xs text-[var(--muted)]">
                    У связанных заказов пока нет выездов
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="px-5 py-7 sm:px-6">
          <div className="flex items-start gap-3 rounded-[13px] border border-[var(--line)] bg-[var(--surface-inset)] p-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-[var(--accent)]/[0.07] text-[var(--accent)]">
              <CalendarDays className="size-4" />
            </span>
            <div>
              <p className="text-xs font-medium text-[var(--text)]">
                Текущий заказ остаётся самостоятельным
              </p>
              <p className="mt-1 text-[10px] leading-5 text-[var(--muted)]">
                После связи здесь автоматически появятся все даты выездов по
                разным адресам и чекам этого клиента.
              </p>
            </div>
          </div>
        </div>
      )}
      <Dialog
        open={open}
        onClose={close}
        title="Связать заказы"
        description="Связь доступна только между заказами одного клиента. Данные самих заказов не объединяются."
      >
        <LinkOrderForm
          orderId={orderId}
          relations={relations}
          onClose={close}
        />
      </Dialog>
    </section>
  );
}

function OrderSummary({ order }: { order: OrderRelations["orders"][number] }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <strong className="font-display text-xs text-[var(--text)]">
          {order.number}
        </strong>
        {order.current ? (
          <span className="rounded-full bg-[var(--accent)]/10 px-2 py-1 text-[8px] text-[var(--accent)]">
            Текущий
          </span>
        ) : null}
        <span className="ml-auto text-[9px] text-[var(--muted)]">
          {order.visits.length} выезд.
        </span>
      </div>
      <p className="mt-2 truncate text-xs text-[var(--text-secondary)]">
        {order.object}
      </p>
      <p className="mt-1 flex items-center gap-1.5 truncate text-[9px] text-[var(--muted)]">
        <MapPin className="size-3 shrink-0" />
        {order.address}
      </p>
    </>
  );
}
