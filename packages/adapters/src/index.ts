import type { IMAdapter, Platform, IMConfig } from "./types/index.js";
import { WechatAdapter } from "./wechat.js";
import { QQAdapter } from "./qq.js";
import { TelegramAdapter } from "./telegram.js";
import { DiscordAdapter } from "./discord.js";
import { DingTalkAdapter } from "./dingtalk.js";
import { FeishuAdapter } from "./feishu.js";
import { XiaoyiAdapter } from "./xiaoyi.js";
import { WhatsAppAdapter } from "./whatsapp.js";
import { SlackAdapter } from "./slack.js";
import { EmailAdapter } from "./email.js";

export * from "./types/index.js";
export * from "./base.js";
export type { StreamSender } from "./base.js";
export { WechatAdapter } from "./wechat.js";
export { QQAdapter } from "./qq.js";
export { TelegramAdapter } from "./telegram.js";
export { DiscordAdapter } from "./discord.js";
export { DingTalkAdapter } from "./dingtalk.js";
export { FeishuAdapter } from "./feishu.js";
export { XiaoyiAdapter } from "./xiaoyi.js";
export { WhatsAppAdapter } from "./whatsapp.js";
export { SlackAdapter } from "./slack.js";
export { EmailAdapter } from "./email.js";

/**
 * IM 适配器工厂
 */
export function createAdapter(config: IMConfig): IMAdapter {
  switch (config.platform) {
    case "wechat":
      return new WechatAdapter(config.config as unknown as ConstructorParameters<typeof WechatAdapter>[0]);
    case "qq":
      return new QQAdapter(config.config as unknown as ConstructorParameters<typeof QQAdapter>[0]);
    case "telegram":
      return new TelegramAdapter(config.config as unknown as ConstructorParameters<typeof TelegramAdapter>[0]);
    case "discord":
      return new DiscordAdapter(config.config as unknown as ConstructorParameters<typeof DiscordAdapter>[0]);
    case "dingtalk":
      return new DingTalkAdapter(config.config as unknown as ConstructorParameters<typeof DingTalkAdapter>[0]);
    case "feishu":
      return new FeishuAdapter(config.config as unknown as ConstructorParameters<typeof FeishuAdapter>[0]);
    case "xiaoyi":
      return new XiaoyiAdapter(config.config as unknown as ConstructorParameters<typeof XiaoyiAdapter>[0]);
    case "whatsapp":
      return new WhatsAppAdapter(config.config as unknown as ConstructorParameters<typeof WhatsAppAdapter>[0]);
    case "slack":
      return new SlackAdapter(config.config as unknown as ConstructorParameters<typeof SlackAdapter>[0]);
    case "email":
      return new EmailAdapter(config.config as unknown as ConstructorParameters<typeof EmailAdapter>[0]);
    default:
      throw new Error(`Unknown platform: ${(config as { platform: string }).platform}`);
  }
}

/**
 * IM 适配器管理器
 */
export class IMAdapterManager {
  private adapters: Map<Platform, IMAdapter> = new Map();

  /**
   * 注册适配器（不自动连接）
   */
  register(platform: Platform, adapter: IMAdapter): void {
    this.adapters.set(platform, adapter);
  }

  /**
   * 注销适配器
   */
  unregister(platform: Platform): void {
    this.adapters.delete(platform);
  }

  /**
   * 检查平台是否已注册
   */
  has(platform: Platform): boolean {
    return this.adapters.has(platform);
  }

  /**
   * 连接并注册适配器
   */
  async connect(platform: Platform, config: Record<string, unknown>): Promise<IMAdapter> {
    const adapter = createAdapter({ platform, config });
    await adapter.connect();
    this.adapters.set(platform, adapter);
    return adapter;
  }

  /**
   * 断开并注销适配器
   */
  async disconnect(platform: Platform): Promise<void> {
    const adapter = this.adapters.get(platform);
    if (adapter) {
      await adapter.disconnect();
      this.adapters.delete(platform);
    }
  }

  /**
   * 获取适配器
   */
  get(platform: Platform): IMAdapter | undefined {
    return this.adapters.get(platform);
  }

  /**
   * 获取所有适配器
   */
  getAll(): Map<Platform, IMAdapter> {
    return this.adapters;
  }

  /**
   * 断开所有适配器
   */
  async disconnectAll(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.disconnect();
    }
    this.adapters.clear();
  }
}
