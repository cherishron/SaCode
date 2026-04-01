/**
 * SACODE IM 适配器类型
 *
 * 从 @SACODE/types 重新导出共享类型，并添加适配器专用类型。
 */

// ============================================================================
// 从 @SACODE/types 导入共享类型
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
} from "@SACODE/types";

export {
  isTextContent,
  isImageContent,
  isAudioContent,
  isVideoContent,
  isFileContent,
  isLocationContent,
  isStickerContent,
} from "@SACODE/types";