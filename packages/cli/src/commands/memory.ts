import chalk from "chalk";
import type { MemoryManager } from "@sacode/core";

const defaultSessionsDir = process.env.SACODE_SESSIONS_DIR || "sessions";

async function getMemoryManager(): Promise<MemoryManager> {
  const { createMemoryManager } = await import("@sacode/core");
  return createMemoryManager({ sessionsDir: defaultSessionsDir });
}

export async function listMemory(): Promise<void> {
  const manager = await getMemoryManager();

  const sessions = await manager.listSessions();

  if (sessions.length === 0) {
    console.log(chalk.gray("[!] No memory sessions found"));
    return;
  }

  console.log(chalk.cyan("[D] Memory Sessions\n"));

  for (const sessionId of sessions) {
    try {
      const memory = await manager.getSessionMemory(sessionId);
      const size = memory.content.length;
      const sizeLabel = size > 50000 ? chalk.red(`${(size / 1024).toFixed(1)}KB`) : chalk.green(`${(size / 1024).toFixed(1)}KB`);
      const updated = memory.updatedAt.toISOString().split("T")[0] ?? "";
      const compacted = memory.metadata.compacted ? chalk.yellow("[C]") : "";

      console.log(`  ${chalk.bold(sessionId.padEnd(30))} ${sizeLabel}  ${updated}  ${compacted}`);
    } catch {
      console.log(`  ${chalk.bold(sessionId.padEnd(30))} ${chalk.red("[error]")}`);
    }
  }
}

export async function showMemory(sessionId: string): Promise<void> {
  const manager = await getMemoryManager();

  try {
    const memory = await manager.getSessionMemory(sessionId);

    console.log(chalk.cyan("[D] Memory Content\n"));
    console.log(chalk.gray(`Session: ${sessionId}`));
    console.log(chalk.gray(`Created: ${memory.createdAt.toISOString()}`));
    console.log(chalk.gray(`Updated: ${memory.updatedAt.toISOString()}`));
    console.log(chalk.gray(`Size:    ${memory.content.length} chars`));
    if (memory.metadata.compacted) {
      console.log(chalk.yellow("Status:  Compacted"));
    }
    console.log();
    console.log(memory.content);
  } catch {
    console.log(chalk.red(`[x] Memory not found: ${sessionId}`));
    console.log(chalk.gray("  Run 'sacode memory list' to see available sessions"));
  }
}

export async function searchMemory(query: string): Promise<void> {
  const manager = await getMemoryManager();

  const results = await manager.searchMemory(query);

  if (results.length === 0) {
    console.log(chalk.gray(`[!] No results for: "${query}"`));
    return;
  }

  console.log(chalk.cyan(`[D] Search Results for "${query}"\n`));

  for (const result of results) {
    console.log(`  ${chalk.bold(result.sessionId)} ${chalk.gray(`(relevance: ${result.relevance.toFixed(2)})`)}`);
    console.log(`    ${chalk.gray(result.content.slice(0, 120).replace(/\n/g, " "))}...`);
    console.log();
  }
}

export async function appendMemory(sessionId: string, content: string): Promise<void> {
  const manager = await getMemoryManager();

  try {
    await manager.initSession(sessionId);
    const memory = await manager.updateSessionMemory(sessionId, content, "append");

    console.log(chalk.green("+ Memory updated"));
    console.log(chalk.gray(`  Session: ${sessionId}`));
    console.log(chalk.gray(`  Size: ${memory.content.length} chars`));
  } catch (e) {
    console.log(chalk.red(`[x] Failed to update memory: ${e instanceof Error ? e.message : String(e)}`));
  }
}

export async function compactMemory(sessionId: string): Promise<void> {
  const manager = await getMemoryManager();

  try {
    const before = await manager.getSessionMemory(sessionId);
    const after = await manager.compactMemory(sessionId);

    const ratio = ((1 - after.content.length / before.content.length) * 100).toFixed(1);

    console.log(chalk.green("+ Memory compacted"));
    console.log(chalk.gray(`  Before: ${before.content.length} chars`));
    console.log(chalk.gray(`  After:  ${after.content.length} chars`));
    console.log(chalk.gray(`  Saved:  ${ratio}%`));
  } catch (e) {
    console.log(chalk.red(`[x] Failed to compact memory: ${e instanceof Error ? e.message : String(e)}`));
  }
}

export async function deleteMemory(sessionId: string): Promise<void> {
  const manager = await getMemoryManager();

  const deleted = await manager.deleteSessionMemory(sessionId);

  if (deleted) {
    console.log(chalk.green("+ Memory deleted"));
    console.log(chalk.gray(`  Session: ${sessionId}`));
  } else {
    console.log(chalk.red(`[x] Memory not found: ${sessionId}`));
  }
}
