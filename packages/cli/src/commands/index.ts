import type { CommandContext } from "./types";

// --- 新命令模块 re-export ---
export { registerAuthCommand } from "./auth.js";
export { registerCodeCommand } from "./code.js";

export function registerStartCommand(ctx: CommandContext): void {
  ctx.program
    .command("start")
    .description("启动本地 API 与 Web 服务")
    .option("-p, --port <port>", "API 服务端口", "3000")
    .option("-H, --host <host>", "服务监听地址", "127.0.0.1")
    .option("--api", "仅启动 API 服务")
    .option("--web", "仅启动 Web 服务")
    .action(async (options: { port: string; host: string; api?: boolean; web?: boolean }) => {
      const { startServer } = await import("./start.js");
      await startServer(options);
    });
}

export function registerChatCommand(ctx: CommandContext): void {
  ctx.program
    .command("chat")
    .description("启动交互式聊天模式")
    .option("-m, --message <message>", "发送单条消息")
    .option("-s, --session <sessionId>", "指定会话 ID")
    .action(async (options) => {
      const { startChat } = await import("./chat.js");
      await startChat(options);
    });
}

export function registerConfigCommand(ctx: CommandContext): void {
  const config = ctx.program
    .command("config")
    .description("配置管理");

  config
    .command("list")
    .description("列出所有配置")
    .action(async () => {
      const { listConfig } = await import("./config.js");
      await listConfig();
    });

  config
    .command("set <key> <value>")
    .description("设置配置项")
    .action(async (key: string, value: string) => {
      const { setConfig } = await import("./config.js");
      await setConfig(key, value);
    });

  config
    .command("get <key>")
    .description("获取配置项")
    .action(async (key: string) => {
      const { getConfig } = await import("./config.js");
      await getConfig(key);
    });

  config
    .command("reset")
    .description("重置所有配置为默认值")
    .option("--preferences", "仅重置用户偏好")
    .option("--extended", "仅重置扩展配置")
    .action(async (options: { preferences?: boolean; extended?: boolean }) => {
      const { resetPreferences, resetExtendedConfig, resetAllConfig } = await import("./config.js");
      if (options.preferences) {
        await resetPreferences();
      } else if (options.extended) {
        await resetExtendedConfig();
      } else {
        await resetAllConfig();
      }
    });
}

export function registerSessionCommand(ctx: CommandContext): void {
  const session = ctx.program.command("session").description("会话管理");

  session
    .command("list")
    .description("列出所有会话")
    .option("-c, --channel <channel>", "按平台过滤")
    .option("--chat-id <chatId>", "按 Chat ID 过滤")
    .action(async (options: { channel?: string; chatId?: string }) => {
      const { listSessions } = await import("./session.js");
      await listSessions(options);
    });

  session
    .command("info <sessionId>")
    .description("显示会话详情")
    .action(async (sessionId: string) => {
      const { showSession } = await import("./session.js");
      await showSession(sessionId);
    });

  session
    .command("clear [sessionId]")
    .description("清除会话 (不指定则清除所有)")
    .option("-c, --channel <channel>", "按平台过滤")
    .option("--chat-id <chatId>", "按 Chat ID 过滤")
    .action(async (sessionId?: string, options?: { channel?: string; chatId?: string }) => {
      const { clearSession, clearSessions } = await import("./session.js");
      if (sessionId) {
        await clearSession(sessionId);
      } else {
        await clearSessions(options ?? {});
      }
    });
}

export function registerModelCommand(ctx: CommandContext): void {
  const model = ctx.program.command("model").description("模型管理");

  model
    .command("list")
    .description("列出所有可用模型")
    .action(async () => {
      const { listModels } = await import("./model.js");
      await listModels();
    });

  model
    .command("set <modelId>")
    .description("设置默认模型")
    .action(async (modelId: string) => {
      const { setModel } = await import("./model.js");
      await setModel(modelId);
    });

  model
    .command("current")
    .description("显示当前模型")
    .action(async () => {
      const { showCurrentModel } = await import("./model.js");
      await showCurrentModel();
    });

  model
    .command("configure <modelId>")
    .description("配置模型参数")
    .option("-t, --temperature <value>", "温度参数")
    .option("-m, --max-tokens <value>", "最大令牌数")
    .option("-p, --top-p <value>", "Top P 参数")
    .action(
      async (
        modelId: string,
        options: { temperature?: string; maxTokens?: string; topP?: string }
      ) => {
        const { configureModel } = await import("./model.js");
        await configureModel(modelId, options);
      }
    );
}

export function registerWorkspaceCommand(ctx: CommandContext): void {
  const workspace = ctx.program.command("workspace").description("工作空间管理");

  workspace
    .command("init [template]")
    .description("初始化工作空间")
    .action(async (template?: string) => {
      const { initWorkspace } = await import("./workspace.js");
      await initWorkspace(template);
    });

  workspace
    .command("show")
    .description("显示工作空间信息")
    .action(async () => {
      const { showWorkspace } = await import("./workspace.js");
      await showWorkspace();
    });

  workspace
    .command("templates")
    .description("列出所有模板")
    .action(async () => {
      const { listTemplates } = await import("./workspace.js");
      await listTemplates();
    });

  workspace
    .command("edit <filename>")
    .description("编辑工作空间文件")
    .action(async (filename: string) => {
      const { editFile } = await import("./workspace.js");
      await editFile(filename);
    });
}

export function registerMemoryCommand(ctx: CommandContext): void {
  const memory = ctx.program.command("memory").description("会话记忆管理");

  memory
    .command("list")
    .description("列出所有会话记忆")
    .action(async () => {
      const { listMemory } = await import("./memory.js");
      await listMemory();
    });

  memory
    .command("show <sessionId>")
    .description("显示会话记忆内容")
    .action(async (sessionId: string) => {
      const { showMemory } = await import("./memory.js");
      await showMemory(sessionId);
    });

  memory
    .command("search <query>")
    .description("搜索记忆内容")
    .action(async (query: string) => {
      const { searchMemory } = await import("./memory.js");
      await searchMemory(query);
    });

  memory
    .command("append <sessionId> <content>")
    .description("追加内容到会话记忆")
    .action(async (sessionId: string, content: string) => {
      const { appendMemory } = await import("./memory.js");
      await appendMemory(sessionId, content);
    });

  memory
    .command("compact <sessionId>")
    .description("压缩会话记忆")
    .action(async (sessionId: string) => {
      const { compactMemory } = await import("./memory.js");
      await compactMemory(sessionId);
    });

  memory
    .command("delete <sessionId>")
    .description("删除会话记忆")
    .action(async (sessionId: string) => {
      const { deleteMemory } = await import("./memory.js");
      await deleteMemory(sessionId);
    });
}

export function registerCronCommand(ctx: CommandContext): void {
  const cron = ctx.program.command("cron").description("定时任务管理");

  cron
    .command("list")
    .description("列出所有定时任务")
    .option("-a, --all", "显示所有任务（包括禁用的）")
    .action(async (options: { all?: boolean }) => {
      const { listCronJobs } = await import("./cron.js");
      await listCronJobs(options);
    });

  cron
    .command("add")
    .description("添加定时任务")
    .requiredOption("-n, --name <name>", "任务名称")
    .requiredOption("-m, --message <message>", "任务消息")
    .option("-t, --type <type>", "任务类型: interval | once | cron", "interval")
    .option("-e, --every <duration>", "间隔时间 (如: 60, 5m, 2h, 1d)")
    .option("--cron <expr>", "Cron 表达式 (如: '0 9 * * *')")
    .option("--at <datetime>", "执行时间 (ISO 格式)")
    .option("-c, --channel <channel>", "目标平台", "telegram")
    .option("--chat-id <chatId>", "目标聊天 ID")
    .option("--disable", "创建时禁用")
    .action(async (options: {
      name: string;
      message: string;
      type?: "interval" | "once" | "cron";
      every?: string;
      cron?: string;
      at?: string;
      channel?: string;
      chatId?: string;
      disable?: boolean;
    }) => {
      const { addCronJob } = await import("./cron.js");
      await addCronJob(options);
    });

  cron
    .command("remove <jobId>")
    .description("删除定时任务")
    .action(async (jobId: string) => {
      const { removeCronJob } = await import("./cron.js");
      await removeCronJob(jobId);
    });

  cron
    .command("enable <jobId>")
    .description("启用定时任务")
    .action(async (jobId: string) => {
      const { enableCronJob } = await import("./cron.js");
      await enableCronJob(jobId);
    });

  cron
    .command("disable <jobId>")
    .description("禁用定时任务")
    .action(async (jobId: string) => {
      const { disableCronJob } = await import("./cron.js");
      await disableCronJob(jobId);
    });

  cron
    .command("run <jobId>")
    .description("立即运行定时任务")
    .action(async (jobId: string) => {
      const { runCronJob } = await import("./cron.js");
      await runCronJob(jobId);
    });

  cron
    .command("stats")
    .description("显示定时任务统计")
    .action(async () => {
      const { showCronStats } = await import("./cron.js");
      await showCronStats();
    });
}

export function registerPluginCommand(ctx: CommandContext): void {
  const plugin = ctx.program.command("plugin").description("插件管理");

  plugin
    .command("list")
    .description("列出所有插件")
    .action(async () => {
      const { listPlugins } = await import("./plugin.js");
      await listPlugins();
    });

  plugin
    .command("install <name>")
    .description("安装插件")
    .option("-s, --source <source>", "安装源 (git+https://... | npm://<pkg> | /local/path)")
    .action(async (name: string, options: { source?: string }) => {
      const { installPlugin } = await import("./plugin.js");
      await installPlugin(name, options.source);
    });

  plugin
    .command("uninstall <name>")
    .description("卸载插件")
    .action(async (name: string) => {
      const { uninstallPlugin } = await import("./plugin.js");
      await uninstallPlugin(name);
    });

  plugin
    .command("enable <name>")
    .description("启用插件")
    .action(async (name: string) => {
      const { enablePlugin } = await import("./plugin.js");
      await enablePlugin(name);
    });

  plugin
    .command("disable <name>")
    .description("禁用插件")
    .action(async (name: string) => {
      const { disablePlugin } = await import("./plugin.js");
      await disablePlugin(name);
    });

  plugin
    .command("info <name>")
    .description("查看插件详情")
    .action(async (name: string) => {
      const { showPluginInfo } = await import("./plugin.js");
      await showPluginInfo(name);
    });
}
