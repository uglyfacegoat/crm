export const screenLabels = {
  home: "Главная",
  orders: "Заказы",
  inbox: "Входящие",
  quick_order: "Оформление",
  clients: "Клиенты",
  calendar: "Календарь",
  masters: "Мастера",
  my_visits: "Мои выезды",
  documents: "Документы",
  contracts: "Договоры",
  finance: "Финансы",
  tasks: "Задачи",
  workflow: "Воркфлоу",
  analytics: "Аналитика",
  sites: "Сайты",
  chat: "Чат",
  notifications: "Уведомления",
  profile: "Мой профиль",
  settings: "Настройки",
  help: "Помощь",
  developer: "Разработчик",
} as const;

export type ScreenKey = keyof typeof screenLabels;

const pathScreens: Record<string, ScreenKey> = {
  orders: "orders", inbox: "inbox", "quick-order": "quick_order",
  clients: "clients", calendar: "calendar", masters: "masters",
  "my-visits": "my_visits", documents: "documents", contracts: "contracts",
  finance: "finance", tasks: "tasks", workflow: "workflow", analytics: "analytics",
  sites: "sites", chat: "chat", notifications: "notifications",
  profile: "profile", settings: "settings", help: "help", developer: "developer",
};

export function screenForPath(pathname: string): ScreenKey | null {
  if (pathname === "/") return "home";
  return pathScreens[pathname.split("/")[1]] ?? null;
}

export function isScreenKey(value: unknown): value is ScreenKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(screenLabels, value);
}
