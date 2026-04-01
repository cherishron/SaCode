/**
 * SaClaw Container Module - 容器实例封装
 */

import type {
  ContainerConfig,
  ContainerInfo,
  ContainerExecResult,
  ContainerLog,
  Logger,
} from "./types.js";
import { DockerRunner } from "./docker-runner.js";

/**
 * 容器实例
 */
export class Container {
  readonly id: string;
  readonly config: ContainerConfig;
  private runner: DockerRunner;
  private logger: Logger;

  constructor(
    id: string,
    config: ContainerConfig,
    runner: DockerRunner,
    logger?: Logger
  ) {
    this.id = id;
    this.config = config;
    this.runner = runner;
    this.logger = logger ?? console;
  }

  /**
   * 获取容器信息
   */
  async info(): Promise<ContainerInfo> {
    return this.runner.getContainer(this.id);
  }

  /**
   * 检查容器是否运行中
   */
  async isRunning(): Promise<boolean> {
    try {
      const info = await this.info();
      return info.state === "running";
    } catch {
      return false;
    }
  }

  /**
   * 启动容器
   */
  async start(): Promise<void> {
    this.logger.info(`启动容器: ${this.id}`);
    await this.runner.startContainer(this.id);
  }

  /**
   * 停止容器
   */
  async stop(timeout?: number): Promise<void> {
    this.logger.info(`停止容器: ${this.id}`);
    await this.runner.stopContainer(this.id, timeout);
  }

  /**
   * 删除容器
   */
  async remove(force = false): Promise<void> {
    this.logger.info(`删除容器: ${this.id}`);
    await this.runner.removeContainer(this.id, force);
  }

  /**
   * 执行命令
   */
  async exec(
    command: string[],
    options: {
      env?: Record<string, string>;
      cwd?: string;
      timeout?: number;
    } = {}
  ): Promise<ContainerExecResult> {
    return this.runner.exec(this.id, command, {
      ...options,
      timeout: options.timeout ?? this.config.timeout,
    });
  }

  /**
   * 执行Shell命令
   */
  async execShell(
    shell: string,
    options?: { cwd?: string; timeout?: number }
  ): Promise<ContainerExecResult> {
    return this.exec(["sh", "-c", shell], options);
  }

  /**
   * 获取日志
   */
  async logs(options?: { tail?: number; since?: number }): Promise<ContainerLog[]> {
    return this.runner.getLogs(this.id, options);
  }
}
