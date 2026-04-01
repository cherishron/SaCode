/**
 * SaClaw Container Module - 容器管理器
 */

import type {
  ContainerConfig,
  ContainerInfo,
  ContainerExecResult,
  ContainerManagerOptions,
  CreateContainerManagerOptions,
  Logger,
} from "./types.js";
import { DockerRunner } from "./docker-runner.js";
import { Container } from "./container-instance.js";

/**
 * 容器管理器 - 管理所有容器实例
 */
export class ContainerManager {
  private runner: DockerRunner;
  private defaultConfig: ContainerConfig;
  private logger: Logger;
  private containers: Map<string, Container> = new Map();

  constructor(options: ContainerManagerOptions = {}) {
    const runtime = options.runtime ?? "docker";
    const logger = options.logger ?? console;
    this.runner = new DockerRunner({ runtime, logger });
    this.defaultConfig = {
      image: options.defaultConfig?.image ?? "node:22-alpine",
      workingDir: options.defaultConfig?.workingDir ?? "/app",
      autoRemove: options.defaultConfig?.autoRemove ?? true,
      timeout: options.defaultConfig?.timeout ?? 300000,
    };
    this.logger = logger;
  }

  /**
   * 检查运行时是否可用
   */
  async isAvailable(): Promise<boolean> {
    return this.runner.isAvailable();
  }

  /**
   * 拉取镜像
   */
  async pullImage(image: string): Promise<void> {
    await this.runner.pullImage(image);
  }

  /**
   * 创建并启动容器
   */
  async create(
    config: Partial<ContainerConfig> = {},
    command?: string[]
  ): Promise<Container> {
    const mergedConfig: ContainerConfig = {
      ...this.defaultConfig,
      ...config,
      name: config.name ?? this.generateName(),
    };

    this.logger.info(`创建容器: ${mergedConfig.name}`);

    // 拉取镜像(如果不存在)
    try {
      await this.runner.pullImage(mergedConfig.image);
    } catch (error) {
      this.logger.warn(`拉取镜像失败, 尝试使用本地镜像: ${mergedConfig.image}`);
    }

    // 创建并启动容器
    const containerId = await this.runner.createContainer(mergedConfig, command);

    const container = new Container(containerId, mergedConfig, this.runner, this.logger);
    this.containers.set(containerId, container);

    this.logger.info(`容器已创建: ${containerId}`);
    return container;
  }

  /**
   * 获取容器
   */
  async get(containerId: string): Promise<Container> {
    const existing = this.containers.get(containerId);
    if (existing) {
      return existing;
    }

    // 从Docker获取
    const info = await this.runner.getContainer(containerId);
    const container = new Container(
      containerId,
      { ...this.defaultConfig, name: info.name },
      this.runner,
      this.logger
    );
    this.containers.set(containerId, container);
    return container;
  }

  /**
   * 列出所有容器
   */
  async list(all = true): Promise<ContainerInfo[]> {
    return this.runner.listContainers(all);
  }

  /**
   * 快速执行 - 创建、执行、清理
   */
  async run(
    config: Partial<ContainerConfig>,
    command: string[]
  ): Promise<ContainerExecResult> {
    const container = await this.create(config, command);
    try {
      return await container.exec(command);
    } finally {
      await container.remove(true);
    }
  }

  /**
   * 快速执行Shell
   */
  async runShell(
    config: Partial<ContainerConfig>,
    shell: string
  ): Promise<ContainerExecResult> {
    const container = await this.create(config, ["sh", "-c", shell]);
    try {
      return await container.execShell(shell);
    } finally {
      await container.remove(true);
    }
  }

  /**
   * 创建持久容器(不自动删除)
   */
  async createPersistent(
    config: Partial<ContainerConfig>,
    command?: string[]
  ): Promise<Container> {
    const mergedConfig: ContainerConfig = {
      ...this.defaultConfig,
      ...config,
      name: config.name ?? this.generateName(),
      autoRemove: false,
    };

    this.logger.info(`创建持久容器: ${mergedConfig.name}`);
    const containerId = await this.runner.createContainer(mergedConfig, command);
    const container = new Container(containerId, mergedConfig, this.runner, this.logger);
    this.containers.set(containerId, container);
    return container;
  }

  /**
   * 清理所有容器
   */
  async cleanup(): Promise<void> {
    const containers = await this.list(true);
    for (const c of containers) {
      try {
        await this.runner.removeContainer(c.id, true);
        this.containers.delete(c.id);
        this.logger.info(`已清理容器: ${c.name}`);
      } catch (error) {
        this.logger.warn(`清理容器失败: ${c.name}`, error);
      }
    }
  }

  /**
   * 生成容器名称
   */
  private generateName(): string {
    const adjectives = ["happy", "clever", "swift", "brave", "gentle"];
    const nouns = ["wolf", "eagle", "tiger", "dragon", "phoenix"];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const random = Math.random().toString(36).slice(2, 6);
    return `saclaw-${adj}-${noun}-${random}`;
  }
}

// ============================================================================
// Factory function
// ============================================================================

/**
 * 创建容器管理器
 */
export function createContainerManager(
  options: CreateContainerManagerOptions = {}
): ContainerManager {
  const runtime = options.runtime ?? "docker";
  const logger = options.logger ?? console;
  return new ContainerManager({
    runtime,
    defaultConfig: {
      image: options.defaultImage ?? "node:22-alpine",
    },
    logger,
  });
}
