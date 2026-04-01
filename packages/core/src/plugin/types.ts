/**
 * SACODE Plugin System - Type Definitions
 *
 * 插件系统类型定义，支持完整的生命周期管理和上下文注入
 */

import type { PrismaClient } from "@prisma/client";
import type { TaskScheduler } from "../scheduler";
import type { SACODEClient } from "../client";

// ============================================================================
// Plugin Manifest - 插件清单
// ============================================================================

/**
 * 插件配置项定义
 */
export interface PluginConfigField {
  type: "string" | "number" | "boolean" | "array" | "object";
  description?: string;
  default?: unknown;
  required?: boolean;
  enum?: unknown[];
  min?: number;
  max?: number;
  pattern?: string;
}

/**
 * 插件配置 Schema
 */
export interface PluginConfig {
  [key: string]: PluginConfigField | PluginConfig;
}

/**
 * 插件清单 - plugin.json 中定义的内容
 */
export interface PluginManifest {
  /** 插件唯一标识（kebab-case） */
  name: string;
  /** 版本号（semver） */
  version: string;
  /** 插件描述 */
  description?: string;
  /** 入口文件（相对于插件目录） */
  main: string;
  /** 作者 */
  author?: string;
  /** 许可证 */
  license?: string;
  /** 主页 URL */
  homepage?: string;
  /** 仓库 URL */
  repository?: string;
  /** 关键词 */
  keywords?: string[];
  /** 依赖的其他插件 { pluginName: version } */
  dependencies?: Record<string, string>;
  /** 适配器依赖（如需要特定平台） */
  adapterDependencies?: string[];
  /** 配置项定义 */
  config?: PluginConfig;
  /** 默认配置值 */
  defaultConfig?: Record<string, unknown>;
  /** 插件图标 */
  icon?: string;
  /** 插件标签 */
  tags?: string[];
  /** 最小 SACODE 版本 */
  minSACODEVersion?: string;
  /** 是否为系统插件 */
  system?: boolean;
}

// ============================================================================
// Plugin Instance - 插件实例
// ============================================================================

/**
 * 插件状态
 */
export type PluginStatus =
  | "discovered"  // 已发现但未安装
  | "installed"   // 已安装但未启用
  | "enabled"     // 已启用
  | "disabled"    // 已禁用
  | "error";      // 错误状态

/**
 * 插件生命周期钩子
 */
export interface PluginLifecycle {
  /** 安装时调用（首次加载） */
  install?(context: PluginContext): Promise<void>;
  /** 卸载时调用 */
  uninstall?(context: PluginContext): Promise<void>;
  /** 启用时调用 */
  enable?(context: PluginContext): Promise<void>;
  /** 禁用时调用 */
  disable?(context: PluginContext): Promise<void>;
  /** 配置变更时调用 */
  onConfigChange?(newConfig: Record<string, unknown>, oldConfig: Record<string, unknown>): Promise<void>;
}

/**
 * 插件能力扩展
 */
export interface PluginCapabilities {
  /** 注册自定义工具 */
  tools?: PluginTool[];
  /** 注册自定义命令 */
  commands?: PluginCommand[];
  /** 注册消息处理器 */
  messageHandlers?: PluginMessageHandler[];
  /** 注册定时任务 */
  scheduledTasks?: PluginScheduledTask[];
  /** 注册技能 */
  skills?: PluginSkill[];
}

/**
 * 插件工具定义
 */
export interface PluginTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (params: Record<string, unknown>, context: PluginContext) => Promise<unknown>;
}

/**
 * 插件命令定义
 */
export interface PluginCommand {
  name: string;
  description: string;
  aliases?: string[];
  handler: (args: string[], context: PluginContext) => Promise<void>;
}

/**
 * 插件消息处理器
 */
export interface PluginMessageHandler {
  platform?: string;  // 特定平台，不指定则为通用
  priority?: number;  // 优先级，数字越大越先执行
  handler: (message: PluginMessage, context: PluginContext) => Promise<PluginMessageResult | void>;
}

/**
 * 插件消息结构
 */
export interface PluginMessage {
  id: string;
  platform: string;
  chatId: string;
  userId?: string;
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

/**
 * 插件消息处理结果
 */
export interface PluginMessageResult {
  reply?: string;
  stopPropagation?: boolean;  // 是否阻止后续处理器执行
  metadata?: Record<string, unknown>;
}

/**
 * 插件定时任务
 */
export interface PluginScheduledTask {
  name: string;
  cron: string;
  handler: (context: PluginContext) => Promise<void>;
}

/**
 * 插件技能
 */
export interface PluginSkill {
  name: string;
  description: string;
  triggers: string[];
  handler: (input: string, context: PluginContext) => Promise<string>;
}

/**
 * 完整的插件实例接口
 */
export interface Plugin extends PluginLifecycle {
  /** 插件名称 */
  readonly name: string;
  /** 插件版本 */
  readonly version: string;
  /** 插件清单 */
  readonly manifest: PluginManifest;
  /** 插件状态 */
  readonly status: PluginStatus;
  /** 插件路径 */
  readonly path: string;
  /** 当前配置 */
  readonly config: Record<string, unknown>;
  /** 插件能力 */
  readonly capabilities?: PluginCapabilities;
  /** 错误信息（状态为 error 时） */
  readonly error?: Error;
}

// ============================================================================
// Plugin Context - 插件上下文
// ============================================================================

/**
 * 日志接口
 */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * 配置管理接口
 */
export interface ConfigManager {
  get<T = unknown>(key: string): T | undefined;
  get<T = unknown>(key: string, defaultValue: T): T;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  has(key: string): boolean;
  getAll(): Record<string, unknown>;
}

/**
 * 适配器管理接口
 */
export interface AdapterManager {
  getAdapter(platform: string): unknown;
  getConnectedAdapters(): unknown[];
  sendMessage(platform: string, chatId: string, message: string): Promise<void>;
}

/**
 * 存储接口
 */
export interface PluginStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  getAll(): Promise<Record<string, unknown>>;
}

/**
 * 插件上下文 - 注入到插件的 API
 */
export interface PluginContext {
  /** 插件名称 */
  readonly pluginName: string;
  /** 日志实例 */
  readonly logger: Logger;
  /** 配置管理 */
  readonly config: ConfigManager;
  /** 适配器管理 */
  readonly adapters: AdapterManager;
  /** 定时任务调度器 */
  readonly scheduler: TaskScheduler;
  /** 数据库客户端 */
  readonly database: PrismaClient;
  /** SACODE 客户端 */
  readonly client: SACODEClient;
  /** 插件专用存储 */
  readonly storage: PluginStorage;
  /** 注册工具 */
  registerTool(tool: PluginTool): void;
  /** 注册命令 */
  registerCommand(command: PluginCommand): void;
  /** 注册消息处理器 */
  registerMessageHandler(handler: PluginMessageHandler): void;
  /** 发送消息 */
  sendMessage(platform: string, chatId: string, message: string): Promise<void>;
  /** 获取用户信息 */
  getUser?(userId: string): Promise<unknown>;
}

// ============================================================================
// Plugin Factory - 插件工厂
// ============================================================================

/**
 * 插件工厂函数类型
 */
export type PluginFactory = (context: PluginContext) => Plugin | Promise<Plugin>;

/**
 * 插件模块导出格式
 */
export interface PluginModule {
  default: PluginFactory;
}

// ============================================================================
// Plugin Manager - 插件管理器配置
// ============================================================================

/**
 * 插件管理器配置
 */
export interface PluginManagerConfig {
  /** 插件目录路径 */
  pluginsDir: string;
  /** 是否自动发现插件 */
  autoDiscover?: boolean;
  /** 是否自动启用已安装插件 */
  autoEnable?: boolean;
  /** 插件加载超时时间（毫秒） */
  loadTimeout?: number;
  /** 是否允许热重载 */
  hotReload?: boolean;
}

/**
 * 插件管理器事件
 */
export interface PluginManagerEvents {
  "plugin:discovered": (plugin: Plugin) => void;
  "plugin:installed": (plugin: Plugin) => void;
  "plugin:uninstalled": (plugin: Plugin) => void;
  "plugin:enabled": (plugin: Plugin) => void;
  "plugin:disabled": (plugin: Plugin) => void;
  "plugin:error": (plugin: Plugin, error: Error) => void;
  "plugin:config-changed": (plugin: Plugin, config: Record<string, unknown>) => void;
}

/**
 * 插件加载结果
 */
export interface PluginLoadResult {
  success: boolean;
  plugin?: Plugin;
  error?: Error;
  warnings?: string[];
}

/**
 * 插件验证结果
 */
export interface PluginValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * 插件统计信息
 */
export interface PluginStats {
  total: number;
  installed: number;
  enabled: number;
  disabled: number;
  error: number;
}
