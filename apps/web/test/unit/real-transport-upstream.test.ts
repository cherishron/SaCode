// 上游失联可观测性：桌面 RemoteTransport 的 SSE pump 静默结束、无 onClose，
// 因此真实适配器以「轮询持久真源」兜底——既能取到事件，也能据此判定不可达。
import { describe, expect, it, vi } from 'vitest';
import type { TargetConfig } from '../../server/config.js';
import { RemoteTransportAdapter, type RealTransportHandle } from '../../server/daemon/real-transport.js';
import type { RawEventFrame } from '../../server/daemon/transport.js';

const cfg: TargetConfig = {
  id: 'real',
  label: '真实只读',
  baseUrl: 'https://daemon.example',
  credentialRef: 'WEB_TEST_TOKEN',
  workspaceId: 'ws-bound',
  instanceId: 'inst-bound',
};
const catalog = {
  root: '/private/root',
  entries: [{ id: 's1', title: '会话', status: 'idle', durable: 2, workspaceDirectory: '/private/root' }],
};
function page(generation = 'hash-a', seqs = ['0', '1']) {
  return {
    generation,
    nextSeq: seqs.at(-1) ?? '',
    hasMore: false,
    gap: null,
    events: seqs.map((seq) => ({ seq, eventType: 'user/message', data: `正文${seq}` })),
  };
}

interface ClockProbe {
  clock: {
    setIntervalImpl: (fn: () => void, ms: number) => unknown;
    clearIntervalImpl: (handle: unknown) => void;
    pollIntervalMs: number;
  };
  ticks: (() => void)[];
  cleared: unknown[];
}

function clockProbe(pollIntervalMs: number): ClockProbe {
  const ticks: (() => void)[] = [];
  const cleared: unknown[] = [];
  return {
    ticks,
    cleared,
    clock: {
      setIntervalImpl: (fn) => {
        ticks.push(fn);
        return ticks.length;
      },
      clearIntervalImpl: (handle) => {
        cleared.push(handle);
      },
      pollIntervalMs,
    },
  };
}

function fixture(pollIntervalMs: number, catalogError?: Error) {
  const probe = clockProbe(pollIntervalMs);
  const abort = vi.fn();
  const sendRequest = vi.fn(async (method: string): Promise<unknown> => {
    if (method === 'session/catalog') {
      if (catalogError) throw catalogError;
      return catalog;
    }
    if (method === 'initialize') {
      return {
        capabilities: ['initialize', 'session/catalog', 'session/events', 'task/start'],
        instanceId: 'inst-bound',
      };
    }
    if (method === 'session/events') return page();
    throw new Error('禁止非只读方法');
  });
  const handle: RealTransportHandle = {
    sendRequest,
    close: vi.fn(),
    subscribeNotifications: vi.fn(async () => ({ id: 'sub-1', abort })),
  };
  return { ...probe, adapter: new RemoteTransportAdapter(cfg, handle, probe.clock), handle, abort };
}

async function settle(): Promise<void> {
  // 补读是异步 Promise 链，等事件队列排空再断言。
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}

describe('上游失联可观测性', () => {
  it('SSE 通知静默时，轮询仍能从持久真源取到事件', async () => {
    const { adapter, ticks } = fixture(1000);
    const frames: RawEventFrame[] = [];
    const { close } = await adapter.subscribe((f) => frames.push(f));

    expect(ticks.length).toBe(1);
    ticks[0]!();
    await settle();

    // 关键：即使上游 pump 从不回调，也不出现"已连接却永远无数据"。
    expect(frames.length).toBe(2);
    expect(frames[0]?.sessionId).toBe('s1');
    close();
  });

  it('轮询失败判定上游不可达：通知一次且后续读取显式失败', async () => {
    const { adapter, ticks } = fixture(1000, new Error('network-down'));
    const frames: RawEventFrame[] = [];
    let lost = 0;
    const { close } = await adapter.subscribe((f) => frames.push(f), { onLost: () => (lost += 1) });

    ticks[0]!();
    await settle();

    expect(lost).toBe(1);
    // 不回落合成空成功：失联后读取必须显式抛错。
    await expect(adapter.getSessionEvents('s1', null, 10)).rejects.toThrow('real-upstream-unreachable');
    close();
  });

  it('关闭订阅会清理轮询定时器，不留下悬挂计时器', async () => {
    const { adapter, ticks, cleared } = fixture(1000);
    const { close } = await adapter.subscribe(() => {});
    expect(ticks.length).toBe(1);
    expect(cleared.length).toBe(0);

    close();
    expect(cleared.length).toBe(1);
  });

  it('轮询间隔为 0 时不启动定时器', async () => {
    const { adapter, ticks } = fixture(0);
    const { close } = await adapter.subscribe(() => {});
    expect(ticks.length).toBe(0);
    close();
  });

  it('关闭后的轮询 tick 不再触发补读', async () => {
    const { adapter, ticks, handle } = fixture(1000);
    const frames: RawEventFrame[] = [];
    const { close } = await adapter.subscribe((f) => frames.push(f));
    close();

    ticks[0]!();
    await settle();

    expect(frames.length).toBe(0);
    // 关闭后不应再向上游发请求（initialize 除外，它在订阅前完成）。
    const after = (handle.sendRequest as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] !== 'initialize',
    );
    expect(after.length).toBe(0);
  });
});
