/**
 * Chat 命令 - TUI 模式
 *
 * 使用 Ink 实现 Claude Code 风格的交互界面
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { render } from "ink";
import { SACODEClient, type ProviderConfig, getPreferenceManager, getCostTracker, type UserPreferences } from "@sacode/core";
import { parseSlashCommand, executeSlashCommand } from "../commands/parser.js";
import ChatApp, { type Message } from "../ui/App.js";
import { AuthSetup } from "../ui/components/AuthSetup.js";
import { ModelSetup } from "../ui/components/ModelSetup.js";
import { listProviders } from "../auth/providers.js";
import type { CodingPlanProvider } from "../auth/types.js";
import { compactMessages } from "../core/compaction.js";
import type { Message as CompactionMessage } from "../core/QueryEngine.js";
import {
  detectProjectType,
  detectTechStack,
  analyzeDirectory,
  categorizeDependencies,
  detectConfigFiles,
  detectConventions,
  getGitBranch,
} from "./chat/helpers.js";
import { loadChatRuntime, registerCleanup } from "./chat/bootstrap.js";
import { handleRunnerEvent } from "./chat/events.js";
import { createChatSlashRegistry } from "./chat/registry.js";
import { filterToolsForAgent } from "../agent/tool-filter.js";
import { ensureAgentStore } from "../lib/agent-store.js";

export interface ChatOptions {
  message?: string;
  session?: string;
}

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

const SUPPORTED_LANGUAGE_CODES: UserPreferences["language"][] = ["zh-CN", "en-US", "ja-JP", "ko-KR"];
type ChatWorkMode = "smart" | "yolo" | "plan";
const VALID_PREFERENCE_KEYS: (keyof UserPreferences)[] = [
  "language",
  "defaultModel",
  "defaultProvider",
  "customInstructions",
  "outputStyle",
  "showToolDetails",
  "showThinking",
  "theme",
  "timezone",
];

function isPreferenceKey(value: string): value is keyof UserPreferences {
  return VALID_PREFERENCE_KEYS.includes(value as keyof UserPreferences);
}

function parsePreferenceValue<K extends keyof UserPreferences>(
  key: K,
  value: string,
): UserPreferences[K] {
  if (key === "showToolDetails" || key === "showThinking") {
    return (value === "true" || value === "1" || value === "yes") as UserPreferences[K];
  }

  return value as UserPreferences[K];
}

function isCodingPlanProvider(value: string): value is CodingPlanProvider {
  return listProviders().some((provider) => provider.id === value);
}

function toCompactionMessages(messages: Message[]): CompactionMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function fromCompactionMessages(messages: CompactionMessage[]): Message[] {
  return messages.map((message, index) => ({
    id: `${generateId()}_${index}`,
    role: message.role,
    content: message.content,
    timestamp: new Date(),
  }));
}

const ChatWrapper: React.FC<{
  version: string;
  model: string;
  language: string;
  cwd: string;
  client: SACODEClient;
  options: ChatOptions;
  preferenceManager: ReturnType<typeof getPreferenceManager>;
}> = ({ version, model, language, cwd, client, options, preferenceManager }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const toolMessageIdsRef = useRef<Record<string, string>>({});
  const toolStartTimesRef = useRef<Record<string, number>>({});
  const [gitBranch, setGitBranch] = useState<string | undefined>(undefined);
  const [accountInfo, setAccountInfo] = useState<
    { alias: string; provider: string } | undefined
  >(undefined);

  // 退出统计相关状态
  const sessionStartTime = useRef(Date.now());
  const [messageCount, setMessageCount] = useState(0);
  const [isExiting, setIsExiting] = useState(false);

  // 交互式命令状态
  const [showAuthSetup, setShowAuthSetup] = useState(false);
  const [showModelSetup, setShowModelSetup] = useState(false);
  const [modelSetupData, setModelSetupData] = useState<{ models: string[]; providerName: string }>({ models: [], providerName: "" });

  // Reactive model state so UI updates when /model switches
  const [currentModel, setCurrentModel] = useState(model);

  // Ref for model so registry closures always see latest value
  const modelRef = useRef(currentModel);
  modelRef.current = currentModel;

  // 退出处理函数
  const handleExit = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => {
      process.exit(0);
    }, 2000);
  }, []);

  const registry = useMemo(
    () =>
      createChatSlashRegistry({
        cwd,
        messages,
        modelRef,
        preferenceManager,
        supportedLanguageCodes: SUPPORTED_LANGUAGE_CODES,
        validPreferenceKeys: VALID_PREFERENCE_KEYS,
        isPreferenceKey,
        parsePreferenceValue,
        isCodingPlanProvider,
        toCompactionMessages,
        fromCompactionMessages,
        handleExit,
        setMessages,
        setCurrentModel,
        setShowAuthSetup,
        setShowModelSetup,
        setModelSetupData,
      }),
    [
      cwd,
      messages,
      preferenceManager,
      handleExit,
      setMessages,
      setCurrentModel,
      setShowAuthSetup,
      setShowModelSetup,
      setModelSetupData,
    ]
  );

  const slashCommands = useMemo(() => registry.getAll(), [registry]);

  // 启动时获取 git 分支
  useEffect(() => {
    setGitBranch(getGitBranch(cwd));
  }, [cwd]);

  // 尝试获取 CodingPlan 账户信息
  useEffect(() => {
    (async () => {
      try {
        const { CodingPlanAccountManager } = await import("../auth/account-manager.js");
        const manager = new CodingPlanAccountManager();
              const account = await manager.getActiveAccount();
              const preset = listProviders().find((provider) => provider.id === account.provider);
              setAccountInfo({
                alias: account.alias,
                provider: preset?.name || account.provider,
              });
            } catch {
              // 未配置账户，保持 undefined
            }
    })();
  }, []);

  // 处理消息
  const handleMessage = async (userInput: string) => {
    if (isLoading) return;

    // 处理 Slash 命令（通过 registry）
    if (userInput.startsWith("/")) {
      // 纯 "/" 输入静默忽略，不报错
      if (userInput.trim() === "/") {
        return;
      }

      const parsed = parseSlashCommand(userInput);
      const result = await executeSlashCommand(parsed, registry, {
        sessionId: options.session,
        output: (msg: string) => {
          setMessages((prev) => [
            ...prev,
            {
              id: generateId(),
              role: "system" as const,
              content: msg,
              timestamp: new Date(),
            },
          ]);
        },
        error: (msg: string) => {
          setMessages((prev) => [
            ...prev,
            {
              id: generateId(),
              role: "system" as const,
              content: `[ERR] ${msg}`,
              timestamp: new Date(),
            },
          ]);
        },
      });

      if (!result.success && result.error) {
        setMessages((prev) => [
          ...prev,
          {
            id: generateId(),
            role: "system" as const,
            content: `未知命令或执行失败: ${result.error}`,
            timestamp: new Date(),
          },
        ]);
      }
      return;
    }

    // 用户消息计数
    setMessageCount((prev) => prev + 1);

    setIsLoading(true);
    setStreamingContent("");

    // 添加用户消息（去重检查）
    const userMessage: Message = {
      id: generateId(),
      role: "user",
      content: userInput,
      timestamp: new Date(),
    };
    setMessages((prev) => {
      // 检查是否已有相同内容的用户消息（防止重复）
      const isDuplicate = prev.some(
        (m) =>
          m.role === "user" && m.content === userInput && Date.now() - m.timestamp.getTime() < 1000
      );
      if (isDuplicate) return prev;
      return [...prev, userMessage];
    });

    try {
      const { AgentRunner } = await import("../agent/runner.js");
      const { createDefaultTools } = await import("../tools/index.js");
      const agentStore = await ensureAgentStore();
      const runner = new AgentRunner({
        rootDir: cwd,
        agentStore,
        client,
        sessionId: options.session,
        contextWindow: 128_000,
        maxIterations: 25,
        autoApprove: ["file_read", "file_search", "code_search"],
        requireApproval: ["file_write", "shell_exec", "diff_apply"],
        toolResolver: ({ agent, rootDir: agentRootDir }) => {
          return filterToolsForAgent(createDefaultTools(agentRootDir), agent);
        },
      });

      let assistantContent = "";

      for await (const event of runner.run(userInput)) {
        handleRunnerEvent(
          event,
          {
            createId: generateId,
            setMessages,
            setStreamingContent,
            toolMessageIdsRef,
            toolStartTimesRef,
          },
          assistantContent,
          (value) => {
            assistantContent = value;
          },
        );
      }

      // AI 回复计数
      if (assistantContent) {
        setMessageCount((prev) => prev + 1);
      }

      // 添加助手消息（去重检查）
      if (assistantContent) {
        const assistantMessage: Message = {
          id: generateId(),
          role: "assistant",
          content: assistantContent,
          timestamp: new Date(),
        };
        setMessages((prev) => {
          // 检查是否已有相同内容的助手消息（防止重复）
          const isDuplicate = prev.some(
            (m) =>
              m.role === "assistant" &&
              m.content === assistantContent &&
              Date.now() - m.timestamp.getTime() < 1000
          );
          if (isDuplicate) return prev;
          return [...prev, assistantMessage];
        });
      }
    } catch (error) {
      const errorMessage: Message = {
        id: generateId(),
        role: "system",
        content: `错误: ${error instanceof Error ? error.message : "未知错误"}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
      setStreamingContent("");
    }
  };

  return (
    <>
      {showAuthSetup ? (
        <AuthSetup
          providers={listProviders()}
          onComplete={async (result) => {
            try {
              if (!isCodingPlanProvider(result.provider)) {
                throw new Error(`未知厂商: ${result.provider}`);
              }
              const { CodingPlanAccountManager } = await import("../auth/account-manager.js");
              const manager = new CodingPlanAccountManager();
              const account = await manager.addAccount(result.provider, result.apiKey, {
                alias: result.alias,
                baseUrl: result.baseUrl,
              });
              setShowAuthSetup(false);
              setMessages((prev) => [
                ...prev,
                {
                  id: generateId(),
                  role: "system" as const,
                  content: `+ 账户已添加: ${account.alias || account.provider}\n\n使用 /auth list 查看所有账户`,
                  timestamp: new Date(),
                },
              ]);
            } catch (error) {
              setShowAuthSetup(false);
              setMessages((prev) => [
                ...prev,
                {
                  id: generateId(),
                  role: "system" as const,
                  content: `[ERR] 添加失败: ${error instanceof Error ? error.message : "未知错误"}`,
                  timestamp: new Date(),
                },
              ]);
            }
          }}
          onCancel={() => {
            setShowAuthSetup(false);
            setMessages((prev) => [
              ...prev,
              {
                id: generateId(),
                role: "system" as const,
                content: "已取消添加账户",
                timestamp: new Date(),
              },
            ]);
          }}
        />
      ) : showModelSetup ? (
        <ModelSetup
          models={modelSetupData.models}
          currentModel={currentModel}
          providerName={modelSetupData.providerName}
          onComplete={async (model) => {
            preferenceManager.set("defaultModel", model);
            modelRef.current = model;
            setCurrentModel(model);
            setShowModelSetup(false);
            setMessages((prev) => [
              ...prev,
              {
                id: generateId(),
                role: "system" as const,
                content: `+ 已切换模型为: ${model}\n新模型将用于后续新建会话。`,
                timestamp: new Date(),
              },
            ]);
          }}
          onCancel={() => {
            setShowModelSetup(false);
            setMessages((prev) => [
              ...prev,
              {
                id: generateId(),
                role: "system" as const,
                content: "已取消切换模型",
                timestamp: new Date(),
              },
            ]);
          }}
        />
      ) : (
        <ChatApp
          version={version}
          model={currentModel}
          language={language}
          cwd={cwd}
          onMessage={handleMessage}
          messages={messages}
          isLoading={isLoading}
          streamingContent={streamingContent}
          showHeader={true}
          gitBranch={gitBranch}
          accountInfo={accountInfo}
          slashCommands={slashCommands}
          isExiting={isExiting}
          onExit={handleExit}
          messageCount={messageCount}
          sessionStartTime={sessionStartTime.current}
          initialWorkMode={"smart"}
          onWorkModeChange={(mode: ChatWorkMode) => {
            void mode;
          }}
          contextMax={(() => {
            // 根据模型名称推断上下文大小
            const modelLower = currentModel.toLowerCase();
            if (modelLower.includes("gpt-4o") || modelLower.includes("gpt-4-turbo")) return 128000;
            if (modelLower.includes("gpt-4")) return 8192;
            if (modelLower.includes("gpt-3.5")) return 4096;
            if (modelLower.includes("claude-3")) return 200000;
            if (modelLower.includes("deepseek")) return 32768;
            if (modelLower.includes("moonshot")) return 8192;
            if (modelLower.includes("glm")) return 8192;
            if (modelLower.includes("doubao")) return 4096;
            if (modelLower.includes("mimo")) return 32768;
            if (modelLower.includes("longcat")) return 32768;
            return 8192; // 默认值
          })()}
        />
      )}
    </>
  );
};

/**
 * 启动 Chat TUI
 */
export async function startChat(options: ChatOptions): Promise<void> {
  const preferenceManager = getPreferenceManager();
  preferenceManager.load();
  const { client, providerConfig, cwd, version } = await loadChatRuntime();

  // 渲染 TUI
  const { unmount } = render(
    <ChatWrapper
      version={version}
      model={providerConfig.model ?? "default"}
      language={preferenceManager.getResolvedLanguage()}
      cwd={cwd}
      client={client}
      options={options}
      preferenceManager={preferenceManager}
    />
  );

  registerCleanup(client, unmount);
}
