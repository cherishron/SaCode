/**
 * SaClaw Shared Types
 *
 * 跨包共享的类型定义，供 @saclaw/core 和 @saclaw/adapters 使用。
 *
 * @module @saclaw/types
 */

// ============================================================================
// 多媒体消息类型
// ============================================================================

export type {
  MessageContentType,
  ImageContent,
  AudioContent,
  VideoContent,
  FileContent,
  LocationContent,
  StickerContent,
  TextContent,
  MessageContent,
} from "./message.js";

export {
  isTextContent,
  isImageContent,
  isAudioContent,
  isVideoContent,
  isFileContent,
  isLocationContent,
  isStickerContent,
} from "./message.js";

// ============================================================================
// IM 适配器类型
// ============================================================================

export type {
  Platform,
  IMConfig,
  ChannelType,
  Channel,
  IMMessage,
  IMMediaMessage,
  IMAdapter,
  SendOptions,
  StreamOptions,
} from "./adapter.js";
