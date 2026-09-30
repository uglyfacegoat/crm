export type SupportRequestStatus = "new" | "in_progress" | "resolved" | "closed";
export type SupportRequestCategory = "usability" | "data" | "access" | "technical";

export type SupportCenterSnapshot = {
  developers: Array<{ email: string; name: string }>;
  requests: Array<{
    id: string;
    category: SupportRequestCategory;
    subject: string;
    status: SupportRequestStatus;
    createdAt: string;
  }>;
};

export type DeveloperSupportTicket = {
  id: string;
  organizationName: string;
  requesterName: string;
  requesterEmail: string;
  category: SupportRequestCategory;
  subject: string;
  description: string;
  status: SupportRequestStatus;
  createdAt: string;
  updatedAt: string;
  handledByEmail: string | null;
  version: number;
};

export type DeveloperSupportQueue = {
  tickets: DeveloperSupportTicket[];
  counts: Record<SupportRequestStatus | "all", number>;
};
