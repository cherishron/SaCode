import type { ToolDefinition, CapabilitiesConfig } from "../types";
import { createFileTools } from "../files";
import { createBrowserTools, BrowserManager } from "../browser";
import { createShellTools } from "../shell";
import { createWebTools } from "../web";
import { createSearchTools } from "../search";
import { createLspTools } from "../lsp";
import { createTaskTools } from "../task";
import { createAgentTools } from "../agent";
import { createGitTools } from "../git";

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

    // 注册 Web 工具
    const webTools = createWebTools(this.config.web);
    for (const tool of webTools) {
      this.registry.register(tool);
    }

    // 注册搜索工具
    if (this.config.search) {
      const searchTools = createSearchTools(this.config.search);
      for (const tool of searchTools) {
        this.registry.register(tool);
      }
    }

    // 注册 LSP 工具
    if (this.config.lsp) {
      const lspTools = createLspTools(this.config.lsp);
      for (const tool of lspTools) {
        this.registry.register(tool);
      }
    }

    // 注册任务管理工具
    if (this.config.task) {
      const taskTools = createTaskTools(this.config.task);
      for (const tool of taskTools) {
        this.registry.register(tool);
      }
    }

    // 注册 Agent 管理工具
    if (this.config.agent) {
      const agentTools = createAgentTools(this.config.agent);
      for (const tool of agentTools) {
        this.registry.register(tool);
      }
    }

    // 注册 Git 工具
    if (this.config.git) {
      const gitTools = createGitTools(this.config.git);
      for (const tool of gitTools) {
        this.registry.register(tool);
      }
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
  web: {
    enabled: true,
    search: {
      enabled: true,
      apiProvider: "duckduckgo",
      timeout: 10000,
    },
    fetch: {
      enabled: true,
      defaultTimeout: 30000,
    },
    http: {
      enabled: true,
      defaultTimeout: 30000,
      maxRedirects: 5,
    },
  },
  search: {
    enabled: true,
    useRipgrep: true,
    maxResults: 100,
    timeout: 30000,
  },
  lsp: {
    enabled: true,
    languageServers: {
      typescript: {
        command: "typescript-language-server",
        args: ["--stdio"],
        rootPatterns: ["package.json", "tsconfig.json"],
      },
      python: {
        command: "pyright-langserver",
        args: ["--stdio"],
        rootPatterns: ["pyproject.toml", "setup.py", ".git"],
      },
    },
    timeout: 30000,
  },
  task: {
    enabled: true,
    maxTasks: 100,
  },
  agent: {
    enabled: true,
    maxAgents: 10,
    maxTeams: 5,
  },
  git: {
    enabled: true,
    defaultPath: ".",
  },
};
