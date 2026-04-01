import { BaseAdapter } from "./base.js";
import type { IMMessage, Channel, Platform } from "./types/index.js";

interface FeishuConfig {
  appId: string;
  appSecret: string;
}

interface FeishuTokenResponse {
  code: number;
  msg?: string;
  tenant_access_token?: string;
}

interface FeishuMessageResponse {
  code: number;
  msg?: string;
}

interface FeishuChatItem {
  chat_id: string;
  name: string;
}

interface FeishuChatListResponse {
  code: number;
  data?: {
    items?: FeishuChatItem[];
  };
}

export class FeishuAdapter extends BaseAdapter {
  platform: Platform = "feishu";
  private config: FeishuConfig;
  private tenantAccessToken: string | null = null;

  constructor(config: FeishuConfig) {
    super();
    this.config = config;
  }

  async connect(): Promise<void> {
    // 获取 tenant_access_token
    const response = await fetch(
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app_id: this.config.appId,
          app_secret: this.config.appSecret,
        }),
      }
    );

    const data = (await response.json()) as FeishuTokenResponse;
    if (data.code !== 0) {
      throw new Error(`Failed to get tenant access token: ${data.msg}`);
    }

    this.tenantAccessToken = data.tenant_access_token ?? null;
    this.connected = true;
    console.log("[Feishu] Connected");
  }

  async disconnect(): Promise<void> {
    this.tenantAccessToken = null;
    this.connected = false;
  }

  async send(message: IMMessage): Promise<void> {
    if (!this.connected || !this.tenantAccessToken) {
      throw new Error("Not connected");
    }

    // 发送消息
    const response = await fetch(
      "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.tenantAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          receive_id: message.channelId,
          msg_type: "text",
          content: JSON.stringify({ text: message.content }),
        }),
      }
    );

    const data = (await response.json()) as FeishuMessageResponse;
    if (data.code !== 0) {
      throw new Error(`Failed to send message: ${data.msg}`);
    }
  }

  async getChannels(): Promise<Channel[]> {
    if (!this.connected || !this.tenantAccessToken) {
      return [];
    }

    // 获取群列表
    const response = await fetch(
      "https://open.feishu.cn/open-apis/im/v1/chats?page_size=50",
      {
        headers: {
          Authorization: `Bearer ${this.tenantAccessToken}`,
        },
      }
    );

    const data = (await response.json()) as FeishuChatListResponse;
    if (data.code !== 0) {
      return [];
    }

    return (data.data?.items || []).map((item) => ({
      id: item.chat_id,
      name: item.name,
      type: "group" as const,
    }));
  }
}
