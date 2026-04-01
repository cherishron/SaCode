/**
 * SACODE API Client
 *
 * 与 SACODE 服务器通信的客户端
 */

import * as vscode from "vscode";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatResponse {
  message: string;
  done: boolean;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  category?: string;
}

/**
 * SACODE 客户端类
 */
export class SACODEClient {
  private apiUrl: string;
  private token: string | undefined;
  private connected: boolean = false;

  constructor() {
    const config = vscode.workspace.getConfiguration("SACODE");
    this.apiUrl = config.get<string>("apiUrl") ?? "http://localhost:3000";
  }

  /**
   * 连接到服务器
   */
  async connect(url?: string): Promise<void> {
    if (url) {
      this.apiUrl = url;
    }

    try {
      // 检查服务器是否可用
      const response = await fetch(`${this.apiUrl}/api/health`, {
        method: "GET",
      });

      if (response.ok) {
        this.connected = true;
        console.log("Connected to SACODE server");
      } else {
        throw new Error(`Server returned status: ${response.status}`);
      }
    } catch (error) {
      this.connected = false;
      throw error;
    }
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.connected = false;
    console.log("Disconnected from SACODE server");
  }

  /**
   * 检查连接状态
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * 发送聊天消息
   */
  async sendChatMessage(
    messages: ChatMessage[],
    onChunk?: (chunk: string) => void
  ): Promise<string> {
    if (!this.connected) {
      throw new Error("Not connected to SACODE server");
    }

    const config = vscode.workspace.getConfiguration("SACODE");
    const model = config.get<string>("defaultModel") ?? "claude-3-5-sonnet";
    const maxTokens = config.get<number>("maxTokens") ?? 4096;

    try {
      const response = await fetch(`${this.apiUrl}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify({
          messages,
          model,
          maxTokens,
        }),
      });

      if (!response.ok) {
        throw new Error(`Chat request failed: ${response.status}`);
      }

      // 支持流式输出
      if (onChunk && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullResponse = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          // 假设服务器发送 SSE 格式的数据
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") continue;

              try {
                const parsed = JSON.parse(data);
                if (parsed.content) {
                  fullResponse += parsed.content;
                  onChunk(parsed.content);
                }
              } catch (e) {
                // 忽略解析错误
              }
            }
          }
        }

        return fullResponse;
      } else {
        const data: ChatResponse = await response.json();
        return data.message;
      }
    } catch (error) {
      console.error("Failed to send chat message:", error);
      throw error;
    }
  }

  /**
   * 获取技能列表
   */
  async getSkills(): Promise<Skill[]> {
    if (!this.connected) {
      return [];
    }

    try {
      const response = await fetch(`${this.apiUrl}/api/skills`, {
        method: "GET",
        headers: {
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
      });

      if (!response.ok) {
        throw new Error(`Skills request failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Failed to get skills:", error);
      return [];
    }
  }

  /**
   * 执行技能
   */
  async executeSkill(skillId: string, params: Record<string, any>): Promise<any> {
    if (!this.connected) {
      throw new Error("Not connected to SACODE server");
    }

    try {
      const response = await fetch(`${this.apiUrl}/api/skills/${skillId}/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        throw new Error(`Skill execution failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Failed to execute skill:", error);
      throw error;
    }
  }

  /**
   * 设置认证令牌
   */
  setToken(token: string): void {
    this.token = token;
  }

  /**
   * 获取 API URL
   */
  getApiUrl(): string {
    return this.apiUrl;
  }
}
