import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EMAIL_CHALLENGE_COOKIE_NAME } from "@/server/auth/email-otp-repository";
import { safeLoginRedirect } from "@/server/auth/login-redirect";
import { EmailCodeForm } from "@/components/auth/email-code-form";

export const metadata: Metadata = { title: "Подтверждение входа", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function VerifyLoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  if (!(await cookies()).get(EMAIL_CHALLENGE_COOKIE_NAME)?.value) redirect("/login");
  const { next } = await searchParams;
  return <main className="grid min-h-dvh place-items-center bg-[var(--canvas)] px-5 py-10">
    <section className="surface-panel w-full max-w-md p-7 text-[var(--text)] sm:p-9">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">Защита входа</p>
      <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">Код из почты</h1>
      <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">Отправили семизначный код на почту вашей учётной записи. Письмо может прийти в течение минуты. Код действует 10 минут.</p>
      <EmailCodeForm nextPath={safeLoginRedirect(next)} />
      <Link href="/login" className="mt-6 inline-block text-sm text-[var(--text-secondary)] underline underline-offset-4">Вернуться ко входу</Link>
    </section>
  </main>;
}
