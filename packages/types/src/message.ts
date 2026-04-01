/**
 * SACODE Shared Types - 多媒体消息类型
 *
 * 此模块定义了跨包共享的多媒体消息类型。
 * 用于 @SACODE/core 和 @SACODE/adapters。
 */

// ============================================================================
// 消息内容类型
// ============================================================================

/**
 * 消息内容类型枚举
 */
export type MessageContentType =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "file"
  | "location"
  | "sticker";

// ============================================================================
// 内容类型接口
// ============================================================================

/**
 * 图片内容
 */
export interface ImageContent {
  type: "image";
  /** 图片 URL */
  url?: string | undefined;
  /** base64 编码的图片数据 */
  base64?: string | undefined;
  /** 本地文件路径 */
  path?: string | undefined;
  /** 图片宽度 */
  width?: number | undefined;
  /** 图片高度 */
  height?: number | undefined;
  /** 文件大小 (字节) */
  size?: number | undefined;
  /** MIME 类型 */
  mimeType?: string | undefined;
  /** 图片描述 */
  caption?: string | undefined;
}

/**
 * 语音内容
 */
export interface AudioContent {
  type: "audio";
  /** 音频 URL */
  url?: string | undefined;
  /** base64 编码的音频数据 */
  base64?: string | undefined;
  /** 本地文件路径 */
  path?: string | undefined;
  /** 时长 (秒) */
  duration?: number | undefined;
  /** 文件大小 (字节) */
  size?: number | undefined;
  /** MIME 类型 */
  mimeType?: string | undefined;
  /** 文件名 */
  filename?: string | undefined;
  /** 语音转文字结果 */
  transcription?: string | undefined;
}

/**
 * 视频内容
 */
export interface VideoContent {
  type: "video";
  /** 视频 URL */
  url?: string | undefined;
  /** base64 编码的视频数据 */
  base64?: string | undefined;
  /** 本地文件路径 */
  path?: string | undefined;
  /** 时长 (秒) */
  duration?: number | undefined;
  /** 宽度 */
  width?: number | undefined;
  /** 高度 */
  height?: number | undefined;
  /** 文件大小 (字节) */
  size?: number | undefined;
  /** MIME 类型 */
  mimeType?: string | undefined;
  /** 视频描述 */
  caption?: string | undefined;
  /** 缩略图 URL */
  thumbnailUrl?: string | undefined;
}

/**
 * 文件内容
 */
export interface FileContent {
  type: "file";
  /** 文件 URL */
  url?: string | undefined;
  /** base64 编码的文件数据 */
  base64?: string | undefined;
  /** 本地文件路径 */
  path?: string | undefined;
  /** 文件名 */
  filename: string;
  /** 文件大小 (字节) */
  size?: number | undefined;
  /** MIME 类型 */
  mimeType?: string | undefined;
}

/**
 * 位置内容
 */
export interface LocationContent {
  type: "location";
  /** 纬度 */
  latitude: number;
  /** 经度 */
  longitude: number;
  /** 地址名称 */
  name?: string | undefined;
  /** 详细地址 */
  address?: string | undefined;
}

/**
 * 表情包内容
 */
export interface StickerContent {
  type: "sticker";
  /** 表情包 ID */
  stickerId: string;
  /** 表情包 URL */
  url?: string | undefined;
  /** 表情包名称 */
  name?: string | undefined;
  /** 表情包格式 */
  format?: "static" | "animated" | "video" | undefined;
}

/**
 * 文本内容
 */
export interface TextContent {
  type: "text";
  /** 文本内容 */
  text: string;
  /** 是否使用 Markdown 格式 */
  markdown?: boolean | undefined;
}

/**
 * 消息内容联合类型
 */
export type MessageContent =
  | TextContent
  | ImageContent
  | AudioContent
  | VideoContent
  | FileContent
  | LocationContent
  | StickerContent;

// ============================================================================
// 类型守卫
// ============================================================================

/**
 * 检查是否为文本内容
 */
export function isTextContent(content: MessageContent): content is TextContent {
  return content.type === "text";
}

/**
 * 检查是否为图片内容
 */
export function isImageContent(content: MessageContent): content is ImageContent {
  return content.type === "image";
}

/**
 * 检查是否为音频内容
 */
export function isAudioContent(content: MessageContent): content is AudioContent {
  return content.type === "audio";
}

/**
 * 检查是否为视频内容
 */
export function isVideoContent(content: MessageContent): content is VideoContent {
  return content.type === "video";
}

/**
 * 检查是否为文件内容
 */
export function isFileContent(content: MessageContent): content is FileContent {
  return content.type === "file";
}

/**
 * 检查是否为位置内容
 */
export function isLocationContent(content: MessageContent): content is LocationContent {
  return content.type === "location";
}

/**
 * 检查是否为表情包内容
 */
export function isStickerContent(content: MessageContent): content is StickerContent {
  return content.type === "sticker";
}
