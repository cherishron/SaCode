/**
 * shell_exec 工具 — 执行 Shell 命令
 */
import type { Tool, ToolResult } from "../agent/types.js";

const DEFAULT_TIMEOUT = 30_000; // 30 seconds
const MAX_OUTPUT = 10_000; // 10KB output limit

export function createShellExecTool(rootDir: string): Tool {
  return {
    name: "shell_exec",
    description:
      "Execute a shell command and return stdout/stderr. Use for running tests, builds, git commands, linting, etc. Default timeout: 30s.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Shell command to execute",
        },
        cwd: {
          type: "string",
          description: "Working directory (default: project root)",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default: 30000)",
        },
      },
      required: ["command"],
    },
    requiresApproval: true,

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
      const { execSync } = await import("child_process");
      const { resolve } = await import("path");

      const command = String(args.command);
      const cwd = args.cwd ? resolve(rootDir, String(args.cwd)) : rootDir;
      const timeout = Number(args.timeout) || DEFAULT_TIMEOUT;

      try {
        const output = execSync(command, {
          cwd,
          encoding: "utf-8",
          timeout,
          maxBuffer: 1024 * 1024, // 1MB buffer
          stdio: ["pipe", "pipe", "pipe"],
        });

        const trimmed =
          output.length > MAX_OUTPUT
            ? output.slice(0, MAX_OUTPUT) +
              `\n... [truncated, ${output.length - MAX_OUTPUT} chars omitted]`
            : output;

        return {
          success: true,
          output: trimmed,
          metadata: { command, cwd, exitCode: 0 },
        };
      } catch (err: unknown) {
        const execError = err as {
          stdout?: string;
          stderr?: string;
          message: string;
          status?: number;
        };

        const stdout = execError.stdout || "";
        const stderr = execError.stderr || "";
        const combined = [stdout, stderr].filter(Boolean).join("\n");
        const output =
          combined.length > MAX_OUTPUT
            ? combined.slice(0, MAX_OUTPUT) + "\n... [truncated]"
            : combined;

        return {
          success: false,
          output,
          error: execError.message,
          metadata: {
            command,
            cwd,
            exitCode: execError.status ?? 1,
          },
        };
      }
    },
  };
}

/** 向后兼容的导出 */
export const shellExecTool: Tool = createShellExecTool(process.cwd());
