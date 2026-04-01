/**
 * 会话管理器
 */

import { v4 as uuidv4 } from "uuid";
import type { Session, SessionType } from "../protocol/index.js";

interface SessionCreateOptions {
  userId: string;
  type: SessionType;
  channel?: string | undefined;
  chatId?: string | undefined;
  model?: string | undefined;
}

interface SessionUpdateStats {
  messageCount?: number;
  tokenCount?: number;
}

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private userSessions: Map<string, Set<string>> = new Map();

  /**
   * 创建新会话
   */
  async create(options: SessionCreateOptions): Promise<Session> {
    const now = Date.now();
    const session: Session = {
      id: uuidv4(),
      type: options.type,
      channel: options.channel,
      chatId: options.chatId,
      model: options.model,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      tokenCount: 0,
    };

    this.sessions.set(session.id, session);

    // 用户索引
    let userSessionSet = this.userSessions.get(options.userId);
    if (!userSessionSet) {
      userSessionSet = new Set();
      this.userSessions.set(options.userId, userSessionSet);
    }
    userSessionSet.add(session.id);

    return session;
  }

  /**
   * 获取会话
   */
  async get(sessionId: string): Promise<Session | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  /**
   * 列出用户的所有会话
   */
  async listByUser(userId: string): Promise<Session[]> {
    const sessionIds = this.userSessions.get(userId);
    if (!sessionIds) return [];

    return Array.from(sessionIds)
      .map((id) => this.sessions.get(id))
      .filter((s): s is Session => s !== undefined);
  }

  /**
   * 更新会话统计
   */
  async updateStats(sessionId: string, stats: SessionUpdateStats): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (stats.messageCount) {
      session.messageCount += stats.messageCount;
    }
    if (stats.tokenCount) {
      session.tokenCount = (session.tokenCount ?? 0) + stats.tokenCount;
    }
    session.updatedAt = Date.now();
  }

  /**
   * 重置会话（保留 ID，清除历史）
   */
  async reset(sessionId: string): Promise<Session> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const now = Date.now();
    session.createdAt = now;
    session.updatedAt = now;
    session.messageCount = 0;
    session.tokenCount = 0;

    return session;
  }

  /**
   * 删除会话
   */
  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);

    // 从用户索引中移除
    for (const sessionIds of this.userSessions.values()) {
      sessionIds.delete(sessionId);
    }
  }

  /**
   * 获取会话数量
   */
  size(): number {
    return this.sessions.size;
  }
}
