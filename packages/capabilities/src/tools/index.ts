import type { ToolDefinition, CapabilitiesConfig } from "../types";
import { createFileTools } from "../files";
import { createBrowserTools, BrowserManager } from "../browser";
import { createShellTools } from "../shell";

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  register<TInput, TOutput>(tool: ToolDefinition<TInput, TOutput>): void {
    this.tools.set(tool.name, tool as ToolDefinition);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  async execute(name: string, input: unknown): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    return tool.execute(input);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  names(): string[] {
    return Array.from(this.tools.keys());
  }
}

export class CapabilitiesManager {
  private registry: ToolRegistry;
  private config: CapabilitiesConfig;
  private browserManager: BrowserManager | null = null;

  constructor(config: CapabilitiesConfig) {
    this.config = config;
    this.registry = new ToolRegistry();

    this.initialize();
  }

  private initialize(): void {
    // 注册文件工具
    const fileTools = createFileTools(this.config.files);
    for (const tool of fileTools) {
      this.registry.register(tool);
    }

    // 注册浏览器工具
    const browserTools = createBrowserTools(this.config.browser, () => this.getBrowserManager());
    for (const tool of browserTools) {
      this.registry.register(tool);
    }

    // 注册 Shell 工具
    const shellTools = createShellTools(this.config.shell);
    for (const tool of shellTools) {
      this.registry.register(tool);
    }
  }

  private getBrowserManager(): BrowserManager {
    if (!this.browserManager) {
      this.browserManager = new BrowserManager(this.config.browser);
    }
    return this.browserManager;
  }

  getRegistry(): ToolRegistry {
    return this.registry;
  }

  async shutdown(): Promise<void> {
    if (this.browserManager) {
      await this.browserManager.close();
    }
  }
}

// 默认配置
export const defaultCapabilitiesConfig: CapabilitiesConfig = {
  files: {
    enabled: true,
    allowedDirs: ["."],
    maxSize: 10 * 1024 * 1024, // 10MB
    readOnly: false,
  },
  browser: {
    enabled: true,
    headless: true,
    timeout: 30000,
  },
  shell: {
    enabled: true,
    allowedCommands: [
      "git",
      "npm",
      "pnpm",
      "node",
      "npx",
      "yarn",
      // Python 相关
      "python",
      "python3",
      "pip",
      "pip3",
      // vfox
      "vfox",
    ],
    timeout: 60000,
    useVfox: true, // 默认启用 vfox 集成
    vfoxSdks: [], // 空数组表示自动检测 python/node 等
  },
};
