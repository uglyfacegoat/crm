import type { Metadata } from "next";
import { PageHeading } from "@/components/ui/page-heading";
import { WorkflowEditor } from "@/components/workflow/workflow-editor";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import { getWorkflowWorkspace } from "@/server/workflow/repository";
import { getWorkflowContext } from "@/server/workflow/context-repository";
import { getWorkflowCollaboration } from "@/server/workflow/collaboration-repository";
import { getWorkflowAutomationState } from "@/server/workflow/automation-repository";

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
  const [context, collaboration, automation] = workspace.selected && !preview
    ? await Promise.all([getWorkflowContext(member, workspace.selected.id),
      getWorkflowCollaboration(member, workspace.selected.id),
      getWorkflowAutomationState(member, workspace.selected.id)])
    : [{ comments: [], hasMore: false, members: [] }, { watching: false, activity: [] },
      { activeVersion: null, trialReady: false, jobs: [] }];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <PageHeading eyebrow="Процессы компании" title="Воркфлоу"
        description="Карты рабочих процессов: редактируйте, согласовывайте и публикуйте версии. Разрешённые автоматизации включаются отдельно после пробного запуска." />
      <WorkflowEditor key={workspace.selected?.id ?? "empty"} maps={workspace.maps}
        selected={workspace.selected} canWrite={hasPermission(member, "workflow.write") && !preview}
        canComment={hasPermission(member, "workflow.comment") && !preview}
        canWatch={hasPermission(member, "notifications.read") && !preview}
        canReview={hasPermission(member, "workflow.review") && !preview && (workspace.selected?.contextEditable ?? true)}
        canPublish={hasPermission(member, "workflow.publish") && !preview && (workspace.selected?.contextEditable ?? true)}
        canPreviewAutomation={hasPermission(member, "workflow.publish") && hasPermission(member, "orders.read") && hasPermission(member, "tasks.write") && !preview && (workspace.selected?.contextEditable ?? true)}
        canStopAutomation={(hasPermission(member, "workflow.publish") || hasPermission(member, "settings.write")) && !preview}
        currentMemberId={member.memberId} revisions={workspace.revisions} comments={context.comments}
        commentsHasMore={context.hasMore}
        members={context.members} watching={collaboration.watching} activity={collaboration.activity} automation={automation}
        preview={preview} />
    </div>
  );
}
