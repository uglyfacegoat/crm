import Link from "next/link";
import { SearchX } from "lucide-react";

export default function ClientNotFound() {
  return <div className="surface-panel grid min-h-[min(70vh,620px)] place-items-center p-8 text-center"><div><span className="mx-auto grid size-12 place-items-center rounded-[14px] border border-[var(--line)] bg-[var(--surface-raised)] text-[var(--muted)]"><SearchX className="size-5" /></span><h1 className="mt-5 font-display text-2xl font-semibold text-[var(--text)]">Клиент не найден</h1><p className="mt-2 text-sm text-[var(--muted)]">Карточка удалена, недоступна или адрес введён неверно.</p><Link href="/clients" className="focus-ring mt-6 inline-flex h-11 items-center rounded-[12px] bg-[var(--accent)] px-4 text-xs font-semibold text-[var(--on-accent)]">Вернуться к клиентам</Link></div></div>;
}
