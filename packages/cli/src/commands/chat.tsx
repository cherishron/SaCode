/**
 * Chat 命令 - TUI 模式
 *
 * 使用 Ink 实现 Claude Code 风格的交互界面
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { render } from "ink";
import chalk from "chalk";
import { SACODEClient, type ProviderConfig, getPreferenceManager, getCostTracker, type WorkMode, type UserPreferences } from "@sacode/core";
import { parseSlashCommand, createSlashCommandRegistry, executeSlashCommand } from "../commands/parser.js";
import { BUILTIN_SLASH_COMMANDS, type SlashCommand } from "../commands/types.js";
import { getThemeManager } from "../ui/theme/index.js";
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
/**
 * 尝试获取当前 git 分支
 */
function getGitBranch(cwd: string): string | undefined {
  try {
    const proc = Bun.spawnSync({
      cmd: ["git", "branch", "--show-current"],
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 3000,
    });
    return (proc.stdout?.toString() ?? "").trim() || undefined;
  } catch {
    return undefined;
  }
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
  const [, setCurrentTool] = useState<Message | null>(null);
  const [toolStartTime, setToolStartTime] = useState(0);
  const [gitBranch, setGitBranch] = useState<string | undefined>(undefined);
  const [accountInfo, setAccountInfo] = useState<
    { alias: string; provider: string } | undefined
  >(undefined);

  // 退出统计相关状态
  const sessionStartTime = useRef(Date.now());
  const [messageCount, setMessageCount] = useState(0);
  const [isExiting, setIsExiting] = useState(false);

  // Reactive model state so UI updates when /model switches
  const [currentModel, setCurrentModel] = useState(model);

  // Ref for model so registry closures always see latest value
  const modelRef = useRef(currentModel);
  modelRef.current = currentModel;

  // ====== Slash 命令 Registry ======
  const registry = useMemo(() => {
    const reg = createSlashCommandRegistry();
    const getBuiltin = (name: string): Omit<SlashCommand, "execute"> =>
      BUILTIN_SLASH_COMMANDS.find((c) => c.name === name) ?? { name, description: name };

    // /help
    reg.register({
      ...getBuiltin("help"),
      execute: async (ctx) => {
        const cmds = reg.getAll().filter((c) => !c.hidden);
        const lines = cmds.map((c) => {
          const aliases = c.aliases?.length ? ` (${c.aliases.map((a) => "/" + a).join(", ")})` : "";
          return `  /${c.name.padEnd(12)} - ${c.description}${aliases}`;
        });
        ctx.output(`可用命令:\n${lines.join("\n")}`);
        return { success: true };
      },
    });

    // /clear
    reg.register({
      ...getBuiltin("clear"),
      execute: async () => {
        setMessages([]);
        return { success: true };
      },
    });

    // /exit
    reg.register({
      ...getBuiltin("exit"),
      execute: async () => {
        handleExit();
        return { success: true };
      },
    });

    // /model
    reg.register({
      ...getBuiltin("model"),
      execute: async (ctx) => {
        const modelArg = ctx.args.name as string | undefined;
        const listFlag = ctx.flags.list || ctx.flags.l;

        // /model list 或 /model --list — 列出可用模型
        if (listFlag || modelArg === "list") {
          const available = [
            "gpt-4", "gpt-4o", "gpt-3.5-turbo",
            "claude-3-opus", "claude-3-sonnet", "claude-3-haiku",
            "deepseek-chat", "deepseek-coder",
            "moonshot-v1-8k", "moonshot-v1-32k",
            "glm-4", "glm-3-turbo",
          ];
          const lines = [
            `当前模型: ${modelRef.current}`,
            "",
            "可用模型:",
            ...available.map((m) => `  ${m === modelRef.current ? "\u25b6 " : "  "}${m}`),
          ];
          ctx.output(lines.join("\n"));
          return { success: true };
        }

        // /model <name> — 切换模型
        if (modelArg && modelArg !== "") {
          preferenceManager.set("defaultModel", modelArg as never);
          modelRef.current = modelArg;
          setCurrentModel(modelArg);
          ctx.output(`已切换模型为: ${modelArg}`);
          return { success: true };
        }

        // /model （无参数） — 显示当前模型
        ctx.output(`当前模型: ${modelRef.current}\n提示: 使用 /model <name> 切换模型，/model list 查看可用模型`);
        return { success: true };
      },
    });

    // /theme
    reg.register({
      ...getBuiltin("theme"),
      execute: async (ctx) => {
        const themeName = ctx.args.name as string;
        if (themeName) {
          const success = getThemeManager().setTheme(themeName);
          if (success) {
            ctx.output(`主题已切换为: ${themeName}`);
          } else {
            const themes = getThemeManager()
              .getAvailableThemes()
              .map((t) => t.name)
              .join(", ");
            ctx.error(`未知主题。可用主题: ${themes}`);
            return { success: false, error: `Unknown theme: ${themeName}` };
          }
        } else {
          const themes = getThemeManager()
            .getAvailableThemes()
            .map((t) => t.name)
            .join(", ");
          ctx.output(`可用主题: ${themes}`);
        }
        return { success: true };
      },
    });

    // /lang
    reg.register({
      ...getBuiltin("lang"),
      execute: async (ctx) => {
        const code = ctx.args.code as string;
        if (code) {
          if (["zh-CN", "en-US", "ja-JP", "ko-KR"].includes(code)) {
            preferenceManager.set("language", code as never);
            ctx.output(`语言已设置为: ${code}`);
          } else {
            ctx.error("不支持的语言。支持: zh-CN, en-US, ja-JP, ko-KR");
            return { success: false };
          }
        } else {
          ctx.output(`当前语言: ${preferenceManager.getResolvedLanguage()}`);
        }
        return { success: true };
      },
    });

    // /prefs
    reg.register({
      ...getBuiltin("prefs"),
      execute: async (ctx) => {
        const subCommand = ctx.args.name as string | undefined;

        // /prefs set <key> <value>
        if (subCommand === "set") {
          const rawArgs = (ctx.rawInput ?? "").trim();
          // 解析 "/prefs set key value"
          const match = rawArgs.match(/^\/prefs\s+set\s+(\S+)\s+(.+)$/i);
          if (!match) {
            ctx.error("用法: /prefs set <key> <value>\n例如: /prefs set workMode plan");
            return { success: false };
          }
          const key = match[1] as string;
          const value = match[2] as string;

          // 验证 key 是否合法
          const validKeys: (keyof UserPreferences)[] = [
            "workMode", "language", "defaultModel", "defaultProvider",
            "customInstructions", "outputStyle", "showToolDetails",
            "showThinking", "theme", "timezone",
          ];
          if (!validKeys.includes(key as any)) {
            ctx.error(`无效的配置项: ${key}\n可设置的项: ${validKeys.join(", ")}`);
            return { success: false };
          }

          // 类型转换
          let parsed: any = value;
          if (value === "true") parsed = true;
          else if (value === "false") parsed = false;

          preferenceManager.set(key as any, parsed);
          ctx.output(`已设置 ${key} = ${value}`);
          return { success: true };
        }

        // /prefs (无参数) — 显示所有偏好
        const prefs = preferenceManager.getAll();
        ctx.output(`偏好设置:\n${JSON.stringify(prefs, null, 2)}\n\n提示: 使用 /prefs set <key> <value> 修改配置`);
        return { success: true };
      },
    });

    // /cost
    reg.register({
      ...getBuiltin("cost"),
      execute: async (ctx) => {
        try {
          const tracker = getCostTracker();
          const stats = tracker.getStats();
          const lines = [
            "Token 使用统计:",
            `  总请求数: ${stats.totalRequests}`,
            `  输入 Token: ${stats.totalInputTokens.toLocaleString()}`,
            `  输出 Token: ${stats.totalOutputTokens.toLocaleString()}`,
            `  总 Token: ${stats.totalTokens.toLocaleString()}`,
            `  总成本: $${stats.totalCost.toFixed(4)}`,
          ];
          ctx.output(lines.join("\n"));
        } catch {
          ctx.output("暂无使用统计数据");
        }
        return { success: true };
      },
    });

    // /history
    reg.register({
      ...getBuiltin("history"),
      execute: async (ctx) => {
        ctx.output("历史功能暂未实现");
        return { success: true };
      },
    });

    // /compact
    reg.register({
      ...getBuiltin("compact"),
      execute: async (ctx) => {
        ctx.output("上下文压缩功能暂未实现");
        return { success: true };
      },
    });

    // /recall
    reg.register({
      ...getBuiltin("recall"),
      execute: async (ctx) => {
        ctx.output("记忆检索功能暂未实现");
        return { success: true };
      },
    });

    // /remember
    reg.register({
      ...getBuiltin("remember"),
      execute: async (ctx) => {
        ctx.output("记忆保存功能暂未实现");
        return { success: true };
      },
    });

    // /debug
    reg.register({
      ...getBuiltin("debug"),
      execute: async (ctx) => {
        ctx.output("调试模式功能暂未实现");
        return { success: true };
      },
    });

    // /init — 解读当前项目并生成 AGENTS.md
    reg.register({
      ...getBuiltin("init"),
      execute: async (ctx) => {
        const force = ctx.flags.force as boolean;
        const fs = await import("fs");
        const path = await import("path");
        const agentsPath = path.join(process.cwd(), "AGENTS.md");

        if (fs.existsSync(agentsPath) && !force) {
          ctx.output("AGENTS.md 已存在。使用 /init --force 覆盖。");
          return { success: true };
        }

        ctx.output("正在分析当前项目...");

        try {
          const { glob } = await import("glob");
          const pkgPath = path.join(process.cwd(), "package.json");

          let projectInfo = "";
          if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
            projectInfo = `# ${pkg.name || "Project"} 项目上下文\n\n`;
            projectInfo += `> ${pkg.description || "项目描述待补充"}\n\n---\n\n`;
            projectInfo += `## 项目概览\n\n`;
            projectInfo += `- **名称**: ${pkg.name || "unknown"}\n`;
            projectInfo += `- **版本**: ${pkg.version || "0.0.0"}\n`;
            projectInfo += `- **许可证**: ${pkg.license || "未指定"}\n`;
            if (pkg.type) projectInfo += `- **模块类型**: ${pkg.type}\n`;
            if (pkg.scripts) {
              projectInfo += `\n## 常用命令\n\n\`\`\`bash\n`;
              for (const [name, cmd] of Object.entries(pkg.scripts)) {
                if (name.startsWith("pre") || name.startsWith("post")) continue;
                projectInfo += `pnpm ${name.padEnd(16)} # ${cmd}\n`;
              }
              projectInfo += `\`\`\`\n`;
            }
            if (pkg.dependencies) {
              projectInfo += `\n## 核心依赖\n\n| 包 | 版本 |\n|------|------|\n`;
              for (const [name, ver] of Object.entries(pkg.dependencies as Record<string, string>)) {
                projectInfo += `| ${name} | ${ver} |\n`;
              }
            }
          } else {
            projectInfo = "# 项目上下文\n\n> 请补充项目描述\n\n---\n";
          }

          projectInfo += `\n## 目录结构\n\n\`\`\`\n`;
          try {
            const entries = fs.readdirSync(process.cwd(), { withFileTypes: true });
            for (const entry of entries) {
              if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;
              if (entry.name === "node_modules" || entry.name === "dist") continue;
              projectInfo += `${entry.isDirectory() ? "[D]" : "[F]"} ${entry.name}/\n`;
            }
          } catch { /* ignore */ }
          projectInfo += `\`\`\`\n`;

          projectInfo += `\n## 开发规范\n\n- 遵循 ESLint 和 Prettier 配置\n- 语义化命名\n- TypeScript 严格模式\n`;

          fs.writeFileSync(agentsPath, projectInfo, "utf-8");
          ctx.output(`+ AGENTS.md 已生成: ${agentsPath}\n\n提示: 请根据项目实际情况补充和完善内容。`);
        } catch (error) {
          ctx.error(`生成 AGENTS.md 失败: ${error instanceof Error ? error.message : "未知错误"}`);
          return { success: false };
        }

        return { success: true };
      },
    });

    // /session — 管理会话
    reg.register({
      ...getBuiltin("session"),
      execute: async (ctx) => {
        const action = ctx.args.action as string | undefined;

        if (action === "list") {
          ctx.output("会话管理功能暂未实现。请等待后续版本更新。");
          return { success: true };
        }

        if (action === "clear") {
          setMessages([]);
          ctx.output("+ 当前会话消息已清除");
          return { success: true };
        }

        ctx.output(`会话管理:\n  /session list  - 查看历史会话\n  /session clear - 清除当前会话\n  /session info  - 查看当前会话信息`);
        return { success: true };
      },
    });

    // /providers — 管理 AI Provider 配置
    reg.register({
      ...getBuiltin("providers"),
      execute: async (ctx) => {
        const action = ctx.args.action as string | undefined;

        const envKeys: [string, string][] = [
          ["OpenAI", "OPENAI_API_KEY"],
          ["Anthropic", "ANTHROPIC_API_KEY"],
          ["DeepSeek", "DEEPSEEK_API_KEY"],
          ["Moonshot", "MOONSHOT_API_KEY"],
          ["智谱 (Zhipu)", "ZHIPU_API_KEY"],
        ];

        if (action === "add") {
          ctx.output(`添加 Provider API Key:\n\n  export OPENAI_API_KEY=sk-...\n  export ANTHROPIC_API_KEY=sk-ant-...\n  export DEEPSEEK_API_KEY=sk-...\n  export MOONSHOT_API_KEY=sk-...\n  export ZHIPU_API_KEY=...\n\n或在 ~/.sacode/api-keys.json 中配置。`);
          return { success: true };
        }

        const lines = ["已配置的 AI Provider:", ""];
        for (const [name, key] of envKeys) {
          const value = process.env[key];
          const configured = typeof value === "string" && value.length > 0;
          lines.push(`  ${configured ? "+" : "o"} ${name}${configured ? ` (${value.slice(0, 8)}...)` : " (未配置)"}`);
        }
        lines.push("", "提示: 使用 /providers add 查看配置方法");
        ctx.output(lines.join("\n"));
        return { success: true };
      },
    });

    return reg;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 退出处理函数
  const handleExit = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => {
      process.exit(0);
    }, 2000);
  }, []);

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
        const { getProviderPreset } = await import("../auth/providers.js");
        const preset = getProviderPreset(account.provider);
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
            setMessages((prev) => [...prev, newTool]);
          } else {
            // 工具完成
            setCurrentTool((prev) => {
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
              setStreamingContent((prev) => prev + "\n[发生错误]");
            }
          } else if ("message" in msg) {
            // 错误消息
            setStreamingContent((prev) => prev + `\n[错误: ${msg.message}]`);
          }
        }
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
      initialWorkMode={preferenceManager.get("workMode") ?? "smart"}
      onWorkModeChange={(mode: WorkMode) => {
        preferenceManager.set("workMode", mode);
      }}
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

  let client: SACODEClient;

  if (!providerConfig.apiKey || providerConfig.apiKey.includes("your-api-key")) {
    console.log(chalk.yellow("[!] API key 未配置或无效"));
    console.log(chalk.gray("  请使用 /providers 命令配置 API Key"));
    console.log(chalk.gray("  或在 .env 文件 / 环境变量中设置"));
    console.log("");

    const dummyConfig: ProviderConfig = {
      type: "openai",
      apiKey: "placeholder",
      model: providerConfig.model ?? "gpt-4",
    };
    client = new SACODEClient({
      provider: dummyConfig,
      timeout: parseInt(process.env.IFLOW_TIMEOUT || "60000", 10),
    });
  } else {
    client = new SACODEClient({
      provider: providerConfig,
      timeout: parseInt(process.env.IFLOW_TIMEOUT || "60000", 10),
    });

    try {
      await client.connect();
    } catch (error) {
      console.log(chalk.yellow("[!] 连接 AI 服务失败: " + (error instanceof Error ? error.message : "未知错误")));
      console.log(chalk.gray("  将以离线模式启动，请稍后使用 /providers 配置"));
      console.log("");
    }
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
