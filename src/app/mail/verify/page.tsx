import type { Metadata } from "next";
import { confirmMailDestination } from "./actions";

export const metadata: Metadata = { title: "Подтверждение адреса", robots: { index: false, follow: false } };

export default async function VerifyMailPage({ searchParams }: {
  searchParams: Promise<{ token?: string; status?: string }>;
}) {
  const { token, status } = await searchParams;
  return <main className="flex min-h-dvh items-center justify-center bg-[var(--canvas)] p-5">
    <div className="surface-panel w-full max-w-md p-7 text-[var(--text)]">
      <h1 className="font-display text-2xl font-semibold">Адрес для копий писем</h1>
      {status === "confirmed" ? <p className="mt-4 text-sm">Адрес подтверждён. Теперь на него могут приходить выбранные копии.</p>
        : status === "expired" ? <p className="mt-4 text-sm">Ссылка недействительна или срок её действия истёк.</p>
          : token ? <><p className="mt-4 text-sm text-[var(--text-secondary)]">Подтвердите, что этот адрес принадлежит вам.</p>
            <form action={confirmMailDestination} className="mt-6"><input type="hidden" name="token" value={token} />
              <button className="focus-ring rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-medium text-[var(--on-accent)]">Подтвердить адрес</button>
            </form></> : <p className="mt-4 text-sm">Ссылка подтверждения не найдена.</p>}
    </div>
  </main>;
}
