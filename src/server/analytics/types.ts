export const analyticsRanges = [30, 90, 365] as const;
export type AnalyticsRange = (typeof analyticsRanges)[number];

export type ChartSeries = {
  label: string;
  color: string;
  values: number[];
  valueFormat?: "money" | "integer";
};

export type AnalyticsMetric = {
  id: "agreed" | "paid" | "orders" | "visits" | "clients" | "average_order";
  label: string;
  value: number;
  format: "money" | "integer";
  change: string;
  tone: "lime" | "mint" | "violet" | "amber";
};

export type AnalyticsSnapshot = {
  range: {
    days: AnalyticsRange;
    startDate: string;
    endDate: string;
    timezone: string;
  };
  metrics: AnalyticsMetric[];
  financialTrend: { labels: string[]; series: ChartSeries[] };
  orderStages: Array<{ label: string; value: number; percent: number }>;
  serviceMix: Array<{ label: string; percent: number; amountMinor: number; color: string }>;
  teamPerformance: Array<{ id: string; name: string; visits: number; completion: number; orderValueMinor: number }>;
  topClients: Array<{ id: string; name: string; orders: number; agreedMinor: number }>;
  repeatClientRate: number;
  repeatClientCounts: { repeat: number; firstTime: number };
  completedVisitRate: number;
  visitActivity: Array<{ key: string; label: string; value: number }>;
  orderStatusBreakdown: Array<{
    id: "new" | "in_progress" | "scheduled" | "approved" | "completed" | "cancelled";
    label: string;
    value: number;
  }>;
};
