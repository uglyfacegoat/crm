import { z } from "zod";
import { websiteProviders } from "./types.ts";

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

export type CreateWebsiteInput = z.infer<typeof createWebsiteSchema>;
export type ConfigureWebsiteIntegrationInput = z.infer<typeof configureWebsiteIntegrationSchema>;
