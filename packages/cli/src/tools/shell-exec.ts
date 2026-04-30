import type { Tool, ToolResult } from "../agent/types.js";

const DEFAULT_TIMEOUT = 30_000;
const MAX_OUTPUT = 10_000;

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
      const { resolve } = await import("path");

      const command = String(args.command);
      const cwd = args.cwd ? resolve(rootDir, String(args.cwd)) : rootDir;
      const timeout = Number(args.timeout) || DEFAULT_TIMEOUT;

      try {
        const proc = Bun.spawnSync({
          cmd: [command],
          cwd,
          env: process.env,
          stdout: "pipe",
          stderr: "pipe",
          timeout,
          maxBuffer: 1024 * 1024,
        });

        const stdout = proc.stdout?.toString() ?? "";
        const stderr = proc.stderr?.toString() ?? "";

        if (proc.exitCode === 0) {
          const trimmed =
            stdout.length > MAX_OUTPUT
              ? stdout.slice(0, MAX_OUTPUT) +
                `\n... [truncated, ${stdout.length - MAX_OUTPUT} chars omitted]`
              : stdout;

          return {
            success: true,
            output: trimmed,
            metadata: { command, cwd, exitCode: 0 },
          };
        }

        const combined = [stdout, stderr].filter(Boolean).join("\n");
        const output =
          combined.length > MAX_OUTPUT
            ? combined.slice(0, MAX_OUTPUT) + "\n... [truncated]"
            : combined;

        return {
          success: false,
          output,
          error: stderr || `Process exited with code ${proc.exitCode ?? 1}`,
          metadata: {
            command,
            cwd,
            exitCode: proc.exitCode ?? 1,
          },
        };
      } catch (err: unknown) {
        const error = err as Error;
        return {
          success: false,
          output: "",
          error: error.message,
          metadata: {
            command,
            cwd,
            exitCode: 1,
          },
        };
      }
    },
  };
}

export const shellExecTool: Tool = createShellExecTool(process.cwd());
