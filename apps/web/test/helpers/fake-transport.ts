// 测试用合成 daemon 传输：可控 seed / push，用于 broker 与事件链路单测。
import type {
  DaemonInit,
  DaemonTransport,
  RawEventFrame,
  RawEventsPage,
} from '../../server/daemon/transport.js';

export class FakeTransport implements DaemonTransport {
  readonly targetId: string;
  private frames: RawEventFrame[] = [];
  private subscribers: ((f: RawEventFrame) => void)[] = [];

  constructor(targetId = 'fake-1') {
    this.targetId = targetId;
  }

  async initialize(): Promise<DaemonInit> {
    return {
      capabilities: ['initialize', 'session/catalog', 'session/events'],
      workspaceId: 'ws-fake',
      instanceId: 'inst-fake',
    };
  }

  async catalogSessions(): Promise<unknown[]> {
    return [{ id: 's1', title: 'S1', status: 'active', createdAt: '', updatedAt: '' }];
  }

  async getSessionDetail(sessionId: string): Promise<unknown> {
    return {
      id: sessionId,
      title: 'S1',
      status: 'active',
      createdAt: '',
      updatedAt: '',
      workspaceId: 'ws-fake',
    };
  }

  async getSessionEvents(
    sessionId: string,
    afterEventId: string | null,
    limit: number,
  ): Promise<RawEventsPage> {
    const f = this.frames.filter((x) => x.sessionId === sessionId);
    const idx = afterEventId ? f.findIndex((x) => x.id === afterEventId) : -1;
    const slice = idx >= 0 ? f.slice(idx + 1) : f;
    const taken = slice.slice(0, limit);
    const last = taken[taken.length - 1];
    return { frames: taken, nextCursor: last ? last.id : null, generation: 1 };
  }

  async subscribe(onFrame: (f: RawEventFrame) => void): Promise<{ close: () => void }> {
    this.subscribers.push(onFrame);
    return {
      close: () => {
        const i = this.subscribers.indexOf(onFrame);
        if (i >= 0) this.subscribers.splice(i, 1);
      },
    };
  }

  seed(frames: RawEventFrame[]): void {
    this.frames.push(...frames);
  }

  push(frame: RawEventFrame): void {
    for (const s of this.subscribers) s(frame);
  }

  close(): void {
    this.subscribers = [];
  }
}
