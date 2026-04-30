import type { IMAdapter, Platform, IMMessage, IMMediaMessage, Channel, StreamSender, MediaSupport } from "./types/index.js";

// Re-export StreamSender and MediaSupport from @sacode/types
export type { StreamSender, MediaSupport } from "./types/index.js";

export abstract class BaseAdapter implements IMAdapter, Partial<StreamSender>, Partial<MediaSupport> {
  abstract platform: Platform;
  protected connected = false;
  protected messageCallbacks: Array<(message: IMMessage) => void> = [];

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract send(message: IMMessage): Promise<void>;
  abstract getChannels(): Promise<Channel[]>;

  onMessage(callback: (message: IMMessage) => void): void {
    this.messageCallbacks.push(callback);
  }

  protected emitMessage(message: IMMessage): void {
    for (const callback of this.messageCallbacks) {
      callback(message);
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ============================================
  // 流式输出支持 (子类可重写)
  // ============================================

  supportsStreaming(): boolean {
    return false;
  }

  async sendInitial(_channelId: string, _text: string): Promise<string | undefined> {
    return undefined;
  }

  async editMessage(_channelId: string, _messageId: string, _text: string): Promise<void> {
    // 默认不支持编辑
  }

  // ============================================
  // 多媒体支持 (子类可重写)
  // ============================================

  supportsImage(): boolean {
    return false;
  }

  supportsAudio(): boolean {
    return false;
  }

  supportsVideo(): boolean {
    return false;
  }

  supportsFile(): boolean {
    return false;
  }

  supportsLocation(): boolean {
    return false;
  }

  supportsSticker(): boolean {
    return false;
  }

  /**
   * 发送多媒体消息
   * 子类可重写以支持多媒体
   * 默认实现：提取文本内容并发送
   */
  async sendMedia(message: IMMediaMessage): Promise<string | undefined> {
    // 默认实现：提取文本内容并发送
    const text = this.getPrimaryText(message);
    await this.send({ ...message, content: text || message.content });
    return undefined;
  }

  /**
   * 辅助方法：获取消息的主要文本内容
   */
  protected getPrimaryText(message: IMMessage): string {
    if (message.contents && message.contents.length > 0) {
      const textContent = message.contents.find((c) => c.type === "text");
      if (textContent && textContent.type === "text") {
        return textContent.text;
      }
    }
    return message.content;
  }

  /**
   * 辅助方法：获取消息的图片内容
   */
  protected getImageContents(message: IMMessage): import("./types/index.js").ImageContent[] {
    if (!message.contents) return [];
    return message.contents.filter(
      (c): c is import("./types/index.js").ImageContent => c.type === "image"
    );
  }

  /**
   * 辅助方法：获取消息的语音内容
   */
  protected getAudioContents(message: IMMessage): import("./types/index.js").AudioContent[] {
    if (!message.contents) return [];
    return message.contents.filter(
      (c): c is import("./types/index.js").AudioContent => c.type === "audio"
    );
  }

  /**
   * 辅助方法：获取消息的视频内容
   */
  protected getVideoContents(message: IMMessage): import("./types/index.js").VideoContent[] {
    if (!message.contents) return [];
    return message.contents.filter(
      (c): c is import("./types/index.js").VideoContent => c.type === "video"
    );
  }

  /**
   * 辅助方法：获取消息的文件内容
   */
  protected getFileContents(message: IMMessage): import("./types/index.js").FileContent[] {
    if (!message.contents) return [];
    return message.contents.filter(
      (c): c is import("./types/index.js").FileContent => c.type === "file"
    );
  }
}
