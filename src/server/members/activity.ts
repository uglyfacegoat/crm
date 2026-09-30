import "server-only";
import { z } from "zod";
import { requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
import { isScreenKey, type ScreenKey } from "@/lib/member-activity";

const activityRow = z.object({
  member_id: z.string().uuid(),
  screen_key: z.string(),
  activity_day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.enum(["measured", "demo"]),
  seconds: z.coerce.number().int().nonnegative(),
  last_activity_at: z.coerce.date(),
});

export type MemberActivity = {
  memberId: string;
  totalSeconds: number;
  lastActivityAt: string | null;
  screens: { key: ScreenKey; seconds: number }[];
  buckets: { date: string; key: ScreenKey; seconds: number; source: "measured" | "demo" }[];
  demoSeconds: number;
};

export async function recordMemberScreenActivity(member: AuthenticatedMember, screen: ScreenKey) {
  const sql = getDatabase();
  // One half-minute bucket per user prevents multiple tabs from multiplying time.
  await sql`INSERT INTO member_screen_activity (organization_id, member_id, bucket_start, screen_key)
    VALUES (${member.organizationId}, ${member.memberId},
      to_timestamp(floor(extract(epoch from now()) / 30) * 30), ${screen})
    ON CONFLICT (organization_id, member_id, bucket_start)
    DO UPDATE SET screen_key = EXCLUDED.screen_key`;
}

export async function listMemberActivity(member: AuthenticatedMember): Promise<MemberActivity[]> {
  requirePermission(member, "settings.write");
  const sql = getDatabase();
  const rows = await sql`SELECT activity.member_id, activity.screen_key, activity.source,
      to_char(activity.bucket_start AT TIME ZONE organizations.timezone, 'YYYY-MM-DD') AS activity_day,
      sum(activity.seconds)::integer AS seconds, max(activity.bucket_start) AS last_activity_at
    FROM member_screen_activity activity
    JOIN organization_members members ON members.organization_id = activity.organization_id
      AND members.id = activity.member_id
    JOIN organizations ON organizations.id = activity.organization_id
    WHERE activity.organization_id = ${member.organizationId}
      AND members.deleted_at IS NULL
      AND activity.bucket_start >= now() - interval '30 days'
    GROUP BY activity.member_id, activity.screen_key, activity.source, organizations.timezone, activity_day
    ORDER BY activity.member_id, activity_day, activity.screen_key`;
  const byMember = new Map<string, MemberActivity>();
  for (const raw of rows) {
    const row = activityRow.parse(raw);
    if (!isScreenKey(row.screen_key)) continue;
    const current = byMember.get(row.member_id) ?? { memberId: row.member_id, totalSeconds: 0, lastActivityAt: null, screens: [], buckets: [], demoSeconds: 0 };
    current.totalSeconds += row.seconds;
    if (row.source === "demo") current.demoSeconds += row.seconds;
    current.buckets.push({ date: row.activity_day, key: row.screen_key, seconds: row.seconds, source: row.source });
    const screen = current.screens.find((item) => item.key === row.screen_key);
    if (screen) screen.seconds += row.seconds;
    else current.screens.push({ key: row.screen_key, seconds: row.seconds });
    const last = row.last_activity_at.toISOString();
    if (!current.lastActivityAt || last > current.lastActivityAt) current.lastActivityAt = last;
    byMember.set(row.member_id, current);
  }
  return [...byMember.values()].map((item) => ({
    ...item,
    screens: item.screens.sort((a, b) => b.seconds - a.seconds),
  }));
}
