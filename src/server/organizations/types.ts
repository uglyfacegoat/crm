export type OrganizationOption = {
  id: string;
  name: string;
  kind: "center" | "company";
  current: boolean;
};

export type OrganizationSummary = OrganizationOption & {
  clientCount: number;
  orderCount: number;
  activeOrderCount: number;
  upcomingVisitCount: number;
  openTaskCount: number;
  receivedMinor: number | null;
};
