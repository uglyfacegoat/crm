"use client";

import { Check, UsersRound } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  type ChatMutationState,
  updateChatChannelMembersAction,
} from "@/app/(workspace)/chat/actions";
import {
  OrderFormFooter,
  OrderFormStatus,
} from "@/components/orders/order-form-parts";
import { Avatar } from "@/components/ui/avatar";
import { Dialog } from "@/components/ui/dialog";
import type {
  ChatChannel,
  ChatMember,
  ChatMemberOption,
} from "@/server/chat/types";

const initialState: ChatMutationState = {
  status: "idle",
  message: null,
  fieldErrors: {},
  entityId: null,
};
const roleLabels = {
  developer: "Разработчик",
  admin: "Администратор",
  dispatcher: "Диспетчер",
  manager: "Менеджер",
  accountant: "Бухгалтер",
  master: "Мастер",
} as const;

function ManageMembersForm({
  channel,
  members,
  options,
  onComplete,
}: {
  channel: ChatChannel;
  members: ChatMember[];
  options: ChatMemberOption[];
  onComplete: () => void;
}) {
  const [state, action, pending] = useActionState(
    updateChatChannelMembersAction,
    initialState,
  );
  const router = useRouter();
  const currentMemberIds = useMemo(
    () => new Set(members.map((member) => member.id)),
    [members],
  );
  const ownerIds = useMemo(
    () =>
      new Set(
        members
          .filter((member) => member.channelRole === "owner")
          .map((member) => member.id),
      ),
    [members],
  );
  useEffect(() => {
    if (state.status !== "success") return;
    const timeout = window.setTimeout(() => {
      onComplete();
      router.refresh();
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [onComplete, router, state.status]);
  return (
    <form action={action} className="flex min-h-full flex-1 flex-col">
      <input type="hidden" name="channelId" value={channel.id} />
      <input type="hidden" name="expectedVersion" value={channel.version} />
      <div className="flex-1 space-y-5 p-5 sm:p-7">
        <div className="rounded-[13px] border border-[var(--line-strong)] bg-[var(--surface-inset)] p-4">
          <p className="text-sm font-medium text-[var(--text)]">
            {channel.name}
          </p>
          <p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">
            Владелец остаётся в группе. Удалённые сотрудники сразу теряют доступ
            к истории и вложениям.
          </p>
        </div>
        <fieldset>
          <legend className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
            Сотрудники офиса
          </legend>
          <div className="mt-3 max-h-[28rem] space-y-1 overflow-y-auto rounded-[14px] border border-[var(--line-strong)] bg-[var(--surface-inset)] p-2">
            {options.map((member) => {
              const owner = ownerIds.has(member.id);
              return (
                <label
                  key={member.id}
                  className="flex cursor-pointer items-center gap-3 rounded-[11px] px-2.5 py-2.5 transition-colors hover:bg-[var(--surface-soft)]"
                >
                  <input
                    type="checkbox"
                    name="memberIds"
                    value={member.id}
                    defaultChecked={currentMemberIds.has(member.id)}
                    disabled={owner}
                    className="peer sr-only"
                  />
                  {owner ? (
                    <input type="hidden" name="memberIds" value={member.id} />
                  ) : null}
                  <span className="grid size-5 shrink-0 place-items-center rounded-md border border-[var(--line-strong)] text-transparent peer-checked:border-[var(--accent)] peer-checked:bg-[var(--accent)] peer-checked:text-[var(--on-accent)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-[-2px] peer-focus-visible:outline-[var(--focus)]">
                    <Check className="size-3" />
                  </span>
                  <Avatar
                    name={member.displayName}
                    size="sm"
                    tone={owner ? "lime" : "violet"}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-[var(--text)]">
                      {member.displayName}
                      {owner ? " · владелец" : ""}
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] text-[var(--text-secondary)]">
                      {roleLabels[member.role]} · {member.email}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          {state.fieldErrors.memberIds?.length ? (
            <p className="mt-2 text-[10px] text-[var(--danger-ink)]">
              {state.fieldErrors.memberIds[0]}
            </p>
          ) : null}
        </fieldset>
        <OrderFormStatus state={state} />
      </div>
      <OrderFormFooter
        pending={pending}
        saved={state.status === "success"}
        onCancel={onComplete}
        submitLabel="Сохранить состав"
      />
    </form>
  );
}

export function ManageChatMembersButton({
  channel,
  members,
  options,
}: {
  channel: ChatChannel;
  members: ChatMember[];
  options: ChatMemberOption[];
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="focus-ring grid size-9 place-items-center rounded-[11px] border border-[var(--line)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
        aria-label="Изменить состав группы"
        title="Состав группы"
      >
        <UsersRound className="size-3.5" />
      </button>
      <Dialog
        open={open}
        onClose={close}
        title="Состав группы"
        description="Выберите сотрудников, которым доступна история этого канала."
      >
        {open ? (
          <ManageMembersForm
            channel={channel}
            members={members}
            options={options}
            onComplete={close}
          />
        ) : null}
      </Dialog>
    </>
  );
}
