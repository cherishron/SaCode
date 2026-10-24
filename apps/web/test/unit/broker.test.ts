import { describe, it, expect, vi } from 'vitest';
import { EventBroker } from '../../server/events/broker.js';
import { FakeTransport } from '../helpers/fake-transport.js';
import type { RawEventFrame } from '../../server/daemon/transport.js';

function frame(id: string, sessionId = 's1'): RawEventFrame {
  return { id, kind: 'message', at: 't', summary: 's', sessionId, generation: 1 };
}

describe('EventBroker', () => {
  it('refill reads history (seed); live push populates ring', async () => {
    const t = new FakeTransport('fake-1');
    const b = new EventBroker(t);
    await b.start();
    // 历史由 getSessionEvents 提供（seed）；环形缓冲仅承载实时帧
    t.seed([frame('e1'), frame('e2'), frame('e3', 's2')]);
    const r1 = await b.refill('s1', undefined, 500);
    expect(r1.frames.map((f) => f.id)).toEqual(['e1', 'e2']);
    expect(r1.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    const r2 = await b.refill('s1', r1.nextCursor, 500);
    expect(r2.frames.map((f) => f.id)).toEqual([]);
    // 实时帧进入环形缓冲（供 fan-out），不污染历史
    t.push(frame('eLive'));
    expect(b.snapshotRing('s1').map((f) => f.id)).toEqual(['eLive']);
  });

  it('cursor from other target is rejected', async () => {
    const t = new FakeTransport('fake-1');
    const b = new EventBroker(t);
    await b.start();
    const bad = Buffer.from(JSON.stringify({ t: 'other', s: 's1', e: '', g: 1 })).toString('base64url');
    expect(b.parseCursor(bad)).toBeNull();
  });

  it('generation change clears ring + prompts refill', async () => {
    const t = new FakeTransport('fake-1');
    const b = new EventBroker(t);
    await b.start();
    t.push(frame('e1'));
    expect(b.snapshotRing('s1').length).toBe(1);
    let prompted = false;
    const id = b.addSubscriber({
      onFrame: () => {},
      onRefillPrompt: () => {
        prompted = true;
      },
    });
    t.push({ id: 'e2', kind: 'message', at: 't', summary: 's', sessionId: 's1', generation: 2 });
    // 旧环已清空，但触发代际变化的这一帧会进入新环（实时 fan-out）
    expect(b.snapshotRing('s1').length).toBe(1);
    expect(b.snapshotRing('s1')[0].id).toBe('e2');
    expect(prompted).toBe(true);
    b.removeSubscriber(id);
  });

  it('跨会话游标在读取上游前拒绝', async () => {
    const t = new FakeTransport('fake-1');
    const b = new EventBroker(t);
    const read = vi.spyOn(t, 'getSessionEvents');
    const cursor = b.makeCursor('s1', 'e1');
    expect(await b.refill('s2', cursor, 10)).toEqual({ frames: [], nextCursor: null });
    expect(read).not.toHaveBeenCalled();
  });

  it('无新帧的补读保留游标，不从头重复读取', async () => {
    const t = new FakeTransport('fake-1');
    const b = new EventBroker(t);
    t.seed([frame('e1')]);
    const first = await b.refill('s1', undefined, 10);
    const empty = await b.refill('s1', first.nextCursor!, 10);
    expect(b.parseCursor(empty.nextCursor!)?.lastEventId).toBe('e1');
  });

  it('代际变化后不使用旧日志游标', async () => {
    const t = new FakeTransport('fake-1');
    const b = new EventBroker(t);
    await b.start();
    const cursor = b.makeCursor('s1', 'old');
    const read = vi.spyOn(t, 'getSessionEvents');
    t.push({ ...frame('new'), generation: 2 });
    await b.refill('s1', cursor, 10);
    expect(read).toHaveBeenCalledWith('s1', null, 10);
    b.stop();
  });

  it('ring capped at 500', async () => {
    const t = new FakeTransport('fake-1');
    const b = new EventBroker(t);
    await b.start();
    for (let i = 1; i <= 600; i++) t.push(frame('e' + i));
    expect(b.snapshotRing('s1').length).toBe(500);
  });

  it('fan-out to subscribers; removal stops delivery', async () => {
    const t = new FakeTransport('fake-1');
    const b = new EventBroker(t);
    await b.start();
    const got: string[] = [];
    const id = b.addSubscriber({ onFrame: (f) => got.push(f.id), onRefillPrompt: () => {} });
    t.push(frame('eX'));
    expect(got).toEqual(['eX']);
    b.removeSubscriber(id);
    t.push(frame('eY'));
    expect(got).toEqual(['eX']);
  });
});
