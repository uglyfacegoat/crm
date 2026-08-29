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
  return <main className="relative grid min-h-screen place-items-center overflow-hidden px-4 py-12"><div className="pointer-events-none absolute left-1/2 top-0 h-[40rem] w-[min(80rem,120vw)] -translate-x-1/2 bg-[radial-gradient(circle_at_top,rgba(237,244,59,0.06),transparent_58%)]" /><section className="relative flex w-full max-w-2xl min-w-0 flex-col items-center text-center"><div className="grid size-14 place-items-center rounded-[16px] border border-[var(--accent)]/70 text-[var(--accent)] shadow-[0_0_50px_rgba(237,244,59,0.08)]"><span className="font-display text-sm font-bold">CRM</span></div><p className="mt-4 text-sm font-semibold uppercase tracking-[0.08em] text-white">Сервисная CRM</p><p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-[#626c72]">Рабочее пространство</p><h1 className="mt-10 w-full font-display text-[clamp(1.7rem,1.45rem+2vw,3.4rem)] font-semibold leading-tight tracking-[-0.055em] text-white">Добро пожаловать</h1><p className="mt-3 text-sm text-[#7e888e]">Войдите в свою учётную запись</p><LoginForm nextPath={safeNextPath(next)} preview={authMode === "preview"} /><p className="mt-7 text-xs text-[#6f797f]">Нет аккаунта? <button className="focus-ring ml-1 rounded-md text-[var(--accent)]">Связаться с администратором</button></p></section></main>;
}
