export const contractStatuses = ["draft", "active", "suspended", "completed", "cancelled"] as const;
export type ContractStatus = (typeof contractStatuses)[number];

export type ContractSchedule = {
  id: string;
  frequencyUnit: "week" | "month";
  frequencyInterval: number;
  localTime: string;
  durationMinutes: number;
  defaultMasterId: string | null;
  defaultMasterName: string | null;
  visitCount: number;
};

export type ContractListItem = {
  id: string;
  contractNumber: string;
  clientId: string;
  clientName: string;
  objectId: string;
  objectName: string;
  objectAddress: string;
  status: ContractStatus;
  startsOn: string;
  endsOn: string;
  renewalNoticeDays: number;
  notes: string | null;
  version: number;
  renewedFromContractId: string | null;
  renewedByContractId: string | null;
  daysUntilEnd: number;
  nextVisitAt: string | null;
  schedule: ContractSchedule | null;
};

export type ContractObjectOption = {
  id: string;
  clientId: string;
  clientName: string;
  name: string;
  address: string;
};

export type ContractMasterOption = { id: string; name: string; region: string };

export type ContractHistoryEvent = {
  id: string;
  eventType: "created" | "updated" | "status_changed" | "renewed";
  actorName: string | null;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown>;
  reason: string | null;
  createdAt: string;
};

export type ContractSnapshot = {
  contracts: ContractListItem[];
  objectOptions: ContractObjectOption[];
  masterOptions: ContractMasterOption[];
  summary: { total: number; active: number; expiring: number; scheduledVisits: number };
};
