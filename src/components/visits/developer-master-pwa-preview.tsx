"use client";

import { CalendarDays, MessageSquare, ShieldCheck, Smartphone, X } from "lucide-react";
import { useState } from "react";
import { ChatWorkspace } from "@/components/chat/chat-workspace";
import { MasterVisitsWorkspace } from "@/components/visits/master-visits-workspace";
import type { ChatWorkspaceData } from "@/server/chat/types";
import type { DocumentTemplateListItem } from "@/server/document-templates/types";
import type { ServiceVisit } from "@/server/visits/types";

export function DeveloperMasterPwaPreview({
  developerName,
  visits,
  templates,
  chat,
  now,
}: {
  developerName: string;
  visits: ServiceVisit[];
  templates: DocumentTemplateListItem[];
  chat: ChatWorkspaceData;
  now: string;
}) {
  const [section, setSection] = useState<"visits" | "chat">("visits");

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-[480px] flex-col overflow-x-hidden bg-[var(--canvas)]">
      <header className="sticky top-3 z-20 mx-3 mt-3 flex min-h-16 items-center gap-3 rounded-[18px] border border-[var(--line-strong)] bg-[var(--surface-raised)] px-3.5">
        <span className="grid size-10 shrink-0 place-items-center rounded-[13px] bg-[var(--accent-soft)] text-[var(--accent-ink)]">
          <Smartphone className="size-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <h1 className="block truncate text-sm font-semibold text-[var(--text)]">PWA мастера</h1>
          <span className="mt-0.5 flex items-center gap-1.5 truncate text-[9px] text-[var(--muted)]">
            <ShieldCheck className="size-3 shrink-0" />
            Разработчик · {developerName}
          </span>
        </span>
        <button
          type="button"
          onClick={() => window.close()}
          className="focus-ring grid size-10 shrink-0 place-items-center rounded-[13px] border border-[var(--line)] text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
          aria-label="Закрыть предпросмотр"
        >
          <X className="size-[18px]" />
        </button>
      </header>

      <main className={`min-h-0 min-w-0 flex-1 ${section === "visits" ? "px-3 pb-32 pt-6" : "flex flex-col px-3 pb-28 pt-3"}`}>
        {section === "visits" ? (
          <MasterVisitsWorkspace
            visits={visits}
            templates={templates}
            now={now}
            readOnlyPreview
          />
        ) : (
          <div className="flex min-h-[calc(100dvh-10rem)] flex-1 flex-col">
            <ChatWorkspace
              data={chat}
              canWrite={false}
              canManage={false}
              composerRequestKey="developer-preview"
              readOnlyPreview
            />
          </div>
        )}
      </main>

      <nav aria-label="Разделы PWA" className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 mx-auto grid max-w-[448px] grid-cols-2 gap-1 rounded-[18px] border border-[var(--line-strong)] bg-[var(--surface-raised)] p-1.5">
        {([
          { value: "visits", label: "Выезды", icon: CalendarDays },
          { value: "chat", label: "Чат", icon: MessageSquare },
        ] as const).map((item) => {
          const active = section === item.value;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => setSection(item.value)}
              aria-current={active ? "page" : undefined}
              className={`focus-ring flex min-h-12 items-center justify-center gap-2 rounded-[13px] text-xs font-medium transition-colors active:translate-y-px ${active ? "bg-[var(--accent)] text-[var(--on-accent)]" : "text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"}`}
            >
              <item.icon className="size-[18px]" />
              {item.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
