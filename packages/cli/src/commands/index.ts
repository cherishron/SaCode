import type { CommandContext } from "./types";

// --- 新命令模块 re-export ---
export { registerAuthCommand } from "./auth.js";
export { registerCodeCommand } from "./code.js";

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
