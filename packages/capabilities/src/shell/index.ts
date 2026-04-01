import { spawn } from "node:child_process";
import type {
  ToolDefinition,
  ExecuteCommandInput,
  ExecuteCommandOutput,
  ShellCapabilityConfig,
} from "../types";

/**
 * vfox 管理的 SDK 映射
 * 键：命令名称，值：vfox SDK 名称
 */
const VFOX_SDK_MAP: Record<string, string> = {
  python: "python",
  python3: "python",
  pip: "python",
  pip3: "python",
  node: "nodejs",
  npm: "nodejs",
  npx: "nodejs",
  pnpm: "nodejs",
  yarn: "nodejs",
};

/**
 * 检测是否安装了 vfox
 */
async function detectVfox(): Promise<{ installed: boolean; version?: string }> {
  return new Promise((resolve) => {
    const childProcess = spawn("vfox", ["--version"], {
      shell: true,
      timeout: 5000,
    });

    let stdout = "";
    let found = false;

    childProcess.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    childProcess.on("close", (code: number | null) => {
      if (code === 0 && stdout) {
        // vfox version x.x.x
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

    // 超时处理
    setTimeout(() => {
      if (!found) {
        childProcess.kill();
        resolve({ installed: false });
      }
    }, 5000);
  });
}

/**
 * 缓存 vfox 检测结果
 */
let vfoxCache: { installed: boolean; version?: string } | null = null;

/**
 * 检查 vfox 是否可用（带缓存）
 */
async function hasVfox(): Promise<boolean> {
  if (vfoxCache === null) {
    vfoxCache = await detectVfox();
  }
  return vfoxCache.installed;
}

/**
 * 使用 vfox exec 执行命令
 *
 * @param sdk - vfox SDK 名称
 * @param command - 要执行的命令
 * @param options - 执行选项
 */
async function executeWithVfox(
  sdk: string,
  command: string,
  options: {
    cwd?: string;
    timeout?: number;
    env?: Record<string, string>;
  }
): Promise<ExecuteCommandOutput> {
  const { cwd, timeout, env } = options;
  const actualTimeout = timeout ?? 60000;

  // vfox exec <sdk> -- <command>
  const vfoxCommand = `vfox exec ${sdk} -- ${command}`;

  return new Promise((resolve, reject) => {
    const spawnOptions = {
      cwd: cwd ?? process.cwd(),
      env: { ...process.env, ...(env ?? {}) },
      shell: true,
    };

    const childProcess = spawn(vfoxCommand, spawnOptions);

    let stdout = "";
    let stderr = "";

    childProcess.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    childProcess.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      childProcess.kill();
      reject(new Error(`Command timed out after ${actualTimeout}ms`));
    }, actualTimeout);

    childProcess.on("close", (code: number | null) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
        success: code === 0,
      });
    });

    childProcess.on("error", (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/**
 * 解析命令获取 SDK 名称
 */
function parseCommandForSdk(
  command: string,
  vfoxSdks: string[]
): string | null {
  const parts = command.trim().split(/\s+/);
  const commandName = parts[0];

  if (commandName === undefined) {
    return null;
  }

  // 检查是否在 vfox SDK 列表中
  if (vfoxSdks.length > 0 && vfoxSdks.includes(commandName)) {
    return VFOX_SDK_MAP[commandName] ?? commandName;
  }

  // 检查是否是已知的 vfox 管理的 SDK
  if (VFOX_SDK_MAP[commandName]) {
    return VFOX_SDK_MAP[commandName];
  }

  return null;
}

export function createShellTools(config: ShellCapabilityConfig): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  // execute_command
  tools.push({
    name: "execute_command",
    description: "执行 Shell 命令",
    inputSchema: {
      parse: (input: unknown) => {
        if (typeof input === "object" && input !== null && "command" in input) {
          return input as ExecuteCommandInput;
        }
        throw new Error("Invalid input");
      },
    } as unknown as ToolDefinition["inputSchema"],
    execute: async (input: unknown): Promise<ExecuteCommandOutput> => {
      if (!config.enabled) {
        throw new Error("Shell capability is disabled");
      }

      const { command, cwd, timeout, env } = input as ExecuteCommandInput;
      const actualTimeout = timeout ?? config.timeout;

      // 解析命令
      const parts = command.trim().split(/\s+/);
      const commandName = parts[0];

      if (commandName === undefined) {
        throw new Error("Invalid command: empty command");
      }

      // 检查命令是否在允许列表中
      if (config.allowedCommands.length > 0 && !config.allowedCommands.includes(commandName)) {
        throw new Error(`Command not allowed: ${commandName}`);
      }

      // 检查是否应该使用 vfox exec
      if (config.useVfox) {
        const vfoxAvailable = await hasVfox();
        if (vfoxAvailable) {
          const sdk = parseCommandForSdk(command, config.vfoxSdks);
          if (sdk) {
            // 使用 vfox exec 执行
            const vfoxOptions: { timeout: number; cwd?: string; env?: Record<string, string> } = {
              timeout: actualTimeout,
            };
            if (cwd) {
              vfoxOptions.cwd = cwd;
            }
            if (env) {
              vfoxOptions.env = env;
            }
            return executeWithVfox(sdk, command, vfoxOptions);
          }
        }
      }

      // 传统执行方式
      return new Promise((resolve, reject) => {
        const spawnOptions = {
          cwd: cwd ?? process.cwd(),
          env: { ...process.env, ...(env ?? {}) },
          shell: true,
        };

        const childProcess = spawn(command, spawnOptions);

        let stdout = "";
        let stderr = "";

        childProcess.stdout.on("data", (data: Buffer) => {
          stdout += data.toString();
        });

        childProcess.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });

        const timer = setTimeout(() => {
          childProcess.kill();
          reject(new Error(`Command timed out after ${actualTimeout}ms`));
        }, actualTimeout);

        childProcess.on("close", (code: number | null) => {
          clearTimeout(timer);
          resolve({
            stdout,
            stderr,
            exitCode: code ?? 1,
            success: code === 0,
          });
        });

        childProcess.on("error", (error: Error) => {
          clearTimeout(timer);
          reject(error);
        });
      });
    },
  });

  return tools;
}

/**
 * 清除 vfox 检测缓存
 * 用于测试或强制重新检测
 */
export function clearVfoxCache(): void {
  vfoxCache = null;
}

/**
 * 获取 vfox 状态信息
 */
export async function getVfoxStatus(): Promise<{ installed: boolean; version?: string }> {
  return detectVfox();
}