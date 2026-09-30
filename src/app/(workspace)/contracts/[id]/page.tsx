import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth/page-access";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ContractDetailWorkspace } from "@/components/contracts/contract-detail-workspace";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import {
  ContractNotFoundError,
  getContract,
  listContractHistory,
} from "@/server/contracts/repository";
import { getPreviewContracts } from "@/server/contracts/preview";
import { listDocuments } from "@/server/documents/repository";

export const metadata: Metadata = { title: "Карточка договора" };

export default async function ContractDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const member = await requireOfficeSession();
  requirePagePermission(member, "contracts.read");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const preview = getAuthMode() === "preview";
  let contract;
  try {
    contract = preview
      ? getPreviewContracts().contracts.find((entry) => entry.id === id)
      : await getContract(member, id);
  } catch (error) {
    if (error instanceof ContractNotFoundError) notFound();
    throw error;
  }
  if (!contract) notFound();
  const viewingAcrossCompanies = !preview && contract.organizationId !== member.organizationId;
  const readMember = viewingAcrossCompanies ? { ...member, organizationId: contract.organizationId! } : member;
  const [documents, history] = preview
    ? [[], []]
    : await Promise.all([
        hasPermission(member, "documents.read")
          ? listDocuments(readMember, {
              contractId: contract.id,
              clientId: null,
              objectId: null,
              orderId: null,
              category: "contract",
              folderId: null,
              favoriteOnly: false,
            })
          : Promise.resolve([]),
        listContractHistory(member, contract.id),
      ]);
  const orderedDocuments = documents.filter((document) => document.contractId === contract.id);
  return (
    <ContractDetailWorkspace
      contract={contract}
      companyReadOnly={viewingAcrossCompanies ? contract.organizationName : undefined}
      documents={orderedDocuments}
      history={history}
      canWrite={hasPermission(member, "contracts.write") && !preview && !viewingAcrossCompanies}
      canReplaceDocuments={hasPermission(member, "documents.write") && !preview && !viewingAcrossCompanies}
      currentDate={new Intl.DateTimeFormat("en-CA", {
        timeZone: contract.organizationTimezone ?? "Europe/Moscow",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date())}
    />
  );
}
