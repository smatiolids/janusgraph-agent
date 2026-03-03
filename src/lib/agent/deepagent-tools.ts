import path from "node:path";
import { appendFile, mkdir, readFile as readFileFromDisk, rm, writeFile as writeFileToDisk } from "node:fs/promises";
import YAML from "yaml";
import { resolveAppPath } from "@/lib/app-paths";
import { exists } from "@/lib/fs-utils";
import { runGremlinQuery } from "@/lib/gremlin/client";
import { getSessionAgentContext, getSessionById, updateSessionAgentContext } from "@/lib/sessions/store";
import type { ServerConfig } from "@/lib/types";
import type { DeepAgentResult } from "@/lib/agent/deepagent.types";

type LabelSamples = {
  sampleSizePerLabel: number;
  vertexLabels: string[];
  edgeLabels: string[];
  vertexSamplesByLabel: Record<string, unknown>;
  edgeSamplesByLabel: Record<string, unknown>;
  warning?: string;
  error?: string;
};

const defaultDataModel = {
  description: "Graph data model placeholder. Customize server/datamodel.json or server/datamodel.yaml.",
  vertices: [],
  edges: []
};

const promptLogDir = resolveAppPath("log");
const promptLogFile = path.join(promptLogDir, "agent-prompts.log");
const sessionContextRoot = resolveAppPath("server");
const legacySessionContextRoot = resolveAppPath("server", "session-contexts");

const janusSchemaQuery = `mgmt = graph.openManagement(); try { [
  vertexLabels: mgmt.getVertexLabels().collect { it.name() }.sort(),
  edgeLabels: mgmt.getRelationTypes(org.janusgraph.core.EdgeLabel.class).collect { it.name() }.sort(),
  propertyKeys: mgmt.getRelationTypes(org.janusgraph.core.PropertyKey.class).collect {
    [name: it.name(), dataType: it.dataType() ? it.dataType().simpleName : "UNKNOWN", cardinality: String.valueOf(it.cardinality())]
  }.sort { it.name },
  vertexIndexes: mgmt.getGraphIndexes(org.apache.tinkerpop.gremlin.structure.Vertex.class).collect { idx ->
    [name: idx.name(), unique: idx.isUnique(), backingIndex: idx.getBackingIndex(), keys: idx.getFieldKeys().collect { fk ->
      [name: fk.name(), status: String.valueOf(idx.getIndexStatus(fk))]
    }]
  }.sort { it.name },
  edgeIndexes: mgmt.getGraphIndexes(org.apache.tinkerpop.gremlin.structure.Edge.class).collect { idx ->
    [name: idx.name(), unique: idx.isUnique(), backingIndex: idx.getBackingIndex(), keys: idx.getFieldKeys().collect { fk ->
      [name: fk.name(), status: String.valueOf(idx.getIndexStatus(fk))]
    }]
  }.sort { it.name }
] } finally { mgmt.rollback() }`;

export async function logGeneratedPrompt(payload: Record<string, unknown>): Promise<void> {
  try {
    await mkdir(promptLogDir, { recursive: true });
    await appendFile(
      promptLogFile,
      `${JSON.stringify({ ts: new Date().toISOString(), ...payload })}\n`,
      "utf8"
    );
  } catch {
    // Avoid breaking requests due to prompt logging issues.
  }
}

export async function writeLastPromptMarkdown(params: {
  sessionId: string;
  serverId: string;
  model: string;
  prompt: string;
  agentRawResponse: string;
  parsedResponse?: DeepAgentResult;
  parseError?: string;
}): Promise<void> {
  const filePath = path.join(promptLogDir, `${params.sessionId}-last-prompt.md`);
  const markdown = [
    `# Last Agent Interaction`,
    ``,
    `- ts: ${new Date().toISOString()}`,
    `- sessionId: ${params.sessionId}`,
    `- serverId: ${params.serverId}`,
    `- model: ${params.model}`,
    ``,
    `## Prompt`,
    ``,
    "```text",
    params.prompt,
    "```",
    ``,
    `## Agent Raw Response`,
    ``,
    "```text",
    params.agentRawResponse,
    "```",
    ``
  ];

  if (params.parsedResponse) {
    markdown.push(
      `## Parsed Response`,
      ``,
      "```json",
      JSON.stringify(params.parsedResponse, null, 2),
      "```",
      ``
    );
  }

  if (params.parseError) {
    markdown.push(`## Parse Error`, ``, "```text", params.parseError, "```", ``);
  }

  try {
    await mkdir(promptLogDir, { recursive: true });
    await writeFileToDisk(filePath, markdown.join("\n"), "utf8");
  } catch {
    // Avoid breaking requests due to markdown logging issues.
  }
}

function getSessionSampleSize(): number {
  const raw = process.env.JANUSGRAPH_SESSION_SAMPLE_SIZE;
  if (!raw) return 1;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return parsed;
}

function getSessionContextPaths(sessionId: string): { graphDataModelPath: string; janusgraphSchemaIndexesPath: string } {
  const sessionDir = path.join(sessionContextRoot, sessionId);
  return {
    graphDataModelPath: path.join(sessionDir, "graph_datamodel.json"),
    janusgraphSchemaIndexesPath: path.join(sessionDir, "janusgraph_schema_indexes.json")
  };
}

function getLegacySessionContextPaths(sessionId: string): { graphDataModelPath: string; janusgraphSchemaIndexesPath: string } {
  const sessionDir = path.join(legacySessionContextRoot, sessionId);
  return {
    graphDataModelPath: path.join(sessionDir, "graph_datamodel.json"),
    janusgraphSchemaIndexesPath: path.join(sessionDir, "janusgraph_schema_indexes.json")
  };
}

async function loadGraphDataModel(): Promise<unknown> {
  const envModel = process.env.GRAPH_DATA_MODEL_JSON;
  if (envModel) {
    try {
      return JSON.parse(envModel);
    } catch {
      return {
        ...defaultDataModel,
        warning: "GRAPH_DATA_MODEL_JSON is not valid JSON"
      };
    }
  }

  const jsonPath = resolveAppPath("server", "datamodel.json");
  if (await exists(jsonPath)) {
    const raw = await readFileFromDisk(jsonPath, "utf8");
    return JSON.parse(raw);
  }

  const yamlPath = resolveAppPath("server", "datamodel.yaml");
  if (await exists(yamlPath)) {
    const raw = await readFileFromDisk(yamlPath, "utf8");
    return YAML.parse(raw);
  }

  return defaultDataModel;
}

async function inspectJanusGraphRuntimeContext(server: ServerConfig): Promise<Record<string, unknown>> {
  try {
    const schema = await runGremlinQuery(server, janusSchemaQuery);

    return {
      source: "janusgraph_live",
      inspectedAt: new Date().toISOString(),
      details: schema
    };
  } catch (error) {
    const fallbackDetails: Record<string, unknown> = {};
    try {
      fallbackDetails.vertexLabels = await runGremlinQuery(server, "g.V().label().dedup().order().limit(200)");
      fallbackDetails.edgeLabels = await runGremlinQuery(server, "g.E().label().dedup().order().limit(200)");
      fallbackDetails.vertexPropertyKeys = await runGremlinQuery(
        server,
        "g.V().limit(200).properties().key().dedup().order()"
      );
      fallbackDetails.edgePropertyKeys = await runGremlinQuery(
        server,
        "g.E().limit(200).properties().key().dedup().order()"
      );
    } catch (fallbackError) {
      fallbackDetails.fallbackError = fallbackError instanceof Error ? fallbackError.message : "Unknown fallback error";
    }

    return {
      source: "janusgraph_live",
      inspectedAt: new Date().toISOString(),
      warning: "Failed to inspect JanusGraph schema/indexes",
      error: error instanceof Error ? error.message : "Unknown inspection error",
      fallbackDetails
    };
  }
}

function escapeGremlinString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function collectLabelSamples(server: ServerConfig, sampleSize: number): Promise<LabelSamples> {
  const [vertexLabelsRaw, edgeLabelsRaw] = await Promise.all([
    runGremlinQuery(server, "g.V().label().dedup().order()"),
    runGremlinQuery(server, "g.E().label().dedup().order()")
  ]);

  const vertexLabels = Array.isArray(vertexLabelsRaw) ? vertexLabelsRaw.map((v) => String(v)) : [];
  const edgeLabels = Array.isArray(edgeLabelsRaw) ? edgeLabelsRaw.map((v) => String(v)) : [];

  const vertexEntries = await Promise.all(
    vertexLabels.map(async (label) => {
      const query = `g.V().hasLabel('${escapeGremlinString(label)}').limit(${sampleSize})`;
      const sample = await runGremlinQuery(server, query);
      return [label, sample] as const;
    })
  );

  const edgeEntries = await Promise.all(
    edgeLabels.map(async (label) => {
      const query = `g.E().hasLabel('${escapeGremlinString(label)}').limit(${sampleSize})`;
      const sample = await runGremlinQuery(server, query);
      return [label, sample] as const;
    })
  );

  return {
    sampleSizePerLabel: sampleSize,
    vertexLabels,
    edgeLabels,
    vertexSamplesByLabel: Object.fromEntries(vertexEntries),
    edgeSamplesByLabel: Object.fromEntries(edgeEntries)
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function enrichGraphDataModelWithSamples(baseDataModel: unknown, labelSamples: LabelSamples): Record<string, unknown> {
  const model = isRecord(baseDataModel) ? baseDataModel : defaultDataModel;

  const baseVertices = Array.isArray(model.vertices) ? model.vertices : [];
  const baseEdges = Array.isArray(model.edges) ? model.edges : [];

  const enrichedVertices = baseVertices.map((vertex) => {
    if (!isRecord(vertex) || typeof vertex.label !== "string") return vertex;
    return {
      ...vertex,
      sampleRecords: labelSamples.vertexSamplesByLabel[vertex.label] ?? []
    };
  });

  const enrichedEdges = baseEdges.map((edge) => {
    if (!isRecord(edge) || typeof edge.label !== "string") return edge;
    return {
      ...edge,
      sampleRecords: labelSamples.edgeSamplesByLabel[edge.label] ?? []
    };
  });

  const knownVertexLabels = new Set(
    enrichedVertices.filter(isRecord).map((vertex) => vertex.label).filter((label): label is string => typeof label === "string")
  );
  const knownEdgeLabels = new Set(
    enrichedEdges.filter(isRecord).map((edge) => edge.label).filter((label): label is string => typeof label === "string")
  );

  const inferredVertices = labelSamples.vertexLabels
    .filter((label) => !knownVertexLabels.has(label))
    .map((label) => ({
      label,
      inferred: true,
      sampleRecords: labelSamples.vertexSamplesByLabel[label] ?? []
    }));

  const inferredEdges = labelSamples.edgeLabels
    .filter((label) => !knownEdgeLabels.has(label))
    .map((label) => ({
      label,
      inferred: true,
      sampleRecords: labelSamples.edgeSamplesByLabel[label] ?? []
    }));

  return {
    ...model,
    vertices: [...enrichedVertices, ...inferredVertices],
    edges: [...enrichedEdges, ...inferredEdges],
    sampleSizePerLabel: labelSamples.sampleSizePerLabel,
    enrichedAt: new Date().toISOString()
  };
}

async function readJsonFile(pathToFile: string): Promise<unknown> {
  const raw = await readFileFromDisk(pathToFile, "utf8");
  return JSON.parse(raw);
}

export async function buildPromptWithSessionQueryHistory(sessionId: string, prompt: string): Promise<string> {
  const session = await getSessionById(sessionId);
  if (!session) return prompt;

  const previousQueries = session.messages
    .filter((message) => message.role === "assistant" && typeof message.query === "string" && message.query.trim().length > 0)
    .map((message) => message.query!.trim());

  if (previousQueries.length === 0) return prompt;

  const historyBlock = previousQueries.map((query, index) => `${index + 1}. ${query}`).join("\n");

  return [
    "Session previous generated Gremlin queries:",
    historyBlock,
    "",
    "Current user request:",
    prompt
  ].join("\n");
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toLabelStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter((item) => item.length > 0);
}

function extractPropertyNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names = value
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (!isObjectRecord(entry)) return undefined;
      if (typeof entry.name === "string") return entry.name;
      if (typeof entry.key === "string") return entry.key;
      return undefined;
    })
    .filter((item): item is string => typeof item === "string");
  return Array.from(new Set(names));
}

function collectIndexedPropertyNames(indexes: unknown): Set<string> {
  if (!Array.isArray(indexes)) return new Set<string>();

  const indexedProps: string[] = [];
  for (const idx of indexes) {
    if (!isObjectRecord(idx) || !Array.isArray(idx.keys)) continue;
    for (const key of idx.keys) {
      if (!isObjectRecord(key) || typeof key.name !== "string") continue;
      indexedProps.push(key.name);
    }
  }

  return new Set(indexedProps);
}

function compactSample(sample: unknown): Record<string, unknown> {
  if (!isObjectRecord(sample)) return { value: sample };

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(sample)) {
    if (["id", "label", "type"].includes(key)) {
      result[key] = value;
      continue;
    }

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
      result[key] = value;
      continue;
    }

    if (Array.isArray(value)) {
      result[key] = value.slice(0, 3);
      continue;
    }

    if (isObjectRecord(value)) {
      result[key] = Object.fromEntries(
        Object.entries(value)
          .slice(0, 5)
          .map(([nestedKey, nestedValue]) => [nestedKey, nestedValue])
      );
    }
  }
  return result;
}

function collectPropertySampleValues(sampleRecords: unknown[], propertyName: string): unknown[] {
  const values: unknown[] = [];

  for (const record of sampleRecords) {
    if (!isObjectRecord(record)) continue;

    // Shape A: flattened map-like samples: { prop: value }
    if (propertyName in record) {
      const value = record[propertyName];
      if (Array.isArray(value)) {
        values.push(...value.slice(0, 3));
      } else {
        values.push(value);
      }
      continue;
    }

    // Shape B: JanusGraph element samples: { properties: [{ key|label, value }, ...] }
    const props = record.properties;
    if (!Array.isArray(props)) continue;
    for (const prop of props) {
      if (!isObjectRecord(prop)) continue;
      const key = typeof prop.key === "string"
        ? prop.key
        : typeof prop.label === "string"
          ? prop.label
          : undefined;
      if (key !== propertyName) continue;
      values.push(prop.value);
    }
  }

  const deduped: unknown[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const key = typeof value === "string" ? value : JSON.stringify(value);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(value);
    }
    if (deduped.length >= 5) break;
  }

  return deduped;
}

function buildPropertiesObject(
  propertyNames: string[],
  indexedPropertyNames: Set<string>,
  sampleRecords: unknown[]
): Record<string, { indexed: boolean; sample_values: unknown[] }> {
  return Object.fromEntries(
    propertyNames.slice(0, 20).map((name) => [
      name,
      {
        indexed: indexedPropertyNames.has(name),
        sample_values: collectPropertySampleValues(sampleRecords, name)
      }
    ])
  );
}

function buildRootSampleValues(
  sampleRecords: unknown[],
  labelType: "vertex" | "edge"
): Array<{ id: unknown; values: Record<string, unknown> }> {
  return sampleRecords.slice(0, 2).flatMap((sample) => {
    if (!isObjectRecord(sample)) return [];

    const values: Record<string, unknown> = {};
    const nestedProperties = Array.isArray(sample.properties) ? sample.properties : [];

    for (const prop of nestedProperties) {
      if (!isObjectRecord(prop)) continue;
      const key = typeof prop.key === "string"
        ? prop.key
        : typeof prop.label === "string"
          ? prop.label
          : undefined;
      if (!key) continue;
      values[key] = prop.value;
    }

    for (const [key, value] of Object.entries(sample)) {
      if (["id", "label", "type", "properties", "inV", "outV"].includes(key)) continue;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
        values[key] = value;
      }
    }

    if (labelType === "edge") {
      const outV = isObjectRecord(sample.outV) ? sample.outV : undefined;
      const inV = isObjectRecord(sample.inV) ? sample.inV : undefined;
      if (typeof outV?.label === "string") values.outV_label = outV.label;
      if (typeof inV?.label === "string") values.inV_label = inV.label;
    }

    return [{ id: sample.id, values }];
  });
}

function inferEndpointLabelFromSamples(
  sampleRecords: unknown[],
  direction: "outV" | "inV"
): string | undefined {
  for (const sample of sampleRecords) {
    if (!isObjectRecord(sample)) continue;
    const endpoint = sample[direction];
    if (!isObjectRecord(endpoint)) continue;
    if (typeof endpoint.label === "string" && endpoint.label.length > 0) {
      return endpoint.label;
    }
  }
  return undefined;
}

function summarizeLabelEntries(
  entries: unknown,
  labelType: "vertex" | "edge",
  indexedPropertyNames: Set<string>
): Array<Record<string, unknown>> {
  if (!Array.isArray(entries)) return [];

  return entries
    .filter(isObjectRecord)
    .map((entry) => {
      const label = typeof entry.label === "string" ? entry.label : undefined;
      if (!label) return undefined;

      const sampleRecords = Array.isArray(entry.sampleRecords) ? entry.sampleRecords : [];
      const properties = extractPropertyNames(entry.properties);

      if (labelType === "edge") {
        const outLabelFromModel = typeof entry.from === "string" ? entry.from : undefined;
        const inLabelFromModel = typeof entry.to === "string" ? entry.to : undefined;
        const outLabel = outLabelFromModel ?? inferEndpointLabelFromSamples(sampleRecords, "outV");
        const inLabel = inLabelFromModel ?? inferEndpointLabelFromSamples(sampleRecords, "inV");

        return {
          label,
          inV: { label: inLabel ?? "unknown" },
          outV: { label: outLabel ?? "unknown" },
          properties: buildPropertiesObject(properties, indexedPropertyNames, sampleRecords),
          sample_values: buildRootSampleValues(sampleRecords, "edge")
        };
      }

      return {
        label,
        type: labelType,
        properties: buildPropertiesObject(properties, indexedPropertyNames, sampleRecords),
        sample_values: buildRootSampleValues(sampleRecords, "vertex")
      };
    })
    .filter((entry): entry is Record<string, unknown> => !!entry);
}

export async function getSessionGraphContextSummary(sessionId: string): Promise<Record<string, unknown>> {
  const { dataModel, janusRuntimeContext } = await loadSessionContextFiles(sessionId);

  const model = isObjectRecord(dataModel) ? dataModel : {};
  const runtime = isObjectRecord(janusRuntimeContext) ? janusRuntimeContext : {};
  const runtimeDetails = isObjectRecord(runtime.details) ? runtime.details : {};
  const labelSamples = isObjectRecord(runtime.labelSamples) ? runtime.labelSamples : {};
  const vertexIndexedProps = collectIndexedPropertyNames(runtimeDetails.vertexIndexes);
  const edgeIndexedProps = collectIndexedPropertyNames(runtimeDetails.edgeIndexes);
  const vertexSamplesByLabel = isObjectRecord(labelSamples.vertexSamplesByLabel)
    ? labelSamples.vertexSamplesByLabel
    : {};
  const edgeSamplesByLabel = isObjectRecord(labelSamples.edgeSamplesByLabel)
    ? labelSamples.edgeSamplesByLabel
    : {};

  const vertices = summarizeLabelEntries(model.vertices, "vertex", vertexIndexedProps);
  const edges = summarizeLabelEntries(model.edges, "edge", edgeIndexedProps);

  const fallbackVertexLabels = toLabelStringArray(runtimeDetails.vertexLabels);
  const fallbackEdgeLabels = toLabelStringArray(runtimeDetails.edgeLabels);

  const knownVertexLabels = new Set(vertices.map((entry) => String(entry.label)));
  const knownEdgeLabels = new Set(edges.map((entry) => String(entry.label)));

  const inferredVertices = fallbackVertexLabels
    .filter((label) => !knownVertexLabels.has(label))
    .slice(0, 50)
    .map((label) => {
      const samplesRaw = Array.isArray(vertexSamplesByLabel[label])
        ? vertexSamplesByLabel[label]
        : [];
      const samples = samplesRaw.slice(0, 2).map((sample) => compactSample(sample));
      const samplePropNames = Array.from(
        new Set(
          samples.flatMap((sample) =>
            Object.keys(sample).filter((key) => !["id", "label", "type"].includes(key))
          )
        )
      );
      return {
        label,
        type: "vertex",
        properties: buildPropertiesObject(samplePropNames, vertexIndexedProps, samplesRaw),
        sample_values: buildRootSampleValues(samplesRaw, "vertex")
      };
    });

  const inferredEdges = fallbackEdgeLabels
    .filter((label) => !knownEdgeLabels.has(label))
    .slice(0, 50)
    .map((label) => {
      const samplesRaw = Array.isArray(edgeSamplesByLabel[label])
        ? edgeSamplesByLabel[label]
        : [];
      const samples = samplesRaw.slice(0, 2).map((sample) => compactSample(sample));
      const samplePropNames = Array.from(
        new Set(
          samples.flatMap((sample) =>
            Object.keys(sample).filter((key) => !["id", "label", "type"].includes(key))
          )
        )
      );
      const outLabel = inferEndpointLabelFromSamples(samplesRaw, "outV");
      const inLabel = inferEndpointLabelFromSamples(samplesRaw, "inV");
      return {
        label,
        inV: { label: inLabel ?? "unknown" },
        outV: { label: outLabel ?? "unknown" },
        properties: buildPropertiesObject(samplePropNames, edgeIndexedProps, samplesRaw),
        sample_values: buildRootSampleValues(samplesRaw, "edge")
      };
    });

  const summary = {
    source: "session_context_summary",
    sampleSizePerLabel: typeof labelSamples.sampleSizePerLabel === "number" ? labelSamples.sampleSizePerLabel : undefined,
    vertices: [...vertices, ...inferredVertices],
    edges: [...edges, ...inferredEdges]
  };

  const sessionContextPaths = getSessionContextPaths(sessionId);
  const summaryPath = path.join(path.dirname(sessionContextPaths.graphDataModelPath), "graph_context_summary.json");
  await mkdir(path.dirname(summaryPath), { recursive: true });
  await writeFileToDisk(summaryPath, JSON.stringify(summary, null, 2), "utf8");

  return summary;
}

export async function loadSessionContextFiles(sessionId: string): Promise<{ dataModel: unknown; janusRuntimeContext: unknown }> {
  const sessionContext = await getSessionAgentContext(sessionId);
  const primaryPaths = getSessionContextPaths(sessionId);
  const legacyPaths = getLegacySessionContextPaths(sessionId);

  const graphDataModelPathCandidates = [
    sessionContext?.contextFiles?.graphDataModelPath,
    primaryPaths.graphDataModelPath,
    legacyPaths.graphDataModelPath
  ].filter((candidate): candidate is string => typeof candidate === "string");

  const janusgraphSchemaIndexesPathCandidates = [
    sessionContext?.contextFiles?.janusgraphSchemaIndexesPath,
    primaryPaths.janusgraphSchemaIndexesPath,
    legacyPaths.janusgraphSchemaIndexesPath
  ].filter((candidate): candidate is string => typeof candidate === "string");

  const graphDataModelPath = (
    await Promise.all(
      graphDataModelPathCandidates.map(async (candidate) => ((await exists(candidate)) ? candidate : undefined))
    )
  ).find(Boolean);

  const janusgraphSchemaIndexesPath = (
    await Promise.all(
      janusgraphSchemaIndexesPathCandidates.map(async (candidate) => ((await exists(candidate)) ? candidate : undefined))
    )
  ).find(Boolean);

  const dataModel = graphDataModelPath
    ? await readJsonFile(graphDataModelPath)
    : {
        ...defaultDataModel,
        warning: "Session graph data model file not found. Start a new session to initialize context files."
      };

  const janusRuntimeContext = janusgraphSchemaIndexesPath
    ? await readJsonFile(janusgraphSchemaIndexesPath)
    : {
        source: "session_file",
        warning: "Session JanusGraph schema/indexes file not found. Start a new session to initialize context files."
      };

  // Migrate legacy session-context files into server/<session-id>/ on first access.
  const shouldMigrateGraph = graphDataModelPath && graphDataModelPath !== primaryPaths.graphDataModelPath;
  const shouldMigrateSchema =
    janusgraphSchemaIndexesPath && janusgraphSchemaIndexesPath !== primaryPaths.janusgraphSchemaIndexesPath;

  if (shouldMigrateGraph || shouldMigrateSchema) {
    await mkdir(path.dirname(primaryPaths.graphDataModelPath), { recursive: true });

    if (shouldMigrateGraph) {
      await writeFileToDisk(primaryPaths.graphDataModelPath, JSON.stringify(dataModel, null, 2), "utf8");
    }

    if (shouldMigrateSchema) {
      await writeFileToDisk(primaryPaths.janusgraphSchemaIndexesPath, JSON.stringify(janusRuntimeContext, null, 2), "utf8");
    }

    await updateSessionAgentContext(sessionId, {
      janusgraphRuntimeContext: janusRuntimeContext as Record<string, unknown>,
      janusgraphContextUpdatedAt: new Date().toISOString(),
      contextFiles: primaryPaths
    });
  }

  return { dataModel, janusRuntimeContext };
}

export async function initializeSessionContextFiles(sessionId: string, server: ServerConfig): Promise<void> {
  const contextPaths = getSessionContextPaths(sessionId);
  const sampleSize = getSessionSampleSize();
  const [dataModel, janusRuntimeContext, labelSamples] = await Promise.all([
    loadGraphDataModel(),
    inspectJanusGraphRuntimeContext(server),
    collectLabelSamples(server, sampleSize).catch((error): LabelSamples => ({
      sampleSizePerLabel: sampleSize,
      warning: "Failed to load per-label samples",
      error: error instanceof Error ? error.message : "Unknown sampling error",
      vertexLabels: [],
      edgeLabels: [],
      vertexSamplesByLabel: {},
      edgeSamplesByLabel: {}
    }))
  ]);

  const enrichedDataModel = enrichGraphDataModelWithSamples(dataModel, labelSamples);

  const sessionSchemaIndexesContext = {
    ...janusRuntimeContext,
    labelSamples
  };

  await mkdir(path.dirname(contextPaths.graphDataModelPath), { recursive: true });
  await writeFileToDisk(contextPaths.graphDataModelPath, JSON.stringify(enrichedDataModel, null, 2), "utf8");
  await writeFileToDisk(
    contextPaths.janusgraphSchemaIndexesPath,
    JSON.stringify(sessionSchemaIndexesContext, null, 2),
    "utf8"
  );

  await updateSessionAgentContext(sessionId, {
    janusgraphRuntimeContext: sessionSchemaIndexesContext,
    janusgraphContextUpdatedAt: new Date().toISOString(),
    contextFiles: contextPaths
  });
}

export async function deleteSessionContextFiles(sessionId: string): Promise<void> {
  const sessionDir = path.join(sessionContextRoot, sessionId);
  const legacySessionDir = path.join(legacySessionContextRoot, sessionId);
  await Promise.all([
    rm(sessionDir, { recursive: true, force: true }),
    rm(legacySessionDir, { recursive: true, force: true })
  ]);
}
