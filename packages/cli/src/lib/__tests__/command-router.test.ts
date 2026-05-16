import { describe, expect, it, vi } from "vitest";
import { routeSlashCommand, type CommandRouterContext } from "../command-router";

vi.mock("../provider-config", () => ({
  resolveProviderConfigForModelRef: vi.fn(async (modelRef: string) => {
    if (modelRef === "deepseek/deepseek-chat") {
      return { type: "deepseek", apiKey: "secret", model: "deepseek-chat", baseUrl: "https://api.deepseek.com/v1" };
    }
    if (modelRef === "openai/gpt-4o") {
      return { type: "openai", apiKey: "secret", model: "gpt-4o" };
    }
    throw new Error(`模型不存在: ${modelRef}`);
  }),
}));

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
    expect(result.type === "message" ? result.content : "").toContain("status: enabled");
    expect(result.type === "message" ? result.content : "").toContain("referencedBy: none");
  });

  it("routes agent selection and collaboration switches", async () => {
    const context = createContext();
    expect(await routeSlashCommand("/agent use coder", context)).toEqual({ type: "message", content: "默认 Agent 已切换为: coder" });
    expect(await routeSlashCommand("/agent collab on", context)).toEqual({ type: "message", content: "多 Agent 协作已开启" });
    expect(await routeSlashCommand("/agent dispatch on", context)).toEqual({ type: "message", content: "子 Agent 调度已开启" });
    expect(context.agentStore?.collaborationEnabled).toBe(true);
    expect(context.agentStore?.subAgentDispatchEnabled).toBe(true);
  });

  it("supports adding, editing, testing and removing agents", async () => {
    const context = createContext();

    expect(await routeSlashCommand("/agent add reviewer deepseek/deepseek-chat", context)).toEqual({
      type: "message",
      content: "Agent 已保存: reviewer -> deepseek/deepseek-chat",
    });
    expect(context.agentStore?.agents.some((agent) => agent.id === "reviewer")).toBe(true);

    expect(await routeSlashCommand("/agent edit reviewer tools read_file,code_search", context)).toEqual({
      type: "message",
      content: "Agent 已更新: reviewer (tools)",
    });
    expect(context.agentStore?.agents.find((agent) => agent.id === "reviewer")?.tools).toEqual(["read_file", "code_search"]);

    expect(await routeSlashCommand("/agent edit reviewer model deepseek/deepseek-chat", context)).toEqual({
      type: "message",
      content: "Agent 已更新: reviewer (model)",
    });

    const testResult = await routeSlashCommand("/agent test reviewer", context);
    expect(testResult.type === "message" ? testResult.content : "").toContain("Agent 配置可用: reviewer");

    expect(await routeSlashCommand("/agent remove reviewer", context)).toEqual({
      type: "message",
      content: "Agent 已删除: reviewer",
    });
    expect(context.agentStore?.agents.some((agent) => agent.id === "reviewer")).toBe(false);
  });

  it("supports clone, enable/disable and dedicated set commands", async () => {
    const context = createContext();

    expect(await routeSlashCommand("/agent clone coder reviewer", context)).toEqual({
      type: "message",
      content: "Agent 已复制: coder -> reviewer",
    });
    expect(context.agentStore?.agents.some((agent) => agent.id === "reviewer")).toBe(true);

    expect(await routeSlashCommand("/agent set-tools reviewer read_file,code_search", context)).toEqual({
      type: "message",
      content: "Agent 已更新: reviewer (tools)",
    });
    expect(context.agentStore?.agents.find((agent) => agent.id === "reviewer")?.tools).toEqual(["read_file", "code_search"]);

    expect(await routeSlashCommand("/agent disable reviewer", context)).toEqual({
      type: "message",
      content: "Agent 已禁用: reviewer",
    });
    expect(context.agentStore?.agents.find((agent) => agent.id === "reviewer")?.enabled).toBe(false);

    expect(await routeSlashCommand("/agent enable reviewer", context)).toEqual({
      type: "message",
      content: "Agent 已启用: reviewer",
    });
    expect(context.agentStore?.agents.find((agent) => agent.id === "reviewer")?.enabled).toBe(true);

    expect(await routeSlashCommand("/agent set-subagents coder reviewer", context)).toEqual({
      type: "message",
      content: "Agent 已更新: coder (subagents)",
    });
    expect(context.agentStore?.agents.find((agent) => agent.id === "coder")?.subAgents).toEqual(["reviewer"]);
  });

  it("supports showing a single agent and running agent doctor", async () => {
    const context = createContext();

    const showResult = await routeSlashCommand("/agent show coder", context);
    expect(showResult.type === "message" ? showResult.content : "").toContain("Agent: coder");
    expect(showResult.type === "message" ? showResult.content : "").toContain("default: yes");
    expect(showResult.type === "message" ? showResult.content : "").toContain("model: deepseek/deepseek-chat");

    const doctorResult = await routeSlashCommand("/agent doctor", context);
    expect(doctorResult.type === "message" ? doctorResult.content : "").toContain("Agent Doctor");
    expect(doctorResult.type === "message" ? doctorResult.content : "").toContain("- coder: ok (deepseek/deepseek-chat)");
    expect(doctorResult.type === "message" ? doctorResult.content : "").toContain("apiKey: present");
    expect(doctorResult.type === "message" ? doctorResult.content : "").toContain("tools: read_file");
    expect(doctorResult.type === "message" ? doctorResult.content : "").toContain("refs: none");
  });

  it("supports listing and exporting agents as json", async () => {
    const context = createContext();

    const listResult = await routeSlashCommand("/agent list --json", context);
    expect(listResult.type).toBe("message");
    const listed = JSON.parse(listResult.type === "message" ? listResult.content : "{}");
    expect(listed.defaultAgent).toBe("coder");
    expect(listed.agents).toHaveLength(1);
    expect(listed.agents[0]?.id).toBe("coder");

    const exportResult = await routeSlashCommand("/agent export", context);
    expect(exportResult.type).toBe("message");
    const exported = JSON.parse(exportResult.type === "message" ? exportResult.content : "{}");
    expect(exported.collaborationEnabled).toBe(false);
    expect(exported.agents[0]?.model).toBe("deepseek/deepseek-chat");
  });

  it("supports replacing agent store json into the current context", async () => {
    const context = createContext();
    const importedStore = {
      defaultAgent: "reviewer",
      collaborationEnabled: true,
      subAgentDispatchEnabled: true,
      agents: [
        {
          id: "reviewer",
          name: "Reviewer",
          model: "openai/gpt-4o",
          tools: ["read_file", "code_search"],
          permissionProfile: "local-safe",
          enabled: true,
          subAgents: [],
        },
      ],
    };

    const importResult = await routeSlashCommand(`/agent import ${JSON.stringify(importedStore)}`, context);
    expect(importResult).toEqual({
      type: "message",
      content: "Agent 配置已导入(replace): 1 agents",
    });
    expect(context.agentStore).toEqual(importedStore);
  });

  it("supports merging imported agent store json into the current context", async () => {
    const context = createContext({
      agentStore: {
        defaultAgent: "coder",
        collaborationEnabled: false,
        subAgentDispatchEnabled: false,
        agents: [
          {
            id: "coder",
            name: "Coder",
            model: "deepseek/deepseek-chat",
            tools: ["read_file"],
            permissionProfile: "local-safe",
            enabled: true,
            subAgents: [],
          },
          {
            id: "reviewer",
            name: "Reviewer",
            model: "openai/gpt-4o",
            tools: ["code_search"],
            permissionProfile: "local-safe",
            enabled: true,
            subAgents: [],
          },
        ],
      },
    });

    const importedStore = {
      defaultAgent: "reviewer",
      collaborationEnabled: true,
      subAgentDispatchEnabled: true,
      agents: [
        {
          id: "reviewer",
          name: "Senior Reviewer",
          model: "openai/gpt-4.1",
          tools: ["read_file", "code_search"],
          permissionProfile: "local-safe",
          enabled: true,
          subAgents: [],
        },
        {
          id: "planner",
          name: "Planner",
          model: "anthropic/claude-3-7-sonnet",
          tools: ["read_file"],
          permissionProfile: "local-safe",
          enabled: true,
          subAgents: [],
        },
      ],
    };

    const importResult = await routeSlashCommand(`/agent import --merge ${JSON.stringify(importedStore)}`, context);
    expect(importResult).toEqual({
      type: "message",
      content: "Agent 配置已导入(merge): 3 agents",
    });
    expect(context.agentStore?.defaultAgent).toBe("reviewer");
    expect(context.agentStore?.collaborationEnabled).toBe(true);
    expect(context.agentStore?.subAgentDispatchEnabled).toBe(true);
    expect(context.agentStore?.agents.map((agent) => agent.id)).toEqual(["coder", "reviewer", "planner"]);
    expect(context.agentStore?.agents.find((agent) => agent.id === "reviewer")).toMatchObject({
      name: "Senior Reviewer",
      model: "openai/gpt-4.1",
      tools: ["read_file", "code_search"],
    });
  });

  it("rejects invalid imported agent store json", async () => {
    const context = createContext();

    expect(await routeSlashCommand("/agent import {bad-json}", context)).toEqual({
      type: "message",
      content: "导入失败: 无法解析 JSON",
    });

    const invalidStore = {
      defaultAgent: "lead",
      collaborationEnabled: true,
      subAgentDispatchEnabled: true,
      agents: [
        {
          id: "lead",
          name: "Lead",
          model: "deepseek/deepseek-chat",
          tools: ["read_file"],
          permissionProfile: "local-safe",
          enabled: true,
          subAgents: ["ghost"],
        },
      ],
    };

    const result = await routeSlashCommand(`/agent import ${JSON.stringify(invalidStore)}`, context);
    expect(result).toEqual({
      type: "message",
      content: "Unknown sub-agent reference: lead -> ghost",
    });
    expect(context.agentStore?.defaultAgent).toBe("coder");
  });

  it("reports doctor warnings for weak agent configuration", async () => {
    const context = createContext({
      agentStore: {
        defaultAgent: "lead",
        collaborationEnabled: true,
        subAgentDispatchEnabled: true,
        agents: [{
          id: "lead",
          name: "Lead",
          model: "deepseek/deepseek-chat",
          tools: [],
          permissionProfile: "local-safe",
          enabled: true,
          subAgents: [],
        }],
      },
    });

    const doctorResult = await routeSlashCommand("/agent doctor", context);
    expect(doctorResult.type === "message" ? doctorResult.content : "").toContain("warnings: no tools configured; primary agent has no sub-agents configured");
  });

  it("handles unknown commands", async () => {
    expect(await routeSlashCommand("/unknown", createContext())).toEqual({
      type: "message",
      content: "未知命令: unknown",
    });
  });
});
