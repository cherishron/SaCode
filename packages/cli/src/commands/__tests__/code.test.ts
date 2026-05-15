import { describe, expect, it } from "vitest";
import { filterToolsForAgent } from "../../agent/tool-filter";
import type { Tool } from "../../agent/types";

function createTool(name: string): Tool {
  return {
    name,
    description: name,
    inputSchema: {},
    requiresApproval: false,
    execute: async () => ({
      success: true,
      output: name,
    }),
  };
}

describe("filterToolsForAgent", () => {
  it("returns all tools when agent tool list is empty", () => {
    const tools = [createTool("file_read"), createTool("shell_exec")];

    const result = filterToolsForAgent(tools, { tools: [] });

    expect(result.map((tool) => tool.name)).toEqual(["file_read", "shell_exec"]);
  });

  it("filters tools by configured agent tool names", () => {
    const tools = [createTool("file_read"), createTool("shell_exec"), createTool("code_search")];

    const result = filterToolsForAgent(tools, { tools: ["file_read", "code_search"] });

    expect(result.map((tool) => tool.name)).toEqual(["file_read", "code_search"]);
  });
});
