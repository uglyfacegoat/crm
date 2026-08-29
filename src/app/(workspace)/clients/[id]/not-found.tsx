import Link from "next/link";
import { SearchX } from "lucide-react";

export default function ClientNotFound() {
  return <div className="surface-panel grid min-h-[min(70vh,620px)] place-items-center p-8 text-center"><div><span className="mx-auto grid size-12 place-items-center rounded-[14px] border border-white/[0.07] text-[#737d83]"><SearchX className="size-5" /></span><h1 className="mt-5 font-display text-2xl font-semibold text-white">Клиент не найден</h1><p className="mt-2 text-sm text-[#707a80]">Карточка удалена, недоступна или адрес введён неверно.</p><Link href="/clients" className="focus-ring mt-6 inline-flex h-11 items-center rounded-[12px] bg-[var(--accent)] px-4 text-xs font-semibold text-[#101308]">Вернуться к клиентам</Link></div></div>;
}
