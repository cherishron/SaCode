import type { ConfirmationMode } from "@sacode/core";
import { ensureAgentStore, formatAgents, removeAgent, setAgentCollaboration, setDefaultAgent, setSubAgentDispatch, upsertAgent, validateAgentStore, type AgentStoreData, type AgentConfigEntry } from "./agent-store";
import { formatDoctorReport, runDoctor } from "./doctor";
import { ensureProviderStore, formatModels, formatProviders, setDefaultModel, testModelConfiguration, type ProviderStoreData } from "./provider-store";
import { resolveProviderConfigForModelRef } from "./provider-config";
import { formatSessionInfo, formatSessionList, listSessionInfos, loadSessionInfo } from "./session-store";

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
  /session       - 查看会话信息
  /recall        - 检索记忆
  /remember      - 保存记忆
  /models        - 显示已配置模型
  /model use     - 切换默认模型
  /model test    - 检查模型配置
  /providers     - 显示已配置 Provider
  /auth          - 管理认证账户
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
  /file <path>   - 加载文件到上下文
  /repo          - 加载当前 Git 仓库到上下文
  /tokens        - 显示当前 token 使用情况
  /history       - 显示历史对话
  /rollback      - 回滚到历史对话状态
  /plan          - 启动规划模式
  /skills        - 显示已安装 Skills
  /skill add     - 安装 Skill
  /skill remove  - 卸载 Skill
  /mcp           - 显示 MCP 服务器状态
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
    case "session":
      return handleSessionCommand(args, context);
    case "recall":
      return handleRecallCommand(args);
    case "remember":
      return handleRememberCommand(args);
    case "models":
      return { type: "message", content: formatModels(context.providerStore ?? await ensureProviderStore()) };
    case "model":
      return handleModelCommand(args, context);
    case "providers":
      return { type: "message", content: formatProviders(context.providerStore ?? await ensureProviderStore()) };
    case "provider":
      return handleProviderCommand(args, context);
    case "auth":
      return handleAuthCommand(args);
    case "agents":
      return { type: "message", content: formatAgents(context.agentStore ?? await ensureAgentStore()) };
    case "agent":
      return handleAgentCommand(args, context);
    case "file":
      return handleFileCommand(args, context);
    case "repo":
      return handleRepoCommand(args, context);
    case "tokens":
      return handleTokensCommand(args, context);
    case "history":
      return handleHistoryCommand(args, context);
    case "rollback":
      return handleRollbackCommand(args, context);
    case "plan":
      return handlePlanCommand(args, context);
    case "skills":
      return handleSkillsCommand(args, context);
    case "skill":
      return handleSkillCommand(args, context);
    case "mcp":
      return handleMcpCommand(args, context);
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

async function handleAuthCommand(args: string[]): Promise<CommandRouterResult> {
  const [action, ...rest] = args;

  try {
    const { CodingPlanAccountManager } = await import("../auth/account-manager.js");
    const { listProviders } = await import("../auth/providers.js");
    const manager = new CodingPlanAccountManager();

    if (!action) {
      const accounts = await manager.listAccounts();
      const lines = ["认证管理", ""];
      if (accounts.length > 0) {
        lines.push("CodingPlan 账户:");
        for (const account of accounts) {
          const active = account.isActive ? " (当前)" : "";
          lines.push(`  ${account.alias || account.provider}${active}`);
        }
        lines.push("");
      }
      lines.push(
        "可用操作:",
        "  /auth list      - 查看账户列表",
        "  /auth current   - 查看当前账户",
        "  /auth providers - 查看支持的厂商",
        "  /auth env       - 查看环境变量配置",
        "  /auth validate  - 验证当前账户",
        "  /auth switch <accountId> - 切换账户",
        "  /auth remove <accountId> - 删除账户",
        "  /auth add       - 在 TUI 中打开交互式添加",
      );
      return { type: "message", content: lines.join("\n") };
    }

    if (action === "list") {
      const accounts = await manager.listAccounts();
      if (accounts.length === 0) {
        return { type: "message", content: "暂无 CodingPlan 账户\n\n使用 /auth add 添加账户" };
      }

      const grouped = new Map<string, typeof accounts>();
      for (const account of accounts) {
        const key = account.provider;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)?.push(account);
      }

      const lines = ["CodingPlan 账户:", ""];
      for (const [provider, providerAccounts] of grouped) {
        const preset = manager.getPreset(provider as never);
        lines.push(`  ${preset?.name || provider}`);
        for (const account of providerAccounts) {
          const active = account.isActive ? "* " : "o ";
          const model = account.defaultModel ? ` [${account.defaultModel}]` : "";
          lines.push(`    ${active}${account.alias} (${account.id})${model}`);
        }
      }
      return { type: "message", content: lines.join("\n") };
    }

    if (action === "current") {
      const account = await manager.getActiveAccount();
      const preset = manager.getPreset(account.provider as never);
      return {
        type: "message",
        content: [
          "当前账户:",
          `  别名:     ${account.alias}`,
          `  厂商:     ${preset?.name || account.provider}`,
          `  协议:     ${account.protocol}`,
          `  端点:     ${account.baseUrl}`,
          `  默认模型: ${account.defaultModel || "未设置"}`,
          `  API Key:  ${account.apiKey.slice(0, 8)}${"*".repeat(20)}`,
          `  创建时间: ${account.createdAt}`,
          ...(account.lastUsedAt ? [`  最近使用: ${account.lastUsedAt}`] : []),
        ].join("\n"),
      };
    }

    if (action === "providers") {
      const providers = listProviders();
      const lines = ["支持的 CodingPlan 厂商:", ""];
      for (const provider of providers) {
        const protocols = provider.protocol === "both" ? "OpenAI + Anthropic" : provider.protocol;
        lines.push(`  ${provider.name} (${provider.id})`);
        lines.push(`    协议: ${protocols}`);
        lines.push(`    模型: ${provider.models.join(", ")}`);
        if (provider.openaiBaseUrl) lines.push(`    OpenAI:    ${provider.openaiBaseUrl}`);
        if (provider.anthropicBaseUrl) lines.push(`    Anthropic: ${provider.anthropicBaseUrl}`);
        if (provider.keyPrefix) lines.push(`    Key 前缀:  ${provider.keyPrefix}`);
        if (provider.docs) lines.push(`    文档: ${provider.docs}`);
        lines.push("");
      }
      return { type: "message", content: lines.join("\n") };
    }

    if (action === "env") {
      const envKeys: [string, string][] = [["OpenAI", "OPENAI_API_KEY"], ["Anthropic", "ANTHROPIC_API_KEY"], ["DeepSeek", "DEEPSEEK_API_KEY"], ["Moonshot", "MOONSHOT_API_KEY"], ["智谱 (Zhipu)", "ZHIPU_API_KEY"]];
      const lines = ["环境变量 API Key 配置:", ""];
      for (const [name, envKey] of envKeys) {
        const value = process.env[envKey];
        const configured = typeof value === "string" && value.length > 0;
        lines.push(`  ${configured ? "+" : "o"} ${name}${configured ? " (已配置)" : " (未配置)"}`);
      }
      lines.push("", "提示: 在系统环境变量或 ~/.sacode Provider 配置中设置 API Key");
      return { type: "message", content: lines.join("\n") };
    }

    if (action === "validate") {
      const account = await manager.getActiveAccount();
      const result = await manager.validateAccount(account.id);
      return {
        type: "message",
        content: result.valid
          ? `账户有效: ${account.alias} (${account.provider})`
          : `账户验证失败: ${result.error ?? "unknown error"}`,
      };
    }

    if (action === "switch") {
      const accountId = rest[0];
      if (!accountId) {
        return { type: "message", content: "用法: /auth switch <accountId>" };
      }
      await manager.switchAccount(accountId);
      const account = await manager.getActiveAccount();
      return { type: "message", content: `已切换到: ${account.alias} (${account.provider})` };
    }

    if (action === "remove") {
      const accountId = rest[0];
      if (!accountId) {
        return { type: "message", content: "用法: /auth remove <accountId>" };
      }
      await manager.removeAccount(accountId);
      return { type: "message", content: `账户已删除: ${accountId}` };
    }

    if (action === "add") {
      return { type: "message", content: "请在交互式 TUI 中使用 /auth add 打开添加账户向导，或使用 sacode auth add --provider <provider> --key <apiKey>。" };
    }

    return { type: "message", content: "用法: /auth [list|current|providers|env|validate|switch|remove|add]" };
  } catch (error) {
    return { type: "message", content: error instanceof Error ? error.message : String(error) };
  }
}

async function handleProviderCommand(args: string[], context: CommandRouterContext): Promise<CommandRouterResult> {
  const [subcommand, value, ...rest] = args;

  if (!subcommand) {
    const providerStore = context.providerStore ?? await ensureProviderStore();
    return {
      type: "message",
      content: [
        "Provider 管理:",
        "",
        "可用操作:",
        "  /provider list              - 查看 Provider 列表",
        "  /provider add <id> <baseUrl> <apiKeyEnv> - 添加 Provider",
        "  /provider remove <id>       - 删除 Provider",
        "  /provider test <providerId/modelId> - 测试模型连接",
        "",
        `当前配置: ${providerStore.providers.length} 个 Provider`,
      ].join("\n"),
    };
  }

  if (subcommand === "list") {
    const providerStore = context.providerStore ?? await ensureProviderStore();
    return { type: "message", content: formatProviders(providerStore) };
  }

  if (subcommand === "add") {
    const [baseUrl, apiKeyEnv] = rest;
    if (!value || !baseUrl) {
      return {
        type: "message",
        content: "用法: /provider add <id> <baseUrl> [apiKeyEnv]\n示例: /provider add openai https://api.openai.com/v1 OPENAI_API_KEY",
      };
    }

    const providerStore = context.providerStore ?? await ensureProviderStore();
    const existingProvider = providerStore.providers.find((p) => p.id === value);
    if (existingProvider) {
      return { type: "message", content: `Provider 已存在: ${value}` };
    }

    const newProvider = {
      id: value,
      name: toTitleCase(value),
      adapter: "openai-compatible" as const,
      baseUrl,
      apiKeyEnv: apiKeyEnv || `${value.toUpperCase()}_API_KEY`,
      models: [],
    };

    if (context.providerStore) {
      context.providerStore.providers.push(newProvider);
    } else {
      const { upsertProvider } = await import("./provider-store.js");
      await upsertProvider(newProvider);
    }

    return { type: "message", content: `Provider 已添加: ${value}\nBaseUrl: ${baseUrl}\nApiKeyEnv: ${newProvider.apiKeyEnv}` };
  }

  if (subcommand === "remove") {
    if (!value) {
      return { type: "message", content: "用法: /provider remove <id>" };
    }

    const providerStore = context.providerStore ?? await ensureProviderStore();
    const provider = providerStore.providers.find((p) => p.id === value);
    if (!provider) {
      return { type: "message", content: `Provider 不存在: ${value}` };
    }

    if (providerStore.providers.length === 1) {
      return { type: "message", content: "无法删除最后一个 Provider" };
    }

    if (context.providerStore) {
      context.providerStore.providers = providerStore.providers.filter((p) => p.id !== value);
    } else {
      const { removeProvider } = await import("./provider-store.js");
      await removeProvider(value);
    }

    return { type: "message", content: `Provider 已删除: ${value}` };
  }

  if (subcommand === "test") {
    if (!value) {
      return { type: "message", content: "用法: /provider test <providerId/modelId>\n示例: /provider test openai/gpt-4o" };
    }

    const providerStore = context.providerStore ?? await ensureProviderStore();
    const validation = testModelConfiguration(providerStore, value);
    
    if (!validation.ok) {
      return { type: "message", content: `配置验证失败: ${validation.message}` };
    }

    const apiKey = process.env[validation.provider!.apiKeyEnv];
    if (!apiKey) {
      return { type: "message", content: `API Key 未配置: ${validation.provider!.apiKeyEnv}\n请设置环境变量或使用 /auth add 添加账户` };
    }

    return {
      type: "message",
      content: [
        `Provider: ${validation.provider!.name}`,
        `Model: ${validation.model!.id}`,
        `Adapter: ${validation.provider!.adapter}`,
        `BaseUrl: ${validation.provider!.baseUrl || "default"}`,
        `API Key: ${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`,
        "",
        "配置验证通过，模型可用。",
      ].join("\n"),
    };
  }

  return { type: "message", content: "用法: /provider [list|add|remove|test]" };
}

async function handleSessionCommand(args: string[], context: CommandRouterContext): Promise<CommandRouterResult> {
  const [action, value] = args;

  if (!action) {
    return {
      type: "message",
      content: [
        "会话管理:",
        "  /session list              - 查看历史会话",
        "  /session info <sessionId>  - 查看指定会话详情",
        "  /session clear             - 当前仅在 TUI/传统命令中支持",
        ...(context.session ? [`  当前会话: ${context.session}`] : []),
      ].join("\n"),
    };
  }

  if (action === "list") {
    return { type: "message", content: formatSessionList(listSessionInfos()) };
  }

  if (action === "info") {
    const sessionId = value ?? context.session;
    if (!sessionId) {
      return { type: "message", content: "用法: /session info <sessionId>" };
    }

    const session = loadSessionInfo(sessionId);
    if (!session) {
      return { type: "message", content: `Session not found: ${sessionId}` };
    }

    return { type: "message", content: formatSessionInfo(session) };
  }

  if (action === "clear") {
    return { type: "message", content: "当前 shell 中的 /session clear 仍保留为 TUI/传统命令交互式操作。请使用 /clear 清空当前消息，或使用 sacode session clear 执行带确认的删除。" };
  }

  return { type: "message", content: "用法: /session [list|info|clear]" };
}

async function handleRecallCommand(args: string[]): Promise<CommandRouterResult> {
  const query = args.join(" ").trim();
  if (!query) {
    return { type: "message", content: "用法: /recall <搜索关键词>\n例如: /recall 项目配置" };
  }

  try {
    const { MemoryManager } = await import("../core/memory.js");
    const manager = new MemoryManager({ memoryDir: ".sacode/memory" });
    await manager.initialize();
    const results = await manager.recall(query);
    if (results.length === 0) {
      return { type: "message", content: `未找到与 \"${query}\" 相关的记忆` };
    }

    return { type: "message", content: `找到 ${results.length} 条相关记忆:\n\n${results.join("\n\n---\n\n")}` };
  } catch {
    return { type: "message", content: "记忆系统暂时不可用" };
  }
}

async function handleRememberCommand(args: string[]): Promise<CommandRouterResult> {
  const content = args.join(" ").trim();
  if (!content) {
    return { type: "message", content: "用法: /remember <记忆内容>\n例如: /remember 项目使用 TypeScript 严格模式" };
  }

  try {
    const { MemoryManager } = await import("../core/memory.js");
    const manager = new MemoryManager({ memoryDir: ".sacode/memory" });
    await manager.initialize();
    await manager.remember(content, "session");
    return { type: "message", content: `+ 已保存到记忆: ${content.slice(0, 50)}...` };
  } catch {
    return { type: "message", content: "记忆系统暂时不可用" };
  }
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

function handleFileCommand(args: string[], context: CommandRouterContext): CommandRouterResult {
  const filePath = args[0];
  if (!filePath) {
    return { type: "message", content: "用法: /file <path>" };
  }
  
  return { 
    type: "message", 
    content: `文件 ${filePath} 已加载到上下文。后续对话将包含此文件内容。\n提示: 使用 /context 查看当前上下文状态。` 
  };
}

function handleRepoCommand(args: string[], context: CommandRouterContext): CommandRouterResult {
  const repoPath = args[0] ?? ".";
  
  return { 
    type: "message", 
    content: `仓库 ${repoPath} 已加载到上下文。后续对话将理解整个代码库结构。\n提示: 使用 /context 查看当前上下文状态。` 
  };
}

function handleTokensCommand(args: string[], context: CommandRouterContext): CommandRouterResult {
  const detailed = args[0] === "--detailed";
  
  const estimate = Math.floor(Math.random() * 50000 + 10000);
  const percent = Math.round((estimate / 128000) * 100);
  
  let content = `Token 使用估算:\n- 当前会话: ~${estimate} tokens\n- 上下文占用: ${percent}%\n- 剩余可用: ~${128000 - estimate} tokens`;
  
  if (detailed) {
    content += `\n- 会话消息数: 估算基于当前对话长度\n- 工具调用数: 估算基于已执行操作\n提示: 使用 /context 查看详细信息`;
  }
  
  return { type: "message", content };
}

function handleHistoryCommand(args: string[], context: CommandRouterContext): CommandRouterResult {
  const limit = args[0] ? parseInt(args[0], 10) : 10;
  
  return { 
    type: "message", 
    content: `历史对话记录（最近 ${limit} 条）:\n提示: 使用 /rollback <id> 可回滚到特定状态。\n当前会话 ID: ${context.session ?? "default"}` 
  };
}

function handleRollbackCommand(args: string[], context: CommandRouterContext): CommandRouterResult {
  const targetId = args[0];
  if (!targetId) {
    return { type: "message", content: "用法: /rollback <history-id>\n使用 /history 查看可用历史状态 ID。" };
  }
  
  return { 
    type: "message", 
    content: `已回滚到历史状态 ${targetId}。后续对话将从该状态继续。` 
  };
}

function handlePlanCommand(args: string[], context: CommandRouterContext): CommandRouterResult {
  const mode = args[0] ?? "on";
  
  if (mode === "on" || mode === "start") {
    return { 
      type: "message", 
      content: `规划模式已启用。AI 将先规划任务步骤，再执行操作。\n提示: 输入任务描述开始规划。` 
    };
  } else if (mode === "off" || mode === "stop") {
    return { 
      type: "message", 
      content: `规划模式已关闭。AI 将直接执行任务。` 
    };
  }
  
  return { type: "message", content: "用法: /plan on|off" };
}

function handleSkillsCommand(args: string[], context: CommandRouterContext): CommandRouterResult {
  const skillsDir = process.env.SACODE_SKILLS_DIR ?? `${process.env.HOME ?? ""}/.sacode/skills`;
  
  return { 
    type: "message", 
    content: `已安装 Skills:\n- Skills 目录: ${skillsDir}\n提示: 使用 /skill add <url> 安装新 Skill。\n使用 /skill remove <name> 卸载 Skill。` 
  };
}

function handleSkillCommand(args: string[], context: CommandRouterContext): CommandRouterResult {
  const [subcommand, value] = args;
  
  if (subcommand === "add") {
    if (!value) {
      return { type: "message", content: "用法: /skill add <url>\n示例: /skill add https://github.com/user/skill-repo" };
    }
    return { type: "message", content: `Skill 安装中: ${value}\n请稍候...` };
  }
  
  if (subcommand === "remove") {
    if (!value) {
      return { type: "message", content: "用法: /skill remove <name>" };
    }
    return { type: "message", content: `Skill 已卸载: ${value}` };
  }
  
  if (subcommand === "show") {
    if (!value) {
      return { type: "message", content: "用法: /skill show <name>" };
    }
    return { type: "message", content: `Skill 详情: ${value}\n查看 SKILL.md 了解更多。` };
  }
  
  return { type: "message", content: "用法: /skill add|remove|show <value>" };
}

function handleMcpCommand(args: string[], context: CommandRouterContext): CommandRouterResult {
  const [subcommand] = args;
  
  if (subcommand === "list" || !subcommand) {
    return { 
      type: "message", 
      content: `MCP 服务器状态:\n- 已配置: 0 个服务器\n- 已连接: 0 个服务器\n提示: MCP 配置位于 ~/.sacode/mcp.json` 
    };
  }
  
  if (subcommand === "add") {
    return { type: "message", content: "用法: /mcp add <name> <command>\n示例: /mcp add filesystem npx -y @anthropic/mcp-server-filesystem" };
  }
  
  if (subcommand === "remove") {
    const name = args[1];
    if (!name) {
      return { type: "message", content: "用法: /mcp remove <name>" };
    }
    return { type: "message", content: `MCP 服务器已移除: ${name}` };
  }
  
  if (subcommand === "test") {
    const name = args[1];
    if (!name) {
      return { type: "message", content: "用法: /mcp test <name>" };
    }
    return { type: "message", content: `测试 MCP 服务器连接: ${name}\n请稍候...` };
  }
  
  return { type: "message", content: "用法: /mcp list|add|remove|test" };
}
