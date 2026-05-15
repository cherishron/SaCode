import type { AgentConfigEntry } from "../lib/agent-store.js";
import type { Tool } from "./types.js";

export function filterToolsForAgent(tools: Tool[], agent: Pick<AgentConfigEntry, "tools">): Tool[] {
  if (agent.tools.length === 0) {
    return tools;
  }

  const allowedTools = new Set(agent.tools);
  return tools.filter((tool) => allowedTools.has(tool.name));
}
