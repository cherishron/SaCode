import chalk from "chalk";
import ora from "ora";
import { SACODEClient } from "@SACODE/core";

interface ChatOptions {
  message?: string;
  session?: string;
}

export async function startChat(options: ChatOptions): Promise<void> {
  console.log(chalk.cyan("🦞 SACODE Chat Mode"));
  console.log(chalk.gray("Type your message and press Enter. Type 'exit' to quit.\n"));

  const spinner = ora("Connecting to iFlow...").start();

  const client = new SACODEClient({
    acpUrl: process.env.IFLOW_ACP_URL || "ws://localhost:8090/acp",
    autoStart: process.env.IFLOW_AUTO_START !== "false",
    timeout: parseInt(process.env.IFLOW_TIMEOUT || "60000", 10),
  });

  try {
    await client.connect();
    spinner.succeed("Connected to iFlow");
  } catch (error) {
    spinner.fail("Failed to connect to iFlow");
    console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
    process.exit(1);
  }

  // 单条消息模式
  if (options.message) {
    await sendSingleMessage(client, options.message, options.session);
    await client.disconnect();
    return;
  }

  // 交互模式
  const { createInterface } = await import("readline");
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askQuestion = (): void => {
    rl.question(chalk.green("You: "), async (input) => {
      const trimmed = input.trim();

      if (["exit", "quit", "q"].includes(trimmed.toLowerCase())) {
        console.log(chalk.cyan("\nGoodbye! 🦞"));
        await client.disconnect();
        rl.close();
        return;
      }

      if (trimmed) {
        await sendMessage(client, trimmed, options.session);
      }

      askQuestion();
    });
  };

  askQuestion();
}

async function sendSingleMessage(
  client: SACODEClient,
  message: string,
  sessionId?: string
): Promise<void> {
  process.stdout.write(chalk.cyan("SACODE: "));

  try {
    for await (const msg of client.chat(message, sessionId)) {
      if (msg.role === "assistant" && "chunk" in msg) {
        process.stdout.write(msg.chunk.text);
      }
    }
    console.log();
  } catch (error) {
    console.error(chalk.red("\nError:"), error instanceof Error ? error.message : "Unknown error");
  }
}

async function sendMessage(
  client: SACODEClient,
  message: string,
  sessionId?: string
): Promise<void> {
  process.stdout.write(chalk.cyan("SACODE: "));

  try {
    for await (const msg of client.chat(message, sessionId)) {
      if (msg.role === "assistant" && "chunk" in msg) {
        process.stdout.write(msg.chunk.text);
      } else if (msg.role === "tool") {
        console.log(chalk.gray(`\n[Tool: ${msg.toolName}] ${msg.status}`));
        process.stdout.write(chalk.cyan("SACODE: "));
      } else if (msg.role === "system" && "stopReason" in msg) {
        // 任务完成
        if (msg.stopReason === "error") {
          console.log(chalk.red("\n[Error occurred]"));
        }
      }
    }
    console.log();
  } catch (error) {
    console.error(chalk.red("\nError:"), error instanceof Error ? error.message : "Unknown error");
  }
}
