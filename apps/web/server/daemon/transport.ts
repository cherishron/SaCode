// BFF 与 daemon 之间的受控传输契约。BFF 只通过此方法集访问上游，
// 绝不直接暴露 { method: any, params: any } 透传入口。
// catalog/detail 返回“原始上游记录”，由 mapper 在 BFF 边界做白名单挑选，
// 这样新增的上游字段（含 secret/credentialRef）不会自动泄露到浏览器。

export interface DaemonInit {
  capabilities: string[];
  workspaceId: string | null;
  instanceId: string;
}

export interface RawEventFrame {
  id: string;
  kind: string;
  at: string;
  summary: string;
  sessionId: string;
  generation: number;
}

export interface RawEventsPage {
  frames: RawEventFrame[];
  nextCursor: string | null;
  generation: number;
}

export interface DaemonTransport {
  readonly targetId: string;
  initialize(): Promise<DaemonInit>;
  catalogSessions(workspaceId: string): Promise<Record<string, unknown>[]>;
  getSessionDetail(sessionId: string): Promise<Record<string, unknown>>;
  getSessionEvents(sessionId: string, afterEventId: string | null, limit: number): Promise<RawEventsPage>;
  /**
   * 订阅上游帧。`opts.onLost` 在判定上游失联时回调一次（尽力而为）。
   * 上游 pump 静默结束无法被直接观测（桌面 RemoteTransport 无 onClose），
   * 真实实现以轮询持久真源作为兜底：既能取到事件，也能据此判定不可达。
   */
  subscribe(
    onFrame: (frame: RawEventFrame) => void,
    opts?: { onLost?: () => void },
  ): Promise<{ close: () => void }>;
  close(): void;
}

/**
 * 合成 daemon 传输，用于 W01/W02-A 的安全面与只读链路测试。
 * 数据确定性生成，便于断言；不产生实时帧。
 */
export class SimulatedDaemonTransport implements DaemonTransport {
  readonly targetId: string;
  private frameCallbacks = new Set<(f: RawEventFrame) => void>();
  private sessions: Record<string, unknown>[] = [];
  private details = new Map<string, Record<string, unknown>>();
  private allFrames: RawEventFrame[] = [];

  constructor(targetId: string) {
    this.targetId = targetId;
    const ws = `ws-${targetId}`;
    for (let i = 1; i <= 6; i++) {
      const id = `sess-${i}`;
      const created = new Date(Date.UTC(2026, 9, 20, 8, i, 0)).toISOString();
      const status = i % 2 === 1 ? 'active' : 'idle';
      this.sessions.push({ id, title: `会话 ${i}`, status, createdAt: created, updatedAt: created });
      this.details.set(id, {
        id,
        title: `会话 ${i}`,
        status,
        createdAt: created,
        updatedAt: created,
        workspaceId: ws,
      });
      for (let f = 1; f <= 10; f++) {
        this.allFrames.push({
          id: `${id}-e${f}`,
          kind: f % 3 === 0 ? 'tool' : 'message',
          at: new Date(Date.UTC(2026, 9, 20, 9, f, 0)).toISOString(),
          summary: `会话 ${i} 事件 ${f}`,
          sessionId: id,
          generation: 1,
        });
      }
    }
  }

  async initialize(): Promise<DaemonInit> {
    return {
      capabilities: ['initialize', 'session/catalog', 'session/events'],
      workspaceId: `ws-${this.targetId}`,
      instanceId: `inst-${this.targetId}`,
    };
  }

  async catalogSessions(_workspaceId: string): Promise<Record<string, unknown>[]> {
    return this.sessions;
  }

  async getSessionDetail(sessionId: string): Promise<Record<string, unknown>> {
    const d = this.details.get(sessionId);
    if (!d) throw new Error('unknown-session');
    return d;
  }

  async getSessionEvents(
    sessionId: string,
    afterEventId: string | null,
    limit: number,
  ): Promise<RawEventsPage> {
    const frames = this.allFrames.filter((f) => f.sessionId === sessionId);
    const idx = afterEventId ? frames.findIndex((f) => f.id === afterEventId) : -1;
    const slice = idx >= 0 ? frames.slice(idx + 1) : frames;
    const taken = slice.slice(0, limit);
    const last = taken[taken.length - 1];
    return { frames: taken, nextCursor: last ? last.id : null, generation: 1 };
  }

  async subscribe(onFrame: (frame: RawEventFrame) => void): Promise<{ close: () => void }> {
    this.frameCallbacks.add(onFrame);
    return { close: () => this.frameCallbacks.delete(onFrame) };
  }

  /**
   * 驱动一帧合成事件（供验证/演示用，默认不自动推送，保持确定性）。
   * 经 broker 进环形缓冲并 fan-out 给全部订阅者，用于验证实时链路。
   */
  emit(frame: RawEventFrame): void {
    for (const cb of [...this.frameCallbacks]) cb(frame);
  }

  close(): void {
    this.frameCallbacks.clear();
  }
}
