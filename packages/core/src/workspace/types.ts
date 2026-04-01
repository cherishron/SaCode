/**
 * Workspace 类型定义
 */

/**
 * Workspace 类型定义
 */

// ============================================================================
// Container & Sandbox Types
// ============================================================================

/** 沙箱模式 */
export type SandboxMode = "none" | "docker" | "vm" | "bwrap";

/** 容器配置 */
export interface ContainerConfig {
  /** 容器名称 */
  name?: string;
  /** 镜像 */
  image?: string;
  /** 工作目录 */
  workingDir?: string;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 端口映射 */
  ports?: string[];
  /** 卷挂载 */
  volumes?: { host: string; container: string; readonly?: boolean }[];
  /** 内存限制 */
  memory?: string;
  /** CPU限制 */
  cpu?: number;
  /** 网络模式 */
  network?: "bridge" | "host" | "none";
  /** 自动清理 */
  autoRemove?: boolean;
  /** 超时时间(毫秒) */
  timeout?: number;
}

/** 容器执行结果 */
export interface ContainerExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  signal?: string;
  duration: number;
}

/** 沙箱配置 */
export interface SandboxConfig {
  /** 沙箱模式 */
  mode: SandboxMode;
  /** 是否启用 */
  enabled: boolean;
  /** 容器配置 */
  container?: ContainerConfig;
  /** 命令白名单 */
  allowedCommands?: string[];
  /** 文件访问限制 */
  allowedPaths?: string[];
  /** 网络访问限制 */
  allowedNetworks?: string[];
  /** 环境变量白名单 */
  allowedEnvVars?: string[];
}

/** 工作空间配置 */
export interface WorkspaceConfig {
  /** 工作空间根目录 */
  rootPath: string;
  /** 语言设置 */
  language: "zh-CN" | "en-US";
  /** 默认模型 */
  defaultModel: string;
  /** 是否显示思考过程 */
  thinking: boolean;
  /** 模板ID */
  template?: string;
  /** 沙箱配置 */
  sandbox?: SandboxConfig;
  /** 自定义配置 */
  custom?: Record<string, unknown>;
}

/** 工作空间文件 */
export interface WorkspaceFile {
  name: string;
  path: string;
  content: string;
  required: boolean;
}

/** 工作空间上下文 - 传递给AI的信息 */
export interface WorkspaceContext {
  /** AI人格 */
  soul?: string;
  /** 用户信息 */
  user?: string;
  /** 行为指南 */
  agents?: string;
  /** 工具策略 */
  tools?: string;
  /** 长期记忆 */
  memory?: string;
  /** 身份定义 */
  identity?: string;
  /** 项目信息 */
  project?: string;
  /** 日历/提醒 */
  calendar?: string;
}

/** 工作空间管理器选项 */
export interface WorkspaceManagerOptions {
  /** 工作空间根目录 */
  rootPath: string;
  /** 配置文件名 */
  configFile?: string;
}

/** 工作空间模板 */
export interface WorkspaceTemplate {
  id: string;
  name: string;
  description: string;
  files: WorkspaceFile[];
}

/** 工作空间事件 */
export interface WorkspaceEvent {
  type: "loaded" | "updated" | "error";
  timestamp: number;
  data?: unknown;
  error?: Error;
}
