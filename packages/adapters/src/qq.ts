import { BaseAdapter } from "./base.js";
import type { IMMessage, Channel, Platform } from "./types/index.js";

interface QQConfig {
  // 使用 go-cqhttp 或 OneBot 的配置
  wsUrl?: string;
  accessToken?: string;
}

export class QQAdapter extends BaseAdapter {
  platform: Platform = "qq";
  private ws: WebSocket | null = null;
  private config: QQConfig;

  constructor(config: QQConfig = {}) {
    super();
    this.config = config;
  }

  async connect(): Promise<void> {
    const wsUrl = this.config.wsUrl || "ws://localhost:8080";

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          this.connected = true;
          console.log("[QQ] Connected");

          // 发送登录请求
          this.ws?.send(
            JSON.stringify({
              action: "get_login_info",
              echo: "init",
            })
          );

          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onerror = (error) => {
          console.error("[QQ] Error:", error);
          this.connected = false;
        };

        this.ws.onclose = () => {
          console.log("[QQ] Disconnected");
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

    // 判断是群消息还是私聊
    const isGroup = message.channelId.includes("group");

    const payload = {
      action: isGroup ? "send_group_msg" : "send_private_msg",
      params: {
        [isGroup ? "group_id" : "user_id"]: parseInt(
          message.channelId.replace(/^(group_|private_)/, "")
        ),
        message: message.content,
      },
    };

    this.ws.send(JSON.stringify(payload));
  }

  async getChannels(): Promise<Channel[]> {
    if (!this.ws || !this.connected) {
      throw new Error("Not connected");
    }

    return new Promise((resolve, reject) => {
      const requestId = "get_group_list";

      const handleResponse = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data) as {
            echo?: string;
            status?: string;
            data?: Array<{ group_id: number; group_name: string }>;
          };

          if (data.echo === requestId) {
            this.ws?.removeEventListener("message", handleResponse);

            if (data.status === "ok" && Array.isArray(data.data)) {
              const channels: Channel[] = data.data.map((group) => ({
                id: `group_${group.group_id}`,
                name: group.group_name,
                type: "group" as const,
              }));
              resolve(channels);
            } else {
              reject(new Error(`Failed to get group list: ${data.status}`));
            }
          }
        } catch (error) {
          reject(error);
        }
      };

      this.ws?.addEventListener("message", handleResponse);

      // OneBot API call
      this.ws?.send(
        JSON.stringify({
          action: "get_group_list",
          echo: requestId,
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

      // 处理消息事件
      if (parsed.post_type === "message") {
        const message: IMMessage = {
          id: parsed.message_id?.toString() || Date.now().toString(),
          platform: "qq",
          channelId:
            parsed.message_type === "group"
              ? `group_${parsed.group_id}`
              : `private_${parsed.user_id}`,
          userId: parsed.user_id.toString(),
          content: parsed.raw_message,
          timestamp: parsed.time * 1000,
        };

        this.emitMessage(message);
      }
    } catch (error) {
      console.error("[QQ] Parse error:", error);
    }
  }
}
