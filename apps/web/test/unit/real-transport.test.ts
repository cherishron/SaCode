import { describe, expect, it, vi } from 'vitest';
import type { TargetConfig } from '../../server/config.js';
import {
  RealReplayGapError,
  RemoteTransportAdapter,
  realTransportOptions,
  type RealTransportHandle,
} from '../../server/daemon/real-transport.js';
import type { RawEventFrame } from '../../server/daemon/transport.js';

const cfg: TargetConfig = {
  id: 'real',
  label: '真实只读',
  baseUrl: 'https://daemon.example',
  credentialRef: 'WEB_TEST_TOKEN',
  workspaceId: 'ws-bound',
  instanceId: 'inst-bound',
};
const caps = ['initialize', 'session/catalog', 'session/events'];
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
function fixture() {
  let notify: (frame: unknown) => void = () => {};
  const abort = vi.fn();
  const sendRequest = vi.fn(async (method: string, _params: unknown): Promise<unknown> => {
    if (method === 'initialize') return { capabilities: [...caps, 'task/start'], instanceId: 'inst-bound' };
    if (method === 'session/catalog') return catalog;
    if (method === 'session/events') return page();
    throw new Error('禁止非只读方法');
  });
  const handle: RealTransportHandle = {
    sendRequest,
    close: vi.fn(),
    subscribeNotifications: vi.fn(async (cb) => {
      notify = cb;
      return { id: 'sub-1', abort };
    }),
  };
  return {
    adapter: new RemoteTransportAdapter(cfg, handle),
    handle,
    sendRequest,
    abort,
    push: (f: unknown) => notify(f),
  };
}

describe('真实只读传输配置', () => {
  it('传入tokenProvider而非credentialRef，不把凭据写入选项', async () => {
    const options = realTransportOptions(cfg, { WEB_TEST_TOKEN: '仅测试凭据' });
    expect(await options.tokenProvider()).toBe('仅测试凭据');
    expect(options).not.toHaveProperty('credentialRef');
    expect(JSON.stringify(options)).not.toContain('仅测试凭据');
    expect(() => realTransportOptions(cfg, {})).toThrow('real-credential-unavailable');
    expect(() => realTransportOptions({ ...cfg, credentialRef: '/a/token' }, {})).toThrow(
      'real-credential-reference-invalid',
    );
  });
  it.each([
    'http://remote.example',
    'https://u:p@remote.example',
    'https://remote.example?token=x',
    'https://remote.example#secret',
    'file:///tmp/daemon',
    'http://127.0.0.1.evil.example',
  ])('拒绝不安全目标 %s', (baseUrl) => {
    expect(() => realTransportOptions({ ...cfg, baseUrl }, { WEB_TEST_TOKEN: 'test-only' })).toThrow(
      'real-base-url-unsafe',
    );
  });
  it.each(['http://127.0.0.1:9999', 'http://[::1]:9999', 'http://localhost:9999'])(
    '允许受保护回环例外 %s',
    (baseUrl) => {
      expect(realTransportOptions({ ...cfg, baseUrl }, { WEB_TEST_TOKEN: 'test-only' }).baseUrl).toBe(
        baseUrl,
      );
    },
  );
  it('必须由服务端配置workspace和instance', () => {
    expect(() => realTransportOptions({ ...cfg, workspaceId: undefined }, {})).toThrow(
      'real-resource-binding-required',
    );
    expect(() => new RemoteTransportAdapter({ ...cfg, instanceId: undefined }, fixture().handle)).toThrow(
      'real-resource-binding-required',
    );
  });
});

describe('真实只读协议适配', () => {
  it('initialize携带绑定workspace，核instance且仅公布三种只读能力', async () => {
    const f = fixture();
    expect(await f.adapter.initialize()).toEqual({
      capabilities: caps,
      instanceId: 'inst-bound',
      workspaceId: 'ws-bound',
    });
    expect(f.sendRequest).toHaveBeenCalledWith('initialize', { workspaceId: 'ws-bound' });
    const mismatch = fixture();
    mismatch.sendRequest.mockResolvedValue({ instanceId: 'other', capabilities: caps });
    await expect(mismatch.adapter.initialize()).rejects.toThrow('real-instance-mismatch');
    const malformed = fixture();
    malformed.sendRequest.mockResolvedValue({ instanceId: 'inst-bound', capabilities: ['initialize'] });
    await expect(malformed.adapter.initialize()).rejects.toThrow('real-capabilities-invalid');
  });
  it('目录按entries校验，详情只从目录按id提取且不传播本地路径', async () => {
    const f = fixture();
    await expect(f.adapter.catalogSessions('other')).rejects.toThrow('real-workspace-mismatch');
    expect(await f.adapter.getSessionDetail('s1')).toEqual({
      id: 's1',
      title: '会话',
      status: 'idle',
      workspaceId: 'ws-bound',
      createdAt: '',
      updatedAt: '',
    });
    expect(f.sendRequest.mock.calls.map(([method]) => method)).toEqual(['initialize', 'session/catalog']);
    await expect(f.adapter.getSessionDetail('missing')).rejects.toThrow('unknown-session');
    f.sendRequest.mockResolvedValueOnce({ sessions: [] });
    await expect(f.adapter.catalogSessions('ws-bound')).rejects.toThrow('real-catalog-invalid');
  });
  it('事件使用字符串limit/afterSeq及真实generation，含序号0且重放稳定', async () => {
    const f = fixture();
    const first = await f.adapter.getSessionEvents('s1', null, 500);
    expect(f.sendRequest).toHaveBeenLastCalledWith('session/events', {
      workspaceId: 'ws-bound',
      sessionId: 's1',
      limit: '200',
    });
    expect(first.frames).toHaveLength(2);
    expect(first.frames[0]).toMatchObject({
      sessionId: 's1',
      generation: 1,
      kind: 'user/message',
      summary: '正文0',
      at: '',
    });
    expect((await f.adapter.getSessionEvents('s1', null, 2)).frames).toEqual(first.frames);
    f.sendRequest.mockResolvedValueOnce({ ...page('hash-a', []), nextSeq: '1' });
    const quiet = await f.adapter.getSessionEvents('s1', first.nextCursor, 20);
    expect(quiet.frames).toEqual([]);
    expect(quiet.nextCursor).toBe(first.nextCursor);
    expect(f.sendRequest).toHaveBeenLastCalledWith('session/events', {
      workspaceId: 'ws-bound',
      sessionId: 's1',
      afterSeq: '1',
      generation: 'hash-a',
      limit: '20',
    });
    await expect(f.adapter.getSessionEvents('s2', first.nextCursor, 2)).rejects.toThrow(
      'real-events-cursor-invalid',
    );
    await expect(f.adapter.getSessionEvents('s1', null, 0)).rejects.toThrow('real-events-request-invalid');
  });
  it('每会话独立代际，跨代gap显式失败，不伪造空成功', async () => {
    const f = fixture();
    const first = await f.adapter.getSessionEvents('s1', null, 2);
    f.sendRequest.mockResolvedValueOnce({ ...page('hash-b', []), gap: 'generation-mismatch' });
    await expect(f.adapter.getSessionEvents('s1', first.nextCursor, 2)).rejects.toBeInstanceOf(
      RealReplayGapError,
    );
    f.sendRequest.mockResolvedValueOnce(page('hash-b'));
    expect((await f.adapter.getSessionEvents('s1', null, 2)).generation).toBe(2);
    expect((await f.adapter.getSessionEvents('s2', null, 2)).generation).toBe(1);
  });
  it.each([
    { frames: [] },
    { ...page(), events: [{ seq: 'x', eventType: 'user/message', data: '坏帧' }] },
    { ...page(), events: [{ seq: '1', eventType: 'user/message', data: {} }] },
    { ...page(), nextSeq: '99' },
    { ...page(), events: page().events.reverse(), nextSeq: '0' },
  ])('拒绝坏事件响应，不返回合成空页 %#', async (response) => {
    const f = fixture();
    await f.adapter.initialize();
    f.sendRequest.mockResolvedValueOnce(response);
    await expect(f.adapter.getSessionEvents('s1', null, 2)).rejects.toThrow();
  });
  it('真实durable和RPC通知仅作补读提示，控制/坏帧不会传给broker', async () => {
    const f = fixture();
    const frames: RawEventFrame[] = [];
    const sub = await f.adapter.subscribe((frame) => frames.push(frame));
    f.push({ method: 'daemon/client-initialized', params: {} });
    f.push({ method: 'daemon/event', params: { seq: 1, event: 'user/message', data: '无归属' } });
    f.push({ sessionId: 's1', seq: 'x', eventType: 'user/message', data: '坏帧' });
    expect(frames).toEqual([]);
    f.push({ sessionId: 's1', seq: '1', eventType: 'user/message', data: '提示而非真源' });
    await vi.waitFor(() => expect(frames).toHaveLength(2));
    expect(frames[0]?.summary).toBe('正文0');
    f.sendRequest.mockResolvedValueOnce({ ...page('hash-a', []), nextSeq: '1' });
    f.push({
      method: 'daemon/event',
      params: { sessionId: 's1', seq: 200, event: 'user/message', data: '提示' },
    });
    await vi.waitFor(() => expect(f.sendRequest).toHaveBeenCalledTimes(3));
    expect(f.sendRequest).toHaveBeenLastCalledWith(
      'session/events',
      expect.objectContaining({ afterSeq: '1', generation: 'hash-a' }),
    );
    sub.close();
    sub.close();
    f.adapter.close();
    expect(f.abort).toHaveBeenCalledTimes(1);
    expect(f.handle.close).toHaveBeenCalledTimes(1);
  });
  it('支持当前桌面订阅返回abort函数且关闭后不继续投递', async () => {
    const f = fixture();
    vi.mocked(f.handle.subscribeNotifications).mockImplementationOnce(async () => f.abort);
    const sub = await f.adapter.subscribe(vi.fn());
    sub.close();
    f.adapter.close();
    expect(f.abort).toHaveBeenCalledTimes(1);
  });
  it('订阅跨代gap从头补读并保留新的数值代次', async () => {
    const f = fixture();
    const frames: RawEventFrame[] = [];
    await f.adapter.subscribe((frame) => frames.push(frame));
    f.push({ sessionId: 's1', seq: '1', eventType: 'user/message', data: '' });
    await vi.waitFor(() => expect(frames).toHaveLength(2));
    f.sendRequest.mockResolvedValueOnce({ ...page('hash-b', []), gap: 'generation-mismatch' });
    f.sendRequest.mockResolvedValueOnce(page('hash-b', ['0']));
    f.push({ sessionId: 's1', seq: '0', eventType: 'user/message', data: '' });
    await vi.waitFor(() => expect(frames).toHaveLength(3));
    expect(frames[2]?.generation).toBe(2);
    expect(f.sendRequest).toHaveBeenLastCalledWith('session/events', {
      workspaceId: 'ws-bound',
      sessionId: 's1',
      limit: '200',
    });
    f.adapter.close();
  });
  it('上游读取错误不降级为空目录或空历史', async () => {
    const f = fixture();
    await f.adapter.initialize();
    f.sendRequest.mockRejectedValueOnce(new Error('只读失败'));
    await expect(f.adapter.catalogSessions('ws-bound')).rejects.toThrow('只读失败');
    f.sendRequest.mockRejectedValueOnce(new Error('历史失败'));
    await expect(f.adapter.getSessionEvents('s1', null, 2)).rejects.toThrow('历史失败');
    f.adapter.close();
    await expect(f.adapter.initialize()).rejects.toThrow('real-transport-closed');
  });
  it('订阅补读失败会中断订阅，后续读取明确失败', async () => {
    const f = fixture();
    await f.adapter.subscribe(vi.fn());
    f.sendRequest.mockRejectedValueOnce(new Error('私密上游错误'));
    f.push({ sessionId: 's1', seq: '1', eventType: 'user/message', data: '' });
    await vi.waitFor(() => expect(f.abort).toHaveBeenCalledTimes(1));
    await expect(f.adapter.getSessionEvents('s1', null, 2)).rejects.toThrow(
      'real-subscription-refill-failed',
    );
  });
});
