export type OrganizationUnit = {
  id: string;
  name: string;
  kind: "city" | "area";
  parentId: string | null;
  address: string | null;
};

export type OrganizationOption = {
  id: string;
  name: string;
  kind: "center" | "company";
  current: boolean;
  units: OrganizationUnit[];
};

export type OrganizationSummary = Omit<OrganizationOption, "units"> & {
  clientCount: number;
  orderCount: number;
  activeOrderCount: number;
  upcomingVisitCount: number;
  openTaskCount: number;
  receivedMinor: number | null;
};
