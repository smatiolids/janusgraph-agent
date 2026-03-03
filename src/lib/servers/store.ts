import { readFile, writeFile } from "node:fs/promises";
import { v4 as uuidv4 } from "uuid";
import YAML from "yaml";
import type { ServerConfig, ServerFile } from "@/lib/types";
import { ensureFileParent, exists } from "@/lib/fs-utils";
import { resolveAppPath } from "@/lib/app-paths";
import { serverSchema } from "@/lib/validators";

const serversFilePath = resolveAppPath("server", "servers.yaml");

const defaultServers: ServerFile = {
  servers: [
    {
      id: "local-janus",
      name: "Local JanusGraph",
      host: "localhost",
      port: 8182,
      protocol: "ws",
      path: "/gremlin",
      username: "",
      password: "",
      traversalSource: "g"
    }
  ]
};

async function loadServersFile(): Promise<ServerFile> {
  if (!(await exists(serversFilePath))) {
    await ensureFileParent(serversFilePath);
    await writeFile(serversFilePath, YAML.stringify(defaultServers), "utf8");
    return defaultServers;
  }

  const raw = await readFile(serversFilePath, "utf8");
  const parsed = YAML.parse(raw) as ServerFile;

  if (!parsed || !Array.isArray(parsed.servers)) {
    throw new Error("Malformed servers.yaml: expected { servers: [] }");
  }

  const servers = parsed.servers.map((server) => serverSchema.parse(server));
  return { servers };
}

async function saveServersFile(content: ServerFile): Promise<void> {
  await ensureFileParent(serversFilePath);
  await writeFile(serversFilePath, YAML.stringify(content), "utf8");
}

export async function listServers(): Promise<ServerConfig[]> {
  const file = await loadServersFile();
  return file.servers;
}

export async function getServerById(id: string): Promise<ServerConfig | undefined> {
  const servers = await listServers();
  return servers.find((server) => server.id === id);
}

export async function createServer(input: Omit<ServerConfig, "id"> & { id?: string }): Promise<ServerConfig> {
  const file = await loadServersFile();
  const normalized: ServerConfig = {
    id: input.id ?? uuidv4(),
    name: input.name.trim(),
    host: input.host.trim(),
    port: input.port,
    protocol: input.protocol,
    path: input.path,
    username: input.username ?? "",
    password: input.password ?? "",
    traversalSource: input.traversalSource ?? "g"
  };

  serverSchema.parse(normalized);

  const duplicate = file.servers.find(
    (server) =>
      server.name.toLowerCase() === normalized.name.toLowerCase() ||
      (server.host === normalized.host && server.port === normalized.port && server.path === normalized.path)
  );

  if (duplicate) {
    throw new Error("A server with same name or host/port/path already exists");
  }

  file.servers.push(normalized);
  await saveServersFile(file);
  return normalized;
}

export async function updateServer(id: string, patch: Partial<Omit<ServerConfig, "id">>): Promise<ServerConfig> {
  const file = await loadServersFile();
  const index = file.servers.findIndex((server) => server.id === id);
  if (index === -1) {
    throw new Error("Server not found");
  }

  const current = file.servers[index];
  const updated: ServerConfig = serverSchema.parse({ ...current, ...patch, id });

  const duplicate = file.servers.find(
    (server, i) =>
      i !== index &&
      (server.name.toLowerCase() === updated.name.toLowerCase() ||
        (server.host === updated.host && server.port === updated.port && server.path === updated.path))
  );

  if (duplicate) {
    throw new Error("A server with same name or host/port/path already exists");
  }

  file.servers[index] = updated;
  await saveServersFile(file);
  return updated;
}

export async function deleteServer(id: string): Promise<void> {
  const file = await loadServersFile();
  const nextServers = file.servers.filter((server) => server.id !== id);
  if (nextServers.length === file.servers.length) {
    throw new Error("Server not found");
  }
  await saveServersFile({ servers: nextServers });
}
