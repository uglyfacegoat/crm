export const masterStatusCodes = ["scheduled", "available", "overloaded", "inactive"] as const;
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
  active: boolean;
  version: number;
  todayVisitCount: number;
  loadPercent: number;
  statusCode: MasterStatusCode;
  statusLabel: string;
  todayVisits: MasterVisitSummary[];
};
