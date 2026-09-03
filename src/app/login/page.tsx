import type { Metadata } from "next";
import { CalendarCheck2, Check, FileText, Radio, ShieldCheck } from "lucide-react";
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
  return <main className="relative min-h-screen overflow-hidden bg-[#070b0e] p-3 sm:p-5 lg:p-7">
    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_6%_12%,rgba(101,183,238,0.1),transparent_30rem),radial-gradient(circle_at_92%_88%,rgba(156,130,232,0.09),transparent_34rem)]" />
    <section className="relative mx-auto grid min-h-[calc(100dvh-1.5rem)] max-w-[104rem] overflow-hidden rounded-[22px] border border-white/[0.075] bg-[#0a1013]/95 shadow-[0_35px_120px_rgba(0,0,0,0.48)] sm:min-h-[calc(100dvh-2.5rem)] lg:grid-cols-[minmax(0,1.25fr)_minmax(27rem,0.75fr)] lg:min-h-[calc(100dvh-3.5rem)]">
      <div className="relative hidden overflow-hidden border-r border-white/[0.065] p-[clamp(2.5rem,4vw,5rem)] lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:5rem_5rem] [mask-image:linear-gradient(to_bottom,black,transparent_92%)]" />
        <div className="relative max-w-2xl">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[#7c878d]"><Radio className="size-3.5 text-[#69d3a4]" /><span>Рабочая система онлайн</span></div>
          <h1 className="mt-8 font-display text-[clamp(3.3rem,4.2vw,5.7rem)] font-semibold leading-[0.92] tracking-[-0.075em] text-white">Порядок<br />в каждом<br /><span className="text-[#9c82e8]">процессе.</span></h1>
          <p className="mt-7 max-w-xl text-[clamp(0.9rem,0.8rem+0.25vw,1.1rem)] leading-7 text-[#818c92]">От входящей заявки до оплаты и закрывающего документа — одна связанная история без разрозненных таблиц.</p>
        </div>
        <div className="relative ml-auto w-full max-w-2xl">
          <div className="grid gap-2 sm:grid-cols-3">
            {[{ icon: CalendarCheck2, label: "Выезд назначен", tone: "#69d3a4" }, { icon: FileText, label: "Документы связаны", tone: "#65b7ee" }, { icon: Check, label: "Оплата учтена", tone: "#edf43b" }].map(({ icon: Icon, label, tone }, index) => <div key={label} className={`rounded-[15px] border border-white/[0.07] bg-[#0b1216]/80 p-4 backdrop-blur-sm ${index === 1 ? "sm:translate-y-5" : ""}`}><Icon className="size-4" style={{ color: tone }} /><p className="mt-7 text-xs font-medium text-[#c2c8ca]">{label}</p><p className="mt-1 text-[9px] text-[#626d73]">Единый журнал изменений</p></div>)}
          </div>
        </div>
      </div>
      <div className="flex min-w-0 items-center justify-center p-5 sm:p-10 lg:p-[clamp(2.5rem,4vw,5rem)]">
        <div className="w-full max-w-md">
          <span className="grid size-12 place-items-center rounded-[15px] border border-[var(--accent)]/15 bg-[var(--accent)]/[0.055] text-[var(--accent)]"><ShieldCheck className="size-5" /></span>
          <p className="eyebrow mt-8">Личный доступ</p>
          <h2 className="mt-3 font-display text-[clamp(2.4rem,2rem+1vw,3.4rem)] font-semibold tracking-[-0.065em] text-white">Вход в CRM</h2>
          <p className="mt-3 max-w-sm text-sm leading-6 text-[#7b858b]">Используйте корпоративную почту или рабочий телефон.</p>
          <LoginForm nextPath={safeNextPath(next)} preview={authMode === "preview"} />
          <div className="mt-7 border-t border-white/[0.06] pt-5"><p className="text-[10px] leading-5 text-[#606a70]">Доступы и восстановление пароля контролирует администратор вашей компании.</p></div>
        </div>
      </div>
    </section>
  </main>;
}
