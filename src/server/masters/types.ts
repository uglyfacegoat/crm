export const masterOperationalStatuses = ["working", "vacation", "unavailable", "terminated"] as const;
export type MasterOperationalStatus = (typeof masterOperationalStatuses)[number];

export const masterStatusCodes = ["scheduled", "available", "overloaded", "vacation", "unavailable", "terminated"] as const;
export type MasterStatusCode = (typeof masterStatusCodes)[number];

export type MasterVisitSummary = {
  id: string;
  orderId: string;
  orderNumber: string;
  clientName: string;
  objectAddress: string;
  scheduledStartAt: string;
  timezone: string;
};

export type MasterListItem = {
  id: string;
  fullName: string;
  phone: string;
  messenger: string | null;
  serviceRegion: string;
  serviceZone: string;
  basePaymentMinor?: number | null;
  dailyCapacity: number;
  skills: string[];
  notes: string | null;
  operationalStatus: MasterOperationalStatus;
  workingDays: number[];
  statusUntil: string | null;
  statusNote: string | null;
  active: boolean;
  version: number;
  todayVisitCount: number;
  loadPercent: number;
  statusCode: MasterStatusCode;
  statusLabel: string;
  todayVisits: MasterVisitSummary[];
};

export type MasterDetailVisit = MasterVisitSummary & {
  objectName: string;
  statusCode: "planned" | "confirmed" | "in_progress" | "completed" | "cancelled";
  status: string;
};

export type MasterDetail = MasterListItem & {
  totalVisits: number;
  completedVisits: number;
  upcomingVisits: number;
  totalOrders: number;
  accruedMinor?: number;
  paidMinor?: number;
  recentVisits: MasterDetailVisit[];
};
