/**
 * 命令模块入口
 *
 * 提供斜杠命令自动发现和管理功能
 */

export {
  CommandDiscovery,
  createCommandDiscovery,
  DEFAULT_COMMAND_DISCOVERY_CONFIG,
} from "./discovery";

export type {
  CommandDefinition,
  CommandFileMetadata,
  CommandDiscoveryConfig,
  CommandDiscoveryEvents,
} from "./discovery";
