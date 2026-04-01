/**
 * 华为小艺插件 - 入口文件
 *
 * 提供与华为小艺 AI 助手的集成能力
 */

import type { Plugin, PluginContext, PluginTool, PluginMessageHandler } from "@SACODE/core";

/**
 * 创建小艺插件实例
 */
export default function createXiaoyiPlugin(context: PluginContext): Plugin {
  const { logger, config } = context;

  // 配置项
  const ak = config.get("ak", "");
  const sk = config.get("sk", "");
  const agentId = config.get("agentId", "");
  const region = config.get("region", "cn-north-4");
  const timeout = config.get("timeout", 30000);

  // 内部状态
  let isConnected = false;

  return {
    name: "xiaoyi",
    version: "1.0.0",
    manifest: {
      name: "xiaoyi",
      version: "1.0.0",
      main: "index.ts",
    },
    status: "discovered",
    path: "",
    config: config.getAll(),

    // 生命周期钩子
    async install(ctx: PluginContext) {
      logger.info("Installing xiaoyi plugin...");

      // 验证必需配置
      if (!ak || !sk || !agentId) {
        throw new Error("Missing required configuration: ak, sk, or agentId");
      }

      // 初始化存储
      await ctx.storage.set("initializedAt", new Date().toISOString());
      await ctx.storage.set("messageCount", 0);

      logger.info("Xiaoyi plugin installed successfully");
    },

    async uninstall(ctx: PluginContext) {
      logger.info("Uninstalling xiaoyi plugin...");
      await ctx.storage.clear();
      logger.info("Xiaoyi plugin uninstalled");
    },

    async enable(ctx: PluginContext) {
      logger.info("Enabling xiaoyi plugin...");
      
      // 模拟连接
      isConnected = true;
      
      logger.info("Xiaoyi plugin enabled", { region, agentId });
    },

    async disable(ctx: PluginContext) {
      logger.info("Disabling xiaoyi plugin...");
      isConnected = false;
      logger.info("Xiaoyi plugin disabled");
    },

    async onConfigChange(newConfig: Record<string, unknown>, oldConfig: Record<string, unknown>) {
      logger.info("Configuration changed", { newConfig, oldConfig });
      
      // 如果关键配置变更，需要重新连接
      if (
        newConfig.ak !== oldConfig.ak ||
        newConfig.sk !== oldConfig.sk ||
        newConfig.agentId !== oldConfig.agentId
      ) {
        logger.info("Critical config changed, reconnection required");
        // TODO: 实现重连逻辑
      }
    },

    // 插件能力
    capabilities: {
      tools: [
        {
          name: "xiaoyi_chat",
          description: "与小艺 AI 进行对话",
          parameters: {
            type: "object",
            properties: {
              message: {
                type: "string",
                description: "发送给小艺的消息",
              },
              sessionId: {
                type: "string",
                description: "会话 ID（可选）",
              },
            },
            required: ["message"],
          },
          execute: async (params: Record<string, unknown>, ctx: PluginContext) => {
            const { message, sessionId } = params as { message: string; sessionId?: string };
            
            if (!isConnected) {
              throw new Error("Xiaoyi adapter not connected");
            }

            logger.info("Sending message to xiaoyi", { message, sessionId });

            // 更新消息计数
            const count = (await ctx.storage.get<number>("messageCount")) || 0;
            await ctx.storage.set("messageCount", count + 1);

            // TODO: 实际调用小艺 API
            return {
              success: true,
              reply: `[小艺回复] 收到消息: ${message}`,
              sessionId: sessionId || `session_${Date.now()}`,
            };
          },
        },
        {
          name: "xiaoyi_status",
          description: "获取小艺连接状态",
          parameters: {
            type: "object",
            properties: {},
          },
          execute: async () => {
            return {
              connected: isConnected,
              region,
              agentId,
              config: {
                timeout,
                reconnectInterval: config.get("reconnectInterval", 5000),
              },
            };
          },
        },
      ] as PluginTool[],

      commands: [
        {
          name: "xiaoyi",
          description: "与小艺对话",
          aliases: ["xy"],
          handler: async (args: string[], ctx: PluginContext) => {
            const message = args.join(" ");
            if (!message) {
              ctx.logger.info("Usage: /xiaoyi <message>");
              return;
            }

            // 调用 chat 工具
            const result = await ctx.sendMessage("xiaoyi", "console", message);
            ctx.logger.info("Reply:", result);
          },
        },
      ],

      messageHandlers: [
        {
          platform: "xiaoyi",
          priority: 10,
          handler: async (message, ctx) => {
            logger.info("Received xiaoyi message", {
              chatId: message.chatId,
              content: message.content.substring(0, 50),
            });

            // 示例：自动回复
            if (message.content.toLowerCase().includes("hello")) {
              return {
                reply: "你好！我是通过 SACODE 插件系统处理的消息。",
              };
            }

            return undefined;
          },
        },
      ] as PluginMessageHandler[],
    },
  };
}
