/**
 * 环境检测工具
 *
 * 提供运行时环境检测功能，包括：
 * - Python/Node.js 等运行时检测
 * - vfox 版本管理器集成
 * - 跨平台命令解析
 */

import { spawn } from "node:child_process";
import type { RuntimeInfo, VfoxInfo } from "../types";

/**
 * 跨平台命令映射
 */
const PLATFORM_COMMANDS: Record<string, { windows: string; unix: string }> = {
  python: {
    windows: "python",
    unix: "python3",
  },
  pip: {
    windows: "pip",
    unix: "pip3",
  },
};

/**
 * 获取跨平台兼容的命令名
 */
export function getPlatformCommand(command: string): string {
  const mapping = PLATFORM_COMMANDS[command];
  if (mapping) {
    return process.platform === "win32" ? mapping.windows : mapping.unix;
  }
  return command;
}

/**
 * 检测运行时是否安装
 */
export async function detectRuntime(name: string): Promise<RuntimeInfo> {
  const command = getPlatformCommand(name);
  const versionFlag = name === "node" ? "--version" : "--version";

  return new Promise((resolve) => {
    const childProcess = spawn(command, [versionFlag], {
      shell: true,
      timeout: 5000,
    });

    let stdout = "";
    let stderr = "";

    childProcess.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    childProcess.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    childProcess.on("close", (code: number | null) => {
      if (code === 0 && stdout) {
        // 解析版本号
        const version = stdout.trim();
        resolve({
          name,
          installed: true,
          version,
        });
      } else {
        resolve({
          name,
          installed: false,
        });
      }
    });

    childProcess.on("error", () => {
      resolve({
        name,
        installed: false,
      });
    });

    // 超时处理
    setTimeout(() => {
      childProcess.kill();
      resolve({
        name,
        installed: false,
      });
    }, 5000);
  });
}

/**
 * 检测运行时路径
 */
export async function detectRuntimePath(name: string): Promise<string | null> {
  const command = getPlatformCommand(name);
  const whichCommand = process.platform === "win32" ? "where" : "which";

  return new Promise((resolve) => {
    const childProcess = spawn(whichCommand, [command], {
      shell: true,
      timeout: 5000,
    });

    let stdout = "";

    childProcess.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    childProcess.on("close", (code: number | null) => {
      if (code === 0 && stdout) {
        // Windows 可能返回多行，取第一个
        const paths = stdout.trim().split(/\r?\n/);
        resolve(paths[0] ?? null);
      } else {
        resolve(null);
      }
    });

    childProcess.on("error", () => {
      resolve(null);
    });

    setTimeout(() => {
      childProcess.kill();
      resolve(null);
    }, 5000);
  });
}

/**
 * 完整检测运行时信息（包括路径）
 */
export async function detectRuntimeFull(name: string): Promise<RuntimeInfo> {
  const basicInfo = await detectRuntime(name);

  if (!basicInfo.installed) {
    return basicInfo;
  }

  const path = await detectRuntimePath(name);
  if (path) {
    return { ...basicInfo, path };
  }
  return basicInfo;
}

/**
 * 批量检测运行时
 */
export async function detectRuntimes(names: string[]): Promise<RuntimeInfo[]> {
  return Promise.all(names.map((name) => detectRuntimeFull(name)));
}

/**
 * 检测 vfox 是否安装
 */
export async function detectVfox(): Promise<VfoxInfo> {
  return new Promise((resolve) => {
    const childProcess = spawn("vfox", ["--version"], {
      shell: true,
      timeout: 5000,
    });

    let stdout = "";

    childProcess.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    childProcess.on("close", (code: number | null) => {
      if (code === 0 && stdout) {
        const match = stdout.match(/v?(\d+\.\d+\.\d+)/);
        const version = match?.[1];
        if (version) {
          resolve({ installed: true, version });
        } else {
          resolve({ installed: true });
        }
      } else {
        resolve({ installed: false });
      }
    });

    childProcess.on("error", () => {
      resolve({ installed: false });
    });

    setTimeout(() => {
      childProcess.kill();
      resolve({ installed: false });
    }, 5000);
  });
}

/**
 * 获取 vfox 当前使用的 SDK 版本
 */
export async function vfoxCurrent(sdk: string): Promise<string | null> {
  return new Promise((resolve) => {
    const childProcess = spawn("vfox", ["current", sdk], {
      shell: true,
      timeout: 5000,
    });

    let stdout = "";

    childProcess.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    childProcess.on("close", (code: number | null) => {
      if (code === 0 && stdout) {
        // 输出格式: python 3.12.0
        const match = stdout.trim().match(/\S+\s+(\S+)/);
        resolve(match?.[1] ?? null);
      } else {
        resolve(null);
      }
    });

    childProcess.on("error", () => {
      resolve(null);
    });

    setTimeout(() => {
      childProcess.kill();
      resolve(null);
    }, 5000);
  });
}

/**
 * 获取 vfox SDK 安装路径
 */
export async function vfoxGetPath(sdk: string, version?: string): Promise<string | null> {
  const versionArg = version ? `${sdk}@${version}` : sdk;

  return new Promise((resolve) => {
    const childProcess = spawn("vfox", ["info", "--format", "{{.Path}}", versionArg], {
      shell: true,
      timeout: 5000,
    });

    let stdout = "";

    childProcess.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    childProcess.on("close", (code: number | null) => {
      if (code === 0 && stdout) {
        resolve(stdout.trim() || null);
      } else {
        resolve(null);
      }
    });

    childProcess.on("error", () => {
      resolve(null);
    });

    setTimeout(() => {
      childProcess.kill();
      resolve(null);
    }, 5000);
  });
}

/**
 * 环境检测配置
 */
export interface EnvironmentCheckConfig {
  /** 要检测的运行时列表 */
  runtimes: string[];
  /** 是否检测 vfox */
  checkVfox: boolean;
}

/**
 * 默认环境检测配置
 */
export const defaultEnvironmentCheckConfig: EnvironmentCheckConfig = {
  runtimes: ["python", "node"],
  checkVfox: true,
};

/**
 * 完整环境检测结果
 */
export interface EnvironmentCheckResult {
  runtimes: RuntimeInfo[];
  vfox: VfoxInfo;
}

/**
 * 执行完整环境检测
 */
export async function checkEnvironment(
  config: EnvironmentCheckConfig = defaultEnvironmentCheckConfig
): Promise<EnvironmentCheckResult> {
  const [runtimes, vfox] = await Promise.all([
    detectRuntimes(config.runtimes),
    config.checkVfox ? detectVfox() : Promise.resolve({ installed: false }),
  ]);

  return {
    runtimes,
    vfox,
  };
}

/**
 * 检查必要环境是否满足
 */
export async function checkRequiredRuntimes(
  required: string[]
): Promise<{ satisfied: boolean; missing: string[] }> {
  const results = await detectRuntimes(required);
  const missing = results.filter((r) => !r.installed).map((r) => r.name);

  return {
    satisfied: missing.length === 0,
    missing,
  };
}
