/**
 * SACODE Plugin System - Plugin Manager
 *
 * 插件管理器：完整的生命周期管理和插件协调
 */

// 导出类型
export type {
  PluginManifest,
  PluginConfig,
  PluginConfigField,
  Plugin,
  PluginStatus,
  PluginLifecycle,
  PluginCapabilities,
  PluginTool,
  PluginCommand,
  PluginMessageHandler,
  PluginMessage,
  PluginMessageResult,
  PluginScheduledTask,
  PluginSkill,
  PluginContext,
  PluginStorage,
  Logger,
  ConfigManager,
  AdapterManager,
  PluginFactory,
  PluginModule,
  PluginManagerConfig,
  PluginManagerEvents,
  PluginLoadResult,
  PluginValidationResult,
  PluginStats,
} from "./types";

import * as fs from "fs";
import * as path from "path";
import { EventEmitter } from "events";
import type { PrismaClient } from "@prisma/client";
import type { TaskScheduler } from "../scheduler";
import type { SACODEClient } from "../client";
import type { ToolBridge } from "../tools/bridge";
import { PluginLoader, createPluginLoader } from "./loader";
import type {
  Plugin,
  PluginManifest,
  PluginContext,
  PluginManagerConfig,
  PluginManagerEvents,
  PluginStats,
  PluginStorage,
  Logger,
  ConfigManager,
  AdapterManager,
  PluginTool,
  PluginCommand,
  PluginMessageHandler,
} from "./types";

/**
 * 插件专用存储实现
 */
class PluginStorageImpl implements PluginStorage {
  private data: Map<string, unknown> = new Map();

  constructor(_pluginName: string) {
    // pluginName 用于日志标识，暂未使用
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async clear(): Promise<void> {
    this.data.clear();
  }

  async getAll(): Promise<Record<string, unknown>> {
    return Object.fromEntries(this.data);
  }
}

/**
 * 配置管理器实现
 */
class ConfigManagerImpl implements ConfigManager {
  private config: Map<string, unknown> = new Map();

  get<T = unknown>(key: string): T | undefined;
  get<T = unknown>(key: string, defaultValue: T): T;
  get<T = unknown>(key: string, defaultValue?: T): T | undefined {
    if (this.config.has(key)) {
      return this.config.get(key) as T;
    }
    return defaultValue;
  }

  set(key: string, value: unknown): void {
    this.config.set(key, value);
  }

  delete(key: string): void {
    this.config.delete(key);
  }

  has(key: string): boolean {
    return this.config.has(key);
  }

  getAll(): Record<string, unknown> {
    return Object.fromEntries(this.config);
  }

  loadFromObject(obj: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(obj)) {
      this.config.set(key, value);
    }
  }
}

/**
 * 插件上下文实现
 */
class PluginContextImpl implements PluginContext {
  readonly pluginName: string;
  readonly logger: Logger;
  readonly storage: PluginStorage;
  readonly config: ConfigManagerImpl;
  readonly adapters: AdapterManager;
  readonly scheduler: TaskScheduler;
  readonly database: PrismaClient;
  readonly client: SACODEClient;

  private tools: Map<string, PluginTool> = new Map();
  private commands: Map<string, PluginCommand> = new Map();
  private messageHandlers: PluginMessageHandler[] = [];

  constructor(
    pluginName: string,
    adapters: AdapterManager,
    scheduler: TaskScheduler,
    database: PrismaClient,
    client: SACODEClient,
    pluginConfig: Record<string, unknown>
  ) {
    this.pluginName = pluginName;
    this.adapters = adapters;
    this.scheduler = scheduler;
    this.database = database;
    this.client = client;
    this.logger = this.createLogger(pluginName);
    this.storage = new PluginStorageImpl(pluginName);
    this.config = new ConfigManagerImpl();
    this.config.loadFromObject(pluginConfig);
  }

  private createLogger(name: string): Logger {
    const prefix = `[Plugin:${name}]`;
    return {
      debug: (msg: string, ...args: unknown[]) => console.debug(`${prefix} ${msg}`, ...args),
      info: (msg: string, ...args: unknown[]) => console.info(`${prefix} ${msg}`, ...args),
      warn: (msg: string, ...args: unknown[]) => console.warn(`${prefix} ${msg}`, ...args),
      error: (msg: string, ...args: unknown[]) => console.error(`${prefix} ${msg}`, ...args),
    };
  }

  registerTool(tool: PluginTool): void {
    if (this.tools.has(tool.name)) {
      this.logger.warn(`Tool "${tool.name}" already registered, overwriting`);
    }
    this.tools.set(tool.name, tool);
  }

  registerCommand(command: PluginCommand): void {
    if (this.commands.has(command.name)) {
      this.logger.warn(`Command "${command.name}" already registered, overwriting`);
    }
    this.commands.set(command.name, command);
  }

  registerMessageHandler(handler: PluginMessageHandler): void {
    this.messageHandlers.push(handler);
  }

  async sendMessage(platform: string, chatId: string, message: string): Promise<void> {
    return this.adapters.sendMessage(platform, chatId, message);
  }

  // 内部方法：获取注册的能力
  getTools(): PluginTool[] {
    return Array.from(this.tools.values());
  }

  getCommands(): PluginCommand[] {
    return Array.from(this.commands.values());
  }

  getMessageHandlers(): PluginMessageHandler[] {
    return [...this.messageHandlers];
  }
}

/**
 * 插件管理器事件类型映射
 */
type EventHandler<K extends keyof PluginManagerEvents> = PluginManagerEvents[K];

/**
 * 插件管理器
 */
export class PluginManager extends EventEmitter {
  private plugins: Map<string, Plugin> = new Map();
  private contexts: Map<string, PluginContextImpl> = new Map();
  private loader: PluginLoader;
  private config: Required<PluginManagerConfig>;

  // 依赖注入
  private adapters: AdapterManager;
  private scheduler: TaskScheduler;
  private database: PrismaClient;
  private client: SACODEClient;
  private toolBridge: ToolBridge | null;

  // 插件注册的能力追踪（用于注销）
  private registeredToolNames: Map<string, string[]> = new Map();

  constructor(
    config: PluginManagerConfig,
    dependencies: {
      adapters: AdapterManager;
      scheduler: TaskScheduler;
      database: PrismaClient;
      client: SACODEClient;
      toolBridge?: ToolBridge;
    }
  ) {
    super();

    this.config = {
      pluginsDir: config.pluginsDir,
      autoDiscover: config.autoDiscover ?? true,
      autoEnable: config.autoEnable ?? false,
      loadTimeout: config.loadTimeout ?? 30000,
      hotReload: config.hotReload ?? false,
    };

    this.adapters = dependencies.adapters;
    this.scheduler = dependencies.scheduler;
    this.database = dependencies.database;
    this.client = dependencies.client;
    this.toolBridge = dependencies.toolBridge ?? null;

    this.loader = createPluginLoader({ loadTimeout: this.config.loadTimeout });
  }

  /**
   * 初始化：发现并加载所有插件
   */
  async initialize(): Promise<void> {
    // 确保插件目录存在
    if (!fs.existsSync(this.config.pluginsDir)) {
      await fs.promises.mkdir(this.config.pluginsDir, { recursive: true });
      return;
    }

    if (this.config.autoDiscover) {
      await this.discover();
    }
  }

  /**
   * 发现插件目录中的所有插件
   */
  async discover(): Promise<Plugin[]> {
    const discovered: Plugin[] = [];

    const entries = await fs.promises.readdir(this.config.pluginsDir, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const pluginPath = path.join(this.config.pluginsDir, entry.name);

      // 检查是否是有效的插件目录
      const isValid = await this.loader.isPluginDirectory(pluginPath);
      if (!isValid) continue;

      try {
        // 获取插件信息
        const info = await this.loader.getPluginInfo(pluginPath);
        if (!info) continue;

        // 创建占位插件对象（不加载）
        const placeholderPlugin: Plugin = {
          name: info.manifest.name,
          version: info.manifest.version,
          manifest: info.manifest,
          status: "discovered",
          path: pluginPath,
          config: info.manifest.defaultConfig || {},
        };

        this.plugins.set(info.manifest.name, placeholderPlugin);
        discovered.push(placeholderPlugin);
        this.emit("plugin:discovered", placeholderPlugin);
      } catch (e) {
        console.error(`Failed to discover plugin at ${pluginPath}:`, e);
      }
    }

    return discovered;
  }

  /**
   * 安装插件
   *
   * 支持三种安装源：
   * - 无 source: 从本地插件目录安装
   * - git+https://... : 从 Git 仓库克隆安装
   * - npm://<package> 或 <@scope/package>: 从 npm 注册表安装
   * - /path/to/plugin: 从本地路径安装
   */
  async install(name: string, source?: string): Promise<Plugin> {
    const existing = this.plugins.get(name);

    if (existing && existing.status !== "discovered") {
      throw new Error(`Plugin "${name}" is already installed`);
    }

    // 从外部源安装
    if (source) {
      await this.installFromSource(name, source);
    }

    const pluginPath = path.join(this.config.pluginsDir, name);
    if (!fs.existsSync(pluginPath)) {
      throw new Error(`Plugin not found: ${name}`);
    }

    // 创建上下文
    const manifest = existing?.manifest || (await this.loader.loadManifest(pluginPath));
    const config = existing?.config || manifest.defaultConfig || {};
    const context = this.createContext(name, config);
    this.contexts.set(name, context);

    // 加载插件
    const result = await this.loader.load(pluginPath, context);

    if (!result.success || !result.plugin) {
      const errorPlugin: Plugin = {
        name,
        version: existing?.version || "0.0.0",
        manifest: existing?.manifest || ({} as PluginManifest),
        status: "error",
        path: pluginPath,
        config,
        ...(result.error ? { error: result.error } : {}),
      };
      this.plugins.set(name, errorPlugin);
      if (result.error) {
        this.emit("plugin:error", errorPlugin, result.error);
      }
      throw result.error;
    }

    const plugin = result.plugin;
    const finalPlugin: Plugin = {
      ...plugin,
      status: "installed",
    };

    this.plugins.set(name, finalPlugin);

    // 执行安装钩子
    if (plugin.install) {
      try {
        await plugin.install(context);
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        this.emit("plugin:error", finalPlugin, error);
        throw error;
      }
    }

    this.emit("plugin:installed", finalPlugin);

    // 自动启用
    if (this.config.autoEnable) {
      await this.enable(name);
    }

    return finalPlugin;
  }

  /**
   * 卸载插件
   */
  async uninstall(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      throw new Error(`Plugin not found: ${name}`);
    }

    if (plugin.status === "enabled") {
      await this.disable(name);
    }

    const context = this.contexts.get(name);

    // 执行卸载钩子
    if (plugin.uninstall && context) {
      await plugin.uninstall(context);
    }

    // 清理
    this.plugins.delete(name);
    this.contexts.delete(name);

    this.emit("plugin:uninstalled", plugin);
  }

  /**
   * 启用插件
   */
  async enable(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      throw new Error(`Plugin not found: ${name}`);
    }

    if (plugin.status === "enabled") {
      return;
    }

    if (plugin.status === "discovered") {
      await this.install(name);
      return this.enable(name);
    }

    const context = this.contexts.get(name);

    // 检查依赖
    await this.checkDependencies(plugin.manifest);

    // 执行启用钩子
    if (plugin.enable && context) {
      await plugin.enable(context);
    }

    // 注册能力
    if (context) {
      this.registerCapabilities(plugin, context);
    }

    const enabledPlugin: Plugin = {
      ...plugin,
      status: "enabled",
    };

    this.plugins.set(name, enabledPlugin);
    this.emit("plugin:enabled", enabledPlugin);
  }

  /**
   * 禁用插件
   */
  async disable(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      throw new Error(`Plugin not found: ${name}`);
    }

    if (plugin.status !== "enabled") {
      return;
    }

    const context = this.contexts.get(name);

    // 执行禁用钩子
    if (plugin.disable && context) {
      await plugin.disable(context);
    }

    // 注销能力
    if (context) {
      this.unregisterCapabilities(plugin, context);
    }

    const disabledPlugin: Plugin = {
      ...plugin,
      status: "disabled",
    };

    this.plugins.set(name, disabledPlugin);
    this.emit("plugin:disabled", disabledPlugin);
  }

  /**
   * 获取插件
   */
  get(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * 获取所有插件
   */
  getAll(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * 获取已启用的插件
   */
  getEnabled(): Plugin[] {
    return this.getAll().filter((p) => p.status === "enabled");
  }

  /**
   * 获取插件配置
   */
  getConfig(name: string): Record<string, unknown> {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      throw new Error(`Plugin not found: ${name}`);
    }
    return plugin.config;
  }

  /**
   * 设置插件配置
   */
  async setConfig(name: string, config: Record<string, unknown>): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      throw new Error(`Plugin not found: ${name}`);
    }

    const oldConfig = plugin.config;
    const newPlugin: Plugin = {
      ...plugin,
      config: { ...oldConfig, ...config },
    };

    this.plugins.set(name, newPlugin);

    // 更新上下文配置
    const context = this.contexts.get(name);
    if (context) {
      context.config.loadFromObject(newPlugin.config);
    }

    // 触发配置变更钩子
    if (plugin.onConfigChange) {
      await plugin.onConfigChange(newPlugin.config, oldConfig);
    }

    this.emit("plugin:config-changed", newPlugin, newPlugin.config);
  }

  /**
   * 获取统计信息
   */
  getStats(): PluginStats {
    const plugins = this.getAll();
    return {
      total: plugins.length,
      installed: plugins.filter((p) => p.status === "installed").length,
      enabled: plugins.filter((p) => p.status === "enabled").length,
      disabled: plugins.filter((p) => p.status === "disabled").length,
      error: plugins.filter((p) => p.status === "error").length,
    };
  }

  /**
   * 重新加载插件
   */
  async reload(name: string): Promise<Plugin> {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      throw new Error(`Plugin not found: ${name}`);
    }

    const wasEnabled = plugin.status === "enabled";

    if (wasEnabled) {
      await this.disable(name);
    }

    // 重新加载（ESM import 自带缓存隔离，无需手动清除）
    const context = this.contexts.get(name);
    if (!context) {
      throw new Error(`Plugin context not found: ${name}`);
    }

    const result = await this.loader.load(plugin.path, context);
    if (!result.success || !result.plugin) {
      throw result.error;
    }

    const newPlugin: Plugin = {
      ...result.plugin,
      status: wasEnabled ? "disabled" : plugin.status,
    };

    this.plugins.set(name, newPlugin);

    if (wasEnabled) {
      await this.enable(name);
    }

    return this.plugins.get(name)!;
  }

  // =========================================================================
  // 内部方法
  // =========================================================================

  private createContext(name: string, config: Record<string, unknown>): PluginContextImpl {
    return new PluginContextImpl(
      name,
      this.adapters,
      this.scheduler,
      this.database,
      this.client,
      config
    );
  }

  private async checkDependencies(manifest: PluginManifest): Promise<void> {
    if (!manifest.dependencies) return;

    for (const [depName, depVersion] of Object.entries(manifest.dependencies)) {
      const dep = this.plugins.get(depName);
      if (!dep) {
        throw new Error(`Missing dependency: ${depName}@${depVersion}`);
      }
      if (dep.status !== "enabled") {
        throw new Error(`Dependency not enabled: ${depName}`);
      }
    }
  }

  /**
   * 从外部源安装插件
   *
   * 支持的 source 格式：
   * - git+https://github.com/user/plugin.git  → git clone
   * - git+https://github.com/user/plugin.git#v1.0  → git clone 指定分支/标签
   * - npm://@scope/plugin-name  → npm install
   * - @scope/plugin-name  → npm install (简写)
   * - /absolute/path/to/plugin  → 本地路径复制
   * - ./relative/path/to/plugin  → 本地路径复制
   */
  private async installFromSource(name: string, source: string): Promise<void> {
    const targetDir = path.join(this.config.pluginsDir, name);

    // 确保插件目录存在
    if (!fs.existsSync(this.config.pluginsDir)) {
      await fs.promises.mkdir(this.config.pluginsDir, { recursive: true });
    }

    if (fs.existsSync(targetDir)) {
      throw new Error(`Plugin directory already exists: ${targetDir}`);
    }

    try {
      if (source.startsWith("git+") || source.endsWith(".git")) {
        await this.installFromGit(source, targetDir);
      } else if (source.startsWith("npm://") || source.startsWith("@") || !source.includes("/") && !source.includes("\\")) {
        const npmPackage = source.startsWith("npm://") ? source.slice(6) : source;
        await this.installFromNpm(npmPackage, targetDir);
      } else {
        await this.installFromLocalPath(source, targetDir);
      }
    } catch (e) {
      // 安装失败时清理
      if (fs.existsSync(targetDir)) {
        await fs.promises.rm(targetDir, { recursive: true, force: true });
      }
      throw e;
    }
  }

  /**
   * 从 Git 仓库安装插件
   */
  private async installFromGit(gitUrl: string, targetDir: string): Promise<void> {
    const url = gitUrl.startsWith("git+") ? gitUrl.slice(4) : gitUrl;

    const proc = Bun.spawn({
      cmd: ["git", "clone", "--depth", "1", url, targetDir],
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`Git clone failed (exit ${exitCode}): ${stderr.trim()}`);
    }

    // 验证克隆的目录是否是有效插件
    const manifestPath = path.join(targetDir, "plugin.json");
    if (!fs.existsSync(manifestPath)) {
      throw new Error("Cloned repository does not contain a plugin.json manifest");
    }
  }

  /**
   * 从 npm 注册表安装插件
   */
  private async installFromNpm(npmPackage: string, targetDir: string): Promise<void> {
    const tempDir = path.join(this.config.pluginsDir, `.tmp-${Date.now()}`);

    try {
      await fs.promises.mkdir(tempDir, { recursive: true });

      // 使用 bun install 下载包
      const proc = Bun.spawn({
        cmd: ["bun", "add", npmPackage, "--cwd", tempDir],
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text();
        throw new Error(`npm install failed (exit ${exitCode}): ${stderr.trim()}`);
      }

      // 查找包的实际路径
      const pkgName = npmPackage.startsWith("@") ? npmPackage.split("/").slice(0, 2).join("/") : npmPackage.split("@")[0]!;
      const pkgPath = path.join(tempDir, "node_modules", pkgName);

      if (!fs.existsSync(pkgPath)) {
        throw new Error(`Package ${npmPackage} not found after install`);
      }

      // 验证是否包含 plugin.json
      const manifestPath = path.join(pkgPath, "plugin.json");
      if (!fs.existsSync(manifestPath)) {
        throw new Error(`Package ${npmPackage} does not contain a plugin.json manifest`);
      }

      // 复制到插件目录
      await fs.promises.cp(pkgPath, targetDir, { recursive: true });
    } finally {
      // 清理临时目录
      if (fs.existsSync(tempDir)) {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      }
    }
  }

  /**
   * 从本地路径安装插件
   */
  private async installFromLocalPath(localPath: string, targetDir: string): Promise<void> {
    const resolvedPath = path.resolve(localPath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Local plugin path not found: ${resolvedPath}`);
    }

    const manifestPath = path.join(resolvedPath, "plugin.json");
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Local plugin does not contain a plugin.json manifest: ${resolvedPath}`);
    }

    // 复制到插件目录
    await fs.promises.cp(resolvedPath, targetDir, { recursive: true });
  }

  private registerCapabilities(plugin: Plugin, context: PluginContextImpl): void {
    const registeredNames: string[] = [];

    // 注册工具到 ToolBridge
    const tools = context.getTools();
    for (const tool of tools) {
      if (this.toolBridge) {
        const params = tool.parameters as Record<string, unknown>;
        const properties: Record<string, import("../tools/types").ToolParameterSchema> = {};
        for (const [key, value] of Object.entries(params)) {
          properties[key] = typeof value === "object" && value !== null && "type" in value
            ? value as import("../tools/types").ToolParameterSchema
            : { type: "string", description: String(value) };
        }
        this.toolBridge.registerTool({
          name: `plugin_${plugin.name}_${tool.name}`,
          description: tool.description,
          parameters: {
            type: "object",
            properties,
          },
          source: "custom",
          handler: async (args: Record<string, unknown>) => {
            const result = await tool.execute(args, context);
            return typeof result === "string" ? result : JSON.stringify(result, null, 2);
          },
        });
        registeredNames.push(`plugin_${plugin.name}_${tool.name}`);
      }
    }

    // 注册命令（通过事件系统广播，由 CLI/API 层监听）
    const commands = context.getCommands();
    for (const cmd of commands) {
      this.emit("plugin:enabled" as keyof PluginManagerEvents, {
        ...plugin,
        _registeredCommand: cmd,
      } as unknown as Plugin);
      registeredNames.push(`cmd:${cmd.name}`);
    }

    // 注册消息处理器
    const handlers = context.getMessageHandlers();
    for (const handler of handlers) {
      this.emit("plugin:enabled" as keyof PluginManagerEvents, {
        ...plugin,
        _registeredHandler: handler,
      } as unknown as Plugin);
      registeredNames.push(`handler:${handler.platform || "global"}`);
    }

    this.registeredToolNames.set(plugin.name, registeredNames);
  }

  private unregisterCapabilities(plugin: Plugin, context: PluginContextImpl): void {
    const registeredNames = this.registeredToolNames.get(plugin.name) ?? [];

    // 从 ToolBridge 注销工具
    for (const regName of registeredNames) {
      if (regName.startsWith("plugin_") && this.toolBridge) {
        this.toolBridge.unregisterTool(regName);
      }
    }

    this.registeredToolNames.delete(plugin.name);
  }

  // 事件方法重载
  override on<K extends keyof PluginManagerEvents>(
    event: K,
    listener: EventHandler<K>
  ): this {
    return super.on(event, listener);
  }

  override once<K extends keyof PluginManagerEvents>(
    event: K,
    listener: EventHandler<K>
  ): this {
    return super.once(event, listener);
  }

  override emit<K extends keyof PluginManagerEvents>(
    event: K,
    ...args: Parameters<EventHandler<K>>
  ): boolean {
    return super.emit(event, ...args);
  }
}

/**
 * 创建插件管理器
 */
export function createPluginManager(
  config: PluginManagerConfig,
  dependencies: {
    adapters: AdapterManager;
    scheduler: TaskScheduler;
    database: PrismaClient;
    client: SACODEClient;
    toolBridge?: ToolBridge;
  }
): PluginManager {
  return new PluginManager(config, dependencies);
}

// 重导出 loader
export { PluginLoader, createPluginLoader } from "./loader";
