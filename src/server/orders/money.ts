const moneyPattern = /^\d{1,11}(?:[.,]\d{1,2})?$/;
const quantityPattern = /^\d{1,9}(?:[.,]\d{1,3})?$/;

function parseFixedPoint(value: string, fractionDigits: number, pattern: RegExp, label: string) {
  const normalized = value.replace(/[\s\u00a0]/g, "").replace(",", ".");
  if (!pattern.test(normalized)) throw new RangeError(`${label} has an invalid format.`);
  const [whole, fraction = ""] = normalized.split(".");
  return BigInt(whole) * 10n ** BigInt(fractionDigits) + BigInt(fraction.padEnd(fractionDigits, "0"));
}

export function parseMoneyToMinorUnits(value: string) {
  return parseFixedPoint(value, 2, moneyPattern, "Money");
}

export function parseQuantityToMilliunits(value: string) {
  const quantity = parseFixedPoint(value, 3, quantityPattern, "Quantity");
  if (quantity === 0n) throw new RangeError("Quantity must be greater than zero.");
  return quantity;
}

export function calculateServiceLineTotalMinor(unitPriceMinor: bigint, quantityMilliunits: bigint) {
  if (unitPriceMinor < 0n || quantityMilliunits <= 0n) throw new RangeError("Service price and quantity are outside the allowed range.");
  return (unitPriceMinor * quantityMilliunits + 500n) / 1000n;
}

export function formatQuantityForDatabase(quantityMilliunits: bigint) {
  const whole = quantityMilliunits / 1000n;
  const fraction = String(quantityMilliunits % 1000n).padStart(3, "0");
  return `${whole}.${fraction}`;
}

export function minorUnitsToSafeNumber(value: bigint | string | number) {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) {
    throw new RangeError("Monetary value exceeds the supported UI range.");
  }
  const parsed = typeof value === "bigint" ? value : BigInt(value);
  const converted = Number(parsed);
  if (!Number.isSafeInteger(converted)) throw new RangeError("Monetary value exceeds the supported UI range.");
  return converted;
}
