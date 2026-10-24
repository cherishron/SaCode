// 事件 broker：每 target 单条上游订阅 → 环形缓冲（≤500 帧）→ 多浏览器订阅者 fan-out。
// 不透明游标（含 target/session/lastEventId/generation），浏览器不可伪造跨会话。
// generation 变化（上游重建）清空环形并要求补读。慢客户端由 SSE 路由层处理断开。
import type { DaemonTransport, RawEventFrame } from '../daemon/transport.js';

const RING_CAP = 500;

export interface Subscriber {
  id: string;
  onFrame: (frame: RawEventFrame) => void;
  onRefillPrompt: () => void;
  /** 上游失联时回调一次；未提供则静默忽略（合成传输不会失联）。 */
  onUpstreamLost?: () => void;
}

export class EventBroker {
  private ring: RawEventFrame[] = [];
  private subscribers = new Map<string, Subscriber>();
  private subCounter = 0;
  private upstreamClose: (() => void) | null = null;
  private upstreamLost = false;
  private generation = 1;
  private sessionGenerations = new Map<string, number>();

  constructor(
    private readonly transport: DaemonTransport,
    private readonly hooks: { onUpstreamLost?: () => void } = {},
  ) {}

  async start(): Promise<void> {
    const { close } = await this.transport.subscribe((frame) => this.ingest(frame), {
      onLost: () => this.handleUpstreamLost(),
    });
    this.upstreamClose = close;
  }

  /**
   * 上游失联：关闭上游订阅并通知已建立的浏览器流。
   * 不做自动重连——重连须重新校验身份与绑定，由上层按策略处理，
   * 避免在没有凭据校验的情况下反复重连同一失效端点。
   */
  private handleUpstreamLost(): void {
    if (this.upstreamLost) return;
    this.upstreamLost = true;
    this.upstreamClose?.();
    for (const sub of [...this.subscribers.values()]) {
      try {
        sub.onUpstreamLost?.();
      } catch {
        /* 单个订阅者异常不影响其他订阅者 */
      }
    }
    // 通知 gateway 摘除本 broker，使后续请求能重建并重新校验上游。
    try {
      this.hooks.onUpstreamLost?.();
    } catch {
      /* 上层钩子异常不影响订阅者清理 */
    }
  }

  isUpstreamLost(): boolean {
    return this.upstreamLost;
  }

  private ingest(frame: RawEventFrame): void {
    const previous = this.sessionGenerations.get(frame.sessionId) ?? 1;
    if (frame.generation !== previous) {
      this.ring = this.ring.filter((item) => item.sessionId !== frame.sessionId);
      for (const sub of this.subscribers.values()) {
        try {
          sub.onRefillPrompt();
        } catch {
          /* 订阅者错误不阻断其他会话 */
        }
      }
    }
    this.sessionGenerations.set(frame.sessionId, frame.generation);
    this.generation = frame.generation;
    if (this.ring.some((item) => item.sessionId === frame.sessionId && item.id === frame.id)) return;
    this.ring.push(frame);
    if (this.ring.length > RING_CAP) this.ring.shift();
    for (const sub of this.subscribers.values()) {
      try {
        sub.onFrame(frame);
      } catch {
        // 单个慢订阅者异常不影响其他订阅者；SSE 路由层负责断开慢客户端
      }
    }
  }

  getGeneration(sessionId?: string): number {
    return sessionId ? (this.sessionGenerations.get(sessionId) ?? 1) : this.generation;
  }

  /** 不透明游标：base64url(JSON)。嵌入 targetId 防止跨 target 伪造。 */
  makeCursor(sessionId: string, lastEventId: string): string {
    const payload = JSON.stringify({
      t: this.transport.targetId,
      s: sessionId,
      e: lastEventId,
      g: this.getGeneration(sessionId),
    });
    return Buffer.from(payload).toString('base64url');
  }

  parseCursor(
    cursor: string | undefined,
  ): { sessionId: string; lastEventId: string; generation: number } | null {
    if (!cursor || cursor.length > 4096) return null;
    try {
      const obj = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>;
      if (obj['t'] !== this.transport.targetId) return null;
      if (
        typeof obj['s'] !== 'string' ||
        typeof obj['e'] !== 'string' ||
        !Number.isSafeInteger(obj['g']) ||
        Number(obj['g']) < 1
      )
        return null;
      return {
        sessionId: obj['s'],
        lastEventId: obj['e'],
        generation: typeof obj['g'] === 'number' ? obj['g'] : this.generation,
      };
    } catch {
      return null;
    }
  }

  /** 补读：从游标之后取帧；游标过期/跨会话返回 nextCursor=null，要求前端重新拉目录。 */
  async refill(
    sessionId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<{ frames: RawEventFrame[]; nextCursor: string | null }> {
    const parsed = this.parseCursor(cursor);
    if (cursor && (!parsed || parsed.sessionId !== sessionId)) {
      return { frames: [], nextCursor: null };
    }
    // 代次不符时从持久真源重新读取，绝不拿旧日志序号跳过新日志。
    const after = parsed?.generation === this.getGeneration(sessionId) ? parsed.lastEventId : null;
    const page = await this.transport.getSessionEvents(sessionId, after, Math.min(500, Math.max(1, limit)));
    if (page.generation !== this.getGeneration(sessionId)) {
      this.sessionGenerations.set(sessionId, page.generation);
      this.ring = this.ring.filter((item) => item.sessionId !== sessionId);
    }
    const last = page.frames[page.frames.length - 1];
    // 空页保留已消费位置；清成空串会令下一次补读从头重复。
    const nextCursor = this.makeCursor(sessionId, last?.id ?? after ?? '');
    return { frames: page.frames, nextCursor };
  }

  addSubscriber(sub: Omit<Subscriber, 'id'>): string {
    const id = `sub-${++this.subCounter}`;
    this.subscribers.set(id, { ...sub, id });
    return id;
  }

  removeSubscriber(id: string): void {
    this.subscribers.delete(id);
  }

  snapshotRing(sessionId: string): RawEventFrame[] {
    return this.ring.filter((f) => f.sessionId === sessionId);
  }

  stop(): void {
    this.upstreamClose?.();
    this.subscribers.clear();
  }
}
