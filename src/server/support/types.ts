export type SupportRequestStatus = "new" | "in_progress" | "resolved" | "closed";

export type SupportCenterSnapshot = {
  administrators: Array<{ id: string; name: string; email: string }>;
  requests: Array<{
    id: string;
    category: "usability" | "data" | "access" | "technical";
    subject: string;
    status: SupportRequestStatus;
    createdAt: string;
  }>;
};
