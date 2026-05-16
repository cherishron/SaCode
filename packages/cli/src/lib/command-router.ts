import type { ConfirmationMode } from "@sacode/core";
import { ensureAgentStore, formatAgents, removeAgent, setAgentCollaboration, setDefaultAgent, setSubAgentDispatch, upsertAgent, validateAgentStore, type AgentStoreData, type AgentConfigEntry } from "./agent-store";
import { formatDoctorReport, runDoctor } from "./doctor";
import { ensureProviderStore, formatModels, formatProviders, setDefaultModel, testModelConfiguration, type ProviderStoreData } from "./provider-store";
import { resolveProviderConfigForModelRef } from "./provider-config";

export interface CommandRouterContext {
  tools: string[];
  workspaceContext: string;
  model: string;
  language: string;
  session?: string;
  confirmationMode: ConfirmationMode;
  preferences: Record<string, unknown>;
  providerStore?: ProviderStoreData;
  agentStore?: AgentStoreData;
  setLanguage?: (language: string) => void;
}

export type CommandRouterResult =
  | { type: "message"; content: string }
  | { type: "clear" }
  | { type: "exit" };

const HELP_TEXT = `可用命令:
  /help          - 显示帮助
  /clear         - 清屏
  /doctor        - 运行环境诊断
  /tools         - 显示可用工具
  /context       - 显示当前上下文概览
  /permissions   - 显示当前权限模式
  /models        - 显示已配置模型
  /model use     - 切换默认模型
  /model test    - 检查模型配置
  /providers     - 显示已配置 Provider
  /agents        - 显示已配置 Agent
  /agent use     - 切换默认 Agent
  /agent add     - 添加 Agent
  /agent edit    - 编辑 Agent
  /agent clone   - 复制 Agent
  /agent enable  - 启用 Agent
  /agent disable - 禁用 Agent
  /agent list    - 列出 Agent（支持 --json）
  /agent export  - 导出 Agent 配置
  /agent import  - 导入 Agent 配置
  /agent set-tools - 设置 Agent 工具
  /agent set-subagents - 设置 Agent 子 Agent
  /agent remove  - 删除 Agent
  /agent show    - 查看单个 Agent 详情
  /agent doctor  - 诊断 Agent 配置
  /agent test    - 检查 Agent 模型配置
  /agent collab  - 开关多 Agent 协作
  /agent dispatch - 开关子 Agent 调度
  /lang zh-CN    - 设置语言为中文
  /lang en-US    - 设置语言为英文
  /prefs         - 显示偏好设置
  /exit          - 退出`;

export async function routeSlashCommand(
  input: string,
  context: CommandRouterContext
): Promise<CommandRouterResult> {
  const [cmd = "", ...args] = input.trim().replace(/^\//, "").split(/\s+/);

  switch (cmd.toLowerCase()) {
    case "help":
      return { type: "message", content: HELP_TEXT };
    case "clear":
      return { type: "clear" };
    case "doctor":
      return { type: "message", content: formatDoctorReport(await runDoctor()) };
    case "tools":
      return { type: "message", content: formatTools(context.tools) };
    case "context":
      return { type: "message", content: formatContext(context) };
    case "permissions":
      return { type: "message", content: formatPermissions(context.confirmationMode) };
    case "models":
      return { type: "message", content: formatModels(context.providerStore ?? await ensureProviderStore()) };
    case "model":
      return handleModelCommand(args, context);
    case "providers":
      return { type: "message", content: formatProviders(context.providerStore ?? await ensureProviderStore()) };
    case "agents":
      return { type: "message", content: formatAgents(context.agentStore ?? await ensureAgentStore()) };
    case "agent":
      return handleAgentCommand(args, context);
    case "lang":
      return handleLanguage(args[0], context);
    case "prefs":
      return { type: "message", content: `偏好设置:\n${JSON.stringify(context.preferences, null, 2)}` };
    case "exit":
    case "quit":
    case "q":
      return { type: "exit" };
    default:
      return { type: "message", content: `未知命令: ${cmd}` };
  }
}

async function handleAgentCommand(args: string[], context: CommandRouterContext): Promise<CommandRouterResult> {
  const [subcommand, value, ...rest] = args;

  try {
    if (subcommand === "use") {
      if (!value) return { type: "message", content: "用法: /agent use <agent-id>" };
      if (context.agentStore) {
        if (!context.agentStore.agents.some((agent) => agent.id === value && agent.enabled)) return { type: "message", content: `Agent 不存在或未启用: ${value}` };
        context.agentStore.defaultAgent = value;
        return { type: "message", content: `默认 Agent 已切换为: ${value}` };
      }
      await setDefaultAgent(value);
      return { type: "message", content: `默认 Agent 已切换为: ${value}` };
    }

    if (subcommand === "collab") {
      const enabled = parseOnOff(value);
      if (enabled === null) return { type: "message", content: "用法: /agent collab on|off" };
      if (context.agentStore) context.agentStore.collaborationEnabled = enabled;
      else await setAgentCollaboration(enabled);
      return { type: "message", content: `多 Agent 协作已${enabled ? "开启" : "关闭"}` };
    }

    if (subcommand === "dispatch") {
      const enabled = parseOnOff(value);
      if (enabled === null) return { type: "message", content: "用法: /agent dispatch on|off" };
      if (context.agentStore) context.agentStore.subAgentDispatchEnabled = enabled;
      else await setSubAgentDispatch(enabled);
      return { type: "message", content: `子 Agent 调度已${enabled ? "开启" : "关闭"}` };
    }

    if (subcommand === "add") {
      const modelRef = value ? rest[0] : undefined;
      if (!value || !modelRef) {
        return { type: "message", content: "用法: /agent add <agent-id> <provider/model>" };
      }

      const agentStore = context.agentStore ?? await ensureAgentStore();
      const providerStore = context.providerStore ?? await ensureProviderStore();
      const validation = testModelConfiguration(providerStore, modelRef);
      if (!validation.ok) {
        return { type: "message", content: validation.message };
      }

      const nextAgent: AgentConfigEntry = {
        id: value,
        name: toTitleCase(value),
        model: modelRef,
        tools: [],
        permissionProfile: "local-safe",
        enabled: true,
        subAgents: [],
      };

      if (context.agentStore) {
        const index = agentStore.agents.findIndex((agent) => agent.id === value);
        if (index >= 0) agentStore.agents[index] = nextAgent;
        else agentStore.agents.push(nextAgent);
        agentStore.defaultAgent = agentStore.defaultAgent ?? value;
      } else {
        await upsertAgent(nextAgent);
      }

      return { type: "message", content: `Agent 已保存: ${value} -> ${modelRef}` };
    }

    if (subcommand === "edit") {
      const field = rest[0];
      const rawValue = rest.slice(1).join(" ");
      if (!value || !field || !rawValue) {
        return { type: "message", content: "用法: /agent edit <agent-id> model|tools|subagents|description|permission|enabled|name <value>" };
      }

      const agentStore = context.agentStore ?? await ensureAgentStore();
      const agent = agentStore.agents.find((item) => item.id === value);
      if (!agent) {
        return { type: "message", content: `Agent 不存在: ${value}` };
      }

      const updatedAgent = await applyAgentEdit(agent, field, rawValue, context.providerStore ?? await ensureProviderStore());
      if (context.agentStore) {
        const index = agentStore.agents.findIndex((item) => item.id === value);
        if (index >= 0) {
          agentStore.agents[index] = updatedAgent;
        }
      } else {
        await upsertAgent(updatedAgent);
      }

      return { type: "message", content: `Agent 已更新: ${value} (${field})` };
    }

    if (subcommand === "clone") {
      const targetId = rest[0];
      if (!value || !targetId) {
        return { type: "message", content: "用法: /agent clone <source-id> <target-id>" };
      }

      const agentStore = context.agentStore ?? await ensureAgentStore();
      const sourceAgent = agentStore.agents.find((item) => item.id === value);
      if (!sourceAgent) {
        return { type: "message", content: `Agent 不存在: ${value}` };
      }
      if (agentStore.agents.some((item) => item.id === targetId)) {
        return { type: "message", content: `Agent 已存在: ${targetId}` };
      }

      const clonedAgent: AgentConfigEntry = {
        ...sourceAgent,
        id: targetId,
        name: `${sourceAgent.name} Copy`,
        subAgents: [...sourceAgent.subAgents],
        tools: [...sourceAgent.tools],
      };

      if (context.agentStore) {
        agentStore.agents.push(clonedAgent);
      } else {
        await upsertAgent(clonedAgent);
      }

      return { type: "message", content: `Agent 已复制: ${value} -> ${targetId}` };
    }

    if (subcommand === "list") {
      const agentStore = context.agentStore ?? await ensureAgentStore();
      const jsonMode = value === "--json" || rest.includes("--json");
      return {
        type: "message",
        content: jsonMode ? JSON.stringify(agentStore, null, 2) : formatAgents(agentStore),
      };
    }

    if (subcommand === "export") {
      const agentStore = context.agentStore ?? await ensureAgentStore();
      return {
        type: "message",
        content: JSON.stringify(agentStore, null, 2),
      };
    }

    if (subcommand === "import") {
      const importMode = value === "--merge" || value === "--replace" ? value : "--replace";
      const rawJson = (importMode === value ? rest : [value, ...rest]).filter(Boolean).join(" ");
      if (!rawJson) {
        return { type: "message", content: "用法: /agent import [--merge|--replace] <json>" };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawJson);
      } catch {
        return { type: "message", content: "导入失败: 无法解析 JSON" };
      }

      const importedStore = normalizeImportedAgentStore(parsed);
      const currentStore = context.agentStore ?? await ensureAgentStore();
      const nextStore = validateAgentStore(
        importMode === "--merge"
          ? mergeAgentStores(currentStore, importedStore)
          : importedStore,
      );

      if (context.agentStore) {
        context.agentStore.agents = nextStore.agents;
        context.agentStore.defaultAgent = nextStore.defaultAgent;
        context.agentStore.collaborationEnabled = nextStore.collaborationEnabled;
        context.agentStore.subAgentDispatchEnabled = nextStore.subAgentDispatchEnabled;
      } else {
        const { saveAgentStore } = await import("./agent-store");
        await saveAgentStore(nextStore);
      }

      return {
        type: "message",
        content: `Agent 配置已导入(${importMode === "--merge" ? "merge" : "replace"}): ${nextStore.agents.length} agents`,
      };
    }

    if (subcommand === "enable" || subcommand === "disable") {
      if (!value) {
        return { type: "message", content: `用法: /agent ${subcommand} <agent-id>` };
      }

      const agentStore = context.agentStore ?? await ensureAgentStore();
      const agent = agentStore.agents.find((item) => item.id === value);
      if (!agent) {
        return { type: "message", content: `Agent 不存在: ${value}` };
      }

      const updatedAgent = await applyAgentEdit(
        agent,
        "enabled",
        subcommand === "enable" ? "on" : "off",
        context.providerStore ?? await ensureProviderStore(),
      );

      if (context.agentStore) {
        const index = agentStore.agents.findIndex((item) => item.id === value);
        if (index >= 0) {
          agentStore.agents[index] = updatedAgent;
        }
      } else {
        await upsertAgent(updatedAgent);
      }

      return { type: "message", content: `Agent 已${subcommand === "enable" ? "启用" : "禁用"}: ${value}` };
    }

    if (subcommand === "set-tools" || subcommand === "set-subagents") {
      const rawValue = rest.join(" ");
      if (!value || !rawValue) {
        return { type: "message", content: `用法: /agent ${subcommand} <agent-id> <comma-separated-values>` };
      }

      const agentStore = context.agentStore ?? await ensureAgentStore();
      const agent = agentStore.agents.find((item) => item.id === value);
      if (!agent) {
        return { type: "message", content: `Agent 不存在: ${value}` };
      }

      const updatedAgent = await applyAgentEdit(
        agent,
        subcommand === "set-tools" ? "tools" : "subagents",
        rawValue,
        context.providerStore ?? await ensureProviderStore(),
      );

      if (context.agentStore) {
        const index = agentStore.agents.findIndex((item) => item.id === value);
        if (index >= 0) {
          agentStore.agents[index] = updatedAgent;
        }
      } else {
        await upsertAgent(updatedAgent);
      }

      return { type: "message", content: `Agent 已更新: ${value} (${subcommand === "set-tools" ? "tools" : "subagents"})` };
    }

    if (subcommand === "remove") {
      if (!value) {
        return { type: "message", content: "用法: /agent remove <agent-id>" };
      }

      if (context.agentStore) {
        const nextAgents = context.agentStore.agents.filter((agent) => agent.id !== value);
        if (nextAgents.length === context.agentStore.agents.length) {
          return { type: "message", content: `Agent 不存在: ${value}` };
        }
        context.agentStore.agents = nextAgents;
        if (context.agentStore.defaultAgent === value) {
          context.agentStore.defaultAgent = nextAgents.find((agent) => agent.enabled)?.id;
        }
      } else {
        await removeAgent(value);
      }

      return { type: "message", content: `Agent 已删除: ${value}` };
    }

    if (subcommand === "show") {
      if (!value) {
        return { type: "message", content: "用法: /agent show <agent-id>" };
      }

      const agentStore = context.agentStore ?? await ensureAgentStore();
      const agent = agentStore.agents.find((item) => item.id === value);
      if (!agent) {
        return { type: "message", content: `Agent 不存在: ${value}` };
      }

      return { type: "message", content: formatSingleAgent(agentStore, agent) };
    }

    if (subcommand === "doctor") {
      const agentStore = context.agentStore ?? await ensureAgentStore();
      return { type: "message", content: await doctorAgents(agentStore) };
    }

    if (subcommand === "test") {
      if (!value) {
        return { type: "message", content: "用法: /agent test <agent-id>" };
      }

      const agentStore = context.agentStore ?? await ensureAgentStore();
      const agent = agentStore.agents.find((item) => item.id === value);
      if (!agent) {
        return { type: "message", content: `Agent 不存在: ${value}` };
      }

      try {
        const providerConfig = await resolveProviderConfigForModelRef(agent.model);
        return {
          type: "message",
          content: `Agent 配置可用: ${agent.id}\nmodel: ${agent.model}\nprovider: ${providerConfig.type}\nresolvedModel: ${providerConfig.model}`,
        };
      } catch (error) {
        return { type: "message", content: error instanceof Error ? error.message : String(error) };
      }
    }
  } catch (error) {
    return { type: "message", content: error instanceof Error ? error.message : String(error) };
  }

  return { type: "message", content: "用法: /agent use <agent-id>、/agent add <agent-id> <provider/model>、/agent edit <agent-id> <field> <value>、/agent clone <source-id> <target-id>、/agent list [--json]、/agent export、/agent import [--merge|--replace] <json>、/agent enable <agent-id>、/agent disable <agent-id>、/agent set-tools <agent-id> <values>、/agent set-subagents <agent-id> <values>、/agent remove <agent-id>、/agent show <agent-id>、/agent doctor、/agent test <agent-id>、/agent collab on|off、/agent dispatch on|off" };
}

async function applyAgentEdit(
  agent: AgentConfigEntry,
  field: string,
  rawValue: string,
  providerStore: ProviderStoreData,
): Promise<AgentConfigEntry> {
  switch (field) {
    case "model": {
      const validation = testModelConfiguration(providerStore, rawValue);
      if (!validation.ok) {
        throw new Error(validation.message);
      }
      return { ...agent, model: rawValue };
    }
    case "tools":
      return { ...agent, tools: splitCsv(rawValue) };
    case "subagents":
      return { ...agent, subAgents: splitCsv(rawValue) };
    case "description":
      return { ...agent, description: rawValue };
    case "permission":
      return { ...agent, permissionProfile: rawValue };
    case "enabled": {
      const enabled = parseOnOff(rawValue);
      if (enabled === null) {
        throw new Error("enabled 仅支持 on|off");
      }
      return { ...agent, enabled };
    }
    case "name":
      return { ...agent, name: rawValue };
    default:
      throw new Error("可编辑字段: model, tools, subagents, description, permission, enabled, name");
  }
}

function splitCsv(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function toTitleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeImportedAgentStore(value: unknown): AgentStoreData {
  if (!isRecord(value)) {
    throw new Error("导入失败: 顶层必须是对象");
  }

  if (!Array.isArray(value.agents)) {
    throw new Error("导入失败: 缺少 agents 数组");
  }

  const agents = value.agents.map((agent) => normalizeImportedAgent(agent));
  return {
    agents,
    defaultAgent: typeof value.defaultAgent === "string" ? value.defaultAgent : agents.find((agent) => agent.enabled)?.id,
    collaborationEnabled: typeof value.collaborationEnabled === "boolean" ? value.collaborationEnabled : false,
    subAgentDispatchEnabled: typeof value.subAgentDispatchEnabled === "boolean" ? value.subAgentDispatchEnabled : false,
  };
}

function mergeAgentStores(current: AgentStoreData, imported: AgentStoreData): AgentStoreData {
  const mergedAgents = new Map(current.agents.map((agent) => [agent.id, agent]));
  for (const agent of imported.agents) {
    mergedAgents.set(agent.id, agent);
  }

  return {
    agents: Array.from(mergedAgents.values()),
    defaultAgent: imported.defaultAgent ?? current.defaultAgent,
    collaborationEnabled: imported.collaborationEnabled,
    subAgentDispatchEnabled: imported.subAgentDispatchEnabled,
  };
}

function normalizeImportedAgent(value: unknown): AgentConfigEntry {
  if (!isRecord(value)) {
    throw new Error("导入失败: agent 条目必须是对象");
  }
  if (typeof value.id !== "string" || typeof value.name !== "string" || typeof value.model !== "string") {
    throw new Error("导入失败: agent 条目缺少 id/name/model");
  }

  return {
    id: value.id,
    name: value.name,
    model: value.model,
    tools: Array.isArray(value.tools) ? value.tools.filter((item): item is string => typeof item === "string") : [],
    permissionProfile: typeof value.permissionProfile === "string" ? value.permissionProfile : "local-safe",
    enabled: typeof value.enabled === "boolean" ? value.enabled : true,
    subAgents: Array.isArray(value.subAgents) ? value.subAgents.filter((item): item is string => typeof item === "string") : [],
    ...(typeof value.description === "string" && { description: value.description }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatSingleAgent(store: AgentStoreData, agent: AgentConfigEntry): string {
  const referencedBy = store.agents
    .filter((item) => item.subAgents.includes(agent.id))
    .map((item) => item.id);
  return [
    `Agent: ${agent.id}`,
    `name: ${agent.name}`,
    `status: ${agent.enabled ? "enabled" : "disabled"}`,
    `default: ${store.defaultAgent === agent.id ? "yes" : "no"}`,
    `model: ${agent.model}`,
    `tools: ${agent.tools.join(", ") || "none"}`,
    `permission: ${agent.permissionProfile}`,
    `subAgents: ${agent.subAgents.join(", ") || "none"}`,
    `referencedBy: ${referencedBy.join(", ") || "none"}`,
    ...(agent.description ? [`description: ${agent.description}`] : []),
  ].join("\n");
}

async function doctorAgents(store: AgentStoreData): Promise<string> {
  const referencedBy = new Map<string, string[]>();
  for (const agent of store.agents) {
    for (const subAgentId of agent.subAgents) {
      const refs = referencedBy.get(subAgentId) ?? [];
      refs.push(agent.id);
      referencedBy.set(subAgentId, refs);
    }
  }

  const lines = [
    "Agent Doctor",
    "",
    `defaultAgent: ${store.defaultAgent ?? "none"}`,
    `collaboration: ${store.collaborationEnabled ? "enabled" : "disabled"}`,
    `sub-agent dispatch: ${store.subAgentDispatchEnabled ? "enabled" : "disabled"}`,
    "",
    "Agents:",
  ];

  for (const agent of store.agents) {
    const warnings: string[] = [];
    const refs = referencedBy.get(agent.id) ?? [];

    if (agent.tools.length === 0) {
      warnings.push("no tools configured");
    }
    if (agent.enabled && refs.length === 0 && store.defaultAgent !== agent.id) {
      warnings.push("enabled but not referenced");
    }
    if (store.collaborationEnabled && store.subAgentDispatchEnabled && store.defaultAgent === agent.id && agent.subAgents.length === 0) {
      warnings.push("primary agent has no sub-agents configured");
    }

    try {
      const providerConfig = await resolveProviderConfigForModelRef(agent.model);
      const apiKeyStatus = providerConfig.apiKey ? "apiKey: present" : "apiKey: missing";
      if (!providerConfig.apiKey) {
        warnings.push("missing API key");
      }
      lines.push(`- ${agent.id}: ok (${providerConfig.type}/${providerConfig.model})`);
      lines.push(`  status: ${agent.enabled ? "enabled" : "disabled"}`);
      lines.push(`  refs: ${refs.join(", ") || "none"}`);
      lines.push(`  tools: ${agent.tools.join(", ") || "none"}`);
      lines.push(`  ${apiKeyStatus}`);
      if (warnings.length > 0) {
        lines.push(`  warnings: ${warnings.join("; ")}`);
      }
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
      lines.push(`- ${agent.id}: error`);
      lines.push(`  status: ${agent.enabled ? "enabled" : "disabled"}`);
      lines.push(`  refs: ${refs.join(", ") || "none"}`);
      lines.push(`  tools: ${agent.tools.join(", ") || "none"}`);
      lines.push(`  warnings: ${warnings.join("; ")}`);
    }
  }

  return lines.join("\n");
}

function parseOnOff(value: string | undefined): boolean | null {
  if (["on", "true", "1", "yes", "enable", "enabled"].includes(value ?? "")) return true;
  if (["off", "false", "0", "no", "disable", "disabled"].includes(value ?? "")) return false;
  return null;
}

async function handleModelCommand(args: string[], context: CommandRouterContext): Promise<CommandRouterResult> {
  const [subcommand, modelRef] = args;
  const store = context.providerStore ?? await ensureProviderStore();
  const targetModel = modelRef ?? store.defaultModel;

  if (subcommand === "use") {
    if (!modelRef) return { type: "message", content: "用法: /model use <provider>/<model>" };
    if (context.providerStore) {
      const result = testModelConfiguration(context.providerStore, modelRef);
      if (!result.ok) return { type: "message", content: result.message };
      context.providerStore.defaultModel = modelRef;
      return { type: "message", content: `默认模型已切换为: ${modelRef}` };
    }

    try {
      await setDefaultModel(modelRef);
      return { type: "message", content: `默认模型已切换为: ${modelRef}` };
    } catch (error) {
      return { type: "message", content: error instanceof Error ? error.message : String(error) };
    }
  }

  if (subcommand === "test") {
    if (!targetModel) return { type: "message", content: "没有默认模型。用法: /model test <provider>/<model>" };
    const result = testModelConfiguration(store, targetModel);
    return { type: "message", content: result.message };
  }

  return { type: "message", content: "用法: /model use <provider>/<model> 或 /model test [provider/model]" };
}

function formatTools(tools: string[]): string {
  return `可用工具:\n${tools.map((tool) => `- ${tool}`).join("\n")}`;
}

function formatContext(context: CommandRouterContext): string {
  return `${context.workspaceContext}\n- 模型: ${context.model}\n- 语言: ${context.language}\n- 会话: ${context.session ?? "default"}\n- 可用工具数: ${context.tools.length}`;
}

function formatPermissions(mode: ConfirmationMode): string {
  return `权限模式: ${mode}\n- 文件访问限制在当前工作目录\n- delete_file 默认不暴露\n- write_file/edit_file/run_shell_command 等危险工具默认需要确认\n- 非交互 print 模式下危险工具会被默认拒绝`;
}

function handleLanguage(language: string | undefined, context: CommandRouterContext): CommandRouterResult {
  if (!language) {
    return { type: "message", content: `当前语言: ${context.language}` };
  }

  if (!["zh-CN", "en-US", "ja-JP", "ko-KR"].includes(language)) {
    return { type: "message", content: "不支持的语言。支持: zh-CN, en-US, ja-JP, ko-KR" };
  }

  context.setLanguage?.(language);
  return { type: "message", content: `语言已设置为: ${language}` };
}
