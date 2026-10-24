import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { api } from '../../src/api/client';
import { useSessionsStore } from '../../src/stores/sessions';

vi.mock('../../src/api/client', () => ({
  api: { sessions: vi.fn(), sessionDetail: vi.fn(), events: vi.fn() },
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  setActivePinia(createPinia());
  vi.resetAllMocks();
});
describe('返回首页与迟到响应隔离', () => {
  it('返回首页后迟到的会话详情不应恢复旧页面或打开流', async () => {
    const store = useSessionsStore();
    store.selectedTargetId = 'a';
    const request = deferred<Awaited<ReturnType<typeof api.sessionDetail>>>();
    vi.mocked(api.sessionDetail).mockReturnValue(request.promise);
    const connect = vi.spyOn(store, 'connectStream').mockImplementation(() => {});
    const pending = store.selectSession('old');
    store.returnHome();
    request.resolve({
      targetId: 'a',
      session: {
        id: 'old',
        title: '旧会话',
        status: 'idle',
        createdAt: '',
        updatedAt: '',
        workspaceId: 'ws',
      },
    });
    await pending;
    expect(store.selectedSessionId).toBeNull();
    expect(store.detail).toBeNull();
    expect(connect).not.toHaveBeenCalled();
    expect(api.events).not.toHaveBeenCalled();
  });
  it('切换目标后忽略旧目标迟到的目录', async () => {
    const store = useSessionsStore();
    const old = deferred<Awaited<ReturnType<typeof api.sessions>>>();
    vi.mocked(api.sessions)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({ targetId: 'new', workspaceId: 'new-ws', sessions: [] });
    const pending = store.selectTarget('old');
    await store.selectTarget('new');
    old.resolve({ targetId: 'old', workspaceId: 'old-ws', sessions: [] });
    await pending;
    expect(store.selectedTargetId).toBe('new');
    expect(store.workspaceId).toBe('new-ws');
  });
  it('返回首页后迟到的历史页不污染首页事件', async () => {
    const store = useSessionsStore();
    store.selectedTargetId = 'a';
    store.selectedSessionId = 's';
    const request = deferred<Awaited<ReturnType<typeof api.events>>>();
    vi.mocked(api.events).mockReturnValue(request.promise);
    const pending = store.loadEvents();
    store.returnHome();
    request.resolve({
      frames: [{ id: 'e', kind: 'message', at: '', summary: '旧内容' }],
      nextCursor: 'old',
      generation: 1,
    });
    await pending;
    expect(store.events).toEqual([]);
    expect(store.cursor).toBeNull();
    expect(store.loadingEvents).toBe(false);
  });
});
