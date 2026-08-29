export type OrderEconomicsInput = {
  agreedTotalMinor: bigint;
  invoicedTotalMinor: bigint;
  paidTotalMinor: bigint;
  masterPaymentsMinor: readonly bigint[];
  directExpensesMinor: readonly bigint[];
};

export type OrderEconomics = {
  agreedTotalMinor: bigint;
  invoicedTotalMinor: bigint;
  paidTotalMinor: bigint;
  masterPaymentsMinor: bigint;
  directExpensesMinor: bigint;
  projectedOperatingContributionMinor: bigint;
  realizedOperatingContributionMinor: bigint;
  outstandingInvoiceMinor: bigint;
};

function assertNonNegative(label: string, values: readonly bigint[]) {
  if (values.some((value) => value < 0n)) {
    throw new RangeError(`${label} cannot contain negative values.`);
  }
}

export function calculateOrderEconomics(input: OrderEconomicsInput): OrderEconomics {
  assertNonNegative("Order totals", [input.agreedTotalMinor, input.invoicedTotalMinor, input.paidTotalMinor]);
  assertNonNegative("Master payments", input.masterPaymentsMinor);
  assertNonNegative("Direct expenses", input.directExpensesMinor);

  const masterPaymentsMinor = input.masterPaymentsMinor.reduce((total, amount) => total + amount, 0n);
  const directExpensesMinor = input.directExpensesMinor.reduce((total, amount) => total + amount, 0n);

  return {
    agreedTotalMinor: input.agreedTotalMinor,
    invoicedTotalMinor: input.invoicedTotalMinor,
    paidTotalMinor: input.paidTotalMinor,
    masterPaymentsMinor,
    directExpensesMinor,
    projectedOperatingContributionMinor: input.agreedTotalMinor - masterPaymentsMinor - directExpensesMinor,
    realizedOperatingContributionMinor: input.paidTotalMinor - masterPaymentsMinor - directExpensesMinor,
    outstandingInvoiceMinor: input.invoicedTotalMinor - input.paidTotalMinor,
  };
}
