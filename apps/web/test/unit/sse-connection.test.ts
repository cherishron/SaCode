import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SseConnection } from '../../server/events/connection.js';

class FakeResponse extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  write = vi.fn((_chunk: string) => true);
  end = vi.fn(() => {
    this.writableEnded = true;
  });
  destroy = vi.fn(() => {
    this.destroyed = true;
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup() {
  const raw = new FakeResponse();
  const cleanup = vi.fn();
  const authorized = vi.fn(() => true);
  const connection = new SseConnection(raw as unknown as ServerResponse, authorized, cleanup);
  return { raw, cleanup, authorized, connection };
}

describe('SSE背压和清理', () => {
  it('drain恢复后先提示掉帧补读，再恢复实时数据', () => {
    const { raw, connection } = setup();
    raw.write.mockReturnValueOnce(false);
    connection.write('first');
    connection.write('dropped');
    vi.advanceTimersByTime(15_000);
    expect(raw.write).toHaveBeenCalledTimes(1);
    raw.emit('drain');
    expect(raw.write.mock.calls[1]?.[0]).toContain('"reason":"slow-client"');
    connection.write('next');
    expect(raw.write.mock.calls[2]?.[0]).toBe('next');
    vi.advanceTimersByTime(15_000);
    expect(raw.destroy).not.toHaveBeenCalled();
    connection.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('首字节、回放、提示与心跳共用背压，不堆积帧', () => {
    const { raw, connection } = setup();
    raw.write.mockReturnValue(false);
    connection.write(': open\n\n', false);
    for (let i = 0; i < 500; i++) connection.write(`replay-${i}`);
    connection.promptRefill('generation-changed');
    vi.advanceTimersByTime(15_000);
    expect(raw.write).toHaveBeenCalledTimes(1);
    raw.write.mockReturnValue(true);
    raw.emit('drain');
    expect(raw.write).toHaveBeenCalledTimes(2);
    expect(raw.write.mock.calls[1]?.[0]).toContain('generation-changed');
    connection.close();
  });

  it('没有掉帧的drain不发送多余补读提示', () => {
    const { raw, connection } = setup();
    raw.write.mockReturnValueOnce(false);
    connection.write('accepted-but-buffered');
    raw.emit('drain');
    connection.write('next');
    expect(raw.write.mock.calls.map(([chunk]) => chunk)).toEqual(['accepted-but-buffered', 'next']);
    connection.close();
  });

  it('默认30秒慢客户端强制关闭且不向阻塞响应追加提示', () => {
    const { raw, cleanup, connection } = setup();
    raw.write.mockReturnValue(false);
    connection.write('buffered');
    connection.write('dropped');
    vi.advanceTimersByTime(29_999);
    expect(raw.destroy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(raw.destroy).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(raw.write).toHaveBeenCalledTimes(1);
    expect(raw.listenerCount('drain')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('补读提示本身阻塞时同样受超时约束', () => {
    const { raw, connection } = setup();
    raw.write.mockReturnValueOnce(false);
    connection.write('buffered');
    connection.write('dropped');
    raw.write.mockReturnValueOnce(false);
    raw.emit('drain');
    vi.advanceTimersByTime(30_000);
    expect(raw.destroy).toHaveBeenCalledTimes(1);
    expect(raw.write).toHaveBeenCalledTimes(2);
  });

  it('response.close只清理一次，移除监听与所有定时器', () => {
    const { raw, cleanup, connection } = setup();
    raw.emit('close');
    connection.close();
    connection.write('late');
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(raw.write).not.toHaveBeenCalled();
    expect(raw.eventNames()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('写入异常与响应error均关闭并清理', () => {
    const first = setup();
    first.raw.write.mockImplementation(() => {
      throw new Error('synthetic-write-failure');
    });
    first.connection.write('frame');
    expect(first.cleanup).toHaveBeenCalledTimes(1);
    expect(first.raw.destroy).toHaveBeenCalledTimes(1);
    const second = setup();
    second.raw.emit('error', new Error('synthetic-response-failure'));
    expect(second.cleanup).toHaveBeenCalledTimes(1);
    expect(second.raw.destroy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('撤销时已背压不追加控制帧；控制帧自身阻塞也强制关闭', () => {
    const blocked = setup();
    blocked.raw.write.mockReturnValue(false);
    blocked.connection.write('buffered');
    blocked.connection.expire();
    expect(blocked.raw.write).toHaveBeenCalledTimes(1);
    expect(blocked.raw.destroy).toHaveBeenCalledTimes(1);
    const control = setup();
    control.raw.write.mockReturnValue(false);
    control.connection.expire();
    expect(control.raw.write).toHaveBeenCalledExactlyOnceWith('event: auth-expired\ndata: {}\n\n');
    expect(control.raw.destroy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('心跳校验会话失效并关闭，而非刷新活动', () => {
    const { raw, authorized, cleanup } = setup();
    authorized.mockReturnValue(false);
    vi.advanceTimersByTime(15_000);
    expect(raw.write).toHaveBeenCalledExactlyOnceWith('event: auth-expired\ndata: {}\n\n');
    expect(raw.end).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
