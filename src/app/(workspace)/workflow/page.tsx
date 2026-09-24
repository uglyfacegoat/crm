import type { Metadata } from "next";
import { PageHeading } from "@/components/ui/page-heading";
import { WorkflowEditor } from "@/components/workflow/workflow-editor";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import { getWorkflowWorkspace } from "@/server/workflow/repository";
import { getWorkflowContext } from "@/server/workflow/context-repository";

export const metadata: Metadata = { title: "Воркфлоу" };

export default async function WorkflowPage({ searchParams }: { searchParams: Promise<{ map?: string }> }) {
  const member = await requireOfficeSession();
  if (!hasPermission(member, "workflow.read")) return (
    <div><PageHeading eyebrow="Процессы компании" title="Воркфлоу" description="Карты рабочих процессов." />
      <section className="surface-panel mt-6 p-8 text-sm text-[var(--muted)]">Для этой роли карты процессов недоступны.</section></div>
  );
  const preview = getAuthMode() === "preview";
  const { map = null } = await searchParams;
  const workspace = preview ? { maps: [], selected: null, revisions: [] } : await getWorkflowWorkspace(member, map);
  const context = workspace.selected && !preview
    ? await getWorkflowContext(member, workspace.selected.id) : { comments: [], hasMore: false, members: [] };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <PageHeading eyebrow="Процессы компании" title="Воркфлоу"
        description="Карты рабочих процессов: редактируйте черновик, согласовывайте и публикуйте версии. Блоки пока не запускают действия в CRM." />
      <WorkflowEditor key={workspace.selected?.id ?? "empty"} maps={workspace.maps}
        selected={workspace.selected} canWrite={hasPermission(member, "workflow.write") && !preview}
        canComment={hasPermission(member, "workflow.comment") && !preview}
        canReview={hasPermission(member, "workflow.review") && !preview && (workspace.selected?.contextEditable ?? true)}
        canPublish={hasPermission(member, "workflow.publish") && !preview && (workspace.selected?.contextEditable ?? true)}
        currentMemberId={member.memberId} revisions={workspace.revisions} comments={context.comments}
        commentsHasMore={context.hasMore}
        members={context.members} preview={preview} />
    </div>
  );
}
