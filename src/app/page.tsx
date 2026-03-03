"use client";

import { useEffect, useMemo, useState } from "react";
import { ServerSelector } from "@/components/server-selector";
import { WorkspaceLayout } from "@/components/workspace-layout";
import type { AgentResponse, ServerConfig, Session } from "@/lib/types";

export default function HomePage() {
  const [servers, setServers] = useState<ServerConfig[]>([]);
  const [activeServer, setActiveServer] = useState<ServerConfig | undefined>();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  const [error, setError] = useState("");
  const [promptDraft, setPromptDraft] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);

  const safeSessions = useMemo(() => (Array.isArray(sessions) ? sessions : []), [sessions]);
  const activeSession = useMemo(
    () => safeSessions.find((session) => session.id === activeSessionId),
    [safeSessions, activeSessionId]
  );

  async function fetchServers() {
    const response = await fetch("/api/servers");
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to load servers");
    }

    setServers(Array.isArray(payload.servers) ? payload.servers : []);
  }

  async function fetchSessions(serverId: string) {
    const response = await fetch(`/api/sessions?serverId=${encodeURIComponent(serverId)}`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to load sessions");
    }

    const nextSessions = Array.isArray(payload.sessions) ? (payload.sessions as Session[]) : [];
    setSessions(nextSessions);
    setActiveSessionId((current) =>
      current && nextSessions.some((session) => session.id === current) ? current : nextSessions[0]?.id
    );
  }

  useEffect(() => {
    fetchServers().catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Failed to initialize"));
  }, []);

  async function handleConnect(server: ServerConfig) {
    setError("");
    setActiveServer(server);
    await fetchSessions(server.id);
  }

  async function handleCreateSession() {
    if (!activeServer) return;

    setIsCreatingSession(true);
    try {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverId: activeServer.id })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to create session");
      }

      await fetchSessions(activeServer.id);
      setActiveSessionId(payload.session.id);
    } finally {
      setIsCreatingSession(false);
    }
  }

  async function handleSelectSession(id: string) {
    const response = await fetch(`/api/sessions/${id}`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to load session");
    }

    setSessions((prev) => {
      const next = prev.filter((session) => session.id !== id);
      return [payload.session as Session, ...next];
    });
    setActiveSessionId(id);
  }

  async function handleRenameSession(id: string) {
    const title = window.prompt("New session title:");
    if (!title?.trim()) return;

    const response = await fetch(`/api/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to rename session");
    }

    setSessions((prev) => prev.map((session) => (session.id === id ? (payload.session as Session) : session)));
  }

  async function handleDeleteSession(id: string) {
    const confirmed = window.confirm("Delete this session and all its data?");
    if (!confirmed) return;

    const response = await fetch(`/api/sessions/${id}`, {
      method: "DELETE"
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to delete session");
    }
    if (activeServer) {
      await fetchSessions(activeServer.id);
    }
  }

  async function handleSubmitPrompt(prompt: string) {
    if (!activeServer || !activeSessionId) {
      throw new Error("Select a server and session first");
    }

    setIsExecuting(true);
    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serverId: activeServer.id,
          sessionId: activeSessionId,
          prompt
        })
      });
      const payload = (await response.json()) as AgentResponse & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "Agent call failed");
      }

      await fetchSessions(activeServer.id);
      await handleSelectSession(activeSessionId);
    } finally {
      setIsExecuting(false);
    }
  }

  async function handleRerunQuery(query: string) {
    if (!activeServer || !activeSessionId) {
      throw new Error("Select a server and session first");
    }

    setIsExecuting(true);
    try {
      const response = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serverId: activeServer.id,
          sessionId: activeSessionId,
          query
        })
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to rerun query");
      }

      await fetchSessions(activeServer.id);
      await handleSelectSession(activeSessionId);
    } finally {
      setIsExecuting(false);
    }
  }

  if (!activeServer) {
    return (
      <main className="container">
        <ServerSelector
          servers={servers}
          onConnect={handleConnect}
          onServerCreated={(server) => setServers((prev) => [...prev, server])}
          onServerUpdated={(server) => {
            setServers((prev) => prev.map((item) => (item.id === server.id ? server : item)));
            setActiveServer((prev) => (prev?.id === server.id ? server : prev));
          }}
        />
        {error ? <p className="error">{error}</p> : null}
      </main>
    );
  }

  return (
    <main className="container">
      <WorkspaceLayout
        server={activeServer}
        sessions={safeSessions}
        activeSession={activeSession}
        onCreateSession={handleCreateSession}
        onSelectSession={handleSelectSession}
        onRenameSession={handleRenameSession}
        onDeleteSession={handleDeleteSession}
        onSubmitPrompt={handleSubmitPrompt}
        onRerunQuery={handleRerunQuery}
        promptDraft={promptDraft}
        onPromptDraftChange={setPromptDraft}
        isExecuting={isExecuting}
        isCreatingSession={isCreatingSession}
      />
      {error ? <p className="error">{error}</p> : null}
    </main>
  );
}
