import type React from "react";
import { getCostTracker, type UserPreferences } from "@sacode/core";
import { createSlashCommandRegistry } from "../parser.js";
import { BUILTIN_SLASH_COMMANDS, type SlashCommand, type SlashCommandRegistry } from "../types.js";
import { getThemeManager } from "../../ui/theme/index.js";
import { compactMessages } from "../../core/compaction.js";
import { listProviders } from "../../auth/providers.js";
import type { CodingPlanProvider } from "../../auth/types.js";
import type { Message } from "../../ui/App.js";
import type { Message as CompactionMessage } from "../../core/QueryEngine.js";
import {
  detectProjectType,
  detectTechStack,
  analyzeDirectory,
  categorizeDependencies,
  detectConfigFiles,
  detectConventions,
} from "./helpers.js";

export interface ChatRegistryDependencies {
  cwd: string;
  messages: Message[];
  modelRef: { current: string };
  preferenceManager: {
    getAll(): UserPreferences;
    getResolvedLanguage(): string;
    set<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]): void;
  };
  supportedLanguageCodes: UserPreferences["language"][];
  validPreferenceKeys: (keyof UserPreferences)[];
  isPreferenceKey: (value: string) => value is keyof UserPreferences;
  parsePreferenceValue: <K extends keyof UserPreferences>(key: K, value: string) => UserPreferences[K];
  isCodingPlanProvider: (value: string) => value is CodingPlanProvider;
  toCompactionMessages: (messages: Message[]) => CompactionMessage[];
  fromCompactionMessages: (messages: CompactionMessage[]) => Message[];
  handleExit: () => void;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setCurrentModel: React.Dispatch<React.SetStateAction<string>>;
  setShowAuthSetup: React.Dispatch<React.SetStateAction<boolean>>;
  setShowModelSetup: React.Dispatch<React.SetStateAction<boolean>>;
  setModelSetupData: React.Dispatch<React.SetStateAction<{ models: string[]; providerName: string }>>;
}

function getBuiltin(name: string): Omit<SlashCommand, "execute"> {
  return BUILTIN_SLASH_COMMANDS.find((command) => command.name === name) ?? { name, description: name };
}

export function createChatSlashRegistry(deps: ChatRegistryDependencies): SlashCommandRegistry {
  const reg = createSlashCommandRegistry();
  const {
    cwd,
    messages,
    modelRef,
    preferenceManager,
    supportedLanguageCodes,
    validPreferenceKeys,
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
  } = deps;

  reg.register({
    ...getBuiltin("help"),
    execute: async (ctx) => {
      const cmds = reg.getAll().filter((command) => !command.hidden);
      const lines = cmds.map((command) => {
        const aliases = command.aliases?.length ? ` (${command.aliases.map((alias) => "/" + alias).join(", ")})` : "";
        return `  /${command.name.padEnd(12)} - ${command.description}${aliases}`;
      });
      ctx.output(`可用命令:\n${lines.join("\n")}`);
      return { success: true };
    },
  });

  reg.register({
    ...getBuiltin("clear"),
    execute: async () => {
      setMessages([]);
      return { success: true };
    },
  });

  reg.register({
    ...getBuiltin("exit"),
    execute: async () => {
      handleExit();
      return { success: true };
    },
  });

  reg.register({
    ...getBuiltin("models"),
    execute: async (ctx) => {
      const modelArg = ctx.args.name as string | undefined;
      const listFlag = ctx.flags.list || ctx.flags.l;

      try {
        const { CodingPlanAccountManager } = await import("../../auth/account-manager.js");
        const { getProviderPreset } = await import("../../auth/providers.js");
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
          // fallback to default list
        }

        if (models.length === 0) {
          models = ["gpt-4", "gpt-4o", "gpt-3.5-turbo", "claude-3-opus", "claude-3-sonnet", "claude-3-haiku", "deepseek-chat", "deepseek-coder", "moonshot-v1-8k", "moonshot-v1-32k", "glm-4", "glm-3-turbo"];
        }

        if (listFlag || modelArg === "list") {
          const lines = [
            `当前厂商: ${currentProvider}`,
            `当前模型: ${modelRef.current}`,
            "",
            "可用模型:",
            ...models.map((model) => `  ${model === modelRef.current ? "▶ " : "  "}${model}`),
          ];
          ctx.output(lines.join("\n"));
          return { success: true };
        }

        if (modelArg && modelArg !== "") {
          if (models.includes(modelArg)) {
            preferenceManager.set("defaultModel", modelArg);
            modelRef.current = modelArg;
            setCurrentModel(modelArg);
            ctx.output(`已切换模型为: ${modelArg}`);
          } else {
            ctx.error(`未知模型: ${modelArg}\n可用模型: ${models.join(", ")}`);
            return { success: false };
          }
          return { success: true };
        }

        setModelSetupData({ models, providerName: currentProvider });
        setShowModelSetup(true);
        return { success: true };
      } catch {
        ctx.output("模型管理暂不可用");
        return { success: true };
      }
    },
  });

  reg.register({
    ...getBuiltin("theme"),
    execute: async (ctx) => {
      const themeName = ctx.args.name as string;
      if (themeName) {
        const success = getThemeManager().setTheme(themeName);
        if (success) {
          ctx.output(`主题已切换为: ${themeName}`);
        } else {
          const themes = getThemeManager().getAvailableThemes().map((theme) => theme.name).join(", ");
          ctx.error(`未知主题。可用主题: ${themes}`);
          return { success: false, error: `Unknown theme: ${themeName}` };
        }
      } else {
        const themes = getThemeManager().getAvailableThemes().map((theme) => theme.name).join(", ");
        ctx.output(`可用主题: ${themes}`);
      }
      return { success: true };
    },
  });

  reg.register({
    ...getBuiltin("lang"),
    execute: async (ctx) => {
      const code = ctx.args.code as string;
      if (code) {
        if (supportedLanguageCodes.includes(code as UserPreferences["language"])) {
          preferenceManager.set("language", code as UserPreferences["language"]);
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

  reg.register({
    ...getBuiltin("prefs"),
    execute: async (ctx) => {
      const subCommand = ctx.args.name as string | undefined;
      if (subCommand === "set") {
        const rawArgs = (ctx.rawInput ?? "").trim();
        const match = rawArgs.match(/^\/prefs\s+set\s+(\S+)\s+(.+)$/i);
        if (!match) {
          ctx.error("用法: /prefs set <key> <value>\n例如: /prefs set workMode plan");
          return { success: false };
        }
        const key = match[1] as string;
        const value = match[2] as string;
        if (!isPreferenceKey(key)) {
          ctx.error(`无效的配置项: ${key}\n可设置的项: ${validPreferenceKeys.join(", ")}`);
          return { success: false };
        }
        const parsed = parsePreferenceValue(key, value);
        preferenceManager.set(key, parsed);
        ctx.output(`已设置 ${key} = ${value}`);
        return { success: true };
      }
      ctx.output(`偏好设置:\n${JSON.stringify(preferenceManager.getAll(), null, 2)}\n\n提示: 使用 /prefs set <key> <value> 修改配置`);
      return { success: true };
    },
  });

  reg.register({
    ...getBuiltin("cost"),
    execute: async (ctx) => {
      try {
        const tracker = getCostTracker();
        const stats = tracker.getStats();
        ctx.output([
          "Token 使用统计:",
          `  总请求数: ${stats.totalRequests}`,
          `  输入 Token: ${stats.totalInputTokens.toLocaleString()}`,
          `  输出 Token: ${stats.totalOutputTokens.toLocaleString()}`,
          `  总 Token: ${stats.totalTokens.toLocaleString()}`,
          `  总成本: $${stats.totalCost.toFixed(4)}`,
        ].join("\n"));
      } catch {
        ctx.output("暂无使用统计数据");
      }
      return { success: true };
    },
  });

  reg.register({
    ...getBuiltin("history"),
    execute: async (ctx) => {
      const clearFlag = ctx.flags.clear || ctx.flags.c;
      if (clearFlag) {
        setMessages([]);
        ctx.output("+ 对话历史已清除");
        return { success: true };
      }
      if (messages.length === 0) {
        ctx.output("暂无对话历史");
        return { success: true };
      }
      const userMsgs = messages.filter((message) => message.role === "user").length;
      const assistantMsgs = messages.filter((message) => message.role === "assistant").length;
      const systemMsgs = messages.filter((message) => message.role === "system").length;
      const lines = [
        "对话历史统计:",
        `  总消息数: ${messages.length}`,
        `  用户消息: ${userMsgs}`,
        `  助手消息: ${assistantMsgs}`,
        `  系统消息: ${systemMsgs}`,
        "",
        "最近消息:",
      ];
      for (const message of messages.slice(-5)) {
        const preview = (message.content ?? "").slice(0, 60).replace(/\n/g, " ");
        lines.push(`  [${message.role}] ${preview}...`);
      }
      ctx.output(lines.join("\n"));
      return { success: true };
    },
  });

  reg.register({
    ...getBuiltin("compact"),
    execute: async (ctx) => {
      const forceFlag = ctx.flags.force || ctx.flags.f;
      if (messages.length < 10 && !forceFlag) {
        ctx.output("消息数量较少，无需压缩。使用 --force 强制压缩。");
        return { success: true };
      }
      try {
        const beforeCount = messages.length;
        const compacted = await compactMessages(toCompactionMessages(messages));
        setMessages(fromCompactionMessages(compacted));
        const saved = beforeCount - compacted.length;
        ctx.output(`+ 上下文已压缩\n  原消息数: ${beforeCount}\n  压缩后: ${compacted.length}\n  移除: ${saved} 条`);
      } catch {
        ctx.output("压缩功能暂时不可用");
      }
      return { success: true };
    },
  });

  reg.register({
    ...getBuiltin("recall"),
    execute: async (ctx) => {
      const query = ctx.args.query as string | undefined;
      if (!query) {
        ctx.output("用法: /recall <搜索关键词>\n例如: /recall 项目配置");
        return { success: true };
      }
      try {
        const { MemoryManager } = await import("../../core/memory.js");
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

  reg.register({
    ...getBuiltin("remember"),
    execute: async (ctx) => {
      const content = ctx.args.content as string | undefined;
      if (!content) {
        ctx.output("用法: /remember <记忆内容>\n例如: /remember 项目使用 TypeScript 严格模式");
        return { success: true };
      }
      try {
        const { MemoryManager } = await import("../../core/memory.js");
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

  reg.register({
    ...getBuiltin("debug"),
    execute: async (ctx) => {
      const onFlag = ctx.flags.on;
      const offFlag = ctx.flags.off;
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

  reg.register({
    ...getBuiltin("init"),
    execute: async (ctx) => {
      const fs = await import("fs");
      const path = await import("path");
      const agentsPath = path.join(process.cwd(), "AGENTS.md");
      ctx.output("正在深度分析项目...");
      try {
        const analysis: string[] = [];
        const pkgPath = path.join(cwd, "package.json");
        let pkg: Record<string, unknown> = {};
        if (fs.existsSync(pkgPath)) pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        const projectType = detectProjectType(cwd, pkg);
        analysis.push(`# ${pkg.name || path.basename(cwd)} — ${projectType}`);
        if (pkg.description) analysis.push(`\n> ${pkg.description}\n`);
        analysis.push(`\n## 项目概览\n`);
        analysis.push(`- **名称**: ${pkg.name || "unknown"}`);
        analysis.push(`- **版本**: ${pkg.version || "0.0.0"}`);
        if (pkg.license) analysis.push(`- **许可证**: ${pkg.license}`);
        if (pkg.type) analysis.push(`- **模块类型**: ${pkg.type}`);
        for (const tech of detectTechStack(cwd, pkg)) analysis.push(tech.startsWith("**") ? `- ${tech}` : tech);
        if (pkg.scripts) {
          analysis.push(`\n## 常用命令\n`);
          analysis.push("```bash");
          for (const [name, command] of Object.entries(pkg.scripts as Record<string, string>)) {
            if (name.startsWith("pre") || name.startsWith("post")) continue;
            analysis.push(`${name.padEnd(20)} # ${command}`);
          }
          analysis.push("```");
        }
        analysis.push(`\n## 目录结构\n`);
        analysis.push("```");
        analysis.push(analyzeDirectory(cwd, 0, 3));
        analysis.push("```");
        const depsMap = pkg.dependencies as Record<string, string> | undefined;
        if (depsMap && Object.keys(depsMap).length > 0) {
          analysis.push(`\n## 核心依赖\n`);
          const categorized = categorizeDependencies(depsMap);
          for (const [category, packages] of Object.entries(categorized)) {
            if (packages.length > 0) {
              analysis.push(`### ${category}`);
              for (const pkgEntry of packages) analysis.push(`- ${pkgEntry}`);
            }
          }
        }
        const configs = detectConfigFiles(cwd);
        if (configs.length > 0) {
          analysis.push(`\n## 配置文件\n`);
          for (const config of configs) analysis.push(`- ${config}`);
        }
        const conventions = detectConventions(cwd, pkg);
        if (conventions.length > 0) {
          analysis.push(`\n## 开发规范\n`);
          for (const convention of conventions) analysis.push(`- ${convention}`);
        }
        if (pkg.workspaces || fs.existsSync(path.join(cwd, "pnpm-workspace.yaml"))) {
          analysis.push(`\n## Monorepo 结构\n`);
          const workspaces = pkg.workspaces as string[] | undefined;
          if (workspaces) {
            for (const workspace of workspaces) analysis.push(`- ${workspace}`);
          } else if (fs.existsSync(path.join(cwd, "pnpm-workspace.yaml"))) {
            const wsContent = fs.readFileSync(path.join(cwd, "pnpm-workspace.yaml"), "utf-8");
            analysis.push("```yaml");
            analysis.push(wsContent.trim());
            analysis.push("```");
          }
        }
        fs.writeFileSync(agentsPath, analysis.join("\n"), "utf-8");
        ctx.output(`+ AGENTS.md 已生成: ${agentsPath}\n\n已分析: 项目类型、技术栈、目录结构、依赖、配置文件、开发规范。`);
      } catch (error) {
        ctx.error(`生成 AGENTS.md 失败: ${error instanceof Error ? error.message : "未知错误"}`);
        return { success: false };
      }
      return { success: true };
    },
  });

  reg.register({
    ...getBuiltin("session"),
    execute: async (ctx) => {
      const action = ctx.args.action as string | undefined;
      if (action === "list") {
        ctx.output("会话列表功能当前不可用。");
        return { success: true };
      }
      if (action === "clear") {
        setMessages([]);
        ctx.output("+ 当前会话消息已清除");
        return { success: true };
      }
      ctx.output("会话管理:\n  /session list  - 查看历史会话\n  /session clear - 清除当前会话\n  /session info  - 查看当前会话信息");
      return { success: true };
    },
  });

  reg.register({
    ...getBuiltin("auth"),
    execute: async (ctx) => {
      const action = ctx.args.action as string | undefined;
      const provider = ctx.flags.provider as string | undefined;
      const key = ctx.flags.key as string | undefined;
      const url = ctx.flags.url as string | undefined;
      const alias = ctx.flags.alias as string | undefined;
      try {
        const { CodingPlanAccountManager } = await import("../../auth/account-manager.js");
        const manager = new CodingPlanAccountManager();
        if (provider && key) {
          if (!isCodingPlanProvider(provider)) {
            ctx.error(`未知厂商: ${provider}`);
            return { success: false };
          }
          try {
            const account = await manager.addAccount(provider, key, { alias, baseUrl: url });
            ctx.output(`+ 账户已添加: ${account.alias || account.provider}\n\n使用 /auth list 查看所有账户`);
            return { success: true };
          } catch (error) {
            ctx.error(`添加失败: ${error instanceof Error ? error.message : "未知错误"}`);
            return { success: false };
          }
        }
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
        if (action === "env") {
          const envKeys: [string, string][] = [["OpenAI", "OPENAI_API_KEY"], ["Anthropic", "ANTHROPIC_API_KEY"], ["DeepSeek", "DEEPSEEK_API_KEY"], ["Moonshot", "MOONSHOT_API_KEY"], ["智谱 (Zhipu)", "ZHIPU_API_KEY"]];
          const lines = ["环境变量 API Key 配置:", ""];
          for (const [name, envKey] of envKeys) {
            const value = process.env[envKey];
            const configured = typeof value === "string" && value.length > 0;
            lines.push(`  ${configured ? "+" : "o"} ${name}${configured ? " (已配置)" : " (未配置)"}`);
          }
          lines.push("", "提示: 在系统环境变量或 ~/.sacode Provider 配置中设置 API Key");
          ctx.output(lines.join("\n"));
          return { success: true };
        }
        if (action === "add" || (provider && !key)) {
          setShowAuthSetup(true);
          return { success: true };
        }
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
          lines.push("可用操作:", "  /auth list   - 查看 CodingPlan 账户", "  /auth add    - 添加新账户（交互式）", "  /auth env    - 查看环境变量配置", "", "快捷添加:", "  /auth --provider <厂商> --key <API Key>");
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
}
