import type { ConfirmationMode } from "@sacode/core";
import { ensureAgentStore, formatAgents, setAgentCollaboration, setDefaultAgent, setSubAgentDispatch, type AgentStoreData } from "./agent-store";
import { formatDoctorReport, runDoctor } from "./doctor";
import { ensureProviderStore, formatModels, formatProviders, setDefaultModel, testModelConfiguration, type ProviderStoreData } from "./provider-store";

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
  const [subcommand, value] = args;

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
  } catch (error) {
    return { type: "message", content: error instanceof Error ? error.message : String(error) };
  }

  return { type: "message", content: "用法: /agent use <agent-id>、/agent collab on|off、/agent dispatch on|off" };
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
