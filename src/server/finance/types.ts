export const paymentMethods = ["bank_transfer", "cash", "card", "other"] as const;
export type PaymentMethod = (typeof paymentMethods)[number];

export type FinancePayment = {
  id: string;
  amountMinor: number;
  receivedOn: string;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
  status: "posted" | "reversed";
  reversalReason: string | null;
  version: number;
};

export type FinanceInvoice = {
  id: string;
  number: string;
  amountMinor: number;
  paidMinor: number;
  outstandingMinor: number;
  issuedOn: string;
  dueOn: string;
  status: "issued" | "void";
  overdue: boolean;
  note: string | null;
  voidReason: string | null;
  version: number;
  payments: FinancePayment[];
};

export type FinancePayout = {
  id: string;
  orderId: string;
  orderNumber: string;
  masterId: string;
  masterName: string;
  amountMinor: number;
  paidOn: string;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
  status: "posted" | "reversed";
  reversalReason: string | null;
  version: number;
};

export type FinanceOrder = {
  id: string;
  number: string;
  client: string;
  object: string;
  status: string;
  agreedMinor: number;
  invoicedMinor: number;
  paidMinor: number;
  receivableMinor: number;
  masterId: string | null;
  masterName: string | null;
  masterAccruedMinor: number;
  masterPaidMinor: number;
  masterDueMinor: number;
  invoices: FinanceInvoice[];
};

export type FinanceSnapshot = {
  today: string;
  orders: FinanceOrder[];
  payouts: FinancePayout[];
  summary: {
    agreedMinor: number;
    invoicedMinor: number;
    receivedMinor: number;
    receivableMinor: number;
    overdueMinor: number;
    masterAccruedMinor: number;
    masterPaidMinor: number;
    masterDueMinor: number;
  };
};
