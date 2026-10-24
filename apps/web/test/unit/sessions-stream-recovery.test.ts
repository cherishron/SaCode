import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { api } from '../../src/api/client';
import { useSessionsStore } from '../../src/stores/sessions';

vi.mock('../../src/api/client', () => ({ api: { streamUrl: () => '/stream', events: vi.fn() } }));
class FakeSource {
  static last: FakeSource;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  listeners = new Map<string, () => void>();
  close = vi.fn();
  constructor() {
    FakeSource.last = this;
  }
  addEventListener(name: string, handler: () => void) {
    this.listeners.set(name, handler);
  }
}
beforeEach(() => {
  setActivePinia(createPinia());
  vi.resetAllMocks();
  vi.stubGlobal('EventSource', FakeSource);
});
afterEach(() => vi.unstubAllGlobals());
function setup() {
  const store = useSessionsStore();
  store.selectedTargetId = 't';
  store.selectedSessionId = 's';
  store.cursor = 'cursor';
  store.connectStream();
  return { store, source: FakeSource.last };
}
describe('浏览器流恢复与旧回调隔离', () => {
  it('首次握手不重复读历史，自动重连按游标补读并保留实时内容', async () => {
    vi.mocked(api.events).mockResolvedValue({
      frames: [{ id: 'history', kind: 'message', at: '', summary: '补读' }],
      nextCursor: 'next',
      generation: 1,
    });
    const { store, source } = setup();
    source.onopen?.();
    expect(api.events).not.toHaveBeenCalled();
    source.onmessage?.({ data: JSON.stringify({ id: 'live', kind: 'message', at: '', summary: '实时' }) });
    source.onerror?.();
    source.onopen?.();
    await vi.waitFor(() => expect(store.refilling).toBe(false));
    expect(api.events).toHaveBeenCalledWith('t', 's', 'cursor');
    expect(store.events.map((f) => f.id)).toEqual(['live', 'history']);
  });
  it('返回首页后旧连接到达的帧、open和error全部无效', () => {
    const { store, source } = setup();
    store.returnHome();
    source.onmessage?.({ data: JSON.stringify({ id: 'old', kind: 'message' }) });
    source.onopen?.();
    source.onerror?.();
    expect(store.events).toEqual([]);
    expect(store.streamStatus).toBe('idle');
    expect(api.events).not.toHaveBeenCalled();
  });
  it('授权失效控制事件关闭流并提示重新登录', () => {
    const { store, source } = setup();
    source.listeners.get('auth-expired')?.();
    expect(source.close).toHaveBeenCalled();
    expect(store.es).toBeNull();
    expect(store.error).toBe('登录已失效，请重新登录');
  });
});
