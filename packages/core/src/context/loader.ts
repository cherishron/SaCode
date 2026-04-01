/**
 * 多层级上下文加载器
 *
 * 支持用户级、项目级、子目录级的上下文加载和合并
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import EventEmitter from "eventemitter3";

/**
 * 上下文层级
 */
export type ContextLevel = "user" | "project" | "subdirectory";

/**
 * 上下文文件信息
 */
export interface ContextFile {
  /** 层级 */
  level: ContextLevel;
  /** 文件路径 */
  path: string;
  /** 文件内容 */
  content: string;
  /** 加载时间 */
  loadedAt: Date;
  /** 是否为主要文件 */
  isPrimary: boolean;
}

/**
 * 上下文加载结果
 */
export interface ContextLoadResult {
  /** 所有加载的文件 */
  files: ContextFile[];
  /** 合并后的上下文 */
  mergedContext: string;
  /** 用户级上下文 */
  userContext?: string;
  /** 项目级上下文 */
  projectContext?: string;
  /** 子目录级上下文列表 */
  subdirectoryContexts: Map<string, string>;
}

/**
 * 上下文加载器配置
 */
export interface ContextLoaderConfig {
  /** 用户级目录 */
  userDir: string;
  /** 项目级目录名 */
  projectDirName: string;
  /** 上下文文件名 */
  contextFileName: string;
  /** 是否启用子目录懒加载 */
  enableLazyLoading: boolean;
  /** 是否合并所有层级 */
  mergeLevels: boolean;
  /** 层级分隔符 */
  levelSeparator: string;
}

/**
 * 默认配置
 */
export const DEFAULT_CONTEXT_LOADER_CONFIG: ContextLoaderConfig = {
  userDir: path.join(os.homedir(), ".saclaw"),
  projectDirName: ".saclaw",
  contextFileName: "SKILL.md",
  enableLazyLoading: true,
  mergeLevels: true,
  levelSeparator: "\n\n---\n\n",
};

/**
 * 上下文加载器事件
 */
export interface ContextLoaderEvents {
  /** 上下文加载完成 */
  loaded: [result: ContextLoadResult];
  /** 子目录上下文加载 */
  subdirectoryLoaded: [subdir: string, content: string];
  /** 上下文变更 */
  changed: [level: ContextLevel, path: string];
  /** 错误 */
  error: [error: Error];
}

/**
 * 多层级上下文加载器
 *
 * @example
 * ```typescript
 * const loader = new ContextLoader({
 *   enableLazyLoading: true,
 * });
 *
 * // 加载所有层级
 * const result = await loader.loadAll();
 *
 * // 懒加载子目录上下文
 * const subdirContext = await loader.loadSubdirectory("./packages/core");
 * ```
 */
export class ContextLoader extends EventEmitter<ContextLoaderEvents> {
  private config: ContextLoaderConfig;
  private projectRoot: string;
  private loadedSubdirectories: Set<string> = new Set();
  private cachedContext: ContextLoadResult | null = null;
  private fileWatchers: Map<string, fs.FSWatcher> = new Map();

  constructor(
    projectRoot: string,
    config: Partial<ContextLoaderConfig> = {}
  ) {
    super();
    this.projectRoot = projectRoot;
    this.config = { ...DEFAULT_CONTEXT_LOADER_CONFIG, ...config };
  }

  /**
   * 加载所有层级上下文
   */
  async loadAll(): Promise<ContextLoadResult> {
    const files: ContextFile[] = [];
    const subdirectoryContexts = new Map<string, string>();

    // 1. 加载用户级上下文
    const userContext = await this.loadUserContext();
    if (userContext) {
      files.push(userContext);
    }

    // 2. 加载项目级上下文
    const projectContext = await this.loadProjectContext();
    if (projectContext) {
      files.push(projectContext);
    }

    // 3. 如果禁用懒加载，预加载所有子目录
    if (!this.config.enableLazyLoading) {
      await this.loadAllSubdirectories(files, subdirectoryContexts);
    }

    // 合并上下文
    const mergedContext = this.mergeContexts(files);

    const result: ContextLoadResult = {
      files,
      mergedContext,
      userContext: userContext?.content,
      projectContext: projectContext?.content,
      subdirectoryContexts,
    };

    this.cachedContext = result;
    this.emit("loaded", result);

    return result;
  }

  /**
   * 加载用户级上下文
   *
   * 从 ~/.saclaw/SKILL.md 加载
   */
  async loadUserContext(): Promise<ContextFile | null> {
    const userContextPath = path.join(
      this.config.userDir,
      this.config.contextFileName
    );

    return this.loadFile(userContextPath, "user", true);
  }

  /**
   * 加载项目级上下文
   *
   * 从项目根目录的 .saclaw/SKILL.md 加载
   */
  async loadProjectContext(): Promise<ContextFile | null> {
    const projectContextPath = path.join(
      this.projectRoot,
      this.config.projectDirName,
      this.config.contextFileName
    );

    return this.loadFile(projectContextPath, "project", true);
  }

  /**
   * 懒加载子目录上下文
   *
   * @param subdir 子目录路径（相对于项目根目录）
   */
  async loadSubdirectory(subdir: string): Promise<ContextFile | null> {
    // 规范化路径
    const normalizedSubdir = path.normalize(subdir);
    const subdirPath = path.join(
      this.projectRoot,
      normalizedSubdir,
      this.config.projectDirName,
      this.config.contextFileName
    );

    // 检查是否已加载
    if (this.loadedSubdirectories.has(normalizedSubdir)) {
      return null;
    }

    const file = await this.loadFile(subdirPath, "subdirectory", false);

    if (file) {
      this.loadedSubdirectories.add(normalizedSubdir);
      this.emit("subdirectoryLoaded", normalizedSubdir, file.content);

      // 更新缓存
      if (this.cachedContext) {
        this.cachedContext.files.push(file);
        this.cachedContext.subdirectoryContexts.set(normalizedSubdir, file.content);
        this.cachedContext.mergedContext = this.mergeContexts(
          this.cachedContext.files
        );
      }
    }

    return file;
  }

  /**
   * 预加载所有子目录
   */
  private async loadAllSubdirectories(
    files: ContextFile[],
    contexts: Map<string, string>
  ): Promise<void> {
    const scanDir = async (dir: string, relativePath: string = "") => {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

        const subdirPath = path.join(dir, entry.name);
        const subdirRelative = relativePath
          ? path.join(relativePath, entry.name)
          : entry.name;

        // 检查是否有上下文文件
        const contextPath = path.join(
          subdirPath,
          this.config.projectDirName,
          this.config.contextFileName
        );

        if (fs.existsSync(contextPath)) {
          const file = await this.loadFile(contextPath, "subdirectory", false);
          if (file) {
            files.push(file);
            contexts.set(subdirRelative, file.content);
            this.loadedSubdirectories.add(subdirRelative);
          }
        }

        // 递归扫描
        await scanDir(subdirPath, subdirRelative);
      }
    };

    try {
      await scanDir(this.projectRoot);
    } catch {
      // 忽略扫描错误
    }
  }

  /**
   * 加载单个文件
   */
  private async loadFile(
    filePath: string,
    level: ContextLevel,
    isPrimary: boolean
  ): Promise<ContextFile | null> {
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const content = await fs.promises.readFile(filePath, "utf-8");

      return {
        level,
        path: filePath,
        content: content.trim(),
        loadedAt: new Date(),
        isPrimary,
      };
    } catch (error) {
      this.emit(
        "error",
        new Error(`Failed to load context file ${filePath}: ${error}`)
      );
      return null;
    }
  }

  /**
   * 合并多个上下文
   */
  private mergeContexts(files: ContextFile[]): string {
    if (!this.config.mergeLevels) {
      return files.map((f) => f.content).join(this.config.levelSeparator);
    }

    // 按层级分组
    const byLevel: Record<ContextLevel, string[]> = {
      user: [],
      project: [],
      subdirectory: [],
    };

    for (const file of files) {
      byLevel[file.level].push(file.content);
    }

    // 按优先级合并：用户级 < 项目级 < 子目录级
    const parts: string[] = [];

    if (byLevel.user.length > 0) {
      parts.push(`## User Context\n\n${byLevel.user.join("\n\n")}`);
    }

    if (byLevel.project.length > 0) {
      parts.push(`## Project Context\n\n${byLevel.project.join("\n\n")}`);
    }

    if (byLevel.subdirectory.length > 0) {
      parts.push(`## Package Context\n\n${byLevel.subdirectory.join("\n\n")}`);
    }

    return parts.join(this.config.levelSeparator);
  }

  /**
   * 监听文件变更
   */
  watch(): void {
    // 监听用户级
    const userContextPath = path.join(
      this.config.userDir,
      this.config.contextFileName
    );
    this.watchFile(userContextPath, "user");

    // 监听项目级
    const projectContextPath = path.join(
      this.projectRoot,
      this.config.projectDirName,
      this.config.contextFileName
    );
    this.watchFile(projectContextPath, "project");
  }

  /**
   * 监听单个文件
   */
  private watchFile(filePath: string, level: ContextLevel): void {
    if (this.fileWatchers.has(filePath)) return;

    try {
      const watcher = fs.watch(filePath, (eventType) => {
        if (eventType === "change") {
          this.emit("changed", level, filePath);
          // 清除缓存
          this.cachedContext = null;
        }
      });

      this.fileWatchers.set(filePath, watcher);
    } catch {
      // 文件不存在，忽略
    }
  }

  /**
   * 停止监听
   */
  unwatch(): void {
    for (const watcher of this.fileWatchers.values()) {
      watcher.close();
    }
    this.fileWatchers.clear();
  }

  /**
   * 获取缓存的上下文
   */
  getCachedContext(): ContextLoadResult | null {
    return this.cachedContext;
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cachedContext = null;
    this.loadedSubdirectories.clear();
  }

  /**
   * 获取用户目录路径
   */
  getUserDir(): string {
    return this.config.userDir;
  }

  /**
   * 获取项目目录路径
   */
  getProjectDir(): string {
    return path.join(this.projectRoot, this.config.projectDirName);
  }
}

/**
 * 创建上下文加载器实例
 */
export function createContextLoader(
  projectRoot: string,
  config?: Partial<ContextLoaderConfig>
): ContextLoader {
  return new ContextLoader(projectRoot, config);
}
