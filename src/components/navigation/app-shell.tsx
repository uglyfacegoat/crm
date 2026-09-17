"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertCircle,
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
  Inbox,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  UserRound,
  UsersRound,
  WalletCards,
  Waypoints,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  globalSearchResponseSchema,
  type GlobalSearchResult,
} from "@/lib/global-search";
import { Avatar } from "@/components/ui/avatar";
import { useDismissableLayer } from "@/components/ui/use-dismissable-layer";
import { NotificationCenter } from "@/components/notifications/notification-center";
import { WorkspaceAssistant } from "@/components/navigation/workspace-assistant";
import { logoutAction } from "@/app/(workspace)/actions";
import type { OrganizationRole } from "@/server/auth/types";
import { hasPermission, type Permission } from "@/server/auth/permissions";

type NavigationItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  permission?: Permission;
};

const officeNavigation: NavigationItem[] = [
  { href: "/", label: "Главная", icon: LayoutDashboard },
  { href: "/orders", label: "Заказы", icon: ClipboardList, permission: "orders.read" },
  { href: "/inbox", label: "Входящие", icon: Inbox, permission: "leads.read" },
  { href: "/quick-order", label: "Оформить", icon: Zap },
  { href: "/clients", label: "Клиенты", icon: UsersRound, permission: "clients.read" },
  { href: "/calendar", label: "Календарь", icon: CalendarDays, permission: "visits.read" },
  { href: "/masters", label: "Мастера", icon: Wrench, permission: "masters.read" },
  { href: "/documents", label: "Документы", icon: FileText, permission: "documents.read" },
  { href: "/contracts", label: "Договоры", icon: FileSignature, permission: "contracts.read" },
  { href: "/finance", label: "Финансы", icon: WalletCards, permission: "finance.read" },
  { href: "/tasks", label: "Задачи", icon: CheckSquare2, permission: "tasks.read" },
  { href: "/analytics", label: "Аналитика", icon: ChartNoAxesCombined, permission: "analytics.read" },
  { href: "/sites", label: "Сайты", icon: Globe2, permission: "sites.read" },
] as const;

const masterNavigation: NavigationItem[] = [
  { href: "/my-visits", label: "Мои выезды", icon: CalendarDays, permission: "visits.read" },
  { href: "/chat", label: "Чат", icon: MessageSquare, permission: "chat.read" },
];

function isActivePath(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function LogoutButton({
  className,
  iconClassName,
  labelClassName,
  role,
}: {
  className: string;
  iconClassName: string;
  labelClassName?: string;
  role?: "menuitem";
}) {
  return (
    <form action={logoutAction}>
      <button type="submit" role={role} className={className}>
        <LogOut className={iconClassName} strokeWidth={1.7} aria-hidden="true" />
        <span className={labelClassName}>Выйти</span>
      </button>
    </form>
  );
}

function SidebarContent({
  pathname,
  navigation,
  currentUser,
  onNavigate,
  expanded = false,
  collapsed = false,
  onToggleCollapsed,
}: {
  pathname: string;
  navigation: NavigationItem[];
  currentUser: ShellUser;
  onNavigate?: () => void;
  expanded?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const role = currentUser.role;
  const compact = collapsed && !expanded;
  const labelClass = compact ? "hidden" : "block";
  const itemAlignment = compact ? "justify-center px-0" : "px-3";
  const controlClass =
    "focus-ring flex h-11 items-center text-[var(--muted)] transition-colors duration-200 hover:bg-[var(--surface-soft)] hover:text-[var(--text)]";

  return (
    <>
      {expanded ? (
        <div className="flex h-16 shrink-0 items-center justify-end border-b border-[var(--line)] px-4">
          <button
            onClick={onNavigate}
            aria-label="Закрыть меню"
            className="focus-ring rounded-xl p-2 text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
          >
            <X className="size-5" />
          </button>
        </div>
      ) : null}

      {role !== "master" || (!expanded && onToggleCollapsed) ? (
        <div className={`shrink-0 px-3 pt-3 ${compact ? "grid gap-2" : ""}`}>
          <div
            className={`flex overflow-hidden border border-[var(--line)] bg-[var(--surface)] ${compact ? "flex-col rounded-[13px]" : "rounded-[14px]"}`}
          >
          {role !== "master" && hasPermission(currentUser, "companies.read") ? (
            <Link
              href="/companies"
              onClick={onNavigate}
              aria-label="Открыть структуру компаний"
              title="Компании"
              className={`${controlClass} ${compact ? "w-full justify-center" : "min-w-0 flex-1 justify-start gap-3 px-3"}`}
            >
              <Waypoints className="size-[18px] shrink-0" strokeWidth={1.65} />
              <span
                className={
                  compact
                    ? "hidden"
                    : "block flex-1 truncate text-left text-xs font-medium text-[var(--text-secondary)]"
                }
              >
                Компании
              </span>
              {compact ? null : <ChevronRight className="size-3.5" />}
            </Link>
          ) : null}
          {!expanded && onToggleCollapsed ? (
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label={compact ? "Развернуть меню" : "Свернуть меню"}
              title={compact ? "Развернуть меню" : "Свернуть меню"}
              className={`${controlClass} grid shrink-0 place-items-center ${compact ? "w-full border-t border-[var(--line)]" : role !== "master" ? "w-11 border-l border-[var(--line)]" : "w-full"}`}
            >
              {compact ? (
                <PanelLeftOpen className="size-[18px]" strokeWidth={1.65} />
              ) : (
                <PanelLeftClose className="size-[18px]" strokeWidth={1.65} />
              )}
            </button>
          ) : null}
          </div>
        </div>
      ) : null}

      <nav
        aria-label="Основная навигация"
        className="sidebar-navigation flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain px-3 py-4"
      >
        {navigation.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={`focus-ring group flex min-h-11 items-center gap-3 rounded-[14px] ${itemAlignment} text-sm transition-[background-color,color,transform,box-shadow] duration-200 ease-out ${
                active
                  ? "bg-[var(--accent)] text-[var(--on-accent)] shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
                  : "text-[var(--muted)] hover:translate-x-0.5 hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
              }`}
            >
              <item.icon
                className={`size-[18px] shrink-0 transition-colors ${active ? "text-[var(--on-accent)]" : "text-[var(--muted)]"}`}
                strokeWidth={active ? 2.2 : 1.7}
              />
              <span className={`${labelClass} font-medium`}>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="shrink-0 space-y-1 border-t border-[var(--line)] bg-[var(--surface-raised)] p-3">
        {hasPermission(currentUser, "help.read") ? (
          <Link
            href="/help"
            onClick={onNavigate}
            aria-current={isActivePath(pathname, "/help") ? "page" : undefined}
            className={`focus-ring flex min-h-11 w-full items-center gap-3 rounded-xl ${itemAlignment} text-sm transition-colors ${isActivePath(pathname, "/help") ? "bg-[var(--surface-soft)] text-[var(--text)]" : "text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"}`}
          >
            <CircleHelp className="size-[18px]" strokeWidth={1.7} />
            <span className={labelClass}>Помощь</span>
          </Link>
        ) : null}
        {hasPermission(currentUser, "settings.write") ? (
          <Link
            href="/settings"
            onClick={onNavigate}
            aria-current={
              isActivePath(pathname, "/settings") ? "page" : undefined
            }
            className={`focus-ring flex min-h-11 w-full items-center gap-3 rounded-xl ${itemAlignment} text-sm transition-colors ${isActivePath(pathname, "/settings") ? "bg-[var(--surface-soft)] text-[var(--text)]" : "text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"}`}
          >
            <Settings className="size-[18px]" strokeWidth={1.7} />
            <span className={labelClass}>Настройки</span>
          </Link>
        ) : null}
        <LogoutButton
          className={`focus-ring flex min-h-11 w-full items-center gap-3 rounded-xl ${itemAlignment} text-left text-sm text-[var(--danger-ink)] transition-colors hover:bg-[var(--danger-bg)]`}
          iconClassName="size-[18px] shrink-0"
          labelClassName={labelClass}
        />
      </div>
    </>
  );
}

const searchTypePresentation = {
  order: {
    label: "Заказ",
    icon: ClipboardList,
    tone: "bg-[var(--accent-soft)] text-[var(--accent-ink)]",
  },
  client: {
    label: "Клиент",
    icon: UserRound,
    tone: "bg-[var(--accent-soft)] text-[var(--accent-ink)]",
  },
  object: {
    label: "Объект",
    icon: Building2,
    tone: "bg-[var(--support-soft)] text-[var(--support-strong)]",
  },
  visit: {
    label: "Выезд",
    icon: CalendarDays,
    tone: "bg-[var(--support-soft)] text-[var(--support-strong)]",
  },
  document: {
    label: "Документ",
    icon: FileText,
    tone: "bg-[var(--warning-bg)] text-[var(--warning)]",
  },
  master: {
    label: "Мастер",
    icon: Wrench,
    tone: "bg-[var(--support-soft)] text-[var(--support-strong)]",
  },
  contract: {
    label: "Договор",
    icon: FileSignature,
    tone: "bg-[var(--warning-bg)] text-[var(--warning)]",
  },
} satisfies Record<
  GlobalSearchResult["entityType"],
  { label: string; icon: typeof Search; tone: string }
>;

function SearchDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const timeoutRef = useRef<number | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      requestRef.current?.abort();
    },
    [],
  );

  async function executeSearch(nextQuery: string, controller: AbortController) {
    try {
      const response = await fetch(
        `/api/v1/search?q=${encodeURIComponent(nextQuery)}`,
        {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        },
      );
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof payload.error === "object" &&
          payload.error !== null &&
          "message" in payload.error &&
          typeof payload.error.message === "string"
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
      if (controller.signal.aborted || requestRef.current !== controller)
        return;
      setResults([]);
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Не удалось выполнить поиск.",
      );
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
    timeoutRef.current = window.setTimeout(
      () => void executeSearch(normalized, controller),
      immediate ? 0 : 220,
    );
  }

  function openResult(result: GlobalSearchResult) {
    router.push(result.href);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/72 px-2 pt-2 sm:px-4 sm:pt-[max(1rem,9vh)]"
      role="presentation"
      onMouseDown={onClose}
    >
      <div
        className="surface-panel w-full max-w-2xl bg-[var(--surface-raised)] shadow-[0_24px_70px_rgba(0,0,0,0.22)]"
        role="dialog"
        aria-modal="true"
        aria-label="Глобальный поиск"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <label className="flex items-center gap-3 border-b border-[var(--line)] px-4">
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
                setActiveIndex(
                  (current) => (current - 1 + results.length) % results.length,
                );
              } else if (event.key === "Enter") {
                event.preventDefault();
                openResult(results[activeIndex] ?? results[0]);
              }
            }}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={results.length > 0}
            aria-controls="global-search-results"
            aria-activedescendant={
              results[activeIndex]
                ? `global-search-result-${activeIndex}`
                : undefined
            }
            placeholder="Клиент, заказ, документ, адрес или дата"
            className="h-14 min-w-0 flex-1 bg-transparent text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)] sm:h-16"
          />
          <button
            onClick={onClose}
            aria-label="Закрыть поиск"
            className="focus-ring rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
          >
            <X className="size-4" />
          </button>
        </label>
        <div
          id="global-search-results"
          role="listbox"
          className="max-h-[min(34rem,calc(100dvh-5rem))] overflow-y-auto p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {!query.trim() ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm text-[var(--text-secondary)]">
                Ищите по всей рабочей базе
              </p>
              <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                Клиент, ИНН, телефон, заказ, объект, документ, мастер или дата
                выезда
              </p>
            </div>
          ) : query.trim().length < 2 ? (
            <p className="px-3 py-9 text-center text-sm text-[var(--muted)]">
              Введите ещё один символ
            </p>
          ) : status === "loading" ? (
            <div
              className="flex items-center justify-center gap-2 px-3 py-10 text-sm text-[var(--muted)]"
              aria-live="polite"
            >
              <LoaderCircle className="size-4 animate-spin text-[var(--accent)]" />
              Ищу в рабочей базе…
            </div>
          ) : status === "error" ? (
            <div
              className="flex flex-col items-center px-4 py-9 text-center"
              aria-live="polite"
            >
              <span className="grid size-10 place-items-center rounded-full bg-[var(--danger-bg)] text-[var(--danger-ink)]">
                <AlertCircle className="size-4" />
              </span>
              <p className="mt-3 text-sm text-[var(--text-secondary)]">
                {errorMessage}
              </p>
              <button
                type="button"
                onClick={() => scheduleSearch(query, true)}
                className="focus-ring mt-4 rounded-[10px] border border-[var(--line-strong)] px-3 py-2 text-xs text-[var(--text)] hover:bg-[var(--surface-soft)]"
              >
                Повторить
              </button>
            </div>
          ) : results.length ? (
            results.map((result, index) => {
              const presentation = searchTypePresentation[result.entityType];
              const Icon = presentation.icon;
              return (
                <button
                  id={`global-search-result-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  key={`${result.entityType}-${result.id}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => openResult(result)}
                  className={`focus-ring flex w-full items-center gap-3 rounded-[13px] px-3 py-3 text-left transition-colors ${index === activeIndex ? "bg-[var(--surface-soft)]" : "hover:bg-[var(--surface-soft)]"}`}
                >
                  <span
                    className={`grid size-10 shrink-0 place-items-center rounded-[12px] ${presentation.tone}`}
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-[var(--text)]">
                      {result.title}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-[var(--muted)]">
                      {result.subtitle}
                    </span>
                    {result.detail ? (
                      <span className="mt-1 block truncate text-[10px] text-[var(--muted-subtle)]">
                        {result.detail}
                      </span>
                    ) : null}
                  </span>
                  <span className="tiny-hidden text-right">
                    <span className="block text-[9px] uppercase tracking-[0.12em] text-[var(--muted)]">
                      {presentation.label}
                    </span>
                    <span className="mt-1 block text-[9px] text-[var(--muted-subtle)]">
                      {result.matchedBy}
                    </span>
                  </span>
                  <ChevronRight className="size-4 text-[var(--muted)]" />
                </button>
              );
            })
          ) : (
            <div className="px-4 py-10 text-center" aria-live="polite">
              <p className="text-sm text-[var(--text-secondary)]">
                Ничего не найдено
              </p>
              <p className="mt-2 text-xs text-[var(--muted)]">
                Проверьте номер, телефон или попробуйте более короткий запрос
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const roleLabels: Record<OrganizationRole, string> = {
  developer: "Разработчик",
  admin: "Администратор",
  dispatcher: "Диспетчер",
  manager: "Менеджер",
  accountant: "Бухгалтер",
  master: "Мастер",
};

type ShellUser = {
  displayName: string;
  email: string;
  role: OrganizationRole;
  permissionOverrides: Record<string, boolean>;
};

function ProfileMenu({ currentUser }: { currentUser: ShellUser }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useDismissableLayer(menuRef, open, () => setOpen(false));

  return (
    <div ref={menuRef} className="relative hidden lg:block">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="focus-ring flex items-center gap-2 rounded-[13px] p-1 pr-2 transition-colors hover:bg-[var(--surface-soft)]"
      >
        <Avatar name={currentUser.displayName} size="sm" tone="lime" />
        <span className="text-left">
          <span className="block max-w-32 truncate text-xs font-medium text-[var(--text)]">
            {currentUser.displayName}
          </span>
          <span className="block text-[10px] text-[var(--muted)]">
            {roleLabels[currentUser.role]}
          </span>
        </span>
        <ChevronDown
          className={`size-3.5 text-[var(--muted)] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-64 rounded-[14px] border border-[var(--line-strong)] bg-[var(--surface-raised)] p-2 shadow-[0_22px_60px_rgba(0,0,0,0.18)]"
        >
          <p className="truncate px-2.5 py-2 text-[10px] text-[var(--muted)]">
            {currentUser.email}
          </p>
          {hasPermission(currentUser, "settings.write") ? (
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              role="menuitem"
              className="focus-ring flex min-h-10 items-center gap-2.5 rounded-[11px] px-2.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
            >
              <Settings className="size-4" />
              Настройки системы
            </Link>
          ) : null}
          <LogoutButton
            role="menuitem"
            className="focus-ring flex min-h-10 w-full items-center gap-2.5 rounded-[11px] px-2.5 text-left text-xs text-[var(--danger-ink)] hover:bg-[var(--danger-bg)]"
            iconClassName="size-4 shrink-0"
          />
        </div>
      ) : null}
    </div>
  );
}

export function AppShell({
  children,
  currentUser,
}: {
  children: React.ReactNode;
  currentUser: ShellUser;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const canUseQuickOrder =
    hasPermission(currentUser, "clients.write") &&
    hasPermission(currentUser, "orders.write") &&
    hasPermission(currentUser, "visits.write");
  const navigation =
    currentUser.role === "master"
      ? masterNavigation
      : officeNavigation.filter((item) => {
          if (item.href === "/quick-order") return canUseQuickOrder;
          return item.permission
            ? hasPermission(currentUser, item.permission)
            : true;
        });
  const mobileNavigation = navigation.slice(0, 4);
  const chatActive = isActivePath(pathname, "/chat");
  const developerSupportActive = isActivePath(pathname, "/developer/support");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  function toggleSidebar() {
    setSidebarCollapsed((current) => !current);
  }

  function openDeveloperSupportQueue() {
    const supportWindow = window.open(
      "/developer/support",
      "crm-developer-support",
      "popup,width=1440,height=920,resizable=yes,scrollbars=yes",
    );
    if (!supportWindow) {
      router.push("/developer/support");
      return;
    }
    supportWindow.opener = null;
    supportWindow.focus();
  }

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
      <aside
        className={`fixed inset-y-0 left-0 z-30 hidden flex-col overflow-hidden border-r border-[var(--line)] bg-[var(--surface-raised)] backdrop-blur-xl transition-[width] duration-200 md:flex ${sidebarCollapsed ? "w-20" : "w-56"}`}
      >
        <SidebarContent
          pathname={pathname}
          navigation={navigation}
          currentUser={currentUser}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={toggleSidebar}
        />
      </aside>

      {mobileMenuOpen ? (
        <div
          className="fixed inset-0 z-50 bg-black/70 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
          role="presentation"
        >
          <aside
            className="flex h-full w-[min(19rem,88vw)] flex-col overflow-hidden border-r border-[var(--line-strong)] bg-[var(--surface-raised)] shadow-[0_20px_60px_rgba(0,0,0,0.24)]"
            onClick={(event) => event.stopPropagation()}
          >
            <SidebarContent
              pathname={pathname}
              navigation={navigation}
              currentUser={currentUser}
              onNavigate={() => setMobileMenuOpen(false)}
              expanded
            />
          </aside>
        </div>
      ) : null}

      <div
        className={`transition-[padding-left] duration-200 ${sidebarCollapsed ? "md:pl-20" : "md:pl-56"}`}
      >
        <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--canvas)]">
          <div className="topbar-inner flex h-16 min-w-0 items-center gap-2.5 sm:gap-3 2xl:h-[4.5rem]">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="focus-ring soft-button grid size-10 shrink-0 place-items-center rounded-[13px] text-[var(--muted)] md:hidden"
              aria-label="Открыть меню"
            >
              <Menu className="size-5" />
            </button>
            {hasPermission(currentUser, "search.use") ? (
              <button
                aria-label="Открыть глобальный поиск"
                onClick={() => setSearchOpen(true)}
                className="focus-ring soft-button flex h-10 min-w-0 flex-1 items-center gap-2 rounded-[13px] px-3 text-left text-sm text-[var(--muted)] max-[359px]:w-10 max-[359px]:flex-none max-[359px]:justify-center max-[359px]:px-0 sm:max-w-md 2xl:max-w-lg"
              >
                <Search className="size-4 shrink-0" />
                <span className="tiny-hidden truncate">Поиск по всей CRM</span>
                <span className="ml-auto hidden rounded-md border border-[var(--line)] px-1.5 py-0.5 text-[10px] text-[var(--muted)] sm:block">
                  Ctrl K
                </span>
              </button>
            ) : (
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-[var(--text)]">
                  {currentUser.role === "master" ? "Мои выезды" : "Рабочая CRM"}
                </p>
                <p className="mt-0.5 truncate text-[9px] text-[var(--muted)]">
                  {currentUser.role === "master"
                    ? "Мобильное рабочее место"
                    : "Глобальный поиск отключён"}
                </p>
              </div>
            )}
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {hasPermission(currentUser, "chat.read") ? (
                <Link
                  href="/chat"
                  aria-current={chatActive ? "page" : undefined}
                  className={`focus-ring grid size-10 place-items-center rounded-[13px] transition-colors ${chatActive ? "border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "soft-button text-[var(--muted)] hover:text-[var(--text)]"}`}
                  aria-label="Внутренний чат"
                >
                  <MessageSquare
                    className="size-[18px]"
                    strokeWidth={chatActive ? 2.1 : 1.7}
                  />
                </Link>
              ) : null}
              {hasPermission(currentUser, "assistant.use") ? (
                <WorkspaceAssistant />
              ) : null}
              {hasPermission(currentUser, "support.manage") ? (
                <button
                  type="button"
                  onClick={openDeveloperSupportQueue}
                  aria-label="Открыть очередь обращений"
                  title="Очередь обращений"
                  className={`focus-ring grid size-10 place-items-center rounded-[13px] transition-colors ${developerSupportActive ? "border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "soft-button text-[var(--muted)] hover:text-[var(--text)]"}`}
                >
                  <CircleHelp
                    className="size-[18px]"
                    strokeWidth={developerSupportActive ? 2.1 : 1.7}
                  />
                </button>
              ) : null}
              {hasPermission(currentUser, "notifications.read") ? (
                <NotificationCenter />
              ) : null}
              <ProfileMenu currentUser={currentUser} />
            </div>
          </div>
        </header>

        <main
          className={`workspace-main ${pathname === "/chat" ? "workspace-main-chat" : ""}`}
        >
          {children}
        </main>
      </div>

      <nav
        aria-label="Мобильная навигация"
        className={`fixed inset-x-2 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-40 grid min-w-0 ${currentUser.role === "master" ? "grid-cols-3" : "grid-cols-5"} gap-0.5 rounded-[18px] border border-[var(--line-strong)] bg-[var(--surface-raised)]/94 p-1 shadow-[0_18px_60px_rgba(0,0,0,0.22)] backdrop-blur-2xl min-[380px]:inset-x-3 min-[380px]:gap-1 min-[380px]:p-1.5 md:hidden`}
      >
        {mobileNavigation.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`focus-ring flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-[13px] px-0.5 text-[8px] transition-colors min-[360px]:text-[9px] ${active ? "bg-[var(--accent)] text-[var(--on-accent)]" : "text-[var(--muted)]"}`}
            >
              <item.icon
                className="size-[17px] shrink-0 min-[360px]:size-[18px]"
                strokeWidth={active ? 2.3 : 1.7}
              />
              <span className="block w-full truncate text-center">
                {item.label}
              </span>
            </Link>
          );
        })}
        <button
          onClick={() => setMobileMenuOpen(true)}
          className="focus-ring flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-[13px] px-0.5 text-[8px] text-[var(--muted)] min-[360px]:text-[9px]"
        >
          <Menu
            className="size-[17px] shrink-0 min-[360px]:size-[18px]"
            strokeWidth={1.7}
          />
          <span className="block w-full truncate text-center">Ещё</span>
        </button>
      </nav>

      {hasPermission(currentUser, "search.use") && searchOpen ? (
        <SearchDialog onClose={() => setSearchOpen(false)} />
      ) : null}
    </div>
  );
}
