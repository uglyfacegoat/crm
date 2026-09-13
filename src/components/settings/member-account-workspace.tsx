"use client";

import { KeyRound, ShieldCheck, UserRound } from "lucide-react";
import { useState } from "react";
import { clientCrypto as crypto } from "@/lib/client-id";
import {
  MemberAccessForm,
  ResetMemberPasswordForm,
} from "@/components/settings/member-admin-panel";
import { Avatar } from "@/components/ui/avatar";
import { BackLink } from "@/components/ui/back-link";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import type {
  MemberMasterOption,
  OrganizationMemberListItem,
} from "@/server/members/types";

const roleLabels = {
  admin: "Администратор",
  dispatcher: "Диспетчер",
  manager: "Менеджер",
  accountant: "Бухгалтер",
  master: "Мастер",
} as const;

const memberAccountTabs = [
  { value: "access", label: "Доступ и роль", icon: ShieldCheck },
  { value: "security", label: "Пароль и сессии", icon: KeyRound },
] as const;

export function MemberAccountWorkspace({
  member,
  masterOptions,
  currentMemberId,
}: {
  member: OrganizationMemberListItem;
  masterOptions: MemberMasterOption[];
  currentMemberId: string;
}) {
  const [section, setSection] = useState<"access" | "security">("access");
  const [requestKey] = useState(() => crypto.randomUUID());
  const isCurrentMember = member.id === currentMemberId;

  return (
    <div className="mx-auto max-w-[96rem]">
      <BackLink href="/settings">К списку пользователей</BackLink>

      <header className="mt-7 grid gap-6 border-b border-[var(--line)] pb-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar
            name={member.displayName}
            size="md"
            tone={member.active ? "lime" : "violet"}
          />
          <div className="min-w-0">
            <p className="eyebrow">Учётная запись</p>
            <h1 className="mt-2 truncate font-display text-[clamp(1.8rem,1.4rem+1vw,2.7rem)] font-semibold tracking-[-0.05em] text-[var(--text)]">
              {member.displayName}
            </h1>
            <p className="mt-2 break-all text-xs text-[var(--muted)]">
              {member.email}
            </p>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-xs lg:min-w-80">
          <div>
            <dt className="text-[9px] uppercase tracking-[0.12em] text-[var(--muted)]">
              Роль
            </dt>
            <dd className="mt-1 text-[var(--text)]">
              {roleLabels[member.role]}
            </dd>
          </div>
          <div>
            <dt className="text-[9px] uppercase tracking-[0.12em] text-[var(--muted)]">
              Статус
            </dt>
            <dd
              className={`mt-1 ${member.active ? "text-[var(--success)]" : "text-[var(--danger-ink)]"}`}
            >
              {member.active ? "Активен" : "Отключён"}
            </dd>
          </div>
        </dl>
      </header>

      {isCurrentMember ? (
        <section className="mt-6 border-l-2 border-[var(--accent)] bg-[var(--surface)] px-5 py-4">
          <div className="flex gap-3">
            <UserRound className="mt-0.5 size-4 shrink-0 text-[var(--accent)]" />
            <div>
              <h2 className="text-sm font-medium text-[var(--text)]">
                Это ваша учётная запись
              </h2>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                Роль и системные права собственного администратора нельзя менять
                из активной сессии. Это защищает центр компаний от случайной
                потери доступа.
              </p>
            </div>
          </div>
        </section>
      ) : (
        <>
          <SegmentedTabs
            tabs={memberAccountTabs}
            value={section}
            onChange={setSection}
            label="Настройки пользователя"
            idPrefix={`member-account-${member.id}`}
            className="mt-6 w-fit"
          />
          <section
            id={`member-account-${member.id}-panel`}
            role="tabpanel"
            aria-labelledby={`member-account-${member.id}-${section}-tab`}
            className="surface-panel surface-panel-popover mt-5"
          >
            {section === "access" ? (
              <MemberAccessForm
                member={member}
                masterOptions={masterOptions}
                embedded
              />
            ) : (
              <ResetMemberPasswordForm
                member={member}
                requestKey={requestKey}
                embedded
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}
