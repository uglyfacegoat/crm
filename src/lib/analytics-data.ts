import type { ChartSeries } from "@/server/analytics/types";

export const analyticsSummary = [
  { label: "Выручка", value: "1,25 млн ₽", change: "+18,2%", tone: "lime" as const },
  { label: "Заказов", value: "47", change: "+12,1%", tone: "violet" as const },
  { label: "Выездов", value: "124", change: "+9,4%", tone: "mint" as const },
  { label: "Новых клиентов", value: "18", change: "+20,0%", tone: "amber" as const },
  { label: "Средний чек", value: "24 510 ₽", change: "+6,8%", tone: "violet" as const },
  { label: "Конверсия в заказ", value: "31,6%", change: "+3,1 п.п.", tone: "amber" as const },
];

export const financialChart = {
  labels: ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг"],
  series: [
    { label: "Выручка", color: "#edf43b", values: [680, 745, 720, 860, 940, 1010, 1140, 1250] },
    { label: "Опер. остаток", color: "#69d3a4", values: [352, 398, 376, 472, 535, 602, 676, 742] },
  ] satisfies ChartSeries[],
};

export const salesFunnel = [
  { label: "Новые обращения", value: 158, percent: 100 },
  { label: "Квалифицированы", value: 112, percent: 71 },
  { label: "Расчёт отправлен", value: 79, percent: 50 },
  { label: "Заказ подтверждён", value: 50, percent: 32 },
];

export const serviceMix = [
  { label: "Дезинсекция", value: 38, color: "#edf43b" },
  { label: "Дератизация", value: 27, color: "#9c82e8" },
  { label: "Дезинфекция", value: 21, color: "#69d3a4" },
  { label: "Утилизация", value: 14, color: "#ef8d68" },
];

export const teamPerformance = [
  { name: "Алексей Смирнов", visits: 38, completion: 96, revenue: "318 000 ₽" },
  { name: "Дмитрий Кузнецов", visits: 34, completion: 91, revenue: "286 500 ₽" },
  { name: "Сергей Волков", visits: 29, completion: 88, revenue: "249 000 ₽" },
  { name: "Иван Петров", visits: 27, completion: 84, revenue: "221 000 ₽" },
];

export const connectedSites = [
  {
    id: "site-1",
    name: "Городская дезслужба",
    domain: "dez-control.ru",
    status: "connected" as const,
    health: 98,
    visitors: "18 420",
    leads: "286",
    conversion: "1,55%",
    change: "+22%",
    integrations: ["Метрика", "Вебмастер"],
  },
  {
    id: "site-2",
    name: "Контроль грызунов",
    domain: "stop-rodent.ru",
    status: "connected" as const,
    health: 92,
    visitors: "9 870",
    leads: "194",
    conversion: "1,97%",
    change: "+14%",
    integrations: ["GA4", "Search Console"],
  },
  {
    id: "site-3",
    name: "Утилизация для бизнеса",
    domain: "eco-util.ru",
    status: "attention" as const,
    health: 71,
    visitors: "4 630",
    leads: "61",
    conversion: "1,32%",
    change: "−6%",
    integrations: ["Метрика"],
  },
  {
    id: "site-4",
    name: "Новый региональный сайт",
    domain: "podolsk-dez.ru",
    status: "setup" as const,
    health: 0,
    visitors: "—",
    leads: "—",
    conversion: "—",
    change: "Ожидает данных",
    integrations: [],
  },
];

export const siteTrafficChart = {
  labels: ["1 авг", "5 авг", "9 авг", "13 авг", "17 авг", "21 авг", "25 авг"],
  series: [
    { label: "Посетители", color: "#edf43b", values: [820, 1010, 940, 1230, 1180, 1420, 1570] },
    { label: "Целевые действия", color: "#9c82e8", values: [32, 41, 38, 55, 51, 67, 74] },
  ] satisfies ChartSeries[],
};

export const trafficSources = [
  { label: "Органический поиск", value: 46, amount: "15 142" },
  { label: "Реклама", value: 28, amount: "9 217" },
  { label: "Прямые заходы", value: 17, amount: "5 596" },
  { label: "Карты и каталоги", value: 9, amount: "2 965" },
];
