import type {
  ToolDefinition,
  ExecuteCommandInput,
  ExecuteCommandOutput,
  ShellCapabilityConfig,
} from "../types";

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

async function detectVfox(): Promise<{ installed: boolean; version?: string }> {
  try {
    const proc = Bun.spawn(["vfox", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 5000,
    });

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    if (exitCode === 0 && stdout) {
      const match = stdout.match(/v?(\d+\.\d+\.\d+)/);
      const version = match?.[1];
      if (version) {
        return { installed: true, version };
      }
      return { installed: true };
    }
    return { installed: false };
  } catch {
    return { installed: false };
  }
}

let vfoxCache: { installed: boolean; version?: string } | null = null;

async function hasVfox(): Promise<boolean> {
  if (vfoxCache === null) {
    vfoxCache = await detectVfox();
  }
  return vfoxCache.installed;
}

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

  const vfoxCommand = `vfox exec ${sdk} -- ${command}`;

  try {
    const proc = Bun.spawn({
      cmd: [vfoxCommand],
      cwd: cwd ?? process.cwd(),
      env: { ...process.env, ...(env ?? {}) },
      stdout: "pipe",
      stderr: "pipe",
      timeout: actualTimeout,
    });

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    return {
      stdout,
      stderr,
      exitCode,
      success: exitCode === 0,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes("timeout")) {
      throw new Error(`Command timed out after ${actualTimeout}ms`);
    }
    throw error;
  }
}

function parseCommandForSdk(
  command: string,
  vfoxSdks: string[]
): string | null {
  const parts = command.trim().split(/\s+/);
  const commandName = parts[0];

  if (commandName === undefined) {
    return null;
  }

  if (vfoxSdks.length > 0 && vfoxSdks.includes(commandName)) {
    return VFOX_SDK_MAP[commandName] ?? commandName;
  }

  if (VFOX_SDK_MAP[commandName]) {
    return VFOX_SDK_MAP[commandName];
  }

  return null;
}

export function createShellTools(config: ShellCapabilityConfig): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

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

      const parts = command.trim().split(/\s+/);
      const commandName = parts[0];

      if (commandName === undefined) {
        throw new Error("Invalid command: empty command");
      }

      if (config.allowedCommands.length > 0 && !config.allowedCommands.includes(commandName)) {
        throw new Error(`Command not allowed: ${commandName}`);
      }

      if (config.useVfox) {
        const vfoxAvailable = await hasVfox();
        if (vfoxAvailable) {
          const sdk = parseCommandForSdk(command, config.vfoxSdks);
          if (sdk) {
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

      try {
        const proc = Bun.spawn({
          cmd: [command],
          cwd: cwd ?? process.cwd(),
          env: { ...process.env, ...(env ?? {}) },
          stdout: "pipe",
          stderr: "pipe",
          timeout: actualTimeout,
        });

        const exitCode = await proc.exited;
        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();

        return {
          stdout,
          stderr,
          exitCode,
          success: exitCode === 0,
        };
      } catch (error) {
        if (error instanceof Error && error.message.includes("timeout")) {
          throw new Error(`Command timed out after ${actualTimeout}ms`);
        }
        throw error;
      }
    },
  });

  return tools;
}

export function clearVfoxCache(): void {
  vfoxCache = null;
}

export async function getVfoxStatus(): Promise<{ installed: boolean; version?: string }> {
  return detectVfox();
}
