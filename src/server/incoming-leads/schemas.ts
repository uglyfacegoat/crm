import { z } from "zod";
import { isValidContactPhone } from "../clients/phone.ts";

const optionalText = (maximum: number) => z.string().trim().max(maximum).optional().transform((value) => value || null);
const optionalUrl = z.string().trim().max(2_048).optional().refine((value) => {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}, "Некорректный URL").transform((value) => value || null);
const optionalPhone = z.string().trim().max(40).optional().refine((value) => !value || isValidContactPhone(value), "Телефон должен содержать от 10 до 15 цифр").transform((value) => value || null);
const optionalEmail = z.string().trim().max(254).optional().refine((value) => !value || z.string().email().safeParse(value).success, "Некорректный email").transform((value) => value?.toLowerCase() || null);

export const websiteLeadWebhookSchema = z.object({
  websiteId: z.string().uuid(),
  eventId: z.string().trim().min(1).max(200).regex(/^[\w.:-]+$/u, "Некорректный идентификатор события"),
  receivedAt: z.iso.datetime({ offset: true }).optional(),
  contactName: optionalText(200),
  phone: optionalPhone,
  email: optionalEmail,
  serviceInterest: optionalText(500),
  landingUrl: optionalUrl,
  referrerUrl: optionalUrl,
  utmSource: optionalText(200),
  utmMedium: optionalText(200),
  utmCampaign: optionalText(200),
  utmContent: optionalText(500),
  utmTerm: optionalText(500),
}).superRefine((value, context) => {
  if (!value.phone && !value.email) context.addIssue({ code: "custom", path: ["phone"], message: "Нужен телефон или email" });
});

export const incomingLeadListFilterSchema = z.object({
  status: z.enum(["all", "new", "reviewing", "accepted", "rejected"]).catch("all"),
  query: z.string().trim().max(200).catch(""),
});

export const rejectIncomingLeadSchema = z.object({
  leadId: z.string().uuid(),
  expectedVersion: z.coerce.number().int().positive(),
  reason: z.string().trim().min(3, "Укажите причину отклонения").max(500),
});

export type WebsiteLeadWebhookInput = z.infer<typeof websiteLeadWebhookSchema>;
export type IncomingLeadListFilter = z.infer<typeof incomingLeadListFilterSchema>;
export type RejectIncomingLeadInput = z.infer<typeof rejectIncomingLeadSchema>;
