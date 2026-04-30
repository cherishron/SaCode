/**
 * SACODE IM 适配器类型
 *
 * 从 @sacode/types 重新导出共享类型，并添加适配器专用类型。
 */

// ============================================================================
// 从 @sacode/types 导入共享类型
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
  Platform,
  IMConfig,
  Channel,
  IMMessage,
  IMMediaMessage,
  IMAdapter,
  SendOptions,
  StreamOptions,
  StreamSender,
  MediaSupport,
  BaseAdapterLike,
} from "@sacode/types";

export {
  isTextContent,
  isImageContent,
  isAudioContent,
  isVideoContent,
  isFileContent,
  isLocationContent,
  isStickerContent,
} from "@sacode/types";