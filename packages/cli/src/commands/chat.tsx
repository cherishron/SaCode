/**
 * Chat 命令 - TUI 模式
 *
 * 使用 Ink 实现 Claude Code 风格的交互界面
 */

import React, { useState } from "react";
import type { Readable } from "node:stream";
import { render } from "ink";
import chalk from "chalk";
import {
  SACODEClient,
  type ProviderConfig,
  type ToolCall,
  type ToolCallResult,
  type ConfirmationRequest,
  getPreferenceManager,
} from "@sacode/core";
import ChatApp, { type Message } from "../ui/App.js";
import { createCliToolRegistryAdapter } from "../lib/capabilities.js";
import {
  collectWorkspaceContext,
  formatWorkspaceContext,
  workspaceContextToPrompt,
} from "../lib/workspace-context.js";
import {
  createAssistantDeltaEvent,
  createCompleteEvent,
  createStartEvent,
  createSystemEvent,
  getPrintOutputFormat,
  serializeJsonEvent,
  type JsonEvent,
  type PrintOutputFormat,
} from "../lib/print-output.js";
import { routeSlashCommand } from "../lib/command-router.js";
import { buildAgentDispatchPlan, ensureAgentStore } from "../lib/agent-store.js";
import { ensureProviderStore, providerConfigFromStore } from "../lib/provider-store.js";

interface ChatOptions {
  message?: string;
  session?: string;
  print?: boolean;
  json?: boolean;
  streamJson?: boolean;
}

/**
 * 从环境变量获取 Provider 配置
 */
async function getProviderConfig(): Promise<ProviderConfig> {
  const storeConfig = providerConfigFromStore(await ensureProviderStore());
  if (storeConfig) return storeConfig;
  return getProviderConfigFromEnv();
}

function getProviderConfigFromEnv(): ProviderConfig {
  const providerType = (process.env.AI_PROVIDER ?? "openai") as ProviderConfig["type"];

  const defaultModel = "gpt-4";
  const getEnvModel = (envKey?: string) => envKey || defaultModel;

  const baseConfig = {
    type: providerType,
    apiKey: "",
    model: defaultModel,
  } as const;

  switch (providerType) {
    case "anthropic":
      return {
        ...baseConfig,
        type: "anthropic",
        apiKey: process.env.ANTHROPIC_API_KEY ?? "",
        model: getEnvModel(process.env.ANTHROPIC_MODEL),
        ...(process.env.ANTHROPIC_BASE_URL && { baseUrl: process.env.ANTHROPIC_BASE_URL }),
      };
    case "deepseek":
      return {
        ...baseConfig,
        type: "deepseek",
        apiKey: process.env.DEEPSEEK_API_KEY ?? "",
        model: getEnvModel(process.env.DEEPSEEK_MODEL),
      };
    case "moonshot":
      return {
        ...baseConfig,
        type: "moonshot",
        apiKey: process.env.MOONSHOT_API_KEY ?? "",
        model: getEnvModel(process.env.MOONSHOT_MODEL),
      };
    case "zhipu":
      return {
        ...baseConfig,
        type: "zhipu",
        apiKey: process.env.ZHIPU_API_KEY ?? "",
        model: getEnvModel(process.env.ZHIPU_MODEL),
      };
    case "openai":
    default:
      return {
        ...baseConfig,
        type: "openai",
        apiKey: process.env.OPENAI_API_KEY ?? "",
        model: getEnvModel(process.env.OPENAI_MODEL),
        ...(process.env.OPENAI_BASE_URL && { baseUrl: process.env.OPENAI_BASE_URL }),
      };
  }
}

interface CliClientContext {
  client: SACODEClient;
  capabilities: ReturnType<typeof createCliToolRegistryAdapter>["capabilities"];
  registry: ReturnType<typeof createCliToolRegistryAdapter>["registry"];
  confirmationMode: ReturnType<typeof createCliToolRegistryAdapter>["confirmationMode"];
  providerConfig: ProviderConfig;
  cwd: string;
}

async function createCliClient(): Promise<CliClientContext> {
  const providerConfig = await getProviderConfig();

  if (!providerConfig.apiKey || providerConfig.apiKey.includes("your-api-key")) {
    throw new Error("API key 无效或缺失，请在 .env 文件或环境变量中设置有效的 API Key");
  }

  const cwd = process.cwd();
  const { capabilities, registry, confirmationMode } = createCliToolRegistryAdapter(cwd, {
    confirm: confirmChatToolExecution,
  });
  const client = new SACODEClient({
    provider: providerConfig,
    timeout: parseInt(process.env.IFLOW_TIMEOUT || "60000", 10),
    toolBridge: {
      capabilitiesRegistry: registry,
    },
  });

  try {
    await client.connect();
  } catch (error) {
    await capabilities.shutdown();
    throw error;
  }

  return { client, capabilities, registry, confirmationMode, providerConfig, cwd };
}

async function closeCliClient(context: CliClientContext): Promise<void> {
  await context.client.disconnect();
  await context.capabilities.shutdown();
}

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Chat 包装器组件 - 管理 React 状态
 */
const ChatWrapper: React.FC<{
  version: string;
  model: string;
  language: string;
  cwd: string;
  workspaceContext: string;
  client: SACODEClient;
  confirmationMode: CliClientContext["confirmationMode"];
  options: ChatOptions;
  preferenceManager: ReturnType<typeof getPreferenceManager>;
}> = ({ version, model, language, cwd, workspaceContext, client, confirmationMode, options, preferenceManager }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const initialMessageSent = React.useRef(false);

  React.useEffect(() => {
    const startedAt = new Map<string, number>();

    const onToolStart = (toolCall: ToolCall) => {
      const args = parseToolArgs(toolCall.function.arguments);
      const started = Date.now();
      startedAt.set(toolCall.id, started);

      const toolMessage: Message = {
        id: toolCall.id,
        role: "tool",
        content: "",
        toolName: toolCall.function.name,
        toolArgs: args,
        toolStatus: "running",
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, toolMessage]);
    };

    const onToolEnd = (result: ToolCallResult) => {
      const duration = Date.now() - (startedAt.get(result.toolCallId) ?? Date.now());
      setMessages(prev => prev.map(message => (
        message.id === result.toolCallId
          ? {
              ...message,
              toolStatus: result.success ? "success" : "error",
              toolResult: result.content,
              toolDuration: duration,
            }
          : message
      )));
    };

    client.on("tool_call_start", onToolStart);
    client.on("tool_call_end", onToolEnd);

    return () => {
      client.off("tool_call_start", onToolStart);
      client.off("tool_call_end", onToolEnd);
    };
  }, [client]);

  // 处理消息
  const handleMessage = async (userInput: string) => {
    if (isLoading) return;

    // 处理命令
    if (userInput.startsWith("/")) {
      await handleCommand(userInput);
      return;
    }

    setIsLoading(true);
    setStreamingContent("");

    // 添加用户消息
    const userMessage: Message = {
      id: generateId(),
      role: "user",
      content: userInput,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);

    try {
      const agentPlan = buildAgentDispatchPlan(await ensureAgentStore(), userInput);
      if (agentPlan.enabled) {
        const agentMessage: Message = {
          id: generateId(),
          role: "system",
          content: formatAgentPlan(agentPlan),
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, agentMessage]);
      }

      // 处理 AI 响应
      let assistantContent = "";

      for await (const msg of client.chat(userInput, options.session)) {
        // 处理不同类型的消息
        if (msg.role === "assistant" && "chunk" in msg) {
          // 助手消息 - 流式文本
          assistantContent += msg.chunk.text;
          setStreamingContent(assistantContent);
        } else if (msg.role === "system") {
          // 系统消息
          if ("stopReason" in msg) {
            // 任务完成
            if (msg.stopReason === "error") {
              setStreamingContent(prev => prev + "\n[发生错误]");
            }
          } else if ("message" in msg) {
            // 错误消息
            setStreamingContent(prev => prev + `\n[错误: ${msg.message}]`);
          }
        }
      }

      // 添加助手消息
      if (assistantContent) {
        const assistantMessage: Message = {
          id: generateId(),
          role: "assistant",
          content: assistantContent,
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, assistantMessage]);
      }
    } catch (error) {
      const errorMessage: Message = {
        id: generateId(),
        role: "system",
        content: `错误: ${error instanceof Error ? error.message : "未知错误"}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
      setStreamingContent("");
    }
  };

  React.useEffect(() => {
    if (!options.message || initialMessageSent.current) return;
    initialMessageSent.current = true;
    void handleMessage(options.message);
  });

  // 处理命令
  const handleCommand = async (command: string) => {
    const result = await routeSlashCommand(command, {
      tools: client.getAvailableTools(),
      workspaceContext,
      model,
      language,
      session: options.session,
      confirmationMode,
      preferences: preferenceManager.getAll() as unknown as Record<string, unknown>,
      setLanguage: (newLanguage) => preferenceManager.set("language", newLanguage as never),
    });

    if (result.type === "clear") {
      setMessages([]);
      return;
    }

    if (result.type === "exit") {
      process.exit(0);
      return;
    }

    setMessages(prev => [...prev, {
      id: generateId(),
      role: "system",
      content: result.content,
      timestamp: new Date(),
    }]);
  };

  return (
    <ChatApp
      version={version}
      model={model}
      language={language}
      cwd={cwd}
      onMessage={handleMessage}
      messages={messages}
      isLoading={isLoading}
      streamingContent={streamingContent}
      showHeader={true}
    />
  );
};

function parseToolArgs(args: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(args);
    return typeof parsed === "object" && parsed !== null
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

async function confirmChatToolExecution(request: ConfirmationRequest): Promise<boolean> {
  const isTty = process.stdin.isTTY && process.stdout.isTTY;
  if (!isTty) return false;

  process.stdout.write(`\nTool confirmation required\n`);
  process.stdout.write(`  Tool: ${request.toolName}\n`);
  process.stdout.write(`  Risk: ${request.riskLevel}\n`);
  process.stdout.write(`  Reason: ${request.reason}\n`);
  process.stdout.write(`Allow this tool execution? [y/N] `);

  return new Promise((resolve) => {
    const onData = (data: Buffer) => {
      process.stdin.off("data", onData);
      const normalized = data.toString().trim().toLowerCase();
      resolve(normalized === "y" || normalized === "yes");
    };
    process.stdin.once("data", onData);
  });
}

/**
 * 启动 Chat TUI
 */
export async function startChat(options: ChatOptions): Promise<void> {
  const outputFormat = getPrintOutputFormat(options);
  if (options.message && (options.print || outputFormat !== "text")) {
    await runPrintChat(options.message, options.session, outputFormat);
    return;
  }

  if (!options.message && !process.stdin.isTTY) {
    await runNonInteractiveSlashCommands(options.session);
    return;
  }

  // 加载用户偏好
  const preferenceManager = getPreferenceManager();
  preferenceManager.load();
  const workspaceSummary = await collectWorkspaceContext(process.cwd());
  const workspaceContext = formatWorkspaceContext(workspaceSummary);

  let context: CliClientContext;
  try {
    context = await createCliClient();
  } catch (error) {
    console.log(chalk.red("连接 AI 服务失败"));
    console.log(chalk.red(error instanceof Error ? error.message : "未知错误"));
    process.exit(1);
  }

  // 渲染 TUI
  const { unmount } = render(
    <ChatWrapper
      version="1.0.0"
      model={context.providerConfig.model ?? "default"}
      language={preferenceManager.getResolvedLanguage()}
      cwd={context.cwd}
      workspaceContext={workspaceContext}
      client={context.client}
      confirmationMode={context.confirmationMode}
      options={options}
      preferenceManager={preferenceManager}
    />
  );

  // 清理
  const cleanup = () => {
    unmount();
    void closeCliClient(context);
  };

  process.on("exit", cleanup);
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

async function runNonInteractiveSlashCommands(session: string | undefined): Promise<void> {
  const input = await readStream(process.stdin);
  const commands = input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (commands.length === 0) return;

  const preferenceManager = getPreferenceManager();
  preferenceManager.load();
  const cwd = process.cwd();
  const workspaceSummary = await collectWorkspaceContext(cwd);
  const { capabilities, registry, confirmationMode } = createCliToolRegistryAdapter(cwd);

  try {
    for (const command of commands) {
      if (!command.startsWith("/")) {
        process.stderr.write(`非交互模式仅支持 slash commands。自然语言任务请使用 -p: ${command}\n`);
        process.exitCode = 1;
        continue;
      }

      const result = await routeSlashCommand(command, {
        tools: registry.list().map((tool) => tool.name),
        workspaceContext: formatWorkspaceContext(workspaceSummary),
        model: (await getProviderConfig()).model ?? "default",
        language: preferenceManager.getResolvedLanguage(),
        session,
        confirmationMode,
        preferences: preferenceManager.getAll() as unknown as Record<string, unknown>,
        setLanguage: (newLanguage) => preferenceManager.set("language", newLanguage as never),
      });

      if (result.type === "exit") break;
      if (result.type === "clear") continue;
      process.stdout.write(`${result.content}\n`);
    }
  } finally {
    await capabilities.shutdown();
  }
}

async function readStream(stream: Readable): Promise<string> {
  let input = "";
  for await (const chunk of stream) {
    input += String(chunk);
  }
  return input;
}

async function runPrintChat(
  message: string,
  session: string | undefined,
  outputFormat: PrintOutputFormat
): Promise<void> {
  let context: CliClientContext;
  try {
    context = await createCliClient();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "连接 AI 服务失败";
    if (outputFormat === "text") {
      console.error(chalk.red(errorMessage));
    } else {
      writeJsonLine({ type: "error", error: errorMessage });
    }
    process.exit(1);
  }

  let content = "";
  const events: JsonEvent[] = [];
  const errors: string[] = [];
  const toolStartedAt = new Map<string, number>();
  const startedAt = Date.now();
  const workspaceSummary = await collectWorkspaceContext(context.cwd);

  const onToolStart = (toolCall: ToolCall) => {
    const args = parseToolArgs(toolCall.function.arguments);
    toolStartedAt.set(toolCall.id, Date.now());
    const event = {
      type: "tool_start",
      id: toolCall.id,
      name: toolCall.function.name,
      args,
    };
    events.push(event);

    if (outputFormat === "stream-json") {
      writeJsonLine(event);
    } else if (outputFormat === "text") {
      process.stderr.write(`\n[tool:start] ${toolCall.function.name}\n`);
    }
  };

  const onToolEnd = (result: ToolCallResult) => {
    const durationMs = Date.now() - (toolStartedAt.get(result.toolCallId) ?? Date.now());
    const event = {
      type: "tool_result",
      id: result.toolCallId,
      name: result.name,
      success: result.success,
      durationMs,
      content: result.content,
    };
    events.push(event);
    if (!result.success) errors.push(`Tool ${result.name} failed: ${result.content}`);

    if (outputFormat === "stream-json") {
      writeJsonLine(event);
    } else if (outputFormat === "text") {
      process.stderr.write(`[tool:${result.success ? "ok" : "error"}] ${result.name} (${durationMs}ms)\n`);
    }
  };

  context.client.on("tool_call_start", onToolStart);
  context.client.on("tool_call_end", onToolEnd);

  try {
    if (outputFormat === "stream-json") {
      writeJsonLine(createStartEvent({ session, providerConfig: context.providerConfig, workspace: workspaceSummary }));
    }

      const agentPlan = buildAgentDispatchPlan(await ensureAgentStore(), message);
      const contextualMessage = `${workspaceContextToPrompt(workspaceSummary)}${agentPlan.enabled ? `\n\n${formatAgentPlan(agentPlan)}` : ""}\n\nUser request:\n${message}`;
    for await (const msg of context.client.chat(contextualMessage, session)) {
      if (msg.role === "assistant" && "chunk" in msg) {
        content += msg.chunk.text;
        if (outputFormat === "text") {
          process.stdout.write(msg.chunk.text);
        } else if (outputFormat === "stream-json") {
          writeJsonLine(createAssistantDeltaEvent(msg.chunk.text));
        }
      } else if (msg.role === "system" && "message" in msg) {
        const event = createSystemEvent(msg.message);
        errors.push(msg.message);
        events.push(event);
        if (outputFormat === "text") {
          process.stderr.write(`\n${msg.message}\n`);
        } else if (outputFormat === "stream-json") {
          writeJsonLine(event);
        }
      }
    }

    const durationMs = Date.now() - startedAt;
    const completedEvent = createCompleteEvent({
      content,
      session,
      providerConfig: context.providerConfig,
      durationMs,
      errors,
      workspace: workspaceSummary,
    });

    if (outputFormat === "text") {
      process.stdout.write("\n");
    } else if (outputFormat === "json") {
      writeJsonLine(createCompleteEvent({
        content,
        session,
        providerConfig: context.providerConfig,
        durationMs,
        errors,
        workspace: workspaceSummary,
        events,
      }));
    } else {
      writeJsonLine(completedEvent);
    }
  } finally {
    context.client.off("tool_call_start", onToolStart);
    context.client.off("tool_call_end", onToolEnd);
    await closeCliClient(context);
  }
}

function formatAgentPlan(plan: ReturnType<typeof buildAgentDispatchPlan>): string {
  const lines = [
    "Agent dispatch plan:",
    `- primary: ${plan.primaryAgent ? `${plan.primaryAgent.id} (${plan.primaryAgent.model})` : "none"}`,
    `- subAgents: ${plan.subAgents.map((agent) => `${agent.id} (${agent.model})`).join(", ") || "none"}`,
    `- reason: ${plan.reason}`,
  ];
  return lines.join("\n");
}

function writeJsonLine(event: JsonEvent): void {
  process.stdout.write(serializeJsonEvent(event));
}
