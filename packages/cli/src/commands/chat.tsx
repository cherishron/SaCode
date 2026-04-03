/**
 * Chat 命令 - TUI 模式
 *
 * 使用 Ink 实现 Claude Code 风格的交互界面
 */

import React, { useState } from "react";
import { render } from "ink";
import chalk from "chalk";
import {
  SACODEClient,
  type ProviderConfig,
  getPreferenceManager,
} from "@SACODE/core";
import ChatApp, { type Message } from "../ui/App.js";

interface ChatOptions {
  message?: string;
  session?: string;
}

/**
 * 从环境变量获取 Provider 配置
 */
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
  client: SACODEClient;
  options: ChatOptions;
  preferenceManager: ReturnType<typeof getPreferenceManager>;
}> = ({ version, model, language, cwd, client, options, preferenceManager }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [currentTool, setCurrentTool] = useState<Message | null>(null);
  const [toolStartTime, setToolStartTime] = useState(0);

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
      // 处理 AI 响应
      let assistantContent = "";

      for await (const msg of client.chat(userInput, options.session)) {
        // 处理不同类型的消息
        if (msg.role === "assistant" && "chunk" in msg) {
          // 助手消息 - 流式文本
          assistantContent += msg.chunk.text;
          setStreamingContent(assistantContent);
        } else if (msg.role === "tool") {
          // 工具调用消息
          if (msg.status === "running") {
            // 新工具开始
            const newTool: Message = {
              id: generateId(),
              role: "tool",
              content: "",
              toolName: msg.toolName,
              toolStatus: "running",
              timestamp: new Date(),
            };
            setCurrentTool(newTool);
            setToolStartTime(Date.now());
            setMessages(prev => [...prev, newTool]);
          } else {
            // 工具完成
            setCurrentTool(prev => {
              if (prev) {
                return {
                  ...prev,
                  toolStatus: msg.status === "success" ? "success" : "error",
                  toolDuration: Date.now() - toolStartTime,
                  toolResult: msg.status === "success" ? "完成" : "失败",
                };
              }
              return prev;
            });
          }
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

  // 处理命令
  const handleCommand = async (command: string) => {
    const [cmd, ...args] = command.slice(1).split(" ");

    switch (cmd?.toLowerCase()) {
      case "help":
        setMessages(prev => [...prev, {
          id: generateId(),
          role: "system",
          content: `可用命令:
  /help     - 显示帮助
  /clear    - 清屏
  /lang zh  - 设置语言为中文
  /lang en  - 设置语言为英文
  /prefs    - 显示偏好设置
  /exit     - 退出`,
          timestamp: new Date(),
        }]);
        break;

      case "clear":
        setMessages([]);
        break;

      case "lang":
        if (args[0]) {
          const newLang = args[0] as "zh-CN" | "en-US";
          if (["zh-CN", "en-US", "ja-JP", "ko-KR"].includes(newLang)) {
            preferenceManager.set("language", newLang as never);
            setMessages(prev => [...prev, {
              id: generateId(),
              role: "system",
              content: `语言已设置为: ${newLang}`,
              timestamp: new Date(),
            }]);
          } else {
            setMessages(prev => [...prev, {
              id: generateId(),
              role: "system",
              content: `不支持的语言。支持: zh-CN, en-US, ja-JP, ko-KR`,
              timestamp: new Date(),
            }]);
          }
        } else {
          setMessages(prev => [...prev, {
            id: generateId(),
            role: "system",
            content: `当前语言: ${preferenceManager.getResolvedLanguage()}`,
            timestamp: new Date(),
          }]);
        }
        break;

      case "prefs":
        const prefs = preferenceManager.getAll();
        setMessages(prev => [...prev, {
          id: generateId(),
          role: "system",
          content: `偏好设置:\n${JSON.stringify(prefs, null, 2)}`,
          timestamp: new Date(),
        }]);
        break;

      case "exit":
      case "quit":
      case "q":
        process.exit(0);
        break;

      default:
        setMessages(prev => [...prev, {
          id: generateId(),
          role: "system",
          content: `未知命令: ${cmd}`,
          timestamp: new Date(),
        }]);
    }
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

/**
 * 启动 Chat TUI
 */
export async function startChat(options: ChatOptions): Promise<void> {
  // 加载用户偏好
  const preferenceManager = getPreferenceManager();
  preferenceManager.load();

  // 获取 Provider 配置
  const providerConfig = getProviderConfigFromEnv();

  // 验证 API Key
  if (!providerConfig.apiKey || providerConfig.apiKey.includes("your-api-key")) {
    console.log(chalk.red("API key 无效或缺失"));
    console.log(chalk.gray("请在 .env 文件或环境变量中设置有效的 API Key"));
    process.exit(1);
  }

  // 创建客户端
  const client = new SACODEClient({
    provider: providerConfig,
    timeout: parseInt(process.env.IFLOW_TIMEOUT || "60000", 10),
  });

  // 连接
  try {
    await client.connect();
  } catch (error) {
    console.log(chalk.red("连接 AI 服务失败"));
    console.log(chalk.red(error instanceof Error ? error.message : "未知错误"));
    process.exit(1);
  }

  // 获取当前目录
  const cwd = process.cwd();

  // 渲染 TUI
  const { unmount } = render(
    <ChatWrapper
      version="1.0.0"
      model={providerConfig.model ?? "default"}
      language={preferenceManager.getResolvedLanguage()}
      cwd={cwd}
      client={client}
      options={options}
      preferenceManager={preferenceManager}
    />
  );

  // 清理
  const cleanup = () => {
    unmount();
    client.disconnect();
  };

  process.on("exit", cleanup);
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}