/**
 * 斜杠命令自动发现
 *
 * 扫描 .saclaw/commands/ 目录，自动发现和注册命令
 */

import * as fs from "fs";
import * as path from "path";
import EventEmitter from "eventemitter3";

/**
 * 命令定义
 */
export interface CommandDefinition {
  /** 命令名称（不含斜杠） */
  name: string;
  /** 命令描述 */
  description?: string;
  /** 命令内容/模板 */
  content: string;
  /** 命令别名 */
  aliases?: string[];
  /** 命令分类 */
  category?: string;
  /** 命令标签 */
  tags?: string[];
  /** 是否启用 */
  enabled: boolean;
  /** 文件路径 */
  filePath: string;
  /** 最后修改时间 */
  modifiedAt: Date;
  /** 是否为用户自定义 */
  isUserDefined: boolean;
}

/**
 * 命令文件元数据
 */
export interface CommandFileMetadata {
  /** 文件路径 */
  path: string;
  /** 命令名称 */
  name: string;
  /** 是否有效 */
  valid: boolean;
  /** 解析错误 */
  error?: string;
}

/**
 * 命令发现器配置
 */
export interface CommandDiscoveryConfig {
  /** 命令目录 */
  commandsDir: string;
  /** 是否自动发现 */
  autoDiscover: boolean;
  /** 是否监听文件变更 */
  watchChanges: boolean;
  /** 文件扩展名 */
  extensions: string[];
  /** 是否递归扫描 */
  recursive: boolean;
}

/**
 * 默认配置
 */
export const DEFAULT_COMMAND_DISCOVERY_CONFIG: CommandDiscoveryConfig = {
  commandsDir: ".saclaw/commands",
  autoDiscover: true,
  watchChanges: true,
  extensions: [".md", ".markdown"],
  recursive: false,
};

/**
 * 命令发现器事件
 */
export interface CommandDiscoveryEvents {
  /** 命令发现 */
  discovered: [command: CommandDefinition];
  /** 命令移除 */
  removed: [commandName: string];
  /** 命令更新 */
  updated: [command: CommandDefinition];
  /** 错误 */
  error: [error: Error];
  /** 扫描完成 */
  scanComplete: [commands: CommandDefinition[]];
}

/**
 * 斜杠命令发现器
 *
 * @example
 * ```typescript
 * const discovery = new CommandDiscovery({
 *   commandsDir: ".saclaw/commands",
 * });
 *
 * // 发现所有命令
 * const commands = await discovery.discover();
 *
 * // 获取命令
 * const cmd = discovery.getCommand("deploy");
 *
 * // 监听新命令
 * discovery.on("discovered", (cmd) => {
 *   console.log(`New command: /${cmd.name}`);
 * });
 * ```
 */
export class CommandDiscovery extends EventEmitter<CommandDiscoveryEvents> {
  private config: CommandDiscoveryConfig;
  private commands: Map<string, CommandDefinition> = new Map();
  private fileWatcher: fs.FSWatcher | null = null;
  private projectRoot: string;

  constructor(
    projectRoot: string,
    config: Partial<CommandDiscoveryConfig> = {}
  ) {
    super();
    this.projectRoot = projectRoot;
    this.config = { ...DEFAULT_COMMAND_DISCOVERY_CONFIG, ...config };
  }

  /**
   * 发现所有命令
   */
  async discover(): Promise<CommandDefinition[]> {
    const commandsDir = this.resolveCommandsDir();

    if (!fs.existsSync(commandsDir)) {
      this.emit("scanComplete", []);
      return [];
    }

    const discovered: CommandDefinition[] = [];

    try {
      const entries = await fs.promises.readdir(commandsDir, {
        withFileTypes: true,
      });

      for (const entry of entries) {
        if (entry.isDirectory() && this.config.recursive) {
          const subCommands = await this.scanDirectory(
            path.join(commandsDir, entry.name)
          );
          discovered.push(...subCommands);
        } else if (entry.isFile()) {
          const command = await this.loadCommandFile(
            path.join(commandsDir, entry.name)
          );
          if (command) {
            discovered.push(command);
          }
        }
      }

      // 更新缓存
      for (const cmd of discovered) {
        this.commands.set(cmd.name, cmd);
        this.emit("discovered", cmd);
      }

      this.emit("scanComplete", discovered);

      // 启动文件监听
      if (this.config.watchChanges && !this.fileWatcher) {
        this.startWatching();
      }
    } catch (error) {
      this.emit(
        "error",
        new Error(`Failed to discover commands: ${error}`)
      );
    }

    return discovered;
  }

  /**
   * 扫描目录
   */
  private async scanDirectory(dir: string): Promise<CommandDefinition[]> {
    const commands: CommandDefinition[] = [];

    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile()) {
          const command = await this.loadCommandFile(path.join(dir, entry.name));
          if (command) {
            commands.push(command);
          }
        }
      }
    } catch {
      // 忽略扫描错误
    }

    return commands;
  }

  /**
   * 加载命令文件
   */
  private async loadCommandFile(filePath: string): Promise<CommandDefinition | null> {
    // 检查扩展名
    const ext = path.extname(filePath);
    if (!this.config.extensions.includes(ext)) {
      return null;
    }

    try {
      const content = await fs.promises.readFile(filePath, "utf-8");
      const stat = await fs.promises.stat(filePath);

      // 从文件名提取命令名
      const baseName = path.basename(filePath, ext);
      const commandName = this.normalizeCommandName(baseName);

      // 解析文件内容
      const { frontmatter, body } = this.parseFrontmatter(content);

      const command: CommandDefinition = {
        name: frontmatter?.name ?? commandName,
        description: frontmatter?.description,
        content: body.trim(),
        aliases: frontmatter?.aliases,
        category: frontmatter?.category,
        tags: frontmatter?.tags,
        enabled: frontmatter?.enabled !== false,
        filePath,
        modifiedAt: stat.mtime,
        isUserDefined: true,
      };

      // 缓存命令
      this.commands.set(command.name, command);

      // 注册别名
      if (command.aliases) {
        for (const alias of command.aliases) {
          this.commands.set(alias, { ...command, name: alias });
        }
      }

      return command;
    } catch (error) {
      this.emit(
        "error",
        new Error(`Failed to load command file ${filePath}: ${error}`)
      );
      return null;
    }
  }

  /**
   * 解析 YAML frontmatter
   */
  private parseFrontmatter(
    content: string
  ): { frontmatter: Record<string, unknown> | null; body: string } {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

    if (!frontmatterMatch) {
      return { frontmatter: null, body: content };
    }

    const frontmatterStr = frontmatterMatch[1] ?? "";
    const body = frontmatterMatch[2] ?? "";

    // 简化的 YAML 解析
    const frontmatter: Record<string, unknown> = {};
    const lines = frontmatterStr.split("\n");

    for (const line of lines) {
      const match = line.match(/^(\w+):\s*(.*)$/);
      if (match) {
        const key = match[1];
        let value: unknown = match[2]?.trim() ?? "";

        // 解析数组
        if (value === "" && lines[lines.indexOf(line) + 1]?.startsWith("  - ")) {
          const arrayItems: string[] = [];
          for (let i = lines.indexOf(line) + 1; i < lines.length; i++) {
            const itemMatch = lines[i]?.match(/^\s+-\s+(.+)$/);
            if (itemMatch) {
              arrayItems.push(itemMatch[1]?.trim() ?? "");
            } else {
              break;
            }
          }
          value = arrayItems;
        } else if (typeof value === "string") {
          // 解析布尔值
          if (value === "true") value = true;
          else if (value === "false") value = false;
          // 解析数组格式 [item1, item2]
          else if (value.startsWith("[") && value.endsWith("]")) {
            value = value
              .slice(1, -1)
              .split(",")
              .map((s) => s.trim());
          }
        }

        frontmatter[key ?? ""] = value;
      }
    }

    return { frontmatter, body };
  }

  /**
   * 规范化命令名称
   */
  private normalizeCommandName(name: string): string {
    // 移除特殊字符，转换为小写
    return name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  /**
   * 获取命令
   */
  getCommand(name: string): CommandDefinition | undefined {
    return this.commands.get(name);
  }

  /**
   * 获取所有命令
   */
  getAllCommands(): CommandDefinition[] {
    // 过滤掉别名（只返回主命令）
    const mainCommands = new Map<string, CommandDefinition>();
    for (const [name, cmd] of this.commands) {
      if (cmd.name === name) {
        mainCommands.set(name, cmd);
      }
    }
    return Array.from(mainCommands.values());
  }

  /**
   * 按分类获取命令
   */
  getCommandsByCategory(category: string): CommandDefinition[] {
    return this.getAllCommands().filter(
      (cmd) => cmd.category === category
    );
  }

  /**
   * 搜索命令
   */
  searchCommands(query: string): CommandDefinition[] {
    const lowerQuery = query.toLowerCase();
    return this.getAllCommands().filter(
      (cmd) =>
        cmd.name.includes(lowerQuery) ||
        cmd.description?.toLowerCase().includes(lowerQuery) ||
        cmd.tags?.some((t) => t.toLowerCase().includes(lowerQuery))
    );
  }

  /**
   * 启动文件监听
   */
  private startWatching(): void {
    const commandsDir = this.resolveCommandsDir();
    if (!fs.existsSync(commandsDir)) return;

    this.fileWatcher = fs.watch(commandsDir, async (eventType, filename) => {
      if (!filename) return;

      const filePath = path.join(commandsDir, filename);

      if (eventType === "rename" || eventType === "change") {
        if (fs.existsSync(filePath)) {
          // 文件创建或修改
          const command = await this.loadCommandFile(filePath);
          if (command) {
            const existing = this.commands.get(command.name);
            if (existing) {
              this.emit("updated", command);
            } else {
              this.emit("discovered", command);
            }
          }
        } else {
          // 文件删除
          const ext = path.extname(filename);
          const name = this.normalizeCommandName(path.basename(filename, ext));
          if (this.commands.has(name)) {
            this.commands.delete(name);
            this.emit("removed", name);
          }
        }
      }
    });
  }

  /**
   * 停止文件监听
   */
  stopWatching(): void {
    if (this.fileWatcher) {
      this.fileWatcher.close();
      this.fileWatcher = null;
    }
  }

  /**
   * 重新加载命令
   */
  async reload(): Promise<CommandDefinition[]> {
    this.commands.clear();
    return this.discover();
  }

  /**
   * 解析命令目录路径
   */
  private resolveCommandsDir(): string {
    if (path.isAbsolute(this.config.commandsDir)) {
      return this.config.commandsDir;
    }
    return path.resolve(this.projectRoot, this.config.commandsDir);
  }

  /**
   * 获取命令数量
   */
  getCommandCount(): number {
    return this.getAllCommands().length;
  }
}

/**
 * 创建命令发现器实例
 */
export function createCommandDiscovery(
  projectRoot: string,
  config?: Partial<CommandDiscoveryConfig>
): CommandDiscovery {
  return new CommandDiscovery(projectRoot, config);
}
