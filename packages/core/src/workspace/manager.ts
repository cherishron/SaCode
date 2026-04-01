/**
 * Workspace Manager - 工作空间管理器
 */

import fs from "fs/promises";
import path from "path";
import type {
  WorkspaceConfig,
  WorkspaceContext,
  WorkspaceManagerOptions,
  WorkspaceEvent,
  ContainerExecResult,
  SandboxConfig,
} from "./types.js";
import { TemplateRegistry, createTemplateRegistry } from "./template.js";
import { MemoryLoader, createMemoryLoader } from "./memory.js";

const DEFAULT_CONFIG: WorkspaceConfig = {
  rootPath: "",
  language: "zh-CN",
  defaultModel: "minimax-m2.5",
  thinking: false,
};

const WORKSPACE_FILES = [
  { name: "SOUL.md", key: "soul" as const, required: true },
  { name: "USER.md", key: "user" as const, required: false },
  { name: "AGENTS.md", key: "agents" as const, required: true },
  { name: "TOOLS.md", key: "tools" as const, required: false },
  { name: "MEMORY.md", key: "memory" as const, required: false },
  { name: "IDENTITY.md", key: "identity" as const, required: false },
  { name: "PROJECT.md", key: "project" as const, required: false },
  { name: "CALENDAR.md", key: "calendar" as const, required: false },
];

/**
 * 工作空间管理器
 */
export class WorkspaceManager {
  private options: WorkspaceManagerOptions;
  private config: WorkspaceConfig;
  private context: WorkspaceContext = {};
  private templateRegistry: TemplateRegistry;
  private memoryLoader: MemoryLoader;
  private eventListeners: Map<string, Set<(event: WorkspaceEvent) => void>> = new Map();

  constructor(options: WorkspaceManagerOptions) {
    this.options = options;
    this.config = { ...DEFAULT_CONFIG, rootPath: options.rootPath };
    this.templateRegistry = createTemplateRegistry();
    this.memoryLoader = createMemoryLoader({ workspacePath: options.rootPath });
  }

  /**
   * 获取内存加载器
   */
  getMemoryLoader(): MemoryLoader {
    return this.memoryLoader;
  }

  /**
   * 初始化工作空间
   */
  async initialize(): Promise<void> {
    try {
      // 加载配置
      await this.loadConfig();

      // 加载工作空间文件
      await this.loadFiles();

      this.emit({ type: "loaded", timestamp: Date.now() });
    } catch (error) {
      this.emit({
        type: "error",
        timestamp: Date.now(),
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  }

  /**
   * 加载配置文件
   */
  async loadConfig(): Promise<void> {
    const configPath = path.join(
      this.options.rootPath,
      this.options.configFile || ".saclaw",
      "settings.json"
    );

    try {
      const data = await fs.readFile(configPath, "utf-8");
      const loaded = JSON.parse(data);
      this.config = { ...this.config, ...loaded };
    } catch {
      // 配置文件不存在，使用默认配置
    }
  }

  /**
   * 保存配置文件
   */
  async saveConfig(): Promise<void> {
    const configDir = path.join(
      this.options.rootPath,
      this.options.configFile || ".saclaw"
    );

    await fs.mkdir(configDir, { recursive: true });

    const configPath = path.join(configDir, "settings.json");
    await fs.writeFile(configPath, JSON.stringify(this.config, null, 2), "utf-8");
  }

  /**
   * 加载工作空间文件
   */
  async loadFiles(): Promise<void> {
    for (const file of WORKSPACE_FILES) {
      const filePath = path.join(this.options.rootPath, file.name);

      try {
        const content = await fs.readFile(filePath, "utf-8");
        this.context[file.key] = content;
      } catch {
        if (file.required) {
          throw new Error(`Required workspace file not found: ${file.name}`);
        }
      }
    }
  }

  /**
   * 获取工作空间上下文
   */
  getContext(): WorkspaceContext {
    return { ...this.context };
  }

  /**
   * 获取特定文件内容
   */
  async getFile(name: string): Promise<string | null> {
    const filePath = path.join(this.options.rootPath, name);

    try {
      return await fs.readFile(filePath, "utf-8");
    } catch {
      return null;
    }
  }

  /**
   * 更新文件内容
   */
  async updateFile(name: string, content: string): Promise<void> {
    const filePath = path.join(this.options.rootPath, name);

    // 确保目录存在
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    await fs.writeFile(filePath, content, "utf-8");

    // 更新内存中的上下文
    const fileInfo = WORKSPACE_FILES.find((f) => f.name === name);
    if (fileInfo) {
      this.context[fileInfo.key] = content;
    }

    this.emit({ type: "updated", timestamp: Date.now(), data: { file: name } });
  }

  /**
   * 获取配置
   */
  getConfig(): WorkspaceConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  async updateConfig(updates: Partial<WorkspaceConfig>): Promise<void> {
    this.config = { ...this.config, ...updates };
    await this.saveConfig();
  }

  /**
   * 从模板创建工作空间
   */
  async createFromTemplate(templateId: string): Promise<void> {
    const template = this.templateRegistry.get(templateId);

    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    // 创建目录结构
    await fs.mkdir(this.options.rootPath, { recursive: true });
    await fs.mkdir(
      path.join(this.options.rootPath, this.options.configFile || ".saclaw"),
      { recursive: true }
    );

    // 创建模板文件
    for (const file of template.files) {
      const filePath = path.join(this.options.rootPath, file.name);
      await fs.writeFile(filePath, file.content, "utf-8");
    }

    // 保存配置
    this.config.template = templateId;
    await this.saveConfig();

    // 重新加载
    await this.initialize();
  }

  /**
   * 获取模板列表
   */
  listTemplates() {
    return this.templateRegistry.list();
  }

  /**
   * 获取沙箱配置
   */
  getSandboxConfig(): SandboxConfig | undefined {
    return this.config.sandbox;
  }

  /**
   * 更新沙箱配置
   */
  async updateSandboxConfig(config: Partial<SandboxConfig>): Promise<void> {
    this.config.sandbox = {
      ...this.config.sandbox,
      ...config,
      enabled: config.enabled ?? this.config.sandbox?.enabled ?? false,
      mode: config.mode ?? this.config.sandbox?.mode ?? "none",
    };
    await this.saveConfig();
  }

  /**
   * 在沙箱中执行命令 (如果启用了沙箱)
   */
  async execInSandbox(
    command: string[],
    options?: {
      env?: Record<string, string>;
      cwd?: string;
      timeout?: number;
    }
  ): Promise<ContainerExecResult | null> {
    const sandbox = this.config.sandbox;
    const execOptions = options ?? {};

    // 如果未启用沙箱，返回null表示直接执行
    if (!sandbox?.enabled || sandbox.mode === "none") {
      return null;
    }

    // TODO: 集成 @saclaw/container
    // 这里需要导入ContainerManager并执行命令
    // 使用execOptions来配置容器执行参数
    // 暂时返回null，后续完成container集成后再实现

    this.emit({
      type: "updated",
      timestamp: Date.now(),
      data: { action: "execInSandbox", command, options: execOptions },
    });

    return null;
  }

  /**
   * 事件监听
   */
  on(eventType: string, listener: (event: WorkspaceEvent) => void): void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set());
    }
    this.eventListeners.get(eventType)!.add(listener);
  }

  /**
   * 移除事件监听
   */
  off(eventType: string, listener: (event: WorkspaceEvent) => void): void {
    this.eventListeners.get(eventType)?.delete(listener);
  }

  private emit(event: WorkspaceEvent): void {
    this.eventListeners.get(event.type)?.forEach((listener) => listener(event));
    this.eventListeners.get("*")?.forEach((listener) => listener(event));
  }
}

/**
 * 创建工作空间管理器
 */
export function createWorkspaceManager(
  options: WorkspaceManagerOptions
): WorkspaceManager {
  return new WorkspaceManager(options);
}
