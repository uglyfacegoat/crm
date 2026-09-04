import { timingSafeEqual } from "node:crypto";
import { IncomingLeadNotFoundError, IncomingLeadRateLimitError, ingestWebsiteLead } from "@/server/incoming-leads/repository";
import { websiteLeadWebhookSchema } from "@/server/incoming-leads/schemas";

export const dynamic = "force-dynamic";

function hasValidSecret(request: Request, configuredSecret: string) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(authorization.slice(7), "utf8");
  const expected = Buffer.from(configuredSecret, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function POST(request: Request) {
  const configuredSecret = process.env.CRM_WEBSITE_WEBHOOK_SECRET;
  if (!configuredSecret || configuredSecret.length < 32) {
    return Response.json({ error: "Webhook is not configured." }, { status: 503 });
  }
  if (!hasValidSecret(request, configuredSecret)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 32_768) {
    return Response.json({ error: "Payload is too large." }, { status: 413 });
  }
  let payload: unknown;
  try {
    const body = await request.text();
    if (Buffer.byteLength(body, "utf8") > 32_768) {
      return Response.json({ error: "Payload is too large." }, { status: 413 });
    }
    payload = JSON.parse(body) as unknown;
  } catch {
    return Response.json({ error: "Malformed JSON." }, { status: 400 });
  }
  const parsed = websiteLeadWebhookSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid lead payload.", issues: parsed.error.flatten().fieldErrors }, { status: 422 });
  }
  try {
    const result = await ingestWebsiteLead(parsed.data);
    return Response.json({ id: result.leadId, duplicate: result.duplicate }, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    if (error instanceof IncomingLeadNotFoundError) {
      return Response.json({ error: "Website is unavailable." }, { status: 404 });
    }
    if (error instanceof IncomingLeadRateLimitError) {
      return Response.json({ error: "Rate limit exceeded." }, { status: 429, headers: { "Retry-After": "60" } });
    }
    console.error(JSON.stringify({
      operation: "website_lead.receive",
      category: "unexpected",
      websiteId: parsed.data.websiteId,
      error: error instanceof Error ? error.message : "Unknown error",
    }));
    return Response.json({ error: "Lead could not be stored." }, { status: 500 });
  }
}
