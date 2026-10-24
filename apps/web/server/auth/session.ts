import { randomBytes } from 'node:crypto';

export interface SessionRecord {
  id: string;
  csrfToken: string;
  ownerId: string;
  username: string;
  createdAt: number;
  lastActivityAt: number;
  absoluteExpiresAt: number;
}

/**
 * 进程内会话存储。BFF 重启即全部失效，用户需重新登录（明确策略，非缺陷）。
 * 会话数据只在服务端保存；cookie 只存不透明 id。
 */
export class SessionStore {
  private sessions = new Map<string, SessionRecord>();
  private revocations = new Map<string, Set<() => void>>();

  constructor(
    private readonly idleMs: number,
    private readonly absoluteMs: number,
  ) {}

  create(ownerId: string, username: string): SessionRecord {
    const now = Date.now();
    const rec: SessionRecord = {
      id: randomBytes(32).toString('base64url'),
      csrfToken: randomBytes(32).toString('base64url'),
      ownerId,
      username,
      createdAt: now,
      lastActivityAt: now,
      absoluteExpiresAt: now + this.absoluteMs,
    };
    this.sessions.set(rec.id, rec);
    return rec;
  }

  /** 只校验不续期；活动续期须显式 touch，SSE 心跳不计入活动。 */
  get(id: string | undefined): SessionRecord | null {
    if (!id) return null;
    const rec = this.sessions.get(id);
    if (!rec) return null;
    const now = Date.now();
    if (now >= rec.absoluteExpiresAt || now - rec.lastActivityAt > this.idleMs) {
      this.destroy(id);
      return null;
    }
    return rec;
  }

  /** 刷新闲置计时（活动定义排除 SSE 心跳）。 */
  touch(id: string): void {
    const rec = this.get(id);
    if (rec) rec.lastActivityAt = Date.now();
  }

  destroy(id: string | undefined): void {
    if (!id) return;
    this.sessions.delete(id);
    const listeners = this.revocations.get(id);
    this.revocations.delete(id);
    for (const listener of listeners ?? []) listener();
  }

  /** 长连接绑定登录会话；销毁、轮换及过期回收均通知，调用方负责解绑。 */
  onRevoke(id: string, listener: () => void): () => void {
    if (!this.get(id)) {
      listener();
      return () => {};
    }
    let listeners = this.revocations.get(id);
    if (!listeners) {
      listeners = new Set();
      this.revocations.set(id, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.revocations.delete(id);
    };
  }

  /** 登录轮换：销毁旧会话，新建会话（换新 id 与 csrf）。 */
  rotate(oldId: string | undefined, ownerId: string, username: string): SessionRecord {
    this.destroy(oldId);
    return this.create(ownerId, username);
  }

  sweep(): number {
    const now = Date.now();
    let removed = 0;
    for (const [id, rec] of this.sessions) {
      if (now >= rec.absoluteExpiresAt || now - rec.lastActivityAt > this.idleMs) {
        this.destroy(id);
        removed++;
      }
    }
    return removed;
  }

  size(): number {
    return this.sessions.size;
  }
}
