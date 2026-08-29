import assert from "node:assert/strict";
import test from "node:test";
import { calculateOrderEconomics } from "./order-economics.ts";

test("calculates projected and realized order economics independently", () => {
  const economics = calculateOrderEconomics({
    agreedTotalMinor: 2_500_000n,
    invoicedTotalMinor: 2_500_000n,
    paidTotalMinor: 1_500_000n,
    masterPaymentsMinor: [400_000n],
    directExpensesMinor: [120_000n, 60_000n],
  });

  assert.equal(economics.masterPaymentsMinor, 400_000n);
  assert.equal(economics.directExpensesMinor, 180_000n);
  assert.equal(economics.projectedOperatingContributionMinor, 1_920_000n);
  assert.equal(economics.realizedOperatingContributionMinor, 920_000n);
  assert.equal(economics.outstandingInvoiceMinor, 1_000_000n);
});

test("rejects negative monetary input", () => {
  assert.throws(() => calculateOrderEconomics({
    agreedTotalMinor: 1_000n,
    invoicedTotalMinor: 1_000n,
    paidTotalMinor: 1_000n,
    masterPaymentsMinor: [],
    directExpensesMinor: [-1n],
  }), RangeError);
});
