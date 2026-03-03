"use client";

import { useMemo } from "react";
import type { ServerConfig, Session } from "@/lib/types";
import { PromptInput } from "@/components/prompt-input";
import { SessionsPane } from "@/components/sessions-pane";
import { VisualizationTabs } from "@/components/visualization-tabs";

type Props = {
  server: ServerConfig;
  sessions: Session[];
  activeSession?: Session;
  onCreateSession: () => Promise<void>;
  onSelectSession: (id: string) => Promise<void>;
  onRenameSession: (id: string) => Promise<void>;
  onDeleteSession: (id: string) => Promise<void>;
  onSubmitPrompt: (prompt: string) => Promise<void>;
  onRerunQuery: (query: string) => Promise<void>;
  promptDraft: string;
  onPromptDraftChange: (value: string) => void;
  isExecuting: boolean;
  isCreatingSession: boolean;
};

export function WorkspaceLayout({
  server,
  sessions,
  activeSession,
  onCreateSession,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  onSubmitPrompt,
  onRerunQuery,
  promptDraft,
  onPromptDraftChange,
  isExecuting,
  isCreatingSession
}: Props) {
  const title = useMemo(() => {
    if (!activeSession) return "No session selected";
    return `${server.name} · ${activeSession.title}`;
  }, [activeSession, server.name]);

  return (
    <div className="split">
      <SessionsPane
        sessions={sessions}
        activeSessionId={activeSession?.id}
        onCreateSession={onCreateSession}
        onSelectSession={onSelectSession}
        onRenameSession={onRenameSession}
        onDeleteSession={onDeleteSession}
        isCreatingSession={isCreatingSession}
        isBusy={isExecuting || isCreatingSession}
      />

      <div className="right-pane">
        <div className="right-pane-top">
          <div className="row" style={{ justifyContent: "space-between", padding: "0 0.25rem" }}>
            <h3 style={{ margin: 0 }}>{title}</h3>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>
              {server.protocol}://{server.host}:{server.port}
            </span>
          </div>
          <VisualizationTabs
            messages={activeSession?.messages ?? []}
            onRerunQuery={onRerunQuery}
            onCopyPromptToInput={onPromptDraftChange}
            isExecuting={isExecuting}
          />
        </div>

        <PromptInput
          onSubmit={onSubmitPrompt}
          value={promptDraft}
          onChange={onPromptDraftChange}
          disabled={!activeSession || isExecuting || isCreatingSession}
        />
      </div>
    </div>
  );
}
