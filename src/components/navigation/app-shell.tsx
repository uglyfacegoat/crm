"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertCircle,
  Bell,
  Building2,
  CalendarDays,
  ChartNoAxesCombined,
  CheckSquare2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  FileText,
  FileSignature,
  Globe2,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  MessageSquare,
  Search,
  Settings,
  UserRound,
  UsersRound,
  WalletCards,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { globalSearchResponseSchema, type GlobalSearchResult } from "@/lib/global-search";
import { Avatar } from "@/components/ui/avatar";
import { NotificationCenter } from "@/components/notifications/notification-center";
import { logoutAction } from "@/app/(workspace)/actions";
import type { OrganizationRole } from "@/server/auth/types";
import { hasPermission } from "@/server/auth/permissions";

const officeNavigation = [
  { href: "/", label: "Главная", icon: LayoutDashboard },
  { href: "/orders", label: "Заказы", icon: ClipboardList },
  { href: "/quick-order", label: "Оформить", icon: Zap },
  { href: "/clients", label: "Клиенты", icon: UsersRound },
  { href: "/calendar", label: "Календарь", icon: CalendarDays },
  { href: "/masters", label: "Мастера", icon: Wrench },
  { href: "/documents", label: "Документы", icon: FileText },
  { href: "/contracts", label: "Договоры", icon: FileSignature },
  { href: "/finance", label: "Финансы", icon: WalletCards },
  { href: "/tasks", label: "Задачи", icon: CheckSquare2 },
  { href: "/notifications", label: "Уведомления", icon: Bell },
  { href: "/chat", label: "Чат", icon: MessageSquare },
  { href: "/analytics", label: "Аналитика", icon: ChartNoAxesCombined },
  { href: "/sites", label: "Сайты", icon: Globe2 },
];

const masterNavigation = [
  { href: "/my-visits", label: "Мои выезды", icon: CalendarDays },
  { href: "/notifications", label: "Уведомления", icon: Bell },
];

type NavigationItem = (typeof officeNavigation)[number];

const navigationIconTones: Record<string, string> = {
  "/orders": "text-[#a892ec]",
  "/quick-order": "text-[#f2c95e]",
  "/clients": "text-[#69d3a4]",
  "/calendar": "text-[#66aef3]",
  "/masters": "text-[#cf78d1]",
  "/documents": "text-[#72d4c4]",
  "/contracts": "text-[#efb56a]",
  "/finance": "text-[#69d3a4]",
  "/tasks": "text-[#66aef3]",
  "/notifications": "text-[#ef8b67]",
  "/chat": "text-[#a892ec]",
  "/analytics": "text-[#72d4c4]",
  "/sites": "text-[#66aef3]",
};

function isActivePath(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function CompanySwitcher({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <div className="px-3 pt-3">
      <div className="flex min-h-11 items-center gap-2.5 rounded-[13px] border border-white/[0.07] bg-white/[0.025] px-3 text-xs text-[#a1aaaf]">
        <Building2 className="size-4 text-[var(--accent)]" />
        <span className="min-w-0 flex-1 truncate">Основная компания</span>
        <span className="size-1.5 rounded-full bg-[#69d3a4] shadow-[0_0_8px_rgba(105,211,164,0.5)]" />
      </div>
    </div>
  );
}

function SidebarContent({ pathname, navigation, role, onNavigate, expanded = false }: { pathname: string; navigation: NavigationItem[]; role: OrganizationRole; onNavigate?: () => void; expanded?: boolean }) {
  const labelClass = expanded ? "block" : "hidden xl:block";

  return (
    <>
      {expanded ? (
        <div className="flex h-16 items-center justify-end border-b border-white/[0.06] px-4">
          <button onClick={onNavigate} aria-label="Закрыть меню" className="focus-ring rounded-xl p-2 text-[#80898f] hover:bg-white/[0.05] hover:text-white">
            <X className="size-5" />
          </button>
        </div>
      ) : null}

      {role !== "master" ? <><CompanySwitcher visible={expanded} /><div className="hidden xl:block"><CompanySwitcher visible={!expanded} /></div></> : null}

      <nav aria-label="Основная навигация" className="flex flex-1 flex-col gap-1 px-3 py-4 md:pt-5">
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
              <item.icon className={`size-[18px] shrink-0 transition-colors ${active ? "text-[#101308]" : navigationIconTones[item.href] ?? "text-[#818a90]"}`} strokeWidth={active ? 2.2 : 1.7} />
              <span className={`${labelClass} font-medium`}>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="space-y-1 border-t border-white/[0.06] p-3">
        <Link href="/help" onClick={onNavigate} aria-current={isActivePath(pathname, "/help") ? "page" : undefined} className={`focus-ring flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm transition-colors ${isActivePath(pathname, "/help") ? "bg-white/[0.06] text-white" : "text-[#818a90] hover:bg-white/[0.04] hover:text-white"}`}>
          <CircleHelp className="size-[18px]" strokeWidth={1.7} />
          <span className={labelClass}>Помощь</span>
        </Link>
        {role === "admin" ? <Link href="/settings" onClick={onNavigate} aria-current={isActivePath(pathname, "/settings") ? "page" : undefined} className={`focus-ring flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm transition-colors ${isActivePath(pathname, "/settings") ? "bg-white/[0.06] text-white" : "text-[#818a90] hover:bg-white/[0.04] hover:text-white"}`}>
          <Settings className="size-[18px]" strokeWidth={1.7} />
          <span className={labelClass}>Настройки</span>
        </Link> : null}
        <form action={logoutAction}><button className="focus-ring flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm text-[#c8797e] transition-colors hover:bg-[#ef646a]/[0.06] hover:text-[#e4979b]"><LogOut className="size-[18px]" strokeWidth={1.7} /><span className={labelClass}>Выйти</span></button></form>
      </div>
    </>
  );
}

const searchTypePresentation = {
  order: { label: "Заказ", icon: ClipboardList, tone: "text-[#9c82e8] bg-[#9c82e8]/[0.09]" },
  client: { label: "Клиент", icon: UserRound, tone: "text-[var(--accent)] bg-[var(--accent)]/[0.08]" },
  object: { label: "Объект", icon: Building2, tone: "text-[#69d3a4] bg-[#69d3a4]/[0.08]" },
  visit: { label: "Выезд", icon: CalendarDays, tone: "text-[#66b6eb] bg-[#66b6eb]/[0.08]" },
  document: { label: "Документ", icon: FileText, tone: "text-[#efb454] bg-[#efb454]/[0.08]" },
  master: { label: "Мастер", icon: Wrench, tone: "text-[#db82d7] bg-[#db82d7]/[0.08]" },
  contract: { label: "Договор", icon: FileSignature, tone: "text-[#efb454] bg-[#efb454]/[0.08]" },
} satisfies Record<GlobalSearchResult["entityType"], { label: string; icon: typeof Search; tone: string }>;

function SearchDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const timeoutRef = useRef<number | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => () => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    requestRef.current?.abort();
  }, []);

  async function executeSearch(nextQuery: string, controller: AbortController) {
    try {
      const response = await fetch(`/api/v1/search?q=${encodeURIComponent(nextQuery)}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message = typeof payload === "object" && payload !== null && "error" in payload
          && typeof payload.error === "object" && payload.error !== null && "message" in payload.error
          && typeof payload.error.message === "string"
          ? payload.error.message
          : "Не удалось выполнить поиск.";
        throw new Error(message);
      }
      const parsed = globalSearchResponseSchema.parse(payload);
      if (requestRef.current !== controller) return;
      setResults(parsed.data.results);
      setActiveIndex(0);
      setStatus("success");
    } catch (error) {
      if (controller.signal.aborted || requestRef.current !== controller) return;
      setResults([]);
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Не удалось выполнить поиск.");
    }
  }

  function scheduleSearch(value: string, immediate = false) {
    setQuery(value);
    setErrorMessage(null);
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    requestRef.current?.abort();
    const normalized = value.trim().replace(/\s+/g, " ");
    if (normalized.length < 2) {
      setResults([]);
      setStatus("idle");
      setActiveIndex(0);
      return;
    }
    const controller = new AbortController();
    requestRef.current = controller;
    setStatus("loading");
    timeoutRef.current = window.setTimeout(() => void executeSearch(normalized, controller), immediate ? 0 : 220);
  }

  function openResult(result: GlobalSearchResult) {
    router.push(result.href);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/72 px-2 pt-2 backdrop-blur-md sm:px-4 sm:pt-[max(1rem,9vh)]" role="presentation" onMouseDown={onClose}>
      <div className="surface-panel w-full max-w-2xl bg-[#11171b] shadow-2xl" role="dialog" aria-modal="true" aria-label="Глобальный поиск" onMouseDown={(event) => event.stopPropagation()}>
        <label className="flex items-center gap-3 border-b border-white/[0.08] px-4">
          <Search className="size-5 text-[var(--accent)]" />
          <input
            autoFocus
            value={query}
            onChange={(event) => scheduleSearch(event.target.value)}
            onKeyDown={(event) => {
              if (!results.length) return;
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((current) => (current + 1) % results.length);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((current) => (current - 1 + results.length) % results.length);
              } else if (event.key === "Enter") {
                event.preventDefault();
                openResult(results[activeIndex] ?? results[0]);
              }
            }}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={results.length > 0}
            aria-controls="global-search-results"
            aria-activedescendant={results[activeIndex] ? `global-search-result-${activeIndex}` : undefined}
            placeholder="Клиент, заказ, документ, адрес или дата"
            className="h-14 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[#687178] sm:h-16"
          />
          <button onClick={onClose} aria-label="Закрыть поиск" className="focus-ring rounded-lg p-2 text-[#768087] hover:bg-white/[0.05] hover:text-white"><X className="size-4" /></button>
        </label>
        <div id="global-search-results" role="listbox" className="max-h-[min(34rem,calc(100dvh-5rem))] overflow-y-auto p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {!query.trim() ? (
            <div className="px-4 py-10 text-center"><p className="text-sm text-[#899298]">Ищите по всей рабочей базе</p><p className="mt-2 text-xs leading-5 text-[#59636a]">Клиент, ИНН, телефон, заказ, объект, документ, мастер или дата выезда</p></div>
          ) : query.trim().length < 2 ? (
            <p className="px-3 py-9 text-center text-sm text-[#687178]">Введите ещё один символ</p>
          ) : status === "loading" ? (
            <div className="flex items-center justify-center gap-2 px-3 py-10 text-sm text-[#7b858b]" aria-live="polite"><LoaderCircle className="size-4 animate-spin text-[var(--accent)]" />Ищу в рабочей базе…</div>
          ) : status === "error" ? (
            <div className="flex flex-col items-center px-4 py-9 text-center" aria-live="polite"><span className="grid size-10 place-items-center rounded-full bg-[#ef646a]/[0.08] text-[#df7379]"><AlertCircle className="size-4" /></span><p className="mt-3 text-sm text-[#c9cfcb]">{errorMessage}</p><button type="button" onClick={() => scheduleSearch(query, true)} className="focus-ring mt-4 rounded-[10px] border border-white/[0.09] px-3 py-2 text-xs text-white hover:bg-white/[0.04]">Повторить</button></div>
          ) : results.length ? (
            results.map((result, index) => {
              const presentation = searchTypePresentation[result.entityType];
              const Icon = presentation.icon;
              return <button
                id={`global-search-result-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                key={`${result.entityType}-${result.id}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => openResult(result)}
                className={`focus-ring flex w-full items-center gap-3 rounded-[13px] px-3 py-3 text-left transition-colors ${index === activeIndex ? "bg-white/[0.055]" : "hover:bg-white/[0.035]"}`}
              >
                <span className={`grid size-10 shrink-0 place-items-center rounded-[12px] ${presentation.tone}`}><Icon className="size-4" /></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-white">{result.title}</span><span className="mt-0.5 block truncate text-xs text-[#7a848a]">{result.subtitle}</span>{result.detail ? <span className="mt-1 block truncate text-[10px] text-[#59636a]">{result.detail}</span> : null}</span>
                <span className="tiny-hidden text-right"><span className="block text-[9px] uppercase tracking-[0.12em] text-[#646e74]">{presentation.label}</span><span className="mt-1 block text-[9px] text-[#4f595f]">{result.matchedBy}</span></span>
                <ChevronRight className="size-4 text-[#596168]" />
              </button>;
            })
          ) : (
            <div className="px-4 py-10 text-center" aria-live="polite"><p className="text-sm text-[#899298]">Ничего не найдено</p><p className="mt-2 text-xs text-[#59636a]">Проверьте номер, телефон или попробуйте более короткий запрос</p></div>
          )}
        </div>
      </div>
    </div>
  );
}

const roleLabels: Record<OrganizationRole, string> = { admin: "Администратор", dispatcher: "Диспетчер", manager: "Менеджер", accountant: "Бухгалтер", master: "Мастер" };

export function AppShell({ children, currentUser }: { children: React.ReactNode; currentUser: { displayName: string; email: string; role: OrganizationRole } }) {
  const pathname = usePathname();
  const canUseQuickOrder = currentUser.role === "admin" || currentUser.role === "dispatcher";
  const navigation = currentUser.role === "master" ? masterNavigation : officeNavigation.filter((item) => {
    if (item.href === "/quick-order") return canUseQuickOrder;
    if (item.href === "/finance") return hasPermission(currentUser.role, "finance.read");
    return true;
  });
  const mobileNavigation = navigation.slice(0, 4);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="min-h-screen bg-transparent">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-20 flex-col border-r border-white/[0.06] bg-[radial-gradient(circle_at_20%_0%,rgba(102,174,243,0.055),transparent_22rem),radial-gradient(circle_at_100%_70%,rgba(156,130,232,0.035),transparent_24rem),rgba(9,13,16,0.96)] shadow-[18px_0_60px_rgba(0,0,0,0.08)] backdrop-blur-xl md:flex xl:w-56">
        <SidebarContent pathname={pathname} navigation={navigation} role={currentUser.role} />
      </aside>

      {mobileMenuOpen ? (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm md:hidden" onClick={() => setMobileMenuOpen(false)} role="presentation">
          <aside className="flex h-full w-[min(19rem,88vw)] flex-col border-r border-white/10 bg-[#090d10] shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <SidebarContent pathname={pathname} navigation={navigation} role={currentUser.role} onNavigate={() => setMobileMenuOpen(false)} expanded />
          </aside>
        </div>
      ) : null}

      <div className="md:pl-20 xl:pl-56">
        <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#070a0c]/82 backdrop-blur-2xl">
          <div className="topbar-inner flex h-16 min-w-0 items-center gap-2.5 sm:gap-3 2xl:h-[4.5rem]">
            <button onClick={() => setMobileMenuOpen(true)} className="focus-ring soft-button grid size-10 shrink-0 place-items-center rounded-[13px] text-[#8b9499] md:hidden" aria-label="Открыть меню">
              <Menu className="size-5" />
            </button>
            {currentUser.role !== "master" ? <button aria-label="Открыть глобальный поиск" onClick={() => setSearchOpen(true)} className="focus-ring soft-button flex h-10 min-w-0 flex-1 items-center gap-2 rounded-[13px] px-3 text-left text-sm text-[#737c82] max-[359px]:w-10 max-[359px]:flex-none max-[359px]:justify-center max-[359px]:px-0 sm:max-w-md 2xl:max-w-lg">
              <Search className="size-4 shrink-0" />
              <span className="tiny-hidden truncate">Поиск по всей CRM</span>
              <span className="ml-auto hidden rounded-md border border-white/[0.08] px-1.5 py-0.5 text-[10px] text-[#616a70] sm:block">Ctrl K</span>
            </button> : <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-white">Мои выезды</p><p className="mt-0.5 truncate text-[9px] text-[#687279]">Мобильное рабочее место</p></div>}
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {currentUser.role !== "master" ? <Link href="/chat" className="focus-ring soft-button hidden size-10 place-items-center rounded-[13px] text-[#8b9499] hover:text-white sm:grid" aria-label="Внутренний чат"><MessageSquare className="size-[18px]" /></Link> : null}
              <NotificationCenter />
              <details className="group relative hidden lg:block">
                <summary className="focus-ring flex cursor-pointer list-none items-center gap-2 rounded-[13px] p-1 pr-2 transition-colors hover:bg-white/[0.04] [&::-webkit-details-marker]:hidden">
                  <Avatar name={currentUser.displayName} size="sm" tone="lime" />
                  <span className="text-left"><span className="block max-w-32 truncate text-xs font-medium text-white">{currentUser.displayName}</span><span className="block text-[10px] text-[#737c82]">{roleLabels[currentUser.role]}</span></span>
                  <ChevronDown className="size-3.5 text-[#626c72] transition-transform group-open:rotate-180" />
                </summary>
                <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-64 rounded-[14px] border border-white/[0.09] bg-[#12191d] p-2 shadow-[0_22px_60px_rgba(0,0,0,0.45)]">
                  <p className="truncate px-2.5 py-2 text-[10px] text-[#758087]">{currentUser.email}</p>
                  {currentUser.role === "admin" ? <Link href="/settings" className="focus-ring flex min-h-10 items-center gap-2.5 rounded-[10px] px-2.5 text-xs text-[#a8b0b4] hover:bg-white/[0.045] hover:text-white"><Settings className="size-4" />Настройки системы</Link> : null}
                  <form action={logoutAction}><button className="focus-ring flex min-h-10 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left text-xs text-[#d8888c] hover:bg-[#ef646a]/[0.06]"><X className="size-4" />Выйти</button></form>
                </div>
              </details>
            </div>
          </div>
        </header>

        <main className={`workspace-main ${pathname === "/chat" ? "workspace-main-chat" : ""}`}>{children}</main>
      </div>

      <nav aria-label="Мобильная навигация" className={`fixed inset-x-2 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-40 grid min-w-0 ${currentUser.role === "master" ? "grid-cols-3" : "grid-cols-5"} gap-0.5 rounded-[18px] border border-white/10 bg-[#101619]/94 p-1 shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl min-[380px]:inset-x-3 min-[380px]:gap-1 min-[380px]:p-1.5 md:hidden`}>
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

      {currentUser.role !== "master" && searchOpen ? <SearchDialog onClose={() => setSearchOpen(false)} /> : null}
    </div>
  );
}
