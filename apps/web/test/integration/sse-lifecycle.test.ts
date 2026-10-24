import { get, type ClientRequest, type IncomingMessage } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../server/index.js';
import { TargetGateway } from '../../server/daemon/gateway.js';
import type { RawEventFrame } from '../../server/daemon/transport.js';
import { FakeTransport } from '../helpers/fake-transport.js';
import { buildTestConfig } from '../helpers/test-config.js';

let built: Awaited<ReturnType<typeof buildApp>>;
let config: Awaited<ReturnType<typeof buildTestConfig>>;
let transport: FakeTransport;
let address: string;
const clients: ClientRequest[] = [];

beforeEach(async () => {
  config = await buildTestConfig();
  transport = new FakeTransport('sim-1');
});
afterEach(async () => {
  for (const client of clients.splice(0)) client.destroy();
  if (built) await built.app.close();
  vi.restoreAllMocks();
});

async function start(heartbeatMs = 15_000): Promise<void> {
  const gateway = new TargetGateway(config, undefined, () => transport);
  built = await buildApp({ config, gateway, sse: { heartbeatMs } });
  address = await built.app.listen({ host: '127.0.0.1', port: 0 });
}

function connect(
  id: string,
): Promise<{ response: IncomingMessage; text: () => string; closed: Promise<void> }> {
  return new Promise((resolve, reject) => {
    const client = get(
      `${address}/api/targets/sim-1/sessions/s1/stream`,
      {
        headers: { origin: config.origin, cookie: `sacode_dev_session=${id}` },
      },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          text += chunk;
        });
        // 服务端强制关闭是本组测试的预期故障，不将合成socket错误输出为未处理异常。
        response.on('error', () => {});
        const closed = new Promise<void>((done) => response.once('close', done));
        resolve({ response, text: () => text, closed });
      },
    );
    client.on('error', reject);
    clients.push(client);
  });
}

function frame(id: string, sessionId = 's1'): RawEventFrame {
  return { id, sessionId, generation: 1, kind: 'message', at: '', summary: id };
}

describe('真实HTTP合成SSE生命周期', () => {
  it('响应保持打开并接收事件；客户端断开后订阅仅清理一次', async () => {
    await start();
    const broker = await built.gateway.getBroker('sim-1');
    const remove = vi.spyOn(broker, 'removeSubscriber');
    const login = built.sessions.create('owner-1', 'tester');
    const stream = await connect(login.id);
    expect(stream.response.statusCode).toBe(200);
    await vi.waitFor(() => expect(stream.text()).toContain(': open'));
    transport.push(frame('live-1'));
    await vi.waitFor(() => expect(stream.text()).toContain('live-1'));
    expect(remove).not.toHaveBeenCalled();
    stream.response.destroy();
    await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    built.sessions.destroy(login.id);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('仅回放所选会话环形缓冲，generation变化发送补读提示', async () => {
    await start();
    await built.gateway.getBroker('sim-1');
    transport.push(frame('replay-own'));
    transport.push(frame('replay-other', 's2'));
    const login = built.sessions.create('owner-1', 'tester');
    const stream = await connect(login.id);
    await vi.waitFor(() => expect(stream.text()).toContain('replay-own'));
    expect(stream.text()).not.toContain('replay-other');
    transport.push({ ...frame('new-generation'), generation: 2 });
    await vi.waitFor(() => expect(stream.text()).toContain('generation-changed'));
    expect(stream.text()).toContain('new-generation');
  });

  it('logout立刻关闭该登录会话的全部流，不影响其他登录会话', async () => {
    await start();
    const broker = await built.gateway.getBroker('sim-1');
    const remove = vi.spyOn(broker, 'removeSubscriber');
    const login = built.sessions.create('owner-1', 'tester');
    const other = built.sessions.create('owner-1', 'tester');
    const first = await connect(login.id);
    const second = await connect(login.id);
    const surviving = await connect(other.id);
    const logout = await built.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: {
        origin: config.origin,
        cookie: `sacode_dev_session=${login.id}`,
        'x-csrf-token': login.csrfToken,
      },
    });
    expect(logout.statusCode).toBe(200);
    await Promise.all([first.closed, second.closed]);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(first.text()).toContain('event: auth-expired');
    expect(second.text()).toContain('event: auth-expired');
    transport.push(frame('still-authorized'));
    await vi.waitFor(() => expect(surviving.text()).toContain('still-authorized'));
    expect(first.text()).not.toContain('still-authorized');
    expect(second.text()).not.toContain('still-authorized');
  });

  it('轮换登录会话立即关闭旧流', async () => {
    await start();
    const broker = await built.gateway.getBroker('sim-1');
    const remove = vi.spyOn(broker, 'removeSubscriber');
    const login = built.sessions.create('owner-1', 'tester');
    const stream = await connect(login.id);
    built.sessions.rotate(login.id, 'owner-1', 'tester');
    await stream.closed;
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('空闲过期在心跳内有界关闭，心跳不touch用户活动', async () => {
    await start(10);
    const login = built.sessions.create('owner-1', 'tester');
    const activity = login.lastActivityAt;
    const touch = vi.spyOn(built.sessions, 'touch');
    const stream = await connect(login.id);
    await vi.waitFor(() => expect(stream.text()).toContain(': ping'));
    expect(login.lastActivityAt).toBe(activity);
    login.lastActivityAt = Date.now() - config.sessionIdleMs - 1;
    await stream.closed;
    expect(touch).not.toHaveBeenCalled();
    expect(built.sessions.get(login.id)).toBeNull();
  });

  it('绝对过期下一帧前关闭，不发送过期后的数据', async () => {
    await start();
    const login = built.sessions.create('owner-1', 'tester');
    const stream = await connect(login.id);
    login.absoluteExpiresAt = Date.now() - 1;
    transport.push(frame('must-not-leak'));
    await stream.closed;
    expect(stream.text()).not.toContain('must-not-leak');
  });

  it('sweep过期回收立即关闭已建立流', async () => {
    await start();
    const login = built.sessions.create('owner-1', 'tester');
    const stream = await connect(login.id);
    login.absoluteExpiresAt = Date.now() - 1;
    expect(built.sessions.sweep()).toBe(1);
    await stream.closed;
  });

  it('上游启动失败在握手前返回脱敏502，不创建浏览器订阅', async () => {
    vi.spyOn(transport, 'subscribe').mockRejectedValue(new Error('synthetic-private-upstream-detail'));
    await start();
    const login = built.sessions.create('owner-1', 'tester');
    const stream = await connect(login.id);
    await stream.closed;
    expect(stream.response.statusCode).toBe(502);
    expect(stream.response.headers['content-type']).not.toContain('text/event-stream');
    expect(JSON.parse(stream.text())).toEqual({ code: 'target_unavailable' });
    expect(stream.text()).not.toContain('synthetic-private-upstream-detail');
  });

  it.each(['revoke', 'expiry'] as const)(
    '等待broker初始化时会话失效（%s），完成后返回401而非SSE握手',
    async (failure) => {
      let ready!: () => void;
      let started!: () => void;
      const pending = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const entered = new Promise<void>((resolve) => {
        started = resolve;
      });
      const subscribe = transport.subscribe.bind(transport);
      vi.spyOn(transport, 'subscribe').mockImplementation(async (callback) => {
        started();
        await pending;
        return subscribe(callback);
      });
      await start();
      const login = built.sessions.create('owner-1', 'tester');
      const connecting = connect(login.id);
      await entered;
      if (failure === 'revoke') built.sessions.destroy(login.id);
      else login.absoluteExpiresAt = Date.now() - 1;
      ready();
      const stream = await connecting;
      await stream.closed;
      expect(stream.response.statusCode).toBe(401);
      expect(JSON.parse(stream.text())).toEqual({ code: 'unauthorized' });
    },
  );

  it('初始化期间客户端断开，不留下浏览器订阅', async () => {
    await start();
    const broker = await built.gateway.getBroker('sim-1');
    const add = vi.spyOn(broker, 'addSubscriber');
    let ready!: () => void;
    let started!: () => void;
    const pending = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.spyOn(built.gateway, 'getBroker').mockImplementation(async () => {
      started();
      await pending;
      return broker;
    });
    const login = built.sessions.create('owner-1', 'tester');
    const connecting = connect(login.id).catch(() => null);
    await entered;
    clients.at(-1)!.destroy();
    await connecting;
    ready();
    await vi.waitFor(() => expect(clients.at(-1)!.destroyed).toBe(true));
    await built.app.close();
    expect(add).not.toHaveBeenCalled();
  });

  it('app.close主动关闭SSE并完成停机，无需客户端先断开', async () => {
    await start();
    const broker = await built.gateway.getBroker('sim-1');
    const remove = vi.spyOn(broker, 'removeSubscriber');
    const close = vi.spyOn(transport, 'close');
    const login = built.sessions.create('owner-1', 'tester');
    const stream = await connect(login.id);
    await built.app.close();
    await stream.closed;
    expect(remove).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
