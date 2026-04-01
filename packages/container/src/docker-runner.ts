/**
 * SaClaw Container Module - Docker 运行时
 */

import { execa } from "execa";
import type {
  ContainerConfig,
  ContainerInfo,
  ContainerExecResult,
  ContainerLog,
  Logger,
  ContainerState,
} from "./types.js";
import {
  ContainerNotFoundError,
  ContainerRuntimeError,
  ContainerTimeoutError,
} from "./errors.js";

/**
 * Docker运行时 - 负责与Docker守护进程通信
 */
export class DockerRunner {
  private runtime: "docker" | "podman";
  private logger: Logger;

  constructor(options: { runtime?: "docker" | "podman"; logger?: Logger } = {}) {
    this.runtime = options.runtime ?? "docker";
    this.logger = options.logger ?? console;
  }

  /**
   * 检查Docker是否可用
   */
  async isAvailable(): Promise<boolean> {
    try {
      const result = await this.runCommand(["info"]);
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  /**
   * 拉取镜像
   */
  async pullImage(image: string): Promise<void> {
    this.logger.info(`拉取镜像: ${image}`);
    const result = await this.runCommand(["pull", image]);
    if (result.exitCode !== 0) {
      throw new ContainerRuntimeError(`拉取镜像失败: ${result.stderr}`, {
        image,
        stderr: result.stderr,
      });
    }
  }

  /**
   * 创建并启动容器
   */
  async createContainer(
    config: ContainerConfig,
    command?: string[]
  ): Promise<string> {
    const args = [
      "run",
      "-d",
      ...(config.name ? ["--name", config.name] : []),
      ...(config.workingDir ? ["-w", config.workingDir] : []),
      ...(config.env
        ? Object.entries(config.env).flatMap(([k, v]) => ["-e", `${k}=${v}`])
        : []),
      ...(config.ports ?? []).flatMap((p) => ["-p", p]),
      ...(config.volumes ?? []).flatMap((v) => ["-v", v]),
      ...(config.memory ? ["--memory", config.memory] : []),
      ...(config.cpu ? ["--cpus", config.cpu.toString()] : []),
      ...(config.network ? ["--network", config.network] : []),
      ...(config.autoRemove ? ["--rm"] : []),
      config.image,
      ...(command ?? []),
    ];

    const result = await this.runCommand(args);
    if (result.exitCode !== 0) {
      throw new ContainerRuntimeError(`创建容器失败: ${result.stderr}`, {
        config,
        stderr: result.stderr,
      });
    }

    return result.stdout.trim();
  }

  /**
   * 启动容器
   */
  async startContainer(containerId: string): Promise<void> {
    const result = await this.runCommand(["start", containerId]);
    if (result.exitCode !== 0) {
      throw new ContainerRuntimeError(`启动容器失败: ${result.stderr}`, {
        containerId,
        stderr: result.stderr,
      });
    }
  }

  /**
   * 停止容器
   */
  async stopContainer(containerId: string, timeout = 10): Promise<void> {
    const result = await this.runCommand(["stop", "-t", timeout.toString(), containerId]);
    if (result.exitCode !== 0) {
      throw new ContainerRuntimeError(`停止容器失败: ${result.stderr}`, {
        containerId,
        stderr: result.stderr,
      });
    }
  }

  /**
   * 删除容器
   */
  async removeContainer(containerId: string, force = false): Promise<void> {
    const args = ["rm"];
    if (force) args.push("-f");
    args.push(containerId);

    const result = await this.runCommand(args);
    if (result.exitCode !== 0) {
      throw new ContainerRuntimeError(`删除容器失败: ${result.stderr}`, {
        containerId,
        stderr: result.stderr,
      });
    }
  }

  /**
   * 获取容器信息
   */
  async getContainer(containerId: string): Promise<ContainerInfo> {
    const result = await this.runCommand([
      "inspect",
      "--format",
      "{{.Id}}|{{.Name}}|{{.Image}}|{{.State.Status}}|{{.Created}}|{{.State.Running}}|{{.NetworkSettings.Ports}}|{{.Mounts}}",
      containerId,
    ]);

    if (result.exitCode !== 0) {
      if (result.stderr.includes("No such container")) {
        throw new ContainerNotFoundError(containerId);
      }
      throw new ContainerRuntimeError(`获取容器信息失败: ${result.stderr}`, {
        containerId,
        stderr: result.stderr,
      });
    }

    const parts = result.stdout.trim().split("|");
    const id = parts[0] ?? "";
    const name = parts[1] ?? "";
    const image = parts[2] ?? "";
    const state = parts[3] ?? "";
    const created = parts[4] ?? "";
    const running = parts[5] ?? "";
    const ports = parts[6] ?? "";
    const mounts = parts[7] ?? "";

    return {
      id,
      name: name.replace(/^\//, ""),
      image,
      state: running === "true" ? "running" : ("exited" as ContainerState),
      created,
      status: state,
      ports: ports === "<nil>" || !ports ? undefined : [ports],
      mounts: mounts === "<nil>" || !mounts ? undefined : [mounts],
    };
  }

  /**
   * 在容器中执行命令
   */
  async exec(
    containerId: string,
    command: string[],
    options: {
      env?: Record<string, string>;
      cwd?: string;
      timeout?: number;
    } = {}
  ): Promise<ContainerExecResult> {
    const startTime = Date.now();
    const args = [
      "exec",
      ...(options.cwd ? ["-w", options.cwd] : []),
      ...(options.env
        ? Object.entries(options.env).flatMap(([k, v]) => [
            "-e",
            `${k}=${v}`,
          ])
        : []),
      containerId,
      ...command,
    ];

    try {
      const result = await this.runCommand(args, {
        timeout: options.timeout ?? 300000,
      });
      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("timeout")) {
        throw new ContainerTimeoutError(containerId, options.timeout ?? 300000);
      }
      throw error;
    }
  }

  /**
   * 获取容器日志
   */
  async getLogs(
    containerId: string,
    options: {
      tail?: number;
      since?: number;
      timestamps?: boolean;
    } = {}
  ): Promise<ContainerLog[]> {
    const args = [
      "logs",
      ...(options.tail ? ["--tail", options.tail.toString()] : []),
      ...(options.since ? ["--since", options.since.toString()] : []),
      ...(options.timestamps ? ["--timestamps"] : []),
      containerId,
    ];

    const result = await this.runCommand(args);
    const lines = result.stdout.split("\n").filter(Boolean);

    return lines.map((line): ContainerLog => {
      const match = line.match(/^(\S+)\s+(stdout|stderr)\s+(.*)$/);
      if (match) {
        return {
          timestamp: match[1] ?? new Date().toISOString(),
          stream: match[2] as "stdout" | "stderr",
          message: match[3] ?? "",
        };
      }
      return {
        timestamp: new Date().toISOString(),
        stream: "stdout" as const,
        message: line,
      };
    });
  }

  /**
   * 列出容器
   */
  async listContainers(all = true): Promise<ContainerInfo[]> {
    const args = [
      "ps",
      ...(all ? ["-a"] : []),
      "--format",
      "{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.CreatedAt}}",
    ];

    const result = await this.runCommand(args);
    if (result.exitCode !== 0) {
      throw new ContainerRuntimeError(`列出容器失败: ${result.stderr}`, {
        stderr: result.stderr,
      });
    }

    const lines = result.stdout.split("\n").filter(Boolean);
    return lines.map((line): ContainerInfo => {
      const parts = line.split("|");
      const id = parts[0] ?? "";
      const name = parts[1] ?? "";
      const image = parts[2] ?? "";
      const status = parts[3] ?? "";
      const created = parts[4] ?? "";
      return {
        id,
        name,
        image,
        state: "created" as ContainerState,
        status,
        created,
      };
    });
  }

  /**
   * 运行命令
   */
  private async runCommand(
    args: string[],
    options: { timeout?: number } = {}
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    try {
      const execaOptions = {
        ...(options.timeout ? { timeout: options.timeout } : {}),
        reject: false,
        stdio: ["ignore", "pipe", "pipe"] as const,
      };
      const result = await execa(this.runtime, args, execaOptions);
      return {
        exitCode: result.exitCode ?? 1,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("timeout")) {
        throw new Error("timeout");
      }
      return {
        exitCode: 1,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
