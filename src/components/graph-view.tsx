"use client";

import { useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  Position,
  type Edge,
  type Node,
  useEdgesState,
  useNodesState
} from "reactflow";
import "reactflow/dist/style.css";
import type { GraphPayload } from "@/lib/types";

type Props = {
  graph: GraphPayload;
  loading?: boolean;
};

type InspectorSelection =
  | { kind: "node"; id: string; label?: string; raw?: Record<string, unknown> }
  | { kind: "edge"; id: string; label?: string; source: string; target: string; raw?: Record<string, unknown> }
  | null;

type PropertyItem = {
  label: string;
  value: string;
};

const NODE_SIZE = 92;

function oppositePosition(position: Position): Position {
  if (position === Position.Left) return Position.Right;
  if (position === Position.Right) return Position.Left;
  if (position === Position.Top) return Position.Bottom;
  return Position.Top;
}

function buildLayout(graph: GraphPayload): { nodes: Node[]; edges: Edge[] } {
  const totalNodes = graph.nodes.length;
  const minRadius = 140;
  const spreadRadius = 36;
  const radius = Math.max(minRadius, totalNodes * spreadRadius);
  const centerX = radius + NODE_SIZE;
  const centerY = radius + NODE_SIZE;

  const nodes: Node[] = graph.nodes.map((node, index) => {
    const angle = totalNodes <= 1 ? 0 : (2 * Math.PI * index) / totalNodes;
    const x = centerX + radius * Math.cos(angle) - NODE_SIZE / 2;
    const y = centerY + radius * Math.sin(angle) - NODE_SIZE / 2;
    const anchorPosition =
      Math.abs(Math.cos(angle)) >= Math.abs(Math.sin(angle))
        ? (Math.cos(angle) >= 0 ? Position.Right : Position.Left)
        : Math.sin(angle) >= 0
          ? Position.Bottom
          : Position.Top;
    return {
      id: node.id,
      data: { label: node.label, raw: node.data ?? {} },
      position: { x, y },
      sourcePosition: anchorPosition,
      targetPosition: oppositePosition(anchorPosition),
      style: {
        border: "1px solid #d6d2c4",
        borderRadius: "50%",
        background: "#fff",
        fontSize: 12,
        width: NODE_SIZE,
        height: NODE_SIZE,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "0.4rem"
      }
    };
  });

  const edges: Edge[] = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    data: { raw: edge.data ?? {} },
    markerEnd: { type: MarkerType.ArrowClosed }
  }));

  return { nodes, edges };
}

export function GraphView({ graph, loading = false }: Props) {
  const initial = useMemo(() => buildLayout(graph), [graph]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [selection, setSelection] = useState<InspectorSelection>(null);

  useEffect(() => {
    const next = buildLayout(graph);
    setNodes(next.nodes);
    setEdges(next.edges);
    setSelection(null);
  }, [graph, setNodes, setEdges]);

  function toPropertyItems(raw?: Record<string, unknown>): PropertyItem[] {
    const properties = raw?.properties;
    if (!Array.isArray(properties)) return [];

    return properties
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const record = item as Record<string, unknown>;
        const label = typeof record.label === "string" ? record.label : typeof record.key === "string" ? record.key : null;
        const value = record.value !== undefined ? String(record.value) : null;
        if (!label || value === null) return null;
        return { label, value };
      })
      .filter((item): item is PropertyItem => item !== null);
  }

  if (!graph.nodes.length && !graph.edges.length) {
    return (
      <div className="card graph-fill" style={{ width: "100%" }}>
        No graph elements returned yet.
      </div>
    );
  }

  return (
    <div style={{ width: "100%" }} className="card graph-fill">
      <div className="graph-stage" style={{ gridTemplateColumns: selection ? "1fr 320px" : "1fr" }}>
        <div className="graph-canvas">
          <ReactFlow
            style={{ flex: 1, minHeight: 0 }}
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onPaneClick={() => setSelection(null)}
            onNodeClick={(_, node) =>
              setSelection({
                kind: "node",
                id: node.id,
                label: typeof node.data?.label === "string" ? node.data.label : undefined,
                raw: (node.data?.raw ?? undefined) as Record<string, unknown> | undefined
              })
            }
            onEdgeClick={(_, edge) =>
              setSelection({
                kind: "edge",
                id: edge.id,
                source: edge.source,
                target: edge.target,
                label: typeof edge.label === "string" ? edge.label : undefined,
                raw: (edge.data?.raw ?? undefined) as Record<string, unknown> | undefined
              })
            }
            fitView
          >
            <Background />
            <Controls />
          </ReactFlow>
          {loading ? (
            <div className="graph-loading-overlay">
              <span className="spinner" />
              <span>Executing query...</span>
            </div>
          ) : null}
        </div>

        {selection ? (
          <aside className="graph-inspector">
            <div className="stack" style={{ gap: "0.5rem" }}>
              <div style={{ fontWeight: 600 }}>{selection.kind === "node" ? "Vertex" : "Edge"} Details</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>ID: {selection.id}</div>
              {selection.label ? <div style={{ fontSize: 12, color: "var(--muted)" }}>Label: {selection.label}</div> : null}
              {selection.kind === "edge" ? (
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  Connection: {selection.source} → {selection.target}
                </div>
              ) : null}

              <div style={{ fontWeight: 600, marginTop: "0.25rem" }}>Properties</div>
              {toPropertyItems(selection.raw).length > 0 ? (
                <div className="stack" style={{ gap: "0.35rem" }}>
                  {toPropertyItems(selection.raw).map((prop) => (
                    <div key={`${prop.label}:${prop.value}`} className="graph-prop-row">
                      <div className="graph-prop-label">{prop.label}</div>
                      <div className="graph-prop-value">{prop.value}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "var(--muted)" }}>No properties.</div>
              )}
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
