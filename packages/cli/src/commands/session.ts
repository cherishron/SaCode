import chalk from "chalk";
import enquirer from "enquirer";
import { existsSync, readdirSync, readFileSync, unlinkSync, rmSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const SACODE_DIR = join(homedir(), ".sacode");
const SESSIONS_DIR = join(SACODE_DIR, "sessions");

interface SessionInfo {
  id: string;
  channel: string;
  chatId: string;
  lastActiveAt: string;
  messageCount: number;
  tokenCount: number;
  model: string;
}

function ensureSessionsDir(): void {
  if (!existsSync(SESSIONS_DIR)) {
    return;
  }
}

function loadSessionFromDisk(sessionId: string): SessionInfo | null {
  const sessionFile = join(SESSIONS_DIR, sessionId, "session.json");
  if (!existsSync(sessionFile)) return null;

  try {
    const raw = readFileSync(sessionFile, "utf-8");
    return JSON.parse(raw) as SessionInfo;
  } catch {
    return null;
  }
}

function listSessionDirs(): string[] {
  if (!existsSync(SESSIONS_DIR)) return [];
  return readdirSync(SESSIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

export async function listSessions(options: { channel?: string; chatId?: string }): Promise<void> {
  console.log(chalk.cyan("[PL] Sessions\n"));

  const sessionDirs = listSessionDirs();

  if (sessionDirs.length === 0) {
    console.log(chalk.gray("No sessions found"));
    console.log(chalk.gray("Start a chat with 'sacode chat' to create a session"));
    return;
  }

  const sessions: SessionInfo[] = [];
  for (const dir of sessionDirs) {
    const info = loadSessionFromDisk(dir);
    if (info) sessions.push(info);
  }

  const filtered = sessions.filter((s) => {
    if (options.channel && s.channel !== options.channel) return false;
    if (options.chatId && s.chatId !== options.chatId) return false;
    return true;
  });

  if (filtered.length === 0) {
    console.log(chalk.gray("No sessions match the filter criteria"));
    return;
  }

  for (const session of filtered) {
    const channelIcon = getChannelIcon(session.channel);
    console.log(`  ${channelIcon} ${chalk.bold(session.id)}`);
    console.log(`      ${chalk.gray("Chat ID:")} ${session.chatId}`);
    console.log(`      ${chalk.gray("Model:")} ${session.model || "default"}`);
    console.log(`      ${chalk.gray("Messages:")} ${session.messageCount}`);
    console.log(`      ${chalk.gray("Tokens:")} ~${session.tokenCount}`);
    console.log(`      ${chalk.gray("Last Active:")} ${formatDate(session.lastActiveAt)}`);
    console.log();
  }

  console.log(chalk.gray(`Total: ${filtered.length} session(s)`));
}

export async function showSession(sessionId: string): Promise<void> {
  console.log(chalk.cyan(`[PL] Session: ${sessionId}\n`));

  const session = loadSessionFromDisk(sessionId);
  if (!session) {
    console.log(chalk.red(`Session not found: ${sessionId}`));
    return;
  }

  console.log(`  ${chalk.gray("Channel:")} ${getChannelIcon(session.channel)} ${session.channel}`);
  console.log(`  ${chalk.gray("Chat ID:")} ${session.chatId}`);
  console.log(`  ${chalk.gray("Model:")} ${session.model || "default"}`);
  console.log(`  ${chalk.gray("Last Active:")} ${formatDate(session.lastActiveAt)}`);
  console.log(`  ${chalk.gray("Messages:")} ${session.messageCount}`);
  console.log(`  ${chalk.gray("Token Count:")} ~${session.tokenCount}`);
}

export async function clearSessions(options: { channel?: string; chatId?: string }): Promise<void> {
  const sessionDirs = listSessionDirs();
  const toDelete: string[] = [];

  for (const dir of sessionDirs) {
    const info = loadSessionFromDisk(dir);
    if (!info) continue;

    if (options.channel && info.channel !== options.channel) continue;
    if (options.chatId && info.chatId !== options.chatId) continue;

    toDelete.push(dir);
  }

  if (toDelete.length === 0) {
    console.log(chalk.gray("No sessions match the filter criteria"));
    return;
  }

  console.log(chalk.yellow(`[!] Will delete ${toDelete.length} session(s):`));
  for (const id of toDelete) {
    console.log(chalk.gray(`  - ${id}`));
  }

  const answers = await enquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message: chalk.yellow("Are you sure you want to clear these session mappings?"),
      initial: false,
    },
  ]) as { confirm: boolean };

  if (!answers.confirm) {
    console.log(chalk.gray("Operation cancelled"));
    return;
  }

  let deleted = 0;
  for (const id of toDelete) {
    const sessionPath = join(SESSIONS_DIR, id);
    try {
      rmSync(sessionPath, { recursive: true, force: true });
      deleted++;
    } catch (err) {
      console.log(chalk.red(`  Failed to delete ${id}: ${err instanceof Error ? err.message : "unknown error"}`));
    }
  }

  console.log(chalk.green(`+ ${deleted} session(s) cleared`));
}

export async function clearSession(sessionId: string): Promise<void> {
  const sessionPath = join(SESSIONS_DIR, sessionId);
  if (!existsSync(sessionPath)) {
    console.log(chalk.red(`Session not found: ${sessionId}`));
    return;
  }

  const answers = await enquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message: chalk.yellow(`Are you sure you want to clear session ${sessionId}?`),
      initial: false,
    },
  ]) as { confirm: boolean };

  if (!answers.confirm) {
    console.log(chalk.gray("Operation cancelled"));
    return;
  }

  try {
    rmSync(sessionPath, { recursive: true, force: true });
    console.log(chalk.green(`+ Session ${sessionId} cleared`));
  } catch (err) {
    console.log(chalk.red(`Failed to clear session: ${err instanceof Error ? err.message : "unknown error"}`));
  }
}

function getChannelIcon(channel: string): string {
  const icons: Record<string, string> = {
    telegram: "[TG]",
    discord: "[DC]",
    feishu: "[FS]",
    dingtalk: "[DT]",
    qq: "[QQ]",
    whatsapp: "[WA]",
    slack: "[SL]",
    email: "[MAIL]",
    wechat: "[WX]",
    xiaoyi: "[XY]",
  };
  return icons[channel] || "[IM]";
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));

    if (minutes < 60) {
      return chalk.gray(`${minutes}m ago`);
    } else if (hours < 24) {
      return chalk.gray(`${hours}h ago`);
    } else {
      return date.toLocaleDateString();
    }
  } catch {
    return chalk.gray("unknown");
  }
}
