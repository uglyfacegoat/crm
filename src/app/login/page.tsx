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
  return <main className="relative grid min-h-screen place-items-center overflow-hidden px-3 py-5 sm:px-6 sm:py-8">
    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_18%,rgba(102,174,243,0.09),transparent_28rem),radial-gradient(circle_at_88%_12%,rgba(237,244,59,0.065),transparent_25rem),radial-gradient(circle_at_72%_84%,rgba(156,130,232,0.08),transparent_30rem)]" />
    <section className="relative grid w-full max-w-6xl overflow-hidden rounded-[clamp(1.25rem,1rem+0.6vw,1.8rem)] border border-white/[0.08] bg-[#0b1014]/94 shadow-[0_36px_120px_rgba(0,0,0,0.42)] backdrop-blur-xl lg:grid-cols-[minmax(0,1.08fr)_minmax(27rem,0.92fr)] min-[2200px]:max-w-[88rem]">
      <div className="relative hidden min-h-[42rem] overflow-hidden border-r border-white/[0.07] p-[clamp(2.5rem,3.5vw,4.5rem)] lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(102,174,243,0.11),transparent_25rem),radial-gradient(circle_at_85%_80%,rgba(156,130,232,0.1),transparent_27rem),linear-gradient(145deg,rgba(255,255,255,0.02),transparent_55%)]" />
        <div className="relative">
          <p className="eyebrow">Единый рабочий контур</p>
          <h1 className="mt-5 max-w-xl font-display text-[clamp(2.5rem,3.2vw,4.25rem)] font-semibold leading-[1.04] tracking-[-0.06em] text-white">Все процессы<br />в одном спокойном интерфейсе.</h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-[#89949b]">Заказы, выезды, документы и аналитика остаются связаны — от первого обращения до закрывающего акта.</p>
        </div>
        <div className="relative grid grid-cols-3 gap-3">
          {[["01", "Заказы"], ["02", "Команда"], ["03", "Аналитика"]].map(([number, label], index) => <div key={label} className="rounded-[15px] border border-white/[0.07] bg-white/[0.025] p-4"><span className={`font-display text-xs ${index === 0 ? "text-[#66aef3]" : index === 1 ? "text-[#a892ec]" : "text-[#72d4c4]"}`}>{number}</span><p className="mt-7 text-xs font-medium text-[#b8c0c3]">{label}</p></div>)}
        </div>
      </div>
      <div className="flex min-h-[min(44rem,calc(100dvh-2.5rem))] min-w-0 flex-col justify-center p-5 sm:p-10 lg:min-h-[42rem] lg:p-[clamp(2.5rem,3.5vw,4.5rem)]">
        <p className="eyebrow">Защищённый вход</p>
        <h2 className="mt-4 font-display text-[clamp(2rem,1.55rem+1.25vw,3rem)] font-semibold tracking-[-0.055em] text-white">Добро пожаловать</h2>
        <p className="mt-2 text-sm leading-6 text-[#7e888e]">Войдите в рабочее пространство под своей учётной записью.</p>
        <LoginForm nextPath={safeNextPath(next)} preview={authMode === "preview"} />
        <p className="mt-6 text-xs leading-5 text-[#6f797f]">Нет аккаунта? Обратитесь к администратору вашей организации.</p>
      </div>
    </section>
  </main>;
}
