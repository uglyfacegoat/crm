import { safeErrorCode } from "@/server/observability/safe-error";
import { timingSafeEqual } from "node:crypto";
import { consumeRateLimit } from "@/server/auth/repository";
import { createPrivateBucketHash } from "@/server/auth/token";
import { getClientAddress } from "@/server/auth/request";
import { IncomingLeadNotFoundError, IncomingLeadRateLimitError, ingestWebsiteLead } from "@/server/incoming-leads/repository";
import { websiteLeadWebhookSchema } from "@/server/incoming-leads/schemas";
import { InvalidJsonBodyError, readJsonBody, RequestBodyTooLargeError } from "@/server/http/json-body";

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
  try {
    // Both buckets are server-derived. Untrusted forwarding headers cannot create new IP buckets.
    const globalBucket = createPrivateBucketHash(configuredSecret, "website-leads:global");
    const globalAllowed = await consumeRateLimit([globalBucket], 600, 1);
    const address = getClientAddress(request.headers);
    const addressAllowed = address
      ? await consumeRateLimit([createPrivateBucketHash(configuredSecret, `website-leads:ip:${address}`)], 120, 1)
      : true;
    if (!globalAllowed || !addressAllowed) {
      return Response.json({ error: "Rate limit exceeded." }, { status: 429, headers: { "Retry-After": "60" } });
    }
  } catch (error) {
    console.error(JSON.stringify({ operation: "website_lead.throttle", category: "unexpected", errorCode: safeErrorCode(error) }));
    return Response.json({ error: "Webhook is unavailable." }, { status: 503 });
  }
  if (!hasValidSecret(request, configuredSecret)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = await readJsonBody(request, 32 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return Response.json({ error: "Payload is too large." }, { status: 413 });
    if (error instanceof InvalidJsonBodyError) return Response.json({ error: "Malformed JSON." }, { status: 400 });
    throw error;
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
      errorCode: safeErrorCode(error),
    }));
    return Response.json({ error: "Lead could not be stored." }, { status: 500 });
  }
}
