export function formatPhoneInput(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  const normalized = digits.startsWith("8") ? `7${digits.slice(1)}` : digits.startsWith("7") ? digits : `7${digits}`;
  const limited = normalized.slice(0, 11);
  if (limited.length <= 1) return limited ? "+7" : "";

  const subscriber = limited.slice(1);
  const area = subscriber.slice(0, 3);
  const first = subscriber.slice(3, 6);
  const second = subscriber.slice(6, 8);
  const third = subscriber.slice(8, 10);
  return `+7${area ? ` (${area}` : ""}${area.length === 3 ? ")" : ""}${first ? ` ${first}` : ""}${second ? `-${second}` : ""}${third ? `-${third}` : ""}`;
}
