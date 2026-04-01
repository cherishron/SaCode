import { BaseAdapter } from "./base.js";
import type { IMMessage, Channel, Platform } from "./types/index.js";

// ============================================
// 类型定义
// ============================================

interface DingTalkConfig {
  appKey: string;
  appSecret: string;
  /** 机器人代码 (群聊必需) */
  robotCode?: string;
  /** AI Card 模板 ID (流式输出) */
  cardTemplateId?: string;
  /** 模板内容字段名 */
  cardTemplateKey?: string;
  /** 是否启用流式输出 */
  streamingEnabled?: boolean;
  /** 企业 ID (可选) */
  corpId?: string;
}

interface DingTalkTokenResponse {
  errcode: number;
  errmsg?: string;
  access_token?: string;
  expires_in?: number;
}

interface DingTalkMessageResponse {
  errcode: number;
  errmsg?: string;
  process_query_keys?: string[];
  task_id?: number;
}

interface DingTalkCardResponse {
  errcode: number;
  errmsg?: string;
  processQueryKey?: string;
}

/**
 * AI Card 按钮配置
 */
interface CardButton {
  key: string;
  text: string;
  type?: "primary" | "secondary" | "danger";
  callback?: (action: string, data: Record<string, unknown>) => void;
}

/**
 * AI Card 配置
 */
interface CardConfig {
  title?: string;
  content: string;
  buttons?: CardButton[];
  markdown?: boolean;
  streamStatus?: "thinking" | "streaming" | "done" | "error";
}

/**
 * 钉钉适配器
 *
 * 支持流式输出：
 * - 使用 AI Card 模板实现打字机效果
 * - 群聊需要配置 robotCode
 * - 需要在钉钉开发者控制台创建 Card 模板
 *
 * @see https://open.dingtalk.com/document/orgapp/robot-send-stream-card
 */
export class DingTalkAdapter extends BaseAdapter {
  platform: Platform = "dingtalk";
  private config: DingTalkConfig;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;
  private webSocket: WebSocket | null = null;
  private cardCallbacks: Map<string, CardButton["callback"]> = new Map();

  constructor(config: DingTalkConfig) {
    super();
    this.config = config;
  }

  async connect(): Promise<void> {
    // 获取 access token
    await this.ensureAccessToken();

    // 获取 Stream 配置
    await this.initStreamConfig();

    this.connected = true;
    console.log("[DingTalk] Connected");
  }

  async disconnect(): Promise<void> {
    if (this.webSocket) {
      this.webSocket.close();
      this.webSocket = null;
    }
    this.accessToken = null;
    this.connected = false;
  }

  async send(message: IMMessage): Promise<void> {
    if (!this.connected) {
      throw new Error("Not connected");
    }

    await this.ensureAccessToken();

    // 发送文本消息
    const response = await fetch(
      `https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2?access_token=${this.accessToken}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: message.channelId,
          userid_list: message.userId,
          msg: {
            msgtype: "text",
            text: {
              content: message.content,
            },
          },
        }),
      }
    );

    const data = (await response.json()) as DingTalkMessageResponse;
    if (data.errcode !== 0) {
      throw new Error(`Failed to send message: ${data.errmsg}`);
    }
  }

  async getChannels(): Promise<Channel[]> {
    if (!this.connected) {
      throw new Error("Not connected");
    }

    await this.ensureAccessToken();

    const channels: Channel[] = [];

    try {
      // Get chat list (groups)
      const response = await fetch(
        `https://oapi.dingtalk.com/topapi/im/chat/list?access_token=${this.accessToken}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            size: 100,
          }),
        }
      );

      const data = (await response.json()) as {
        errcode: number;
        errmsg?: string;
        result?: {
          chat_list?: Array<{
            chat_id: string;
            name: string;
          }>;
        };
      };

      if (data.errcode !== 0) {
        throw new Error(`Failed to get chat list: ${data.errmsg}`);
      }

      if (data.result?.chat_list) {
        for (const chat of data.result.chat_list) {
          channels.push({
            id: chat.chat_id,
            name: chat.name,
            type: "group",
          });
        }
      }

      // Optionally get departments
      try {
        const deptResponse = await fetch(
          `https://oapi.dingtalk.com/topapi/v2/department/listsub?access_token=${this.accessToken}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              dept_id: 1, // Root department
            }),
          }
        );

        const deptData = (await deptResponse.json()) as {
          errcode: number;
          result?: {
            list?: Array<{
              dept_id: number;
              name: string;
            }>;
          };
        };

        if (deptData.errcode === 0 && deptData.result?.list) {
          for (const dept of deptData.result.list) {
            channels.push({
              id: `dept_${dept.dept_id}`,
              name: dept.name,
              type: "group",
            });
          }
        }
      } catch {
        // Ignore department fetch errors
      }

      return channels;
    } catch (error) {
      throw new Error(`Failed to get channels: ${error}`);
    }
  }

  /**
   * 支持流式输出 (需要配置 AI Card 模板)
   */
  override supportsStreaming(): boolean {
    return (
      this.config.streamingEnabled !== false &&
      !!this.config.cardTemplateId &&
      !!this.config.robotCode
    );
  }

  /**
   * 发送初始 AI Card (流式开始)
   * @returns processQueryKey 用于后续更新
   */
  override async sendInitial(channelId: string, text: string): Promise<string | undefined> {
    if (!this.supportsStreaming()) {
      return undefined;
    }

    await this.ensureAccessToken();

    try {
      const response = await fetch(
        `https://api.dingtalk.com/v1.0/card/instances?access_token=${this.accessToken}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cardTemplateId: this.config.cardTemplateId,
            outTrackId: `SACODE_${Date.now()}`,
            callbackRouteKey: "SACODE_callback",
            cardData: {
              cardParamMap: {
                [this.config.cardTemplateKey || "content"]: text || "正在思考...",
                stream_status: "thinking",
              },
            },
            conversationType: "1", // 单聊
            receiverUserIdList: [channelId],
            robotCode: this.config.robotCode,
          }),
        }
      );

      const data = (await response.json()) as DingTalkCardResponse;
      if (data.errcode === 0) {
        return data.processQueryKey || `card_${Date.now()}`;
      }

      console.error("[DingTalk] Send initial card error:", data.errmsg);
    } catch (error) {
      console.error("[DingTalk] Send initial card error:", error);
    }

    return undefined;
  }

  /**
   * 更新 AI Card 内容 (流式更新)
   */
  override async editMessage(
    _channelId: string,
    messageId: string,
    text: string
  ): Promise<void> {
    if (!this.supportsStreaming()) {
      return;
    }

    await this.ensureAccessToken();

    try {
      await fetch(
        `https://api.dingtalk.com/v1.0/card/instances?access_token=${this.accessToken}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            outTrackId: messageId,
            cardData: {
              cardParamMap: {
                [this.config.cardTemplateKey || "content"]: text,
                stream_status: "streaming",
              },
            },
          }),
        }
      );
    } catch (error) {
      console.error("[DingTalk] Edit card error:", error);
    }
  }

  // ============================================
  // 增强功能
  // ============================================

  /**
   * 发送增强版 AI Card
   */
  async sendEnhancedCard(
    channelId: string,
    card: CardConfig
  ): Promise<string | undefined> {
    if (!this.supportsStreaming()) {
      return undefined;
    }

    await this.ensureAccessToken();

    const cardParamMap: Record<string, string> = {
      [this.config.cardTemplateKey || "content"]: card.content,
      stream_status: card.streamStatus || "done",
    };

    if (card.title) {
      cardParamMap.title = card.title;
    }

    if (card.markdown) {
      cardParamMap.content_type = "markdown";
    }

    // 添加按钮
    if (card.buttons && card.buttons.length > 0) {
      cardParamMap.buttons = JSON.stringify(
        card.buttons.map((btn) => ({
          key: btn.key,
          text: btn.text,
          type: btn.type || "primary",
        }))
      );

      // 注册按钮回调
      for (const btn of card.buttons) {
        if (btn.callback) {
          this.cardCallbacks.set(btn.key, btn.callback);
        }
      }
    }

    try {
      const response = await fetch(
        `https://api.dingtalk.com/v1.0/card/instances?access_token=${this.accessToken}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cardTemplateId: this.config.cardTemplateId,
            outTrackId: `SACODE_${Date.now()}`,
            callbackRouteKey: "SACODE_callback",
            cardData: { cardParamMap },
            conversationType: "1",
            receiverUserIdList: [channelId],
            robotCode: this.config.robotCode,
          }),
        }
      );

      const data = (await response.json()) as DingTalkCardResponse;
      if (data.errcode === 0) {
        return data.processQueryKey;
      }
    } catch (error) {
      console.error("[DingTalk] Send enhanced card error:", error);
    }

    return undefined;
  }

  /**
   * 完成流式输出
   */
  async completeStreaming(
    messageId: string,
    finalContent: string,
    options?: {
      title?: string;
      buttons?: CardButton[];
    }
  ): Promise<void> {
    await this.ensureAccessToken();

    const cardParamMap: Record<string, string> = {
      [this.config.cardTemplateKey || "content"]: finalContent,
      stream_status: "done",
    };

    if (options?.title) {
      cardParamMap.title = options.title;
    }

    if (options?.buttons && options.buttons.length > 0) {
      cardParamMap.buttons = JSON.stringify(
        options.buttons.map((btn) => ({
          key: btn.key,
          text: btn.text,
          type: btn.type || "primary",
        }))
      );

      for (const btn of options.buttons) {
        if (btn.callback) {
          this.cardCallbacks.set(btn.key, btn.callback);
        }
      }
    }

    try {
      await fetch(
        `https://api.dingtalk.com/v1.0/card/instances?access_token=${this.accessToken}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            outTrackId: messageId,
            cardData: { cardParamMap },
          }),
        }
      );
    } catch (error) {
      console.error("[DingTalk] Complete streaming error:", error);
    }
  }

  /**
   * 处理按钮回调
   */
  handleCardCallback(
    buttonKey: string,
    action: string,
    data: Record<string, unknown>
  ): void {
    const callback = this.cardCallbacks.get(buttonKey);
    if (callback) {
      callback(action, data);
    }
  }

  // ============================================
  // 私有方法
  // ============================================

  /**
   * 确保 access token 有效
   */
  private async ensureAccessToken(): Promise<void> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return;
    }

    const tokenResponse = await fetch(
      `https://oapi.dingtalk.com/gettoken?appkey=${this.config.appKey}&appsecret=${this.config.appSecret}`
    );

    const tokenData = (await tokenResponse.json()) as DingTalkTokenResponse;
    if (tokenData.errcode !== 0) {
      throw new Error(`Failed to get access token: ${tokenData.errmsg}`);
    }

    this.accessToken = tokenData.access_token ?? null;
    // 提前 5 分钟过期
    this.tokenExpiresAt = Date.now() + ((tokenData.expires_in ?? 7200) - 300) * 1000;
  }

  /**
   * 初始化 Stream 配置
   */
  private async initStreamConfig(): Promise<void> {
    if (!this.accessToken) {
      return;
    }

    try {
      const response = await fetch(
        `https://api.dingtalk.com/v1.0/gateway/connections/open?access_token=${this.accessToken}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: this.config.appKey,
            clientSecret: this.config.appSecret,
          }),
        }
      );

      const data = (await response.json()) as {
        errcode: number;
        errmsg?: string;
        endpoint?: string;
        ticket?: string;
      };

      if (data.errcode === 0 && data.endpoint) {
        // 连接 WebSocket
        await this.connectWebSocket(data.endpoint);
      }
    } catch (error) {
      console.error("[DingTalk] Init stream config error:", error);
    }
  }

  /**
   * 连接 WebSocket 接收消息
   */
  private async connectWebSocket(endpoint: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.webSocket = new WebSocket(endpoint);

        this.webSocket.onopen = () => {
          console.log("[DingTalk] WebSocket connected");
          resolve();
        };

        this.webSocket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data) as {
              type: string;
              content?: {
                senderStaffId?: string;
                conversationId?: string;
                content?: string;
              };
              callback?: {
                buttonKey?: string;
                action?: string;
                data?: Record<string, unknown>;
              };
            };

            // 处理消息
            if (data.type === "CALLBACK" && data.content) {
              const message: IMMessage = {
                id: `dt_${Date.now()}`,
                platform: "dingtalk",
                channelId: data.content.conversationId || "",
                userId: data.content.senderStaffId || "unknown",
                content: data.content.content || "",
                timestamp: Date.now(),
              };

              this.emitMessage(message);
            }

            // 处理按钮回调
            if (data.callback?.buttonKey) {
              this.handleCardCallback(
                data.callback.buttonKey,
                data.callback.action || "click",
                data.callback.data || {}
              );
            }
          } catch {
            // 忽略解析错误
          }
        };

        this.webSocket.onerror = (error) => {
          console.error("[DingTalk] WebSocket error:", error);
          reject(error);
        };

        this.webSocket.onclose = () => {
          console.log("[DingTalk] WebSocket closed");
        };
      } catch (error) {
        reject(error);
      }
    });
  }
}