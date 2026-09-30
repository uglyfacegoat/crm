import { z } from "zod";

const trimmedOptionalText = (maximum: number) => z.string().trim().max(maximum).optional();

export const objectProfileSchema = z.object({
  clientId: z.uuid(),
  name: z.string().trim().min(2).max(240),
  objectType: z.string().trim().min(2).max(100),
  address: z.string().trim().min(5).max(500),
  areaSquareMeters: z.number().positive().max(100_000_000).optional(),
  floorCount: z.number().int().positive().max(1_000).optional(),
  accessInstructions: trimmedOptionalText(2_000),
  parkingNotes: trimmedOptionalText(1_000),
  onsiteContact: trimmedOptionalText(300),
  restrictions: trimmedOptionalText(2_000),
  riskLevel: z.number().int().min(1).max(5).optional(),
  infestationLevel: z.number().int().min(0).max(5).optional(),
}).strict();

export const contractPeriodSchema = z.object({
  clientId: z.uuid(),
  objectId: z.uuid(),
  contractNumber: z.string().trim().min(1).max(120),
  startsOn: z.iso.date(),
  endsOn: z.iso.date(),
  renewalNoticeDays: z.number().int().min(1).max(365),
}).strict().superRefine((period, context) => {
  if (period.endsOn < period.startsOn) {
    context.addIssue({ code: "custom", path: ["endsOn"], message: "Contract end date must not precede its start date." });
  }
});

export const websiteLeadSchema = z.object({
  externalEventId: z.string().trim().min(8).max(200),
  receivedAt: z.iso.datetime({ offset: true }),
  contactName: trimmedOptionalText(200),
  phone: trimmedOptionalText(40),
  email: z.email().max(320).optional(),
  serviceInterest: trimmedOptionalText(200),
  landingUrl: z.url().max(2_000).optional(),
  referrerUrl: z.url().max(2_000).optional(),
  utmSource: trimmedOptionalText(300),
  utmMedium: trimmedOptionalText(300),
  utmCampaign: trimmedOptionalText(300),
  utmContent: trimmedOptionalText(300),
  utmTerm: trimmedOptionalText(300),
}).strict().refine((lead) => lead.phone || lead.email, {
  message: "A lead must contain a phone number or email address.",
});
