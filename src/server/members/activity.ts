import "server-only";
import { z } from "zod";
import { requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
import { screenLabels, isScreenKey, type ScreenKey } from "@/lib/member-activity";

import { ACTIVITY_PAGE_SIZE, activityReportSchema, type ActivityReport, type ActivityReportQuery } from "@/lib/member-activity-report";
import { memberRoleLabels } from "@/lib/member-directory";
import { MemberNotFoundError } from "@/server/members/repository";

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

export async function getMemberActivityReport(member: AuthenticatedMember, query: ActivityReportQuery): Promise<ActivityReport> {
  requirePermission(member, "settings.write");
  const sql = getDatabase();
  const [result] = await sql`WITH context AS (
    SELECT timezone, (now() AT TIME ZONE timezone)::date AS today FROM organizations WHERE id = ${member.organizationId}
  ), accounts AS (
    SELECT members.id, members.display_name, members.email,
      CASE WHEN developer_accounts.email IS NOT NULL THEN developer_accounts.account_role ELSE members.role END AS role
    FROM organization_members members LEFT JOIN developer_accounts ON developer_accounts.email = members.email
    WHERE members.organization_id = ${member.organizationId} AND members.deleted_at IS NULL
  ), buckets AS MATERIALIZED (
    SELECT activity.member_id, activity.screen_key, activity.source, activity.seconds, activity.bucket_start,
      (activity.bucket_start AT TIME ZONE context.timezone)::date AS activity_day
    FROM member_screen_activity activity JOIN accounts ON accounts.id = activity.member_id CROSS JOIN context
    WHERE activity.organization_id = ${member.organizationId}
      AND activity.bucket_start >= ((context.today - (${query.period} - 1))::timestamp AT TIME ZONE context.timezone)
      AND activity.bucket_start < ((context.today + 1)::timestamp AT TIME ZONE context.timezone)
      AND activity.screen_key = ANY(${sql.array(Object.keys(screenLabels))}::text[])
  ), totals AS (
    SELECT accounts.*, coalesce(sum(buckets.seconds), 0)::bigint AS seconds,
      coalesce(sum(buckets.seconds) FILTER (WHERE source = 'demo'), 0)::bigint AS demo_seconds,
      count(DISTINCT activity_day)::integer AS active_days, max(bucket_start) AS last_activity_at
    FROM accounts LEFT JOIN buckets ON buckets.member_id = accounts.id GROUP BY accounts.id, accounts.display_name, accounts.email, accounts.role
  ), matching AS (
    SELECT * FROM totals WHERE ${query.q} = '' OR crm_search_matches(
      concat_ws(' ', display_name, email, role, (${sql.json(memberRoleLabels)}::jsonb ->> role)), ${query.q})
  ), page_rows AS (
    SELECT * FROM matching ORDER BY seconds DESC, display_name, id LIMIT ${ACTIVITY_PAGE_SIZE} OFFSET ${(query.page - 1) * ACTIVITY_PAGE_SIZE}
  ), chosen AS (
    SELECT * FROM totals WHERE id = coalesce(${query.memberId ?? null}::uuid,
      (SELECT id FROM page_rows ORDER BY seconds DESC, display_name, id LIMIT 1))
  ), calendar AS (
    SELECT (context.today - n)::date AS day FROM context CROSS JOIN generate_series(${query.period} - 1, 0, -1) n
  ), daily AS (
    SELECT activity_day, sum(seconds)::bigint AS seconds FROM buckets GROUP BY activity_day
  ), personal_daily AS (
    SELECT activity_day, sum(seconds)::bigint AS seconds FROM buckets WHERE member_id IN (SELECT id FROM chosen) GROUP BY activity_day
  ), personal_screens AS (
    SELECT screen_key, sum(seconds)::bigint AS seconds FROM buckets WHERE member_id IN (SELECT id FROM chosen) GROUP BY screen_key
  ), projected AS (
    SELECT id, seconds, jsonb_build_object('member', jsonb_build_object('id', id, 'displayName', display_name, 'email', email, 'role', role),
      'seconds', seconds, 'demoSeconds', demo_seconds, 'activeDays', active_days, 'lastActivityAt', last_activity_at) AS data
    FROM totals
  ) SELECT jsonb_build_object(
    'period', ${query.period}::integer, 'timeZone', (SELECT timezone FROM context),
    'summary', (SELECT jsonb_build_object('memberCount', count(*), 'activeCount', count(*) FILTER (WHERE seconds > 0),
      'totalSeconds', coalesce(sum(seconds), 0), 'demoSeconds', coalesce(sum(demo_seconds), 0)) FROM totals),
    'days', (SELECT coalesce(jsonb_agg(jsonb_build_object('date', calendar.day::text, 'seconds', coalesce(daily.seconds, 0)) ORDER BY calendar.day), '[]'::jsonb)
      FROM calendar LEFT JOIN daily ON daily.activity_day = calendar.day),
    'members', jsonb_build_object('items', (SELECT coalesce(jsonb_agg(projected.data ORDER BY page_rows.seconds DESC, page_rows.display_name, page_rows.id), '[]'::jsonb)
      FROM page_rows JOIN projected ON projected.id = page_rows.id), 'total', (SELECT count(*) FROM matching), 'page', ${query.page}::integer, 'pageSize', ${ACTIVITY_PAGE_SIZE}::integer),
    'selected', (SELECT projected.data || jsonb_build_object(
      'daily', (SELECT coalesce(jsonb_agg(jsonb_build_object('date', calendar.day::text, 'seconds', coalesce(personal_daily.seconds, 0)) ORDER BY calendar.day), '[]'::jsonb)
        FROM calendar LEFT JOIN personal_daily ON personal_daily.activity_day = calendar.day),
      'screens', (SELECT coalesce(jsonb_agg(jsonb_build_object('key', screen_key, 'seconds', seconds) ORDER BY seconds DESC, screen_key), '[]'::jsonb) FROM personal_screens))
      FROM projected WHERE id IN (SELECT id FROM chosen))
  ) AS report`;
  const report = activityReportSchema.parse(result.report);
  if (query.memberId && !report.selected) throw new MemberNotFoundError();
  return report;
}
