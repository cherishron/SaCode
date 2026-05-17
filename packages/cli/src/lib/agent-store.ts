import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface AgentConfigEntry {
  id: string;
  name: string;
  model: string;
  tools: string[];
  permissionProfile: string;
  enabled: boolean;
  subAgents: string[];
  description?: string;
}

export interface AgentStoreData {
  agents: AgentConfigEntry[];
  defaultAgent?: string;
  collaborationEnabled: boolean;
  subAgentDispatchEnabled: boolean;
}

export interface AgentStoreOptions {
  configDir?: string;
}

export function getAgentStorePath(options: AgentStoreOptions = {}): string {
  return path.join(options.configDir ?? path.join(os.homedir(), ".sacode"), "agents.json");
}

export function createDefaultAgentStore(): AgentStoreData {
  return {
    defaultAgent: "general",
    collaborationEnabled: false,
    subAgentDispatchEnabled: false,
    agents: [{
      id: "general",
      name: "General Agent",
      model: "openai/gpt-4o",
      tools: ["read_file", "list_directory", "search_files"],
      permissionProfile: "local-safe",
      enabled: true,
      subAgents: [],
      description: "Default assistant for general coding and project analysis tasks.",
    }],
  };
}

export async function setAgentCollaboration(enabled: boolean, options: AgentStoreOptions = {}): Promise<AgentStoreData> {
  const data = await ensureAgentStore(options);
  const updated = validateAgentStore({ ...data, collaborationEnabled: enabled });
  await saveAgentStore(updated, options);
  return updated;
}

export async function setSubAgentDispatch(enabled: boolean, options: AgentStoreOptions = {}): Promise<AgentStoreData> {
  const data = await ensureAgentStore(options);
  const updated = validateAgentStore({ ...data, subAgentDispatchEnabled: enabled });
  await saveAgentStore(updated, options);
  return updated;
}

export async function setDefaultAgent(agentId: string, options: AgentStoreOptions = {}): Promise<AgentStoreData> {
  const data = await ensureAgentStore(options);
  if (!data.agents.some((agent) => agent.id === agentId && agent.enabled)) {
    throw new Error(`Agent not found or disabled: ${agentId}`);
  }
  const updated = validateAgentStore({ ...data, defaultAgent: agentId });
  await saveAgentStore(updated, options);
  return updated;
}

export async function upsertAgent(agent: AgentConfigEntry, options: AgentStoreOptions = {}): Promise<AgentStoreData> {
  const data = await ensureAgentStore(options);
  const agents = [...data.agents];
  const index = agents.findIndex((item) => item.id === agent.id);
  if (index >= 0) {
    agents[index] = agent;
  } else {
    agents.push(agent);
  }
  const updated = validateAgentStore({ ...data, agents, defaultAgent: data.defaultAgent ?? agent.id });
  await saveAgentStore(updated, options);
  return updated;
}

export async function removeAgent(agentId: string, options: AgentStoreOptions = {}): Promise<AgentStoreData> {
  const data = await ensureAgentStore(options);
  const agents = data.agents.filter((agent) => agent.id !== agentId);
  if (agents.length === data.agents.length) {
    throw new Error(`Agent not found: ${agentId}`);
  }
  const referencedBy = data.agents.filter((agent) => agent.id !== agentId && agent.subAgents.includes(agentId));
  if (referencedBy.length > 0) {
    throw new Error(`Agent is still referenced by: ${referencedBy.map((agent) => agent.id).join(", ")}`);
  }

  const nextDefaultAgent = data.defaultAgent === agentId
    ? agents.find((agent) => agent.enabled)?.id
    : data.defaultAgent;

  const updated = validateAgentStore({
    ...data,
    agents,
    ...(nextDefaultAgent ? { defaultAgent: nextDefaultAgent } : {}),
  });
  await saveAgentStore(updated, options);
  return updated;
}

export function buildAgentDispatchPlan(data: AgentStoreData, prompt: string): { enabled: boolean; primaryAgent?: AgentConfigEntry; subAgents: AgentConfigEntry[]; reason: string } {
  const primaryAgent = data.agents.find((agent) => agent.id === data.defaultAgent && agent.enabled) ?? data.agents.find((agent) => agent.enabled);
  if (!data.collaborationEnabled) {
    return { enabled: false, primaryAgent, subAgents: [], reason: "agent collaboration is disabled" };
  }
  if (!primaryAgent) {
    return { enabled: false, subAgents: [], reason: "no enabled primary agent" };
  }
  if (!data.subAgentDispatchEnabled || primaryAgent.subAgents.length === 0) {
    return { enabled: true, primaryAgent, subAgents: [], reason: "collaboration enabled with primary agent only" };
  }

  const terms = prompt.toLowerCase();
  const subAgents = data.agents.filter((agent) => primaryAgent.subAgents.includes(agent.id) && agent.enabled && shouldDispatchAgent(agent, terms));
  return {
    enabled: true,
    primaryAgent,
    subAgents,
    reason: subAgents.length > 0 ? "matched enabled sub agents" : "no sub agent matched prompt",
  };
}

export async function ensureAgentStore(options: AgentStoreOptions = {}): Promise<AgentStoreData> {
  const storePath = getAgentStorePath(options);
  try {
    await fs.access(storePath);
    return loadAgentStore(options);
  } catch {
    const data = createDefaultAgentStore();
    await saveAgentStore(data, options);
    return data;
  }
}

export async function loadAgentStore(options: AgentStoreOptions = {}): Promise<AgentStoreData> {
  try {
    return validateAgentStore(normalizeAgentStore(JSON.parse(await fs.readFile(getAgentStorePath(options), "utf-8"))));
  } catch {
    return createDefaultAgentStore();
  }
}

export async function saveAgentStore(data: AgentStoreData, options: AgentStoreOptions = {}): Promise<void> {
  const storePath = getAgentStorePath(options);
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, `${JSON.stringify(validateAgentStore(normalizeAgentStore(data)), null, 2)}\n`, "utf-8");
}

export function formatAgents(data: AgentStoreData): string {
  if (data.agents.length === 0) return "未配置 Agent。";
  const referencedBy = buildReferencedByMap(data.agents);
  return [
    "已配置 Agent:",
    `collaboration: ${data.collaborationEnabled ? "enabled" : "disabled"}`,
    `sub-agent dispatch: ${data.subAgentDispatchEnabled ? "enabled" : "disabled"}`,
    ...data.agents.map((agent) => {
      const marker = data.defaultAgent === agent.id ? "*" : "-";
      const status = agent.enabled ? "enabled" : "disabled";
      const referenced = referencedBy.get(agent.id) ?? [];
      return `${marker} ${agent.id} (${agent.name})\n  status: ${status}\n  model: ${agent.model}\n  tools: ${agent.tools.join(", ") || "none"}\n  permission: ${agent.permissionProfile}\n  subAgents: ${agent.subAgents.join(", ") || "none"}\n  referencedBy: ${referenced.join(", ") || "none"}${agent.description ? `\n  description: ${agent.description}` : ""}`;
    }),
  ].join("\n");
}

export function validateAgentStore(data: AgentStoreData): AgentStoreData {
  const ids = new Set(data.agents.map((agent) => agent.id));
  const graph = new Map(data.agents.map((agent) => [agent.id, agent.subAgents]));
  const agentMap = new Map(data.agents.map((agent) => [agent.id, agent]));

  for (const agent of data.agents) {
    if (agent.subAgents.includes(agent.id)) {
      throw new Error(`Agent cannot reference itself as sub-agent: ${agent.id}`);
    }

    for (const subAgentId of agent.subAgents) {
      if (!ids.has(subAgentId)) {
        throw new Error(`Unknown sub-agent reference: ${agent.id} -> ${subAgentId}`);
      }
      const subAgent = agentMap.get(subAgentId);
      if (subAgent && !subAgent.enabled) {
        throw new Error(`Disabled sub-agent reference: ${agent.id} -> ${subAgentId}`);
      }
    }
  }

  const cyclePath = detectAgentCycle(graph);
  if (cyclePath) {
    throw new Error(`Agent sub-agent cycle detected: ${cyclePath.join(" -> ")}`);
  }

  if (data.defaultAgent) {
    const defaultAgent = data.agents.find((agent) => agent.id === data.defaultAgent);
    if (!defaultAgent) {
      throw new Error(`Default agent not found: ${data.defaultAgent}`);
    }
    if (!defaultAgent.enabled) {
      throw new Error(`Default agent is disabled: ${data.defaultAgent}`);
    }
  }

  return data;
}

function detectAgentCycle(graph: Map<string, string[]>): string[] | null {
  const visited = new Set<string>();
  const active = new Set<string>();
  const path: string[] = [];

  const visit = (node: string): string[] | null => {
    if (active.has(node)) {
      const cycleStart = path.indexOf(node);
      return cycleStart >= 0 ? [...path.slice(cycleStart), node] : [node, node];
    }

    if (visited.has(node)) {
      return null;
    }

    visited.add(node);
    active.add(node);
    path.push(node);

    for (const next of graph.get(node) ?? []) {
      const cycle = visit(next);
      if (cycle) {
        return cycle;
      }
    }

    path.pop();
    active.delete(node);
    return null;
  };

  for (const node of graph.keys()) {
    const cycle = visit(node);
    if (cycle) {
      return cycle;
    }
  }

  return null;
}

function buildReferencedByMap(agents: AgentConfigEntry[]): Map<string, string[]> {
  const referencedBy = new Map<string, string[]>();
  for (const agent of agents) {
    for (const subAgentId of agent.subAgents) {
      const refs = referencedBy.get(subAgentId) ?? [];
      refs.push(agent.id);
      referencedBy.set(subAgentId, refs);
    }
  }
  return referencedBy;
}

function normalizeAgentStore(value: unknown): AgentStoreData {
  if (!isRecord(value)) return createDefaultAgentStore();
  const agents = Array.isArray(value.agents)
    ? value.agents.map(normalizeAgent).filter((agent): agent is AgentConfigEntry => agent !== null)
    : [];
  return {
    agents,
    ...(typeof value.defaultAgent === "string" && { defaultAgent: value.defaultAgent }),
    collaborationEnabled: typeof value.collaborationEnabled === "boolean" ? value.collaborationEnabled : false,
    subAgentDispatchEnabled: typeof value.subAgentDispatchEnabled === "boolean" ? value.subAgentDispatchEnabled : false,
  };
}

function normalizeAgent(value: unknown): AgentConfigEntry | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || typeof value.name !== "string" || typeof value.model !== "string") return null;
  return {
    id: value.id,
    name: value.name,
    model: value.model,
    tools: Array.isArray(value.tools) ? value.tools.filter((tool): tool is string => typeof tool === "string") : [],
    permissionProfile: typeof value.permissionProfile === "string" ? value.permissionProfile : "local-safe",
    enabled: typeof value.enabled === "boolean" ? value.enabled : true,
    subAgents: Array.isArray(value.subAgents) ? value.subAgents.filter((agent): agent is string => typeof agent === "string") : [],
    ...(typeof value.description === "string" && { description: value.description }),
  };
}

function shouldDispatchAgent(agent: AgentConfigEntry, terms: string): boolean {
  const haystack = `${agent.id} ${agent.name} ${agent.description ?? ""} ${agent.tools.join(" ")}`.toLowerCase();
  const termTokens = new Set(terms.split(/[^a-z0-9_-]+/).filter((t) => t.length > 2));
  return haystack.split(/[^a-z0-9_-]+/).some((token) => termTokens.has(token));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
