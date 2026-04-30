import type { RuntimeInfo, VfoxInfo } from "../types";

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

export function getPlatformCommand(command: string): string {
  const mapping = PLATFORM_COMMANDS[command];
  if (mapping) {
    return process.platform === "win32" ? mapping.windows : mapping.unix;
  }
  return command;
}

export async function detectRuntime(name: string): Promise<RuntimeInfo> {
  const command = getPlatformCommand(name);

  try {
    const proc = Bun.spawn([command, "--version"], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 5000,
    });

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    if (exitCode === 0 && stdout) {
      const version = stdout.trim();
      return { name, installed: true, version };
    }

    return { name, installed: false };
  } catch {
    return { name, installed: false };
  }
}

export async function detectRuntimePath(name: string): Promise<string | null> {
  const command = getPlatformCommand(name);
  const whichCommand = process.platform === "win32" ? "where" : "which";

  try {
    const proc = Bun.spawn([whichCommand, command], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 5000,
    });

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    if (exitCode === 0 && stdout) {
      const paths = stdout.trim().split(/\r?\n/);
      return paths[0] ?? null;
    }

    return null;
  } catch {
    return null;
  }
}

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

export async function detectRuntimes(names: string[]): Promise<RuntimeInfo[]> {
  return Promise.all(names.map((name) => detectRuntimeFull(name)));
}

export async function detectVfox(): Promise<VfoxInfo> {
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

export async function vfoxCurrent(sdk: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(["vfox", "current", sdk], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 5000,
    });

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    if (exitCode === 0 && stdout) {
      const match = stdout.trim().match(/\S+\s+(\S+)/);
      return match?.[1] ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

export async function vfoxGetPath(sdk: string, version?: string): Promise<string | null> {
  const versionArg = version ? `${sdk}@${version}` : sdk;

  try {
    const proc = Bun.spawn(["vfox", "info", "--format", "{{.Path}}", versionArg], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 5000,
    });

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    if (exitCode === 0 && stdout) {
      return stdout.trim() || null;
    }
    return null;
  } catch {
    return null;
  }
}

export interface EnvironmentCheckConfig {
  runtimes: string[];
  checkVfox: boolean;
}

export const defaultEnvironmentCheckConfig: EnvironmentCheckConfig = {
  runtimes: ["python", "node"],
  checkVfox: true,
};

export interface EnvironmentCheckResult {
  runtimes: RuntimeInfo[];
  vfox: VfoxInfo;
}

export async function checkEnvironment(
  config: EnvironmentCheckConfig = defaultEnvironmentCheckConfig
): Promise<EnvironmentCheckResult> {
  const [runtimes, vfox] = await Promise.all([
    detectRuntimes(config.runtimes),
    config.checkVfox ? detectVfox() : Promise.resolve({ installed: false }),
  ]);

  return { runtimes, vfox };
}

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
