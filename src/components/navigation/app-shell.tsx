"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  Building2,
  CalendarDays,
  Check,
  ChartNoAxesCombined,
  CheckSquare2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  FileText,
  Globe2,
  LayoutDashboard,
  Menu,
  MessageSquare,
  Plus,
  Search,
  Settings,
  UserRound,
  UsersRound,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { clients, orders } from "@/lib/mock-data";
import { Avatar } from "@/components/ui/avatar";
import { logoutAction } from "@/app/(workspace)/actions";
import type { OrganizationRole } from "@/server/auth/types";

const navigation = [
  { href: "/", label: "Главная", icon: LayoutDashboard },
  { href: "/orders", label: "Заказы", icon: ClipboardList },
  { href: "/clients", label: "Клиенты", icon: UsersRound },
  { href: "/calendar", label: "Календарь", icon: CalendarDays },
  { href: "/masters", label: "Мастера", icon: Wrench },
  { href: "/documents", label: "Документы", icon: FileText },
  { href: "/tasks", label: "Задачи", icon: CheckSquare2 },
  { href: "/chat", label: "Чат", icon: MessageSquare },
  { href: "/analytics", label: "Аналитика", icon: ChartNoAxesCombined },
  { href: "/sites", label: "Сайты", icon: Globe2 },
];

const mobileNavigation = navigation.slice(0, 4);

function isActivePath(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function CompanySwitcher({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <div className="px-3 pt-3">
      <details className="group relative">
        <summary className="focus-ring flex min-h-11 cursor-pointer list-none items-center gap-2.5 rounded-[13px] border border-white/[0.07] bg-white/[0.025] px-3 text-xs text-[#a1aaaf] transition-colors hover:border-white/[0.12] hover:bg-white/[0.045] [&::-webkit-details-marker]:hidden">
          <span className="flex -space-x-1"><span className="size-2.5 rounded-full bg-[var(--accent)] ring-2 ring-[#101619]" /><span className="size-2.5 rounded-full bg-[#9c82e8] ring-2 ring-[#101619]" /></span>
          <span className="min-w-0 flex-1 truncate">Все компании</span>
          <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
        </summary>
        <div className="absolute inset-x-0 top-[calc(100%+0.4rem)] z-50 rounded-[14px] border border-white/[0.09] bg-[#12191d] p-1.5 shadow-[0_22px_60px_rgba(0,0,0,0.45)]">
          <button onClick={(event) => event.currentTarget.closest("details")?.removeAttribute("open")} className="focus-ring flex min-h-10 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left text-xs text-white hover:bg-white/[0.045]">
            <Building2 className="size-4 text-[var(--accent)]" /><span className="min-w-0 flex-1 truncate">Основная компания</span><Check className="size-3.5 text-[var(--accent)]" />
          </button>
          <button disabled title="Добавление организаций появится после серверной авторизации" className="flex min-h-10 w-full cursor-not-allowed items-center gap-2.5 rounded-[10px] px-2.5 text-left text-xs text-[#626c72]"><Plus className="size-4" />Добавить компанию</button>
        </div>
      </details>
    </div>
  );
}

function SidebarContent({ pathname, onNavigate, expanded = false }: { pathname: string; onNavigate?: () => void; expanded?: boolean }) {
  const labelClass = expanded ? "block" : "hidden xl:block";

  return (
    <>
      <div className="flex h-20 items-center border-b border-white/[0.06] px-5 xl:px-6">
        <Link href="/" onClick={onNavigate} className="focus-ring flex items-center gap-3 rounded-lg">
          <span className="grid size-9 shrink-0 place-items-center rounded-[12px] bg-[var(--accent)] text-[#101308] shadow-[0_0_32px_rgba(237,244,59,0.14)]">
            <span className="font-display text-[9px] font-bold tracking-[-0.05em]">CRM</span>
          </span>
          <span className={labelClass}>
            <span className="block text-sm font-semibold tracking-[-0.02em] text-white">Сервисная CRM</span>
            <span className="mt-0.5 block text-[10px] uppercase tracking-[0.14em] text-[#687178]">Рабочее пространство</span>
          </span>
        </Link>
        {expanded ? (
          <button onClick={onNavigate} aria-label="Закрыть меню" className="focus-ring ml-auto rounded-xl p-2 text-[#80898f] hover:bg-white/[0.05] hover:text-white">
            <X className="size-5" />
          </button>
        ) : null}
      </div>

      <CompanySwitcher visible={expanded || false} />
      <div className="hidden xl:block"><CompanySwitcher visible={!expanded} /></div>

      <nav aria-label="Основная навигация" className="flex flex-1 flex-col gap-1 px-3 py-4">
        {navigation.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={`focus-ring group flex min-h-11 items-center gap-3 rounded-[14px] px-3 text-sm transition-[background-color,color,transform,box-shadow] duration-200 ease-out ${
                active
                  ? "bg-[var(--accent)] text-[#101308] shadow-[0_8px_24px_rgba(237,244,59,0.08)]"
                  : "text-[#818a90] hover:translate-x-0.5 hover:bg-white/[0.045] hover:text-white"
              }`}
            >
              <item.icon className="size-[18px] shrink-0" strokeWidth={active ? 2.2 : 1.7} />
              <span className={`${labelClass} font-medium`}>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="space-y-1 border-t border-white/[0.06] p-3">
        <button className="focus-ring flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm text-[#818a90] transition-colors hover:bg-white/[0.04] hover:text-white">
          <CircleHelp className="size-[18px]" strokeWidth={1.7} />
          <span className={labelClass}>Помощь</span>
        </button>
        <Link href="/settings" onClick={onNavigate} aria-current={isActivePath(pathname, "/settings") ? "page" : undefined} className={`focus-ring flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm transition-colors ${isActivePath(pathname, "/settings") ? "bg-white/[0.06] text-white" : "text-[#818a90] hover:bg-white/[0.04] hover:text-white"}`}>
          <Settings className="size-[18px]" strokeWidth={1.7} />
          <span className={labelClass}>Настройки</span>
        </Link>
      </div>
    </>
  );
}

function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru");
    if (!normalized) return [];

    return [
      ...orders
        .filter((order) => [order.number, order.client, order.object, order.address].some((field) => field.toLocaleLowerCase("ru").includes(normalized)))
        .map((order) => ({ id: order.id, title: `Заказ №${order.number}`, meta: `${order.client} · ${order.object}`, href: `/orders/${order.id}`, type: "Заказ" })),
      ...clients
        .filter((client) => [client.name, client.phone, client.email].some((field) => field.toLocaleLowerCase("ru").includes(normalized)))
        .map((client) => ({ id: client.id, title: client.name, meta: `${client.contact} · ${client.phone}`, href: "/clients", type: "Клиент" })),
    ].slice(0, 7);
  }, [query]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/72 px-3 pt-[max(1rem,10vh)] backdrop-blur-md sm:px-4" role="presentation" onMouseDown={onClose}>
      <div className="surface-panel w-full max-w-2xl bg-[#11171b] shadow-2xl" role="dialog" aria-modal="true" aria-label="Глобальный поиск" onMouseDown={(event) => event.stopPropagation()}>
        <label className="flex items-center gap-3 border-b border-white/[0.08] px-4">
          <Search className="size-5 text-[var(--accent)]" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Клиент, заказ, телефон или адрес"
            className="h-14 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[#687178] sm:h-16"
          />
          <button onClick={onClose} aria-label="Закрыть поиск" className="focus-ring rounded-lg p-2 text-[#768087] hover:bg-white/[0.05] hover:text-white">
            <X className="size-4" />
          </button>
        </label>
        <div className="max-h-[420px] overflow-y-auto p-2">
          {!query ? (
            <p className="px-3 py-8 text-center text-sm text-[#687178]">Начните вводить название, номер или адрес</p>
          ) : results.length ? (
            results.map((result) => (
              <button
                key={`${result.type}-${result.id}`}
                onClick={() => {
                  router.push(result.href);
                  onClose();
                }}
                className="focus-ring flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-white/[0.05]"
              >
                <span className="grid size-9 place-items-center rounded-lg bg-white/[0.05] text-[var(--accent)]">
                  {result.type === "Заказ" ? <ClipboardList className="size-4" /> : <UserRound className="size-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-white">{result.title}</span>
                  <span className="mt-0.5 block truncate text-xs text-[#747d83]">{result.meta}</span>
                </span>
                <span className="tiny-hidden text-[10px] uppercase tracking-[0.12em] text-[#596168]">{result.type}</span>
                <ChevronRight className="size-4 text-[#596168]" />
              </button>
            ))
          ) : (
            <p className="px-3 py-8 text-center text-sm text-[#687178]">Ничего не найдено</p>
          )}
        </div>
      </div>
    </div>
  );
}

function NotificationsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <div className="surface-panel absolute right-0 top-12 z-40 w-[min(22rem,calc(100vw-1.5rem))] bg-[#11171b] p-2 shadow-2xl">
      <div className="flex items-center justify-between px-3 py-2">
        <p className="text-sm font-semibold text-white">Уведомления</p>
        <button onClick={onClose} className="focus-ring rounded-lg p-1.5 text-[#778087] hover:bg-white/5 hover:text-white" aria-label="Закрыть уведомления">
          <X className="size-4" />
        </button>
      </div>
      {[
        ["Выезд через 45 минут", "ООО «Домжилсервис» · ул. Ленина, 15"],
        ["Нужен мастер", "Заказ №1245 просрочен"],
        ["Нет закрывающего акта", "Заказ №1246 · ООО «Вектор»"],
      ].map(([title, meta], index) => (
        <div key={title} className="flex gap-3 rounded-xl px-3 py-3 hover:bg-white/[0.04]">
          <span className={`mt-1.5 size-2 shrink-0 rounded-full ${index === 1 ? "bg-[var(--danger)]" : "bg-[var(--accent)]"}`} />
          <div>
            <p className="text-sm text-[#e9ece8]">{title}</p>
            <p className="mt-1 text-xs leading-5 text-[#747d83]">{meta}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

const roleLabels: Record<OrganizationRole, string> = { admin: "Администратор", dispatcher: "Диспетчер", manager: "Менеджер", accountant: "Бухгалтер", master: "Мастер" };

export function AppShell({ children, currentUser }: { children: React.ReactNode; currentUser: { displayName: string; email: string; role: OrganizationRole } }) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const primaryAction = [
    ["/orders", "Новый заказ"],
    ["/clients", "Новый клиент"],
    ["/calendar", "Новый выезд"],
    ["/masters", "Новый мастер"],
    ["/documents", "Добавить документ"],
    ["/tasks", "Новая задача"],
    ["/chat", "Новая группа"],
    ["/sites", "Подключить сайт"],
    ["/analytics", "Экспорт отчёта"],
  ].find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? "Новый заказ";

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        setNotificationsOpen(false);
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="min-h-screen bg-transparent">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-20 flex-col border-r border-white/[0.06] bg-[#090d10]/94 shadow-[18px_0_60px_rgba(0,0,0,0.08)] backdrop-blur-xl md:flex xl:w-60">
        <SidebarContent pathname={pathname} />
      </aside>

      {mobileMenuOpen ? (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm md:hidden" onClick={() => setMobileMenuOpen(false)} role="presentation">
          <aside className="flex h-full w-[min(19rem,88vw)] flex-col border-r border-white/10 bg-[#090d10] shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <SidebarContent pathname={pathname} onNavigate={() => setMobileMenuOpen(false)} expanded />
          </aside>
        </div>
      ) : null}

      <div className="md:pl-20 xl:pl-60">
        <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#070a0c]/82 backdrop-blur-2xl">
          <div className="topbar-inner flex h-16 min-w-0 items-center gap-2.5 sm:gap-3 2xl:h-[4.5rem]">
            <button onClick={() => setMobileMenuOpen(true)} className="focus-ring soft-button grid size-10 shrink-0 place-items-center rounded-[13px] text-[#8b9499] md:hidden" aria-label="Открыть меню">
              <Menu className="size-5" />
            </button>
            <button aria-label="Открыть глобальный поиск" onClick={() => setSearchOpen(true)} className="focus-ring soft-button flex h-10 min-w-0 flex-1 items-center gap-2 rounded-[13px] px-3 text-left text-sm text-[#737c82] max-[359px]:w-10 max-[359px]:flex-none max-[359px]:justify-center max-[359px]:px-0 sm:max-w-md 2xl:max-w-lg">
              <Search className="size-4 shrink-0" />
              <span className="tiny-hidden truncate">Поиск по всей CRM</span>
              <span className="ml-auto hidden rounded-md border border-white/[0.08] px-1.5 py-0.5 text-[10px] text-[#616a70] sm:block">Ctrl K</span>
            </button>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <span title="Создание заказов подключим вместе с базой данных" aria-disabled="true" className="hidden h-10 cursor-not-allowed items-center gap-2 rounded-[13px] bg-[var(--accent)]/55 px-4 text-sm font-semibold text-[#101308]/70 sm:flex">
                <Plus className="size-4" />
                {primaryAction}
              </span>
              <Link href="/chat" className="focus-ring soft-button hidden size-10 place-items-center rounded-[13px] text-[#8b9499] hover:text-white sm:grid" aria-label="Внутренний чат"><MessageSquare className="size-[18px]" /></Link>
              <div className="relative">
                <button onClick={() => setNotificationsOpen((current) => !current)} className="focus-ring soft-button relative grid size-10 place-items-center rounded-[13px] text-[#8b9499]" aria-label="Уведомления" aria-expanded={notificationsOpen}>
                  <Bell className="size-[18px]" />
                  <span className="absolute right-2 top-2 size-2 rounded-full bg-[var(--danger)] ring-2 ring-[#0b0f12]" />
                </button>
                <NotificationsPanel open={notificationsOpen} onClose={() => setNotificationsOpen(false)} />
              </div>
              <details className="group relative hidden lg:block">
                <summary className="focus-ring flex cursor-pointer list-none items-center gap-2 rounded-[13px] p-1 pr-2 transition-colors hover:bg-white/[0.04] [&::-webkit-details-marker]:hidden">
                  <Avatar name={currentUser.displayName} size="sm" tone="lime" />
                  <span className="text-left"><span className="block max-w-32 truncate text-xs font-medium text-white">{currentUser.displayName}</span><span className="block text-[10px] text-[#737c82]">{roleLabels[currentUser.role]}</span></span>
                  <ChevronDown className="size-3.5 text-[#626c72] transition-transform group-open:rotate-180" />
                </summary>
                <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-64 rounded-[14px] border border-white/[0.09] bg-[#12191d] p-2 shadow-[0_22px_60px_rgba(0,0,0,0.45)]">
                  <p className="truncate px-2.5 py-2 text-[10px] text-[#758087]">{currentUser.email}</p>
                  <Link href="/settings" className="focus-ring flex min-h-10 items-center gap-2.5 rounded-[10px] px-2.5 text-xs text-[#a8b0b4] hover:bg-white/[0.045] hover:text-white"><Settings className="size-4" />Настройки профиля</Link>
                  <form action={logoutAction}><button className="focus-ring flex min-h-10 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left text-xs text-[#d8888c] hover:bg-[#ef646a]/[0.06]"><X className="size-4" />Выйти</button></form>
                </div>
              </details>
            </div>
          </div>
        </header>

        <main className="workspace-main">{children}</main>
      </div>

      <nav aria-label="Мобильная навигация" className="fixed inset-x-2 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-40 grid min-w-0 grid-cols-5 gap-0.5 rounded-[18px] border border-white/10 bg-[#101619]/94 p-1 shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl min-[380px]:inset-x-3 min-[380px]:gap-1 min-[380px]:p-1.5 md:hidden">
        {mobileNavigation.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <Link key={item.href} href={item.href} className={`focus-ring flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-[13px] px-0.5 text-[8px] transition-colors min-[360px]:text-[9px] ${active ? "bg-[var(--accent)] text-[#101308]" : "text-[#7c858b]"}`}>
              <item.icon className="size-[17px] shrink-0 min-[360px]:size-[18px]" strokeWidth={active ? 2.3 : 1.7} />
              <span className="block w-full truncate text-center">{item.label}</span>
            </Link>
          );
        })}
        <button onClick={() => setMobileMenuOpen(true)} className="focus-ring flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-[13px] px-0.5 text-[8px] text-[#7c858b] min-[360px]:text-[9px]">
          <Menu className="size-[17px] shrink-0 min-[360px]:size-[18px]" strokeWidth={1.7} />
          <span className="block w-full truncate text-center">Ещё</span>
        </button>
      </nav>

      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
