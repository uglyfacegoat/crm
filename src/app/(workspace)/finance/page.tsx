import type { Metadata } from "next";
import { FinanceWorkspace } from "@/components/finance/finance-workspace";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import { getPreviewFinanceSnapshot } from "@/server/finance/preview";
import { getFinanceSnapshot } from "@/server/finance/repository";

export const metadata: Metadata = { title: "Финансы" };

export default async function FinancePage() {
  const member = await requireOfficeSession();
  const snapshot = getAuthMode() === "preview" ? getPreviewFinanceSnapshot() : await getFinanceSnapshot(member);
  return <div><PageHeading eyebrow="Денежный поток" title="Финансы" description="Счета, частичные оплаты, дебиторская задолженность и выплаты мастерам в едином неизменяемом реестре." /><FinanceWorkspace snapshot={snapshot} canWrite={hasPermission(member, "finance.write")} /></div>;
}
