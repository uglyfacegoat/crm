import Link from "next/link";
import { Bell, CalendarDays, ChevronRight, ClipboardList, FileText, Search, Smartphone, Wrench } from "lucide-react";
import { PageHeading } from "@/components/ui/page-heading";
import { requireSession } from "@/server/auth/session";

const officeTopics = [
  { href: "/quick-order", title: "Оформить заказ", description: "Создать клиента, объект, заказ и первый выезд одним сценарием.", icon: ClipboardList, tone: "text-[#f0d65f] bg-[#f0d65f]/[0.08]" },
  { href: "/calendar", title: "Спланировать выезды", description: "Назначить даты, перенести карточки и проверить загрузку мастеров.", icon: CalendarDays, tone: "text-[#66aef3] bg-[#66aef3]/[0.08]" },
  { href: "/documents", title: "Найти документы", description: "Открыть архив клиента, заказа или конкретного выезда.", icon: FileText, tone: "text-[#72d4c4] bg-[#72d4c4]/[0.08]" },
  { href: "/notifications", title: "Проверить напоминания", description: "Просрочки, предстоящие выезды и системные события.", icon: Bell, tone: "text-[#ef8b67] bg-[#ef8b67]/[0.08]" },
];

export default async function HelpPage() {
  const session = await requireSession();
  const topics = session.role === "master" ? [
    { href: "/my-visits", title: "Мои выезды", description: "Открыть назначения, начать работу и заполнить результат.", icon: Wrench, tone: "text-[#a892ec] bg-[#a892ec]/[0.08]" },
    { href: "/notifications", title: "Уведомления", description: "Проверить новые назначения и изменения расписания.", icon: Bell, tone: "text-[#ef8b67] bg-[#ef8b67]/[0.08]" },
  ] : officeTopics;

  return <div>
    <PageHeading eyebrow="Поддержка" title="Помощь по CRM" description="Короткие маршруты к основным рабочим сценариям без неработающих декоративных кнопок." />
    <section className="mt-6 grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
      {topics.map((topic) => <Link key={topic.href} href={topic.href} className="focus-ring surface-panel group flex min-h-40 flex-col p-5 hover:border-white/[0.13]">
        <span className={`grid size-10 place-items-center rounded-[12px] ${topic.tone}`}><topic.icon className="size-4" /></span>
        <h2 className="mt-5 font-display text-base font-semibold text-white">{topic.title}</h2>
        <p className="mt-2 flex-1 text-xs leading-5 text-[#747e84]">{topic.description}</p>
        <span className="mt-5 flex items-center gap-2 text-[10px] font-medium text-[var(--accent)]">Открыть <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" /></span>
      </Link>)}
    </section>
    {session.role !== "master" ? <section className="surface-panel mt-4 grid gap-4 p-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
      <span className="grid size-11 place-items-center rounded-[13px] bg-[#9c82e8]/[0.08] text-[#ad98ea]"><Search className="size-5" /></span>
      <div><h2 className="text-sm font-semibold text-white">Быстрый поиск</h2><p className="mt-1 text-xs leading-5 text-[#747e84]">Нажмите <kbd className="rounded-md border border-white/[0.08] bg-white/[0.035] px-1.5 py-0.5 text-[10px] text-[#b8c0c3]">Ctrl K</kbd> на любом экране, чтобы найти клиента, заказ, объект, документ, мастера или дату выезда.</p></div>
    </section> : null}
    <section className="mt-4 flex items-start gap-3 rounded-[14px] border border-white/[0.06] bg-white/[0.018] p-4"><Smartphone className="mt-0.5 size-4 shrink-0 text-[#69d3a4]" /><p className="text-[10px] leading-5 text-[#717b81]">Если действие недоступно для вашей роли или требует изменения прав, обратитесь к администратору организации. CRM не показывает фиктивное успешное сохранение для незавершённых серверных функций.</p></section>
  </div>;
}
