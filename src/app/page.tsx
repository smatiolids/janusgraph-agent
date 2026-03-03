"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ServerSelector } from "@/components/server-selector";
import type { ServerConfig } from "@/lib/types";

export default function HomePage() {
  const router = useRouter();
  const [servers, setServers] = useState<ServerConfig[]>([]);
  const [error, setError] = useState("");
  const [envWarning, setEnvWarning] = useState("");

  async function fetchServers() {
    const response = await fetch("/api/servers");
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to load servers");
    }

    setServers(Array.isArray(payload.servers) ? payload.servers : []);
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

  async function handleConnect(server: ServerConfig) {
    setError("");
    router.push(`/agents?serverId=${encodeURIComponent(server.id)}`);
  }

  return (
    <main className="container">
      {envWarning ? <p className="warning">{envWarning}</p> : null}
      <ServerSelector
        servers={servers}
        onConnect={handleConnect}
        onServerCreated={(server) => setServers((prev) => [...prev, server])}
        onServerUpdated={(server) => {
          setServers((prev) => prev.map((item) => (item.id === server.id ? server : item)));
        }}
      />
      {error ? <p className="error">{error}</p> : null}
    </main>
  );
}
