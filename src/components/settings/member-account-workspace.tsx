"use client";

import { ArrowLeft, KeyRound, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { clientCrypto as crypto } from "@/lib/client-id";
import { MemberAccessForm, ResetMemberPasswordForm } from "@/components/settings/member-admin-panel";
import { Avatar } from "@/components/ui/avatar";
import type { MemberMasterOption, OrganizationMemberListItem } from "@/server/members/types";

const roleLabels = {
  admin: "Администратор",
  dispatcher: "Диспетчер",
  manager: "Менеджер",
  accountant: "Бухгалтер",
  master: "Мастер",
} as const;

export function MemberAccountWorkspace({ member, masterOptions, currentMemberId }: { member: OrganizationMemberListItem; masterOptions: MemberMasterOption[]; currentMemberId: string }) {
  const [section, setSection] = useState<"access" | "security">("access");
  const [requestKey] = useState(() => crypto.randomUUID());
  const isCurrentMember = member.id === currentMemberId;

  return <div className="mx-auto max-w-6xl">
    <Link href="/settings" className="focus-ring inline-flex items-center gap-2 text-xs text-[#8e9795] hover:text-white"><ArrowLeft className="size-4" />К списку пользователей</Link>

    <header className="mt-7 grid gap-6 border-b border-white/[0.09] pb-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
      <div className="flex min-w-0 items-center gap-4">
        <Avatar name={member.displayName} size="md" tone={member.active ? "lime" : "violet"} />
        <div className="min-w-0"><p className="eyebrow">Учётная запись</p><h1 className="mt-2 truncate font-display text-[clamp(1.8rem,1.4rem+1vw,2.7rem)] font-semibold tracking-[-0.05em] text-white">{member.displayName}</h1><p className="mt-2 break-all text-xs text-[#8e9795]">{member.email}</p></div>
      </div>
      <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-xs lg:min-w-80"><div><dt className="text-[9px] uppercase tracking-[0.12em] text-[#697270]">Роль</dt><dd className="mt-1 text-white">{roleLabels[member.role]}</dd></div><div><dt className="text-[9px] uppercase tracking-[0.12em] text-[#697270]">Статус</dt><dd className="mt-1 text-[var(--accent)]">{member.active ? "Активен" : "Отключён"}</dd></div></dl>
    </header>

    {isCurrentMember ? <section className="mt-6 border-l-2 border-[var(--accent)] bg-[var(--surface)] px-5 py-4"><div className="flex gap-3"><UserRound className="mt-0.5 size-4 shrink-0 text-[var(--accent)]" /><div><h2 className="text-sm font-medium text-white">Это ваша учётная запись</h2><p className="mt-1 text-xs leading-5 text-[#8e9795]">Роль и системные права собственного администратора нельзя менять из активной сессии. Это защищает центр компаний от случайной потери доступа.</p></div></div></section> : <>
      <nav className="mt-6 flex gap-6 border-b border-white/[0.08]" aria-label="Настройки пользователя">
        <button type="button" onClick={() => setSection("access")} className={`focus-ring flex h-12 items-center gap-2 border-b-2 text-xs ${section === "access" ? "border-[var(--accent)] text-white" : "border-transparent text-[#858e8c]"}`}><ShieldCheck className="size-4" />Доступ и роль</button>
        <button type="button" onClick={() => setSection("security")} className={`focus-ring flex h-12 items-center gap-2 border-b-2 text-xs ${section === "security" ? "border-[var(--accent)] text-white" : "border-transparent text-[#858e8c]"}`}><KeyRound className="size-4" />Пароль и сессии</button>
      </nav>
      <section className="mt-5 overflow-hidden border border-white/[0.08] bg-[var(--surface)]">
        {section === "access" ? <MemberAccessForm member={member} masterOptions={masterOptions} embedded /> : <ResetMemberPasswordForm member={member} requestKey={requestKey} embedded />}
      </section>
    </>}
  </div>;
}
