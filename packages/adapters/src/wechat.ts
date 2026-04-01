import { BaseAdapter } from "./base.js";
import type { IMMessage, Channel, Platform } from "./types/index.js";

interface WechatConfig {
  // 使用 WeChatBot 或类似工具的配置
  wsUrl?: string;
  token?: string;
}

export class WechatAdapter extends BaseAdapter {
  platform: Platform = "wechat";
  private ws: WebSocket | null = null;
  private config: WechatConfig;

  constructor(config: WechatConfig = {}) {
    super();
    this.config = config;
  }

  async connect(): Promise<void> {
    const wsUrl = this.config.wsUrl || "ws://localhost:19088";

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          this.connected = true;
          console.log("[WeChat] Connected");
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onerror = (error) => {
          console.error("[WeChat] Error:", error);
          this.connected = false;
        };

        this.ws.onclose = () => {
          console.log("[WeChat] Disconnected");
          this.connected = false;
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  async send(message: IMMessage): Promise<void> {
    if (!this.ws || !this.connected) {
      throw new Error("Not connected");
    }

    const payload = {
      type: "send",
      data: {
        channelId: message.channelId,
        content: message.content,
      },
    };

    this.ws.send(JSON.stringify(payload));
  }

  async getChannels(): Promise<Channel[]> {
    if (!this.ws || !this.connected) {
      throw new Error("Not connected");
    }

    return new Promise((resolve, reject) => {
      const requestId = `get_contacts_${Date.now()}`;

      const handleResponse = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data) as {
            requestId?: string;
            type?: string;
            contacts?: Array<{
              wxid: string;
              name?: string;
              type?: number;
            }>;
          };

          if (data.requestId === requestId && data.type === "contact_list") {
            this.ws?.removeEventListener("message", handleResponse);

            const channels: Channel[] = (data.contacts || []).map((contact) => ({
              id: contact.wxid,
              name: contact.name || contact.wxid,
              type: contact.type === 1 ? ("private" as const) : ("group" as const),
            }));

            resolve(channels);
          }
        } catch (error) {
          reject(error);
        }
      };

      this.ws?.addEventListener("message", handleResponse);

      // Request contact list (protocol depends on bridge service)
      this.ws?.send(
        JSON.stringify({
          type: "get_contacts",
          requestId,
        })
      );

      // Timeout after 10 seconds
      setTimeout(() => {
        this.ws?.removeEventListener("message", handleResponse);
        reject(new Error("Get channels timeout"));
      }, 10000);
    });
  }

  private handleMessage(data: string): void {
    try {
      const parsed = JSON.parse(data);

      if (parsed.type === "message") {
        const message: IMMessage = {
          id: parsed.data.id || Date.now().toString(),
          platform: "wechat",
          channelId: parsed.data.roomId || parsed.data.fromUser,
          userId: parsed.data.fromUser,
          content: parsed.data.content,
          timestamp: parsed.data.timestamp || Date.now(),
        };

        this.emitMessage(message);
      }
    } catch (error) {
      console.error("[WeChat] Parse error:", error);
    }
  }
}
