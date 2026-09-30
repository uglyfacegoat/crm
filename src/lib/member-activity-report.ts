import { z } from "zod";
import { organizationRoles } from "@/server/auth/types";
import { screenLabels } from "@/lib/member-activity";

export const ACTIVITY_PAGE_SIZE = 30;
export const activityReportQuerySchema = z.object({
  q: z.string().trim().max(100).default(""),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  period: z.coerce.number().pipe(z.union([z.literal(7), z.literal(30)])).default(30),
  memberId: z.string().uuid().optional(),
});
export type ActivityReportQuery = z.infer<typeof activityReportQuerySchema>;
const seconds = z.number().int().nonnegative();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const account = z.object({ id: z.string().uuid(), displayName: z.string(), email: z.string(), role: z.enum(organizationRoles) });
const row = z.object({ member: account, seconds, demoSeconds: seconds, activeDays: seconds, lastActivityAt: z.string().nullable() });
const day = z.object({ date, seconds });
export const activityReportSchema = z.object({
  period: z.union([z.literal(7), z.literal(30)]), timeZone: z.string(),
  summary: z.object({ memberCount: seconds, activeCount: seconds, totalSeconds: seconds, demoSeconds: seconds }),
  days: z.array(day),
  members: z.object({ items: z.array(row), total: seconds, page: seconds, pageSize: seconds }),
  selected: row.extend({ daily: z.array(day), screens: z.array(z.object({ key: z.enum(Object.keys(screenLabels) as [keyof typeof screenLabels, ...(keyof typeof screenLabels)[]]), seconds })) }).nullable(),
});
export type ActivityReport = z.infer<typeof activityReportSchema>;
