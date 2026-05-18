import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SACODE_DIR = join(homedir(), ".sacode");
const SESSIONS_DIR = join(SACODE_DIR, "sessions");

export interface SessionInfo {
  id: string;
  channel: string;
  chatId: string;
  lastActiveAt: string;
  messageCount: number;
  tokenCount: number;
  model: string;
}

export function loadSessionInfo(sessionId: string): SessionInfo | null {
  const sessionFile = join(SESSIONS_DIR, sessionId, "session.json");
  if (!existsSync(sessionFile)) return null;

  try {
    return JSON.parse(readFileSync(sessionFile, "utf-8")) as SessionInfo;
  } catch {
    return null;
  }
}

export function listSessionInfos(options: { channel?: string; chatId?: string } = {}): SessionInfo[] {
  if (!existsSync(SESSIONS_DIR)) return [];

  return readdirSync(SESSIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => loadSessionInfo(entry.name))
    .filter((session): session is SessionInfo => Boolean(session))
    .filter((session) => {
      if (options.channel && session.channel !== options.channel) return false;
      if (options.chatId && session.chatId !== options.chatId) return false;
      return true;
    });
}

export function formatSessionList(sessions: SessionInfo[]): string {
  if (sessions.length === 0) {
    return "No sessions found";
  }

  return [
    "Sessions",
    "",
    ...sessions.flatMap((session) => [
      `- ${session.id}`,
      `  Channel: ${session.channel}`,
      `  Chat ID: ${session.chatId}`,
      `  Model: ${session.model || "default"}`,
      `  Messages: ${session.messageCount}`,
      `  Tokens: ~${session.tokenCount}`,
      `  Last Active: ${formatSessionDate(session.lastActiveAt)}`,
      "",
    ]),
    `Total: ${sessions.length} session(s)`,
  ].join("\n");
}

export function formatSessionInfo(session: SessionInfo): string {
  return [
    `Session: ${session.id}`,
    `Channel: ${session.channel}`,
    `Chat ID: ${session.chatId}`,
    `Model: ${session.model || "default"}`,
    `Last Active: ${formatSessionDate(session.lastActiveAt)}`,
    `Messages: ${session.messageCount}`,
    `Token Count: ~${session.tokenCount}`,
  ].join("\n");
}

function formatSessionDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));

    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleDateString();
  } catch {
    return "unknown";
  }
}
