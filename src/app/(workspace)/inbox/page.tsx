import type { Metadata } from "next";
import { IncomingLeadsWorkspace } from "@/components/incoming-leads/incoming-leads-workspace";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import { getIncomingLeadSnapshot } from "@/server/incoming-leads/repository";
import { incomingLeadListFilterSchema } from "@/server/incoming-leads/schemas";
import type { IncomingLeadSnapshot } from "@/server/incoming-leads/types";

export const metadata: Metadata = { title: "Входящие заявки" };

const emptySnapshot: IncomingLeadSnapshot = {
  leads: [],
  counts: { all: 0, new: 0, reviewing: 0, accepted: 0, rejected: 0 },
};

export default async function IncomingLeadsPage({ searchParams }: PageProps<"/inbox">) {
  const member = await requireOfficeSession();
  const query = await searchParams;
  const filter = incomingLeadListFilterSchema.parse({
    status: Array.isArray(query.status) ? query.status[0] : query.status,
    query: Array.isArray(query.query) ? query.query[0] : query.query,
  });
  const canRead = hasPermission(member.role, "leads.read");
  const canWrite = hasPermission(member.role, "leads.write");
  const preview = getAuthMode() === "preview";
  const snapshot = canRead && !preview ? await getIncomingLeadSnapshot(member, filter) : emptySnapshot;
  return <IncomingLeadsWorkspace snapshot={snapshot} filter={filter} canWrite={canWrite && !preview} preview={preview} />;
}

