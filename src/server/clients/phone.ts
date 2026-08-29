export function normalizeContactPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) return `+7${digits.slice(1)}`;
  if (digits.length === 10) return `+7${digits}`;
  return `+${digits}`;
}

export function isValidContactPhone(phone: string) {
  return /^\+[0-9]{10,15}$/.test(normalizeContactPhone(phone));
}
