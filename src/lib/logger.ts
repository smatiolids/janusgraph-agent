import path from "node:path";
import { appendFile, mkdir } from "node:fs/promises";
import { resolveAppPath } from "@/lib/app-paths";

type LogLevel = "debug" | "info" | "warn" | "error";

type LogPayload = Record<string, unknown>;

const levels: LogLevel[] = ["debug", "info", "warn", "error"];
const logDir = resolveAppPath("log");
const logFile = path.join(logDir, "app.log");

function getConfiguredLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL || "info").toLowerCase();
  if (levels.includes(raw as LogLevel)) {
    return raw as LogLevel;
  }
  return "info";
}

function shouldLog(level: LogLevel): boolean {
  return levels.indexOf(level) >= levels.indexOf(getConfiguredLevel());
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(record)) {
    const lowered = key.toLowerCase();
    if (lowered.includes("password") || lowered.includes("apikey") || lowered.includes("authorization") || lowered.includes("token")) {
      out[key] = "[REDACTED]";
    } else {
      out[key] = redact(val);
    }
  }

  return out;
}

export async function logEvent(level: LogLevel, event: string, payload: LogPayload = {}): Promise<void> {
  if (!shouldLog(level)) return;

  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    payload: redact(payload)
  });

  try {
    await mkdir(logDir, { recursive: true });
    await appendFile(logFile, `${line}\n`, "utf8");
  } catch {
    // Avoid failing API requests due to logging errors.
  }
}
