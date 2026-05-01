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
import { AuthSetup } from "../ui/components/AuthSetup.js";
import { ModelSetup } from "../ui/components/ModelSetup.js";

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

// ============================================================================
// /init 命令辅助函数
// ============================================================================

import * as nodeFs from "fs";
import * as nodePath from "path";

/**
 * 检测项目类型
 */
function detectProjectType(cwd: string, pkg: Record<string, unknown>): string {
  const name = (pkg.name as string) || "";
  const desc = (pkg.description as string) || "";

  // 检查是否是 Monorepo
  if (pkg.workspaces || nodeFs.existsSync(nodePath.join(cwd, "pnpm-workspace.yaml"))) {
    return "Monorepo 项目";
  }

  // 检查是否是 CLI 工具
  if (pkg.bin || desc.includes("CLI") || desc.includes("cli") || name.includes("cli")) {
    return "CLI 工具";
  }

  // 检查是否是库
  if (pkg.main || pkg.module || pkg.exports) {
    return "库/SDK";
  }

  // 检查是否是 Web 应用
  const deps = (pkg.dependencies as Record<string, string>) || {};
  if (deps.react || deps.vue || deps.angular || deps.svelte) {
    return "Web 应用";
  }

  // 检查是否是 API 服务
  if (deps.express || deps.koa || deps.fastify || deps.hono) {
    return "API 服务";
  }

  return "项目";
}

/**
 * 检测技术栈
 */
function detectTechStack(cwd: string, pkg: Record<string, unknown>): string[] {
  const tech: string[] = [];

  const deps = { ...(pkg.dependencies as Record<string, string> || {}), ...(pkg.devDependencies as Record<string, string> || {}) };

  // 运行时
  if (nodeFs.existsSync(nodePath.join(cwd, "bun.lockb"))) tech.push("**运行时**: Bun");
  else if (nodeFs.existsSync(nodePath.join(cwd, "yarn.lock"))) tech.push("**包管理**: Yarn");
  else if (nodeFs.existsSync(nodePath.join(cwd, "pnpm-lock.yaml"))) tech.push("**包管理**: pnpm");
  else tech.push("**包管理**: npm");

  // 语言
  if (nodeFs.existsSync(nodePath.join(cwd, "tsconfig.json"))) tech.push("**语言**: TypeScript");
  else tech.push("**语言**: JavaScript");

  // 前端框架
  if (deps.react) tech.push(`**前端**: React ${deps.react}`);
  if (deps.vue) tech.push(`**前端**: Vue ${deps.vue}`);
  if (deps["@angular/core"]) tech.push(`**前端**: Angular ${deps["@angular/core"]}`);

  // 后端框架
  if (deps.express) tech.push(`**HTTP**: Express ${deps.express}`);
  if (deps.hono) tech.push(`**HTTP**: Hono ${deps.hono}`);
  if (deps.fastify) tech.push(`**HTTP**: Fastify ${deps.fastify}`);

  // 测试
  if (deps.vitest) tech.push(`**测试**: Vitest ${deps.vitest}`);
  if (deps.jest) tech.push(`**测试**: Jest ${deps.jest}`);
  if (deps.mocha) tech.push(`**测试**: Mocha ${deps.mocha}`);

  // 构建
  if (deps.vite) tech.push(`**构建**: Vite ${deps.vite}`);
  if (deps.webpack) tech.push(`**构建**: Webpack ${deps.webpack}`);
  if (deps.esbuild) tech.push(`**构建**: esbuild ${deps.esbuild}`);
  if (deps.tsup) tech.push(`**构建**: tsup ${deps.tsup}`);

  // ORM
  if (deps["@prisma/client"]) tech.push("**ORM**: Prisma");
  if (deps.drizzle) tech.push("**ORM**: Drizzle");
  if (deps.typeorm) tech.push("**ORM**: TypeORM");

  return tech;
}

/**
 * 分析目录结构
 */
function analyzeDirectory(dirPath: string, depth: number, maxDepth: number): string {
  if (depth >= maxDepth) return "";

  const ignore = new Set(["node_modules", ".git", "dist", "build", ".next", ".nuxt", "coverage", "__pycache__"]);
  const lines: string[] = [];

  try {
    const entries = nodeFs.readdirSync(dirPath, { withFileTypes: true });

    // 排序：目录优先，然后按名称
    const sorted = [...entries].sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of sorted) {
      if (ignore.has(entry.name)) continue;
      if (entry.name.startsWith(".") && entry.name !== ".env.example" && entry.name !== ".github") continue;

      const indent = "  ".repeat(depth);
      const fullPath = nodePath.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        lines.push(`${indent}${entry.name}/`);
        const subTree = analyzeDirectory(fullPath, depth + 1, maxDepth);
        if (subTree) lines.push(subTree);
      } else if (depth === 0) {
        // 只显示根目录的文件
        lines.push(`${indent}${entry.name}`);
      }
    }
  } catch { /* ignore */ }

  return lines.join("\n");
}

/**
 * 分类依赖
 */
function categorizeDependencies(deps: Record<string, string>): Record<string, string[]> {
  const categories: Record<string, string[]> = {
    "AI/LLM": [],
    "Web 框架": [],
    "数据库": [],
    "认证": [],
    "测试": [],
    "构建工具": [],
    "UI 组件": [],
    "工具库": [],
  };

  for (const [name, version] of Object.entries(deps)) {
    const entry = `${name} ${version}`;

    if (name.includes("openai") || name.includes("anthropic") || name.includes("llm") || name.includes("ai")) {
      categories["AI/LLM"]!.push(entry);
    } else if (name.includes("express") || name.includes("koa") || name.includes("fastify") || name.includes("hono")) {
      categories["Web 框架"]!.push(entry);
    } else if (name.includes("prisma") || name.includes("drizzle") || name.includes("typeorm") || name.includes("mongoose") || name.includes("knex")) {
      categories["数据库"]!.push(entry);
    } else if (name.includes("passport") || name.includes("auth") || name.includes("jwt") || name.includes("oauth")) {
      categories["认证"]!.push(entry);
    } else if (name.includes("vitest") || name.includes("jest") || name.includes("mocha") || name.includes("chai") || name.includes("testing")) {
      categories["测试"]!.push(entry);
    } else if (name.includes("vite") || name.includes("webpack") || name.includes("esbuild") || name.includes("rollup") || name.includes("tsup")) {
      categories["构建工具"]!.push(entry);
    } else if (name.includes("react") || name.includes("vue") || name.includes("angular") || name.includes("svelte") || name.includes("ink")) {
      categories["UI 组件"]!.push(entry);
    } else {
      categories["工具库"]!.push(entry);
    }
  }

  return categories;
}

/**
 * 检测配置文件
 */
function detectConfigFiles(cwd: string): string[] {
  const configs: string[] = [];

  const configFiles = [
    { file: "tsconfig.json", desc: "TypeScript 配置" },
    { file: ".eslintrc.js", desc: "ESLint 配置" },
    { file: ".eslintrc.json", desc: "ESLint 配置" },
    { file: "eslint.config.js", desc: "ESLint 配置" },
    { file: ".prettierrc", desc: "Prettier 配置" },
    { file: "prettier.config.js", desc: "Prettier 配置" },
    { file: "vite.config.ts", desc: "Vite 配置" },
    { file: "vitest.config.ts", desc: "Vitest 配置" },
    { file: ".env.example", desc: "环境变量示例" },
    { file: "Dockerfile", desc: "Docker 配置" },
    { file: "docker-compose.yml", desc: "Docker Compose" },
    { file: ".github/workflows", desc: "GitHub Actions" },
    { file: "pnpm-workspace.yaml", desc: "pnpm 工作区" },
  ];

  for (const { file, desc } of configFiles) {
    if (nodeFs.existsSync(nodePath.join(cwd, file))) {
      configs.push(`**${file}** — ${desc}`);
    }
  }

  return configs;
}

/**
 * 检测开发规范
 */
function detectConventions(cwd: string, pkg: Record<string, unknown>): string[] {
  const conventions: string[] = [];

  // TypeScript 严格模式
  if (nodeFs.existsSync(nodePath.join(cwd, "tsconfig.json"))) {
    try {
      const tsconfig = JSON.parse(nodeFs.readFileSync(nodePath.join(cwd, "tsconfig.json"), "utf-8"));
      if (tsconfig.compilerOptions?.strict) {
        conventions.push("TypeScript 严格模式");
      }
    } catch { /* ignore */ }
  }

  // ESLint
  if (nodeFs.existsSync(nodePath.join(cwd, ".eslintrc.js")) || nodeFs.existsSync(nodePath.join(cwd, "eslint.config.js"))) {
    conventions.push("遵循 ESLint 规范");
  }

  // Prettier
  if (nodeFs.existsSync(nodePath.join(cwd, ".prettierrc")) || nodeFs.existsSync(nodePath.join(cwd, "prettier.config.js"))) {
    conventions.push("使用 Prettier 格式化");
  }

  // Git Hooks
  const devDeps = (pkg.devDependencies as Record<string, string>) || {};
  if (devDeps.husky) {
    conventions.push("使用 Husky 管理 Git Hooks");
  }
  if (devDeps["lint-staged"]) {
    conventions.push("提交前自动 lint (lint-staged)");
  }

  // 测试
  if (devDeps.vitest || devDeps.jest) {
    conventions.push("编写单元测试");
  }

  return conventions;
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

  // 交互式命令状态
  const [showAuthSetup, setShowAuthSetup] = useState(false);
  const [showModelSetup, setShowModelSetup] = useState(false);
  const [modelSetupData, setModelSetupData] = useState<{ models: string[]; providerName: string }>({ models: [], providerName: "" });

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

    // /models - 管理模型（交互式选择）
    reg.register({
      ...getBuiltin("models"),
      execute: async (ctx) => {
        const modelArg = ctx.args.name as string | undefined;
        const listFlag = ctx.flags.list || ctx.flags.l;

        try {
          // 获取当前厂商的模型列表
          const { CodingPlanAccountManager } = await import("../auth/account-manager.js");
          const { getProviderPreset } = await import("../auth/providers.js");
          const manager = new CodingPlanAccountManager();
          
          let models: string[] = [];
          let currentProvider = "openai";
          
          try {
            const account = await manager.getActiveAccount();
            if (account) {
              const preset = getProviderPreset(account.provider);
              models = preset?.models || [];
              currentProvider = account.provider;
            }
          } catch {
            // 未配置账户，使用默认模型列表
          }
          
          // 如果没有获取到模型，使用默认列表
          if (models.length === 0) {
            models = [
              "gpt-4", "gpt-4o", "gpt-3.5-turbo",
              "claude-3-opus", "claude-3-sonnet", "claude-3-haiku",
              "deepseek-chat", "deepseek-coder",
              "moonshot-v1-8k", "moonshot-v1-32k",
              "glm-4", "glm-3-turbo",
            ];
          }

          // /models list 或 /models --list — 列出可用模型
          if (listFlag || modelArg === "list") {
            const lines = [
              `当前厂商: ${currentProvider}`,
              `当前模型: ${modelRef.current}`,
              "",
              "可用模型:",
              ...models.map((m) => `  ${m === modelRef.current ? "▶ " : "  "}${m}`),
            ];
            ctx.output(lines.join("\n"));
            return { success: true };
          }

          // /models <name> — 切换模型
          if (modelArg && modelArg !== "") {
            if (models.includes(modelArg)) {
              preferenceManager.set("defaultModel", modelArg as never);
              modelRef.current = modelArg;
              setCurrentModel(modelArg);
              ctx.output(`已切换模型为: ${modelArg}`);
            } else {
              ctx.error(`未知模型: ${modelArg}\n可用模型: ${models.join(", ")}`);
              return { success: false };
            }
            return { success: true };
          }

          // /models （无参数） — 显示交互式选择
          setModelSetupData({ models, providerName: currentProvider });
          setShowModelSetup(true);
          return { success: true };
        } catch {
          ctx.output("模型管理暂不可用");
          return { success: true };
        }
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

    // /history - 显示历史消息
    reg.register({
      ...getBuiltin("history"),
      execute: async (ctx) => {
        const clearFlag = ctx.flags.clear || ctx.flags.c;
        
        if (clearFlag) {
          setMessages([]);
          ctx.output("+ 对话历史已清除");
          return { success: true };
        }
        
        // 显示历史摘要
        const msgCount = messages.length;
        if (msgCount === 0) {
          ctx.output("暂无对话历史");
          return { success: true };
        }
        
        const userMsgs = messages.filter(m => m.role === "user").length;
        const assistantMsgs = messages.filter(m => m.role === "assistant").length;
        const systemMsgs = messages.filter(m => m.role === "system").length;
        
        const lines = [
          "对话历史统计:",
          `  总消息数: ${msgCount}`,
          `  用户消息: ${userMsgs}`,
          `  助手消息: ${assistantMsgs}`,
          `  系统消息: ${systemMsgs}`,
          "",
          "最近消息:",
        ];
        
        // 显示最近 5 条消息
        const recent = messages.slice(-5);
        for (const msg of recent) {
          const preview = (msg.content ?? "").slice(0, 60).replace(/\n/g, " ");
          lines.push(`  [${msg.role}] ${preview}...`);
        }
        
        ctx.output(lines.join("\n"));
        return { success: true };
      },
    });

    // /compact - 压缩上下文
    reg.register({
      ...getBuiltin("compact"),
      execute: async (ctx) => {
        const forceFlag = ctx.flags.force || ctx.flags.f;
        
        if (messages.length < 10 && !forceFlag) {
          ctx.output("消息数量较少，无需压缩。使用 --force 强制压缩。");
          return { success: true };
        }
        
        try {
          const { compactMessages } = await import("../core/compaction.js");
          const beforeCount = messages.length;
          const compacted = await compactMessages(messages);
          setMessages(compacted);
          
          const saved = beforeCount - compacted.length;
          ctx.output(`+ 上下文已压缩\n  原消息数: ${beforeCount}\n  压缩后: ${compacted.length}\n  移除: ${saved} 条`);
        } catch {
          ctx.output("压缩功能暂时不可用");
        }
        
        return { success: true };
      },
    });

    // /recall - 检索记忆
    reg.register({
      ...getBuiltin("recall"),
      execute: async (ctx) => {
        const query = ctx.args.query as string | undefined;
        
        if (!query) {
          ctx.output("用法: /recall <搜索关键词>\n例如: /recall 项目配置");
          return { success: true };
        }
        
        try {
          const { MemoryManager } = await import("../core/memory.js");
          const manager = new MemoryManager({ memoryDir: ".sacode/memory" });
          await manager.initialize();
          
          const results = await manager.recall(query);
          
          if (results.length === 0) {
            ctx.output(`未找到与 "${query}" 相关的记忆`);
            return { success: true };
          }
          
          ctx.output(`找到 ${results.length} 条相关记忆:\n\n${results.join("\n\n---\n\n")}`);
        } catch {
          ctx.output("记忆系统暂时不可用");
        }
        
        return { success: true };
      },
    });

    // /remember - 保存记忆
    reg.register({
      ...getBuiltin("remember"),
      execute: async (ctx) => {
        const content = ctx.args.content as string | undefined;
        
        if (!content) {
          ctx.output("用法: /remember <记忆内容>\n例如: /remember 项目使用 TypeScript 严格模式");
          return { success: true };
        }
        
        try {
          const { MemoryManager } = await import("../core/memory.js");
          const manager = new MemoryManager({ memoryDir: ".sacode/memory" });
          await manager.initialize();
          
          await manager.remember(content, "session");
          ctx.output(`+ 已保存到记忆: ${content.slice(0, 50)}...`);
        } catch {
          ctx.output("记忆系统暂时不可用");
        }
        
        return { success: true };
      },
    });

    // /debug - 调试模式
    reg.register({
      ...getBuiltin("debug"),
      execute: async (ctx) => {
        const onFlag = ctx.flags.on;
        const offFlag = ctx.flags.off;
        
        // 获取当前调试状态
        const isDebug = process.env.SACODE_DEBUG === "true";
        
        if (onFlag) {
          process.env.SACODE_DEBUG = "true";
          ctx.output("+ 调试模式已开启");
        } else if (offFlag) {
          process.env.SACODE_DEBUG = "false";
          ctx.output("+ 调试模式已关闭");
        } else {
          ctx.output(`调试模式: ${isDebug ? "开启" : "关闭"}\n\n使用 /debug --on 开启\n使用 /debug --off 关闭`);
        }
        
        return { success: true };
      },
    });

    // /init — 深度分析项目并生成 AGENTS.md
    reg.register({
      ...getBuiltin("init"),
      execute: async (ctx) => {
        const fs = await import("fs");
        const path = await import("path");
        const agentsPath = path.join(process.cwd(), "AGENTS.md");

        ctx.output("正在深度分析项目...");

        try {
          const cwd = process.cwd();
          const analysis: string[] = [];

          // 1. 读取 package.json
          const pkgPath = path.join(cwd, "package.json");
          let pkg: Record<string, unknown> = {};
          if (fs.existsSync(pkgPath)) {
            pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
          }

          // 2. 检测项目类型
          const projectType = detectProjectType(cwd, pkg);
          analysis.push(`# ${pkg.name || path.basename(cwd)} — ${projectType}`);

          if (pkg.description) {
            analysis.push(`\n> ${pkg.description}\n`);
          }

          // 3. 项目概览
          analysis.push(`\n## 项目概览\n`);
          analysis.push(`- **名称**: ${pkg.name || "unknown"}`);
          analysis.push(`- **版本**: ${pkg.version || "0.0.0"}`);
          if (pkg.license) analysis.push(`- **许可证**: ${pkg.license}`);
          if (pkg.type) analysis.push(`- **模块类型**: ${pkg.type}`);

          // 4. 检测技术栈
          const techStack = detectTechStack(cwd, pkg);
          if (techStack.length > 0) {
            analysis.push(`\n## 技术栈\n`);
            for (const tech of techStack) {
              analysis.push(`- ${tech}`);
            }
          }

          // 5. 常用命令
          if (pkg.scripts) {
            analysis.push(`\n## 常用命令\n`);
            analysis.push("```bash");
            for (const [name, cmd] of Object.entries(pkg.scripts as Record<string, string>)) {
              if (name.startsWith("pre") || name.startsWith("post")) continue;
              analysis.push(`${name.padEnd(20)} # ${cmd}`);
            }
            analysis.push("```");
          }

          // 6. 目录结构（递归分析）
          analysis.push(`\n## 目录结构\n`);
          analysis.push("```");
          const dirTree = analyzeDirectory(cwd, 0, 3); // 最多 3 层
          analysis.push(dirTree);
          analysis.push("```");

          // 7. 核心依赖分析
          const deps = pkg.dependencies as Record<string, string> | undefined;
          const devDeps = pkg.devDependencies as Record<string, string> | undefined;
          if (deps && Object.keys(deps).length > 0) {
            analysis.push(`\n## 核心依赖\n`);
            const categorized = categorizeDependencies(deps);
            for (const [category, pkgs] of Object.entries(categorized)) {
              if (pkgs.length > 0) {
                analysis.push(`### ${category}`);
                for (const p of pkgs) {
                  analysis.push(`- ${p}`);
                }
              }
            }
          }

          // 8. 配置文件检测
          const configs = detectConfigFiles(cwd);
          if (configs.length > 0) {
            analysis.push(`\n## 配置文件\n`);
            for (const config of configs) {
              analysis.push(`- ${config}`);
            }
          }

          // 9. 开发规范（基于配置推断）
          const conventions = detectConventions(cwd, pkg);
          if (conventions.length > 0) {
            analysis.push(`\n## 开发规范\n`);
            for (const conv of conventions) {
              analysis.push(`- ${conv}`);
            }
          }

          // 10. Monorepo 支持
          if (pkg.workspaces || fs.existsSync(path.join(cwd, "pnpm-workspace.yaml"))) {
            analysis.push(`\n## Monorepo 结构\n`);
            const workspaces = pkg.workspaces as string[] | undefined;
            if (workspaces) {
              for (const ws of workspaces) {
                analysis.push(`- ${ws}`);
              }
            } else if (fs.existsSync(path.join(cwd, "pnpm-workspace.yaml"))) {
              const wsContent = fs.readFileSync(path.join(cwd, "pnpm-workspace.yaml"), "utf-8");
              analysis.push("```yaml");
              analysis.push(wsContent.trim());
              analysis.push("```");
            }
          }

          // 写入文件
          fs.writeFileSync(agentsPath, analysis.join("\n"), "utf-8");
          ctx.output(`+ AGENTS.md 已生成: ${agentsPath}\n\n已分析: 项目类型、技术栈、目录结构、依赖、配置文件、开发规范。`);

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

    // /auth — 管理认证账户（合并了 /providers 功能）
    reg.register({
      ...getBuiltin("auth"),
      execute: async (ctx) => {
        const action = ctx.args.action as string | undefined;
        const provider = ctx.flags.provider as string | undefined;
        const key = ctx.flags.key as string | undefined;
        const url = ctx.flags.url as string | undefined;
        const alias = ctx.flags.alias as string | undefined;

        try {
          const { CodingPlanAccountManager } = await import("../auth/account-manager.js");
          const { listProviders } = await import("../auth/providers.js");
          const manager = new CodingPlanAccountManager();

          // 如果提供了 provider 和 key，直接添加
          if (provider && key) {
            try {
              const account = await manager.addAccount(provider as any, key, {
                alias: alias,
                baseUrl: url,
              });
              ctx.output(`+ 账户已添加: ${account.alias || account.provider}\n\n使用 /auth list 查看所有账户`);
              return { success: true };
            } catch (error) {
              ctx.error(`添加失败: ${error instanceof Error ? error.message : "未知错误"}`);
              return { success: false };
            }
          }

          // /auth list - 显示账户列表
          if (action === "list") {
            const accounts = await manager.listAccounts();
            if (accounts.length === 0) {
              ctx.output("暂无 CodingPlan 账户\n\n使用 /auth add 添加账户");
              return { success: true };
            }

            const lines = ["CodingPlan 账户:", ""];
            for (const account of accounts) {
              const active = account.isActive ? " (当前)" : "";
              lines.push(`  ${account.alias || account.provider}${active}`);
            }
            ctx.output(lines.join("\n"));
            return { success: true };
          }

          // /auth env - 显示环境变量配置
          if (action === "env") {
            const envKeys: [string, string][] = [
              ["OpenAI", "OPENAI_API_KEY"],
              ["Anthropic", "ANTHROPIC_API_KEY"],
              ["DeepSeek", "DEEPSEEK_API_KEY"],
              ["Moonshot", "MOONSHOT_API_KEY"],
              ["智谱 (Zhipu)", "ZHIPU_API_KEY"],
            ];

            const lines = ["环境变量 API Key 配置:", ""];
            for (const [name, envKey] of envKeys) {
              const value = process.env[envKey];
              const configured = typeof value === "string" && value.length > 0;
              lines.push(`  ${configured ? "+" : "o"} ${name}${configured ? ` (${value.slice(0, 8)}...)` : " (未配置)"}`);
            }
            lines.push("", "提示: 在 .env 文件或环境变量中设置 API Key");
            ctx.output(lines.join("\n"));
            return { success: true };
          }

          // /auth add - 显示交互式添加界面
          if (action === "add" || (provider && !key)) {
            setShowAuthSetup(true);
            return { success: true };
          }

          // /auth (无参数) - 显示操作选择菜单
          if (!action) {
            const accounts = await manager.listAccounts();
            const lines = [
              "认证管理",
              "",
            ];
            
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
              "  /auth list   - 查看 CodingPlan 账户",
              "  /auth add    - 添加新账户（交互式）",
              "  /auth env    - 查看环境变量配置",
              "",
              "快捷添加:",
              "  /auth --provider <厂商> --key <API Key>"
            );
            ctx.output(lines.join("\n"));
            return { success: true };
          }

          ctx.output("用法: /auth [list|add|env] [--provider <厂商>] [--key <API Key>] [--url <端点>]");
          return { success: true };
        } catch {
          ctx.output("认证模块暂不可用");
          return { success: true };
        }
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
    <>
      {showAuthSetup ? (
        <AuthSetup
          providers={(() => {
            try {
              const { listProviders } = require("../auth/providers.js");
              return listProviders();
            } catch {
              return [];
            }
          })()}
          onComplete={async (result) => {
            try {
              const { CodingPlanAccountManager } = await import("../auth/account-manager.js");
              const manager = new CodingPlanAccountManager();
              const account = await manager.addAccount(result.provider as any, result.apiKey, {
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
            preferenceManager.set("defaultModel", model as never);
            modelRef.current = model;
            setCurrentModel(model);
            setShowModelSetup(false);
            
            // 更新 client 的模型配置
            try {
              // 手动更新配置并重新连接
              if (client.config.provider) {
                client.config.provider.model = model;
              }
              if (client.isConnected()) {
                await client.disconnect();
                await client.connect();
              }
              setMessages((prev) => [
                ...prev,
                {
                  id: generateId(),
                  role: "system" as const,
                  content: `+ 已切换模型为: ${model}`,
                  timestamp: new Date(),
                },
              ]);
            } catch (error) {
              setMessages((prev) => [
                ...prev,
                {
                  id: generateId(),
                  role: "system" as const,
                  content: `[ERR] 切换模型失败: ${error instanceof Error ? error.message : "未知错误"}`,
                  timestamp: new Date(),
                },
              ]);
            }
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
          initialWorkMode={preferenceManager.get("workMode") ?? "smart"}
          onWorkModeChange={(mode: WorkMode) => {
            preferenceManager.set("workMode", mode);
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
 * 比较版本号
 * @returns 如果 v1 > v2 返回 1，v1 < v2 返回 -1，相等返回 0
 */
function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split(".").map(Number);
  const parts2 = v2.split(".").map(Number);
  
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] ?? 0;
    const p2 = parts2[i] ?? 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

/**
 * 检查并更新 CLI 版本
 */
async function checkAndUpdateVersion(currentVersion: string): Promise<void> {
  try {
    const { execSync } = await import("child_process");
    
    // 获取最新版本
    const latestVersion = execSync("npm view @cherishron/sacode-cli version", { encoding: "utf-8" }).trim();
    
    // 只在最新版本大于当前版本时才更新
    if (compareVersions(latestVersion, currentVersion) > 0) {
      console.log(chalk.cyan(`\n[更新] 发现新版本: ${currentVersion} → ${latestVersion}`));
      console.log(chalk.gray("  正在自动更新..."));
      
      try {
        execSync("npm install -g @cherishron/sacode-cli@latest", { stdio: "pipe" });
        console.log(chalk.green("  ✓ 更新完成，请重启 sacode 生效\n"));
      } catch {
        console.log(chalk.yellow("  更新失败，请手动执行: npm install -g @cherishron/sacode-cli@latest\n"));
      }
    }
  } catch {
    // 网络错误或 npm 不可用，静默忽略
  }
}

/**
 * 启动 Chat TUI
 */
export async function startChat(options: ChatOptions): Promise<void> {
  // 检查并更新版本
  let currentVersion = "0.0.0";
  try {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const packageJsonPath = join(import.meta.dirname, "..", "..", "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    currentVersion = packageJson.version || "0.0.0";
  } catch {
    // 读取失败使用默认版本
  }
  await checkAndUpdateVersion(currentVersion);

  // 加载用户偏好
  const preferenceManager = getPreferenceManager();
  preferenceManager.load();

  // 获取 Provider 配置
  let providerConfig = getProviderConfigFromEnv();

  // 如果环境变量没有配置 API key，检查 CodingPlan 账户
  if (!providerConfig.apiKey || providerConfig.apiKey.includes("your-api-key")) {
    try {
      const { CodingPlanAccountManager } = await import("./auth/account-manager.js");
      const { getProviderPreset, getBaseUrl } = await import("./auth/providers.js");
      const manager = new CodingPlanAccountManager();
      const account = await manager.getActiveAccount();
      
      if (account) {
        const preset = getProviderPreset(account.provider);
        const baseUrl = account.baseUrl || (preset ? getBaseUrl(preset, account.protocol) : undefined);
        
        providerConfig = {
          type: "openai", // CodingPlan 默认使用 OpenAI 兼容协议
          apiKey: account.apiKey,
          model: account.defaultModel || preset?.models[0] || "gpt-4",
          ...(baseUrl && { baseUrl }),
        };
      }
    } catch {
      // CodingPlan 账户未配置，继续使用环境变量
    }
  }

  let client: SACODEClient;

  if (!providerConfig.apiKey || providerConfig.apiKey.includes("your-api-key")) {
    console.log(chalk.yellow("[!] API key 未配置或无效"));
    console.log(chalk.gray("  请使用 /auth 命令添加 CodingPlan 账户"));
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
      console.log(chalk.gray("  将以离线模式启动，请稍后使用 /auth 配置"));
      console.log("");
    }
  }

  // 获取当前目录
  const cwd = process.cwd();

  // 从 package.json 读取版本号
  let version = "0.0.0";
  try {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const packageJsonPath = join(import.meta.dirname, "..", "..", "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    version = packageJson.version || "0.0.0";
  } catch {
    // 读取失败使用默认版本
  }

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

  // 清理
  const cleanup = () => {
    unmount();
    client.disconnect();
  };

  process.on("exit", cleanup);
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}
