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
  const updated = { ...data, collaborationEnabled: enabled };
  await saveAgentStore(updated, options);
  return updated;
}

export async function setSubAgentDispatch(enabled: boolean, options: AgentStoreOptions = {}): Promise<AgentStoreData> {
  const data = await ensureAgentStore(options);
  const updated = { ...data, subAgentDispatchEnabled: enabled };
  await saveAgentStore(updated, options);
  return updated;
}

export async function setDefaultAgent(agentId: string, options: AgentStoreOptions = {}): Promise<AgentStoreData> {
  const data = await ensureAgentStore(options);
  if (!data.agents.some((agent) => agent.id === agentId && agent.enabled)) {
    throw new Error(`Agent not found or disabled: ${agentId}`);
  }
  const updated = { ...data, defaultAgent: agentId };
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
  const updated = { ...data, agents, defaultAgent: data.defaultAgent ?? agent.id };
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
    return normalizeAgentStore(JSON.parse(await fs.readFile(getAgentStorePath(options), "utf-8")));
  } catch {
    return createDefaultAgentStore();
  }
}

export async function saveAgentStore(data: AgentStoreData, options: AgentStoreOptions = {}): Promise<void> {
  const storePath = getAgentStorePath(options);
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, `${JSON.stringify(normalizeAgentStore(data), null, 2)}\n`, "utf-8");
}

export function formatAgents(data: AgentStoreData): string {
  if (data.agents.length === 0) return "未配置 Agent。";
  return [
    "已配置 Agent:",
    `collaboration: ${data.collaborationEnabled ? "enabled" : "disabled"}`,
    `sub-agent dispatch: ${data.subAgentDispatchEnabled ? "enabled" : "disabled"}`,
    ...data.agents.map((agent) => {
      const marker = data.defaultAgent === agent.id ? "*" : "-";
      return `${marker} ${agent.id} (${agent.name})\n  enabled: ${agent.enabled}\n  model: ${agent.model}\n  tools: ${agent.tools.join(", ") || "none"}\n  permission: ${agent.permissionProfile}\n  subAgents: ${agent.subAgents.join(", ") || "none"}${agent.description ? `\n  description: ${agent.description}` : ""}`;
    }),
  ].join("\n");
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
