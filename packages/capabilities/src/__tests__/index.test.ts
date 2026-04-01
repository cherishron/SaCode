import { describe, it, expect, beforeEach } from "vitest";
import { ToolRegistry } from "../tools";
import type { ToolDefinition } from "../types";

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it("should register and retrieve tools", () => {
    registry.register({
      name: "test_tool",
      description: "A test tool",
      inputSchema: {} as never,
      execute: async () => ({ success: true }),
    });

    expect(registry.has("test_tool")).toBe(true);
    expect(registry.get("test_tool")).toBeDefined();
  });

  it("should list all tools", () => {
    registry.register({
      name: "tool1",
      description: "Tool 1",
      inputSchema: {} as never,
      execute: async () => null,
    });

    registry.register({
      name: "tool2",
      description: "Tool 2",
      inputSchema: {} as never,
      execute: async () => null,
    });

    const tools = registry.list();
    expect(tools).toHaveLength(2);
    expect(tools.map((t: ToolDefinition) => t.name)).toContain("tool1");
    expect(tools.map((t: ToolDefinition) => t.name)).toContain("tool2");
  });

  it("should execute tools", async () => {
    registry.register({
      name: "echo",
      description: "Echo tool",
      inputSchema: {} as never,
      execute: async (input: unknown) => ({ echo: input }),
    });

    const result = await registry.execute("echo", { message: "hello" });
    expect(result).toEqual({ echo: { message: "hello" } });
  });

  it("should throw for unknown tools", async () => {
    await expect(registry.execute("unknown", {})).rejects.toThrow("Tool not found");
  });
});
