export const incomingLeadStatuses = ["new", "reviewing", "accepted", "rejected"] as const;
export type IncomingLeadStatus = (typeof incomingLeadStatuses)[number];

export const incomingLeadStatusLabels: Record<IncomingLeadStatus, string> = {
  new: "Новая",
  reviewing: "На проверке",
  accepted: "Принята",
  rejected: "Отклонена",
};

export type IncomingLead = {
  id: string;
  websiteId: string;
  websiteName: string;
  websiteDomain: string;
  externalEventId: string;
  receivedAt: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  serviceInterest: string | null;
  landingUrl: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
  status: IncomingLeadStatus;
  reviewNote: string | null;
  reviewerName: string | null;
  reviewedAt: string | null;
  version: number;
  orderId: string | null;
  orderNumber: string | null;
  possibleClientId: string | null;
  possibleClientName: string | null;
};

export type IncomingLeadSnapshot = {
  leads: IncomingLead[];
  counts: Record<IncomingLeadStatus | "all", number>;
};

export type IncomingLeadPrefill = {
  sourceLeadId: string;
  sourceLeadVersion: number;
  possibleClientId: string | null;
  contactName: string;
  phone: string;
  email: string;
  serviceInterest: string;
  orderNotes: string;
};
