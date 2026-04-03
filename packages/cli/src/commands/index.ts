import type { CommandContext } from "./types";

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
    .requiredOption("-m, --message <message>", "消息内容")
    .option("-t, --type <type>", "任务类型 (interval|cron|once)", "interval")
    .option("-e, --every <seconds>", "间隔秒数 (interval类型)")
    .option("-c, --cron <expression>", "Cron表达式 (cron类型)")
    .option("-a, --at <datetime>", "执行时间 (once类型)")
    .option("--channel <channel>", "目标平台", "telegram")
    .option("--to <chatId>", "目标 Chat ID")
    .option("-d, --disable", "创建后禁用")
    .action(
      async (options: {
        name: string;
        message: string;
        type?: "interval" | "once" | "cron";
        every?: string;
        cron?: string;
        at?: string;
        channel?: string;
        to?: string;
        disable?: boolean;
      }) => {
        const { addCronJob } = await import("./cron.js");
        const cronOptions: {
          name: string;
          message: string;
          type?: "interval" | "once" | "cron";
          every?: string;
          cron?: string;
          at?: string;
          channel?: string;
          chatId?: string;
          disable?: boolean;
        } = {
          name: options.name,
          message: options.message,
        };
        if (options.type !== undefined) {
          cronOptions.type = options.type;
        }
        if (options.every !== undefined) {
          cronOptions.every = options.every;
        }
        if (options.cron !== undefined) {
          cronOptions.cron = options.cron;
        }
        if (options.at !== undefined) {
          cronOptions.at = options.at;
        }
        if (options.channel !== undefined) {
          cronOptions.channel = options.channel;
        }
        if (options.to !== undefined) {
          cronOptions.chatId = options.to;
        }
        if (options.disable !== undefined) {
          cronOptions.disable = options.disable;
        }
        await addCronJob(cronOptions);
      }
    );

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
    .description("立即执行定时任务")
    .action(async (jobId: string) => {
      const { runCronJob } = await import("./cron.js");
      await runCronJob(jobId);
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

export function registerStatusCommand(ctx: CommandContext): void {
  const status = ctx.program.command("status").description("系统状态");

  status
    .command("show")
    .description("显示系统状态")
    .action(async () => {
      const { showStatus } = await import("./status.js");
      await showStatus();
    });

  status
    .command("diagnose")
    .description("显示诊断信息")
    .action(async () => {
      const { showDiagnostics } = await import("./status.js");
      await showDiagnostics();
    });

  status
    .command("health")
    .description("检查服务健康状态")
    .action(async () => {
      const { checkHealth } = await import("./status.js");
      await checkHealth();
    });
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

export function registerIMCommand(ctx: CommandContext): void {
  const im = ctx.program
    .command("im")
    .description("IM 平台管理");

  im
    .command("list")
    .description("列出所有 IM 连接")
    .action(async () => {
      const { listIMConnections } = await import("./im.js");
      await listIMConnections();
    });

  im
    .command("connect <platform>")
    .description("连接到 IM 平台")
    .option("-c, --config <config>", "配置 JSON")
    .action(async (platform: string, options: { config?: string }) => {
      const { connectIM } = await import("./im.js");
      await connectIM(platform, options);
    });

  im
    .command("disconnect <platform>")
    .description("断开 IM 平台连接")
    .action(async (platform: string) => {
      const { disconnectIM } = await import("./im.js");
      await disconnectIM(platform);
    });
}

export function registerStartCommand(ctx: CommandContext): void {
  ctx.program
    .command("start")
    .description("启动 SACODE 服务")
    .option("-p, --port <port>", "服务端口", "3000")
    .option("-h, --host <host>", "服务主机", "localhost")
    .option("--api", "只启动 API 服务")
    .option("--web", "只启动 Web 服务")
    .action(async (options) => {
      const { startServer } = await import("./start.js");
      await startServer(options);
    });
}

export function registerPluginCommand(ctx: CommandContext): void {
  const plugin = ctx.program
    .command("plugin")
    .description("插件管理");

  plugin
    .command("list")
    .description("列出所有插件")
    .action(async () => {
      const { listPlugins } = await import("./plugin.js");
      await listPlugins();
    });

  plugin
    .command("install <path>")
    .description("安装插件")
    .action(async (path: string) => {
      const { installPlugin } = await import("./plugin.js");
      await installPlugin(path);
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
}

export function registerToolCommand(ctx: CommandContext): void {
  const tool = ctx.program
    .command("tool")
    .description("工具管理");

  tool
    .command("list")
    .description("列出所有工具")
    .action(async () => {
      const { listTools } = await import("./tool.js");
      await listTools();
    });

  tool
    .command("run <name>")
    .description("运行工具")
    .option("-p, --param <params...>", "工具参数 (key=value)")
    .action(async (name: string, options: { param?: string[] }) => {
      const { runTool } = await import("./tool.js");
      await runTool(name, options);
    });
}

export function registerSkillCommand(ctx: CommandContext): void {
  const skills = ctx.program.command("skills").description("技能管理 (ClawHub/SkillHub)");

  skills
    .command("search [query]")
    .description("搜索技能")
    .option("-t, --tags <tags>", "按标签过滤 (逗号分隔)")
    .option("-l, --limit <number>", "结果数量限制", "20")
    .option("-r, --registry <registry>", "注册表源 (clawhub|skillhub)", "clawhub")
    .action(
      async (
        query: string | undefined,
        options: { tags?: string; limit?: string; registry?: string }
      ) => {
        const { searchSkills } = await import("./skills.js");
        const params: {
          limit: number;
          query?: string;
          tags?: string;
          registry?: "clawhub" | "skillhub";
        } = {
          limit: options.limit ? parseInt(options.limit, 10) : 20,
        };
        if (query !== undefined) params.query = query;
        if (options.tags !== undefined) params.tags = options.tags;
        if (
          options.registry === "clawhub" ||
          options.registry === "skillhub"
        ) {
          params.registry = options.registry;
        }
        await searchSkills(params);
      }
    );

  skills
    .command("install <slug>")
    .description("安装技能")
    .option("-v, --version <version>", "指定版本")
    .option("-f, --force", "强制覆盖")
    .option("-r, --registry <registry>", "注册表源 (clawhub|skillhub)", "clawhub")
    .action(
      async (
        slug: string,
        options: { version?: string; force?: boolean; registry?: string }
      ) => {
        const { installSkill } = await import("./skills.js");
        const registry =
          options.registry === "skillhub" ? "skillhub" : "clawhub";
        await installSkill(slug, { ...options, registry });
      }
    );

  skills
    .command("update [slug]")
    .description("更新技能 (不指定则更新全部)")
    .option("-v, --version <version>", "指定版本")
    .option("-r, --registry <registry>", "注册表源 (clawhub|skillhub)", "clawhub")
    .action(
      async (
        slug: string | undefined,
        options: { version?: string; registry?: string }
      ) => {
        const { updateSkill, updateAllSkills } = await import("./skills.js");
        const registry =
          options.registry === "skillhub" ? "skillhub" : "clawhub";
        if (slug) {
          await updateSkill(slug, { ...options, registry });
        } else {
          await updateAllSkills({ registry });
        }
      }
    );

  skills
    .command("list")
    .description("列出已安装技能")
    .action(async () => {
      const { listSkills } = await import("./skills.js");
      await listSkills();
    });

  skills
    .command("uninstall <slug>")
    .description("卸载技能")
    .action(async (slug: string) => {
      const { uninstallSkill } = await import("./skills.js");
      await uninstallSkill(slug);
    });

  skills
    .command("login")
    .description("登录注册表 (ClawHub/SkillHub)")
    .option("-t, --token <token>", "API Token")
    .option("-r, --registry <registry>", "注册表源 (clawhub|skillhub)", "clawhub")
    .action(async (options: { token?: string; registry?: string }) => {
      const { loginRegistry } = await import("./skills.js");
      const registry =
        options.registry === "skillhub" ? "skillhub" : "clawhub";
      await loginRegistry({ ...options, registry });
    });

  skills
    .command("publish <path>")
    .description("发布技能")
    .option("-s, --slug <slug>", "技能标识")
    .option("-v, --version <version>", "版本号")
    .option("-r, --registry <registry>", "注册表源 (clawhub|skillhub)", "clawhub")
    .action(
      async (
        skillPath: string,
        options: { slug?: string; version?: string; registry?: string }
      ) => {
        const { publishSkill } = await import("./skills.js");
        const registry =
          options.registry === "skillhub" ? "skillhub" : "clawhub";
        await publishSkill(skillPath, { ...options, registry });
      }
    );
}
