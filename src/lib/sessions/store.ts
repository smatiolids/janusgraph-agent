import { readFile, writeFile } from "node:fs/promises";
import { v4 as uuidv4 } from "uuid";
import type { Session, SessionAgentContext, SessionMessage, SessionsFile } from "@/lib/types";
import { resolveAppPath } from "@/lib/app-paths";
import { ensureFileParent, exists } from "@/lib/fs-utils";

const sessionsFilePath = resolveAppPath("server", "sessions.json");

const defaultSessionsFile: SessionsFile = { sessions: [] };

async function loadSessionsFile(): Promise<SessionsFile> {
  if (!(await exists(sessionsFilePath))) {
    await ensureFileParent(sessionsFilePath);
    await writeFile(sessionsFilePath, JSON.stringify(defaultSessionsFile, null, 2), "utf8");
    return defaultSessionsFile;
  }

  const raw = await readFile(sessionsFilePath, "utf8");
  const parsed = JSON.parse(raw) as SessionsFile;
  if (!parsed || !Array.isArray(parsed.sessions)) {
    throw new Error("Malformed sessions.json: expected { sessions: [] }");
  }

  return parsed;
}

async function saveSessionsFile(content: SessionsFile): Promise<void> {
  await ensureFileParent(sessionsFilePath);
  await writeFile(sessionsFilePath, JSON.stringify(content, null, 2), "utf8");
}

export async function listSessions(serverId: string): Promise<Session[]> {
  const file = await loadSessionsFile();
  return file.sessions
    .filter((session) => session.serverId === serverId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function getSessionById(id: string): Promise<Session | undefined> {
  const file = await loadSessionsFile();
  return file.sessions.find((session) => session.id === id);
}

export async function createSession(serverId: string, title?: string): Promise<Session> {
  const file = await loadSessionsFile();
  const now = new Date().toISOString();

  const session: Session = {
    id: uuidv4(),
    serverId,
    title: title?.trim() || "New session",
    createdAt: now,
    updatedAt: now,
    messages: []
  };

  file.sessions.push(session);
  await saveSessionsFile(file);
  return session;
}

export async function renameSession(id: string, title: string): Promise<Session> {
  const file = await loadSessionsFile();
  const index = file.sessions.findIndex((session) => session.id === id);
  if (index === -1) {
    throw new Error("Session not found");
  }

  file.sessions[index].title = title.trim();
  file.sessions[index].updatedAt = new Date().toISOString();
  await saveSessionsFile(file);
  return file.sessions[index];
}

export async function deleteSession(id: string): Promise<void> {
  const file = await loadSessionsFile();
  const index = file.sessions.findIndex((session) => session.id === id);
  if (index === -1) {
    throw new Error("Session not found");
  }

  file.sessions.splice(index, 1);
  await saveSessionsFile(file);
}

export async function appendMessages(sessionId: string, messages: SessionMessage[]): Promise<Session> {
  const file = await loadSessionsFile();
  const index = file.sessions.findIndex((session) => session.id === sessionId);
  if (index === -1) {
    throw new Error("Session not found");
  }

  const session = file.sessions[index];
  session.messages.push(...messages);
  session.updatedAt = new Date().toISOString();

  if (messages[0]?.prompt && session.title === "New session") {
    session.title = messages[0].prompt.slice(0, 36);
  }

  file.sessions[index] = session;
  await saveSessionsFile(file);
  return session;
}

export async function getSessionAgentContext(sessionId: string): Promise<SessionAgentContext | undefined> {
  const session = await getSessionById(sessionId);
  return session?.agentContext;
}

export async function updateSessionAgentContext(sessionId: string, agentContext: SessionAgentContext): Promise<Session> {
  const file = await loadSessionsFile();
  const index = file.sessions.findIndex((session) => session.id === sessionId);
  if (index === -1) {
    throw new Error("Session not found");
  }

  const session = file.sessions[index];
  session.agentContext = agentContext;
  session.updatedAt = new Date().toISOString();

  file.sessions[index] = session;
  await saveSessionsFile(file);
  return session;
}
