import { getDatabase } from "@/server/database";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getDatabase()`SELECT 1`;
    return Response.json({
      status: "ok",
      service: "crm-web",
      apiVersion: "v1",
      database: "available",
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(JSON.stringify({ operation: "system.health", category: "database_unavailable", error: error instanceof Error ? error.message : "Unknown error" }));
    return Response.json({ status: "unavailable", service: "crm-web", database: "unavailable" }, { status: 503 });
  }
}
