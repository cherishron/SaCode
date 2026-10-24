import { describe, expect, it, vi } from 'vitest';
import { TargetGateway } from '../../server/daemon/gateway.js';
import { FakeTransport } from '../helpers/fake-transport.js';
import type { WebConfig } from '../../server/config.js';

const config = {
  targets: [{ id: 'fake-1', label: '测试', baseUrl: 'http://127.0.0.1', credentialRef: 'fixture' }],
} as WebConfig;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
describe('目标网关并发初始化与关闭', () => {
  it('多个同时到达的浏览器只创建一个transport和上游订阅', async () => {
    const transport = new FakeTransport();
    const subscribe = vi.spyOn(transport, 'subscribe');
    const factory = vi.fn(async () => transport);
    const gateway = new TargetGateway(config, factory);
    const brokers = await Promise.all(Array.from({ length: 8 }, () => gateway.getBroker('fake-1')));
    expect(new Set(brokers).size).toBe(1);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
    await gateway.stopAll();
  });
  it('上游订阅失败不缓存半初始化broker，下次可以重新连接', async () => {
    const transport = new FakeTransport();
    const original = transport.subscribe.bind(transport);
    const subscribe = vi
      .spyOn(transport, 'subscribe')
      .mockRejectedValueOnce(new Error('fixture-unavailable'))
      .mockImplementation(original);
    const gateway = new TargetGateway(config, async () => transport);
    await expect(gateway.getBroker('fake-1')).rejects.toThrow('fixture-unavailable');
    await expect(gateway.getBroker('fake-1')).resolves.toBeDefined();
    expect(subscribe).toHaveBeenCalledTimes(2);
    await gateway.stopAll();
  });
  it('停机期间迟到的transport会关闭，不重新开放网关', async () => {
    const transport = new FakeTransport();
    const close = vi.spyOn(transport, 'close');
    const ready = deferred<FakeTransport>();
    const gateway = new TargetGateway(config, () => ready.promise);
    const pending = gateway.getBroker('fake-1');
    const result = expect(pending).rejects.toThrow('gateway-stopped');
    await Promise.resolve();
    await gateway.stopAll();
    ready.resolve(transport);
    await result;
    expect(close).toHaveBeenCalled();
    await expect(gateway.initialize('fake-1')).rejects.toThrow('gateway-stopped');
  });
});
