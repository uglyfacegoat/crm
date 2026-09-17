import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
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
  return <main className="relative isolate grid min-h-[100dvh] place-items-center overflow-hidden bg-[var(--canvas)] px-5 py-10 sm:px-8 sm:py-14">
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[var(--line)]" />
    <div aria-hidden className="pointer-events-none absolute left-1/2 top-[12%] size-[min(52rem,92vw)] -translate-x-1/2 rounded-full border border-[var(--line)] opacity-45" />
    <section className="relative w-full max-w-[27rem] text-center">
      <div className="animate-rise">
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Рабочий доступ</p>
        <h1 className="mt-4 font-display text-[clamp(2.2rem,8vw,3.2rem)] font-semibold tracking-[-0.065em] text-[var(--text)]">Вход в CRM</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[var(--text-secondary)]">Введите корпоративную почту или рабочий телефон и пароль.</p>
      </div>
      <LoginForm nextPath={safeNextPath(next)} preview={authMode === "preview"} />
      <p className="mt-8 flex items-start gap-2 border-t border-[var(--line)] pt-5 text-left text-[10px] leading-5 text-[var(--muted)]"><ShieldCheck className="mt-0.5 size-3 shrink-0 text-[var(--support)]" aria-hidden />Если доступ не работает, обратитесь к администратору компании.</p>
    </section>
  </main>;
}
