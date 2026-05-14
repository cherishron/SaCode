import { describe, expect, it, vi } from "vitest";
import { routeSlashCommand, type CommandRouterContext } from "../command-router";

vi.mock("../doctor", () => ({
  formatDoctorReport: () => "SaCode Doctor\n\nDoctor passed",
  runDoctor: vi.fn(async () => ({ ok: true, checks: [], provider: {}, workspace: {} })),
}));

function createContext(overrides: Partial<CommandRouterContext> = {}): CommandRouterContext {
  return {
    tools: ["read_file", "write_file"],
    workspaceContext: "上下文概览:\n- 工作目录: /tmp/project",
    model: "gpt-test",
    language: "zh-CN",
    session: "s1",
    confirmationMode: "dangerous",
    preferences: { language: "zh-CN" },
    providerStore: {
      providers: [{
        id: "deepseek",
        name: "DeepSeek",
        adapter: "openai-compatible",
        baseUrl: "https://api.deepseek.com/v1",
        apiKeyEnv: "DEEPSEEK_API_KEY",
        models: [{ id: "deepseek-chat", capabilities: ["chat", "tool_calling"] }],
      }],
      defaultModel: "deepseek/deepseek-chat",
    },
    agentStore: {
      defaultAgent: "coder",
      collaborationEnabled: false,
      subAgentDispatchEnabled: false,
      agents: [{
        id: "coder",
        name: "Coder",
        model: "deepseek/deepseek-chat",
        tools: ["read_file"],
        permissionProfile: "local-safe",
        enabled: true,
        subAgents: [],
      }],
    },
    ...overrides,
  };
}

describe("command router", () => {
  it("returns help text", async () => {
    const result = await routeSlashCommand("/help", createContext());
    expect(result).toMatchObject({ type: "message" });
    expect(result.type === "message" ? result.content : "").toContain("/models");
    expect(result.type === "message" ? result.content : "").not.toMatch(/待接入|后续|占位/);
  });

  it("runs doctor command inside the router", async () => {
    const result = await routeSlashCommand("/doctor", createContext());
    expect(result).toEqual({ type: "message", content: "SaCode Doctor\n\nDoctor passed" });
  });

  it("routes tools and context commands", async () => {
    const tools = await routeSlashCommand("/tools", createContext());
    const context = await routeSlashCommand("/context", createContext());

    expect(tools.type === "message" ? tools.content : "").toContain("read_file");
    expect(context.type === "message" ? context.content : "").toContain("模型: gpt-test");
  });

  it("supports clear and exit actions", async () => {
    await expect(routeSlashCommand("/clear", createContext())).resolves.toEqual({ type: "clear" });
    await expect(routeSlashCommand("/exit", createContext())).resolves.toEqual({ type: "exit" });
  });

  it("updates language through context callback", async () => {
    const setLanguage = vi.fn();
    const result = await routeSlashCommand("/lang en-US", createContext({ setLanguage }));

    expect(result).toEqual({ type: "message", content: "语言已设置为: en-US" });
    expect(setLanguage).toHaveBeenCalledWith("en-US");
  });

  it("routes provider and model commands from provider store", async () => {
    const models = await routeSlashCommand("/models", createContext());
    const providers = await routeSlashCommand("/providers", createContext());

    expect(models.type === "message" ? models.content : "").toContain("* deepseek/deepseek-chat");
    expect(providers.type === "message" ? providers.content : "").toContain("DeepSeek");
  });

  it("routes model use and model test commands", async () => {
    const context = createContext();
    const useResult = await routeSlashCommand("/model use deepseek/deepseek-chat", context);
    const testResult = await routeSlashCommand("/model test", context);

    expect(useResult).toEqual({ type: "message", content: "默认模型已切换为: deepseek/deepseek-chat" });
    expect(testResult.type === "message" ? testResult.content : "").toContain("模型配置可用");
  });

  it("routes agents from agent store", async () => {
    const result = await routeSlashCommand("/agents", createContext());
    expect(result.type === "message" ? result.content : "").toContain("* coder (Coder)");
  });

  it("routes agent selection and collaboration switches", async () => {
    const context = createContext();
    expect(await routeSlashCommand("/agent use coder", context)).toEqual({ type: "message", content: "默认 Agent 已切换为: coder" });
    expect(await routeSlashCommand("/agent collab on", context)).toEqual({ type: "message", content: "多 Agent 协作已开启" });
    expect(await routeSlashCommand("/agent dispatch on", context)).toEqual({ type: "message", content: "子 Agent 调度已开启" });
    expect(context.agentStore?.collaborationEnabled).toBe(true);
    expect(context.agentStore?.subAgentDispatchEnabled).toBe(true);
  });

  it("handles unknown commands", async () => {
    expect(await routeSlashCommand("/unknown", createContext())).toEqual({
      type: "message",
      content: "未知命令: unknown",
    });
  });
});
