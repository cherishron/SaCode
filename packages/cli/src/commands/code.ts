import type { CommandContext } from "./types.js";
import chalk from "chalk";

/**
 * 代码智能命令 — Claude Code 风格
 *
 * 子命令：
 *   sacode code          — 进入交互式 agentic 会话
 *   sacode code run <p>  — 执行单次 agentic 任务
 *   sacode code explain  — 解释代码（快捷方式）
 *   sacode code search   — 代码搜索（快捷方式）
 *   sacode code refactor — 重构建议（快捷方式）
 */

/** 打印流式事件的通用处理器 */
async function printStreamEvents(
  events: AsyncGenerator<import("../agent/types.js").StreamEvent>,
): Promise<void> {
  for await (const event of events) {
    switch (event.type) {
      case "thought":
        console.log(chalk.dim.italic(`💭 ${event.text}`));
        break;
      case "content":
        process.stdout.write(event.text);
        break;
      case "tool_call":
        console.log(
          chalk.gray(
            `  ⟳ ${event.name}(${Object.entries(event.args).map(([k, v]) => `${k}: ${JSON.stringify(v).slice(0, 40)}`).join(", ")})`,
          ),
        );
        break;
      case "tool_result":
        if (event.success) {
          const preview =
            typeof event.result === "string"
              ? event.result.slice(0, 100)
              : JSON.stringify(event.result).slice(0, 100);
          console.log(
            chalk.gray(
              `  ✓ ${event.name} ${event.duration ? `(${event.duration}ms)` : ""} — ${preview}${String(event.result).length > 100 ? "..." : ""}`,
            ),
          );
        } else {
          console.log(chalk.red(`  ✗ ${event.name} failed`));
        }
        break;
      case "citation":
        console.log(chalk.cyan(`  📎 Sources: ${event.sources.join(", ")}`));
        break;
      case "error":
        console.error(chalk.red(`Error: ${event.message}`));
        break;
      case "finished":
        console.log(
          chalk.green(
            `\nDone. (tokens: ${event.usage.totalTokens})`,
          ),
        );
        break;
    }
  }
}

/** 创建 AgenticLoop 实例 */
async function createLoop(opts: { maxIterations?: number } = {}) {
  const { AgenticLoop } = await import("../agent/loop.js");
  const { createDefaultTools } = await import("../tools/index.js");

  const rootDir = process.cwd();
  const tools = createDefaultTools(rootDir);

  return new AgenticLoop(
    {
      maxIterations: opts.maxIterations || 25,
      tools,
      contextWindow: 128_000,
      autoApprove: ["file_read", "file_search", "code_search"],
      requireApproval: ["file_write", "shell_exec", "diff_apply"],
    },
    rootDir,
  );
}

export function registerCodeCommand(ctx: CommandContext): void {
  const code = ctx.program
    .command("code")
    .description("代码智能功能 — Agentic 代码助手");

  // ─── sacode code (默认: 交互式会话) ───
  code.action(async () => {
    console.log(
      chalk.bold.cyan("SaCode Agentic Mode"),
      chalk.gray("— Type your request, Ctrl+C to exit\n"),
    );

    // 延迟加载 Ink TUI
    try {
      const { render } = await import("ink");
      const React = await import("react");
      const { ChatApp } = await import("../ui/App.js");
      if (ChatApp && render) {
        render(React.createElement(ChatApp as React.FC, {}));
        return;
      }
    } catch {
      // Ink/UI 模块不可用，fallback 到 readline 交互模式
    }

    // Fallback: readline 交互模式
    const { createInterface } = await import("readline");
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const prompt = () => {
      rl.question(chalk.cyan("\n> "), async (input) => {
        const trimmed = input.trim();
        if (!trimmed || trimmed === "/exit" || trimmed === "/quit") {
          console.log(chalk.gray("Goodbye."));
          rl.close();
          return;
        }

        if (trimmed === "/help") {
          console.log(chalk.yellow("Commands:"));
          console.log("  /exit, /quit  — Exit the session");
          console.log("  /help         — Show this help");
          console.log("  Anything else — Send to AI agent");
          prompt();
          return;
        }

        try {
          const loop = await createLoop();
          await printStreamEvents(loop.run(trimmed));
        } catch (err) {
          console.error(
            chalk.red(
              `Error: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
        }

        prompt();
      });
    };

    prompt();
  });

  // ─── sacode code run <prompt> ───
  code
    .command("run <prompt>")
    .description("执行单次 agentic 任务（非交互模式）")
    .option("-i, --iterations <n>", "最大迭代次数", "25")
    .action(async (prompt: string, opts: { iterations: string }) => {
      console.log(chalk.blue(`Running: "${prompt}"...\n`));

      const loop = await createLoop({
        maxIterations: parseInt(opts.iterations, 10) || 25,
      });

      await printStreamEvents(loop.run(prompt));
    });

  // ─── sacode code explain <file> ───
  code
    .command("explain <file>")
    .description("解释文件中的代码")
    .action(async (file: string) => {
      console.log(chalk.blue(`Analyzing ${file}...\n`));

      const loop = await createLoop({ maxIterations: 5 });
      await printStreamEvents(
        loop.run(
          `Please read and explain the code in file: ${file}. Provide a clear summary of what it does, its key functions, and any notable patterns.`,
        ),
      );
    });

  // ─── sacode code search <query> ───
  code
    .command("search <query>")
    .description("语义代码搜索")
    .option("-p, --pattern <glob>", "文件模式过滤")
    .option("-r, --regex", "使用正则搜索")
    .action(
      async (
        query: string,
        opts: { pattern?: string; regex?: boolean },
      ) => {
        const { createCodeSearchTool } = await import(
          "../tools/code-search.js"
        );

        console.log(chalk.blue(`Searching for "${query}"...\n`));

        const tool = createCodeSearchTool(process.cwd());
        const result = await tool.execute({
          query,
          filePattern: opts.pattern,
          isRegex: opts.regex || false,
        });

        if (result.success) {
          console.log(result.output);
        } else {
          console.error(chalk.red(result.error));
        }
      },
    );

  // ─── sacode code refactor <file> ───
  code
    .command("refactor <file>")
    .description("建议重构方案")
    .action(async (file: string) => {
      console.log(chalk.blue(`Analyzing ${file} for refactoring...\n`));

      const loop = await createLoop({ maxIterations: 10 });
      await printStreamEvents(
        loop.run(
          `Read the file ${file} and suggest refactoring improvements. Analyze code quality, identify code smells, and propose specific improvements. Do not make changes, only suggest.`,
        ),
      );
    });
}
