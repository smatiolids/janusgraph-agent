"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { WorkspaceLayout } from "@/components/workspace-layout";
import type { AgentResponse, ServerConfig, Session } from "@/lib/types";
import graphxLogo from "@/img/graphx-logo.png";

type ThemeMode = "light" | "dark";

export default function AgentsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const serverId = searchParams.get("serverId");

  const [servers, setServers] = useState<ServerConfig[]>([]);
  const [activeServer, setActiveServer] = useState<ServerConfig | undefined>();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  const [error, setError] = useState("");
  const [envWarning, setEnvWarning] = useState("");
  const [promptDraft, setPromptDraft] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");

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

  async function fetchSessions(nextServerId: string) {
    const response = await fetch(`/api/sessions?serverId=${encodeURIComponent(nextServerId)}`);
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

  useEffect(() => {
    fetch("/api/env")
      .then((response) => response.json())
      .then((payload: { ok?: boolean; missing?: string[] }) => {
        if (!payload.ok && Array.isArray(payload.missing) && payload.missing.length > 0) {
          setEnvWarning(`Missing environment variables: ${payload.missing.join(", ")}`);
        } else {
          setEnvWarning("");
        }
      })
      .catch(() => {
        setEnvWarning("");
      });
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem("janus-theme-mode");
    if (stored === "light" || stored === "dark") {
      setThemeMode(stored);
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", themeMode);
    window.localStorage.setItem("janus-theme-mode", themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (!serverId || servers.length === 0) return;
    const nextServer = servers.find((server) => server.id === serverId);
    if (!nextServer) {
      setError("Selected server was not found.");
      return;
    }

    setError("");
    setActiveServer(nextServer);
    fetchSessions(nextServer.id).catch((loadError) =>
      setError(loadError instanceof Error ? loadError.message : "Failed to load sessions")
    );
  }, [serverId, servers]);

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

  function handleLogout() {
    setActiveServer(undefined);
    setSessions([]);
    setActiveSessionId(undefined);
    setPromptDraft("");
    setError("");
    router.push("/");
  }

  if (!serverId) {
    return (
      <main className="container">
        <p style={{ color: "var(--muted)" }}>Select a server first.</p>
        <button className="button secondary" onClick={() => router.push("/")}>
          Back to server selection
        </button>
      </main>
    );
  }

  if (!activeServer) {
    return (
      <main className="container">
        <p style={{ color: "var(--muted)" }}>Loading server workspace...</p>
        {error ? <p className="error">{error}</p> : null}
      </main>
    );
  }

  return (
    <main className="container with-header">
      <header className="app-header">
        <div className="row app-header-inner" style={{ justifyContent: "space-between", width: "100%" }}>
          <div className="row" style={{ gap: "1rem" }}>
            <Image src={graphxLogo} alt="GraphX-AI logo" className="app-logo" priority />
            <h2 className="app-title" style={{ margin: 0 }}>
              GraphX-AI
            </h2>
            <span className="app-nav-item">Agent</span>
          </div>
          <div className="row" style={{ gap: "0.5rem" }}>
            <select
              className="select theme-select"
              aria-label="Theme mode selector"
              value={themeMode}
              onChange={(event) => setThemeMode(event.target.value as ThemeMode)}
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
            <button className="button secondary" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </div>
      </header>
      <div className="app-main">
        {envWarning ? <p className="warning">{envWarning}</p> : null}
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
      </div>
    </main>
  );
}
