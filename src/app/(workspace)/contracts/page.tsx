import type { Metadata } from "next";
import { ContractsWorkspace } from "@/components/contracts/contracts-workspace";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import { getPreviewContracts } from "@/server/contracts/preview";
import { listContracts } from "@/server/contracts/repository";

export const metadata: Metadata = { title: "Договоры" };

export default async function ContractsPage() {
  const member = await requireOfficeSession();
  const snapshot = getAuthMode() === "preview" ? getPreviewContracts() : await listContracts(member);
  const canWrite = hasPermission(member.role, "contracts.write");
  return <div>
    <PageHeading eyebrow="Долгосрочное обслуживание" title="Договоры" description="Периоды, продления и все плановые выезды — в одной непрерывной истории клиента." />
    <ContractsWorkspace key={snapshot.contracts.map((contract) => `${contract.id}:${contract.version}`).join("|")} snapshot={snapshot} canWrite={canWrite} />
  </div>;
}
