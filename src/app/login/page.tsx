import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";
import { getAuthMode } from "@/server/auth/config";

export const metadata: Metadata = { title: "Вход" };

export const dynamic = "force-dynamic";

function safeNextPath(value: string | string[] | undefined) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  const authMode = getAuthMode();
  return <main className="grid min-h-screen place-items-center bg-[#070a0c] px-5 py-12">
    <section className="w-full max-w-[25rem]">
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">Рабочий доступ</p>
      <h1 className="mt-5 font-display text-[clamp(2.35rem,8vw,3.35rem)] font-semibold tracking-[-0.065em] text-white">Вход в CRM</h1>
      <p className="mt-3 max-w-sm text-sm leading-6 text-[#919a98]">Введите корпоративную почту или рабочий телефон и пароль.</p>
      <LoginForm nextPath={safeNextPath(next)} preview={authMode === "preview"} />
      <p className="mt-8 border-t border-white/[0.08] pt-5 text-[10px] leading-5 text-[#6f7776]">Если доступ не работает, обратитесь к администратору компании.</p>
    </section>
  </main>;
}
