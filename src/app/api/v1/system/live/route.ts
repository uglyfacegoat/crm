export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok", service: "crm-web" }, { headers: { "cache-control": "no-store" } });
}
