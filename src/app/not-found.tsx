import Link from "next/link";

export default function NotFound() {
  return <main className="grid min-h-[100dvh] place-items-center bg-[var(--canvas)] px-5 text-center text-[var(--text)]">
    <div className="max-w-md">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">Ошибка 404</p>
      <h1 className="mt-3 font-display text-3xl font-semibold">Страница не найдена</h1>
      <p className="mt-4 text-sm leading-6 text-[var(--text-secondary)]">Проверьте адрес. Если вы скопировали ссылку вместе с логином и паролем, откройте только адрес CRM.</p>
      <Link href="/" className="focus-ring mt-7 inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--accent)] px-5 text-sm font-semibold text-[var(--on-accent)]">На главную CRM</Link>
    </div>
  </main>;
}
