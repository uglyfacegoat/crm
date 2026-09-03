import { z } from "zod";
import { websiteProviders } from "./types.ts";
import { parseMoneyToMinorUnits } from "../orders/money.ts";

const domainPattern = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/;

export const createWebsiteSchema = z.object({
  idempotencyKey: z.string().uuid(),
  name: z.string().trim().min(2, "Введите название сайта").max(200),
  domain: z.string().trim().toLowerCase().max(253).regex(domainPattern, "Укажите домен без протокола, пути и параметров"),
});

export const configureWebsiteIntegrationSchema = z.object({
  idempotencyKey: z.string().uuid(),
  websiteId: z.string().uuid(),
  provider: z.enum(websiteProviders),
  propertyId: z.string().trim().min(1, "Укажите ID счётчика или ресурса").max(200),
  secretReference: z.string().trim().regex(/^[A-Z][A-Z0-9_]{2,127}$/, "Используйте имя переменной секрета в UPPER_SNAKE_CASE"),
});

const money = z.string().trim().refine((value) => {
  try { return parseMoneyToMinorUnits(value) <= 10_000_000_00n; } catch { return false; }
}, "Укажите сумму до 10 млн ₽").transform((value) => Number(parseMoneyToMinorUnits(value)));
const optionalText = (maximum: number) => z.string().trim().max(maximum).transform((value) => value || null);
const numericInput = (schema: z.ZodNumber) => z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().replace(/[\s\u00a0]/g, "").replace(",", ".");
  return normalized ? Number(normalized) : Number.NaN;
}, schema);

export const updateWebsiteInfrastructureSchema = z.object({
  websiteId: z.string().uuid(),
  expectedVersion: numericInput(z.number().int().positive()),
  status: z.enum(["setup", "active", "attention", "disabled"]),
  hostingProvider: z.string().trim().min(2, "Укажите хостинг").max(160),
  planName: z.string().trim().min(2, "Укажите тариф").max(160),
  serverRegion: z.string().trim().min(2, "Укажите регион").max(160),
  monthlyCostMinor: money,
  renewalOn: z.iso.date(),
  sslExpiresOn: z.iso.date(),
  diskCapacityMb: numericInput(z.number().int().min(128).max(100_000_000)),
  memoryCapacityMb: numericInput(z.number().int().min(64).max(10_000_000)),
  notes: optionalText(4_000),
  healthStatus: z.enum(["healthy", "degraded", "down"]),
  uptimePercent: numericInput(z.number().min(0).max(100)),
  responseTimeMs: numericInput(z.number().int().min(0).max(600_000)),
  cpuLoadPercent: numericInput(z.number().min(0).max(100)),
  memoryUsedMb: numericInput(z.number().int().min(0)),
  diskUsedMb: numericInput(z.number().int().min(0)),
}).superRefine((value, context) => {
  if (value.memoryUsedMb > value.memoryCapacityMb) context.addIssue({ code: "custom", path: ["memoryUsedMb"], message: "Использовано больше объёма памяти" });
  if (value.diskUsedMb > value.diskCapacityMb) context.addIssue({ code: "custom", path: ["diskUsedMb"], message: "Использовано больше объёма диска" });
});

export type CreateWebsiteInput = z.infer<typeof createWebsiteSchema>;
export type ConfigureWebsiteIntegrationInput = z.infer<typeof configureWebsiteIntegrationSchema>;
export type UpdateWebsiteInfrastructureInput = z.infer<typeof updateWebsiteInfrastructureSchema>;
