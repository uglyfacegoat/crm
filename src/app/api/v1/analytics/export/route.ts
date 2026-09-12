import { AuthorizationError, requirePermission } from "@/server/auth/permissions";
import { getAuthMode } from "@/server/auth/config";
import { getCurrentSession } from "@/server/auth/session";
import { createAnalyticsCsv } from "@/server/analytics/export";
import { getPreviewAnalytics } from "@/server/analytics/preview";
import { getAnalyticsSnapshot, recordAnalyticsExport } from "@/server/analytics/repository";
import { analyticsRanges, type AnalyticsRange } from "@/server/analytics/types";

function requestedRange(request: Request): AnalyticsRange | null {
  const parsed = Number(new URL(request.url).searchParams.get("range") ?? "30");
  return analyticsRanges.includes(parsed as AnalyticsRange) ? parsed as AnalyticsRange : null;
}

export async function GET(request: Request) {
  const range = requestedRange(request);
  if (!range) return Response.json({ error: { code: "validation_error", message: "Допустимый период: 30, 90 или 365 дней." } }, { status: 400 });
  try {
    const member = await getCurrentSession();
    if (!member) return Response.json({ error: { code: "unauthenticated", message: "Требуется вход." } }, { status: 401 });
    requirePermission(member, "analytics.read");
    const preview = getAuthMode() === "preview";
    const snapshot = preview ? getPreviewAnalytics(range) : await getAnalyticsSnapshot(member, range);
    if (!preview) await recordAnalyticsExport(member, range);
    const filename = `crm-analytics-${snapshot.range.endDate}-${range}d.csv`;
    return new Response(`\uFEFF${createAnalyticsCsv(snapshot)}`, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": "text/csv; charset=utf-8",
      },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: { code: "forbidden", message: "Недостаточно прав для экспорта аналитики." } }, { status: 403 });
    console.error(JSON.stringify({ operation: "analytics.export", category: "unexpected", error: error instanceof Error ? error.message : "Unknown error" }));
    return Response.json({ error: { code: "service_unavailable", message: "Не удалось сформировать отчёт." } }, { status: 503 });
  }
}
