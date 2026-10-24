import { describe, it, expect, vi } from 'vitest';
import { SessionStore } from '../../server/auth/session.js';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('SessionStore', () => {
  it('create/get/rotate/destroy', () => {
    const s = new SessionStore(1000, 5000);
    const r = s.create('o1', 'u1');
    expect(s.get(r.id)?.id).toBe(r.id);
    const r2 = s.rotate(r.id, 'o1', 'u1');
    expect(s.get(r.id)).toBeNull();
    expect(s.get(r2.id)?.id).toBe(r2.id);
    s.destroy(r2.id);
    expect(s.get(r2.id)).toBeNull();
  });

  it('idle expiry', async () => {
    const s = new SessionStore(50, 100000);
    const r = s.create('o1', 'u1');
    await wait(80);
    expect(s.get(r.id)).toBeNull();
  });

  it('absolute expiry', async () => {
    const s = new SessionStore(100000, 50);
    const r = s.create('o1', 'u1');
    await wait(80);
    expect(s.get(r.id)).toBeNull();
  });

  it('touch extends idle', async () => {
    // 容错留足：wait 只保证不少于名义值，并发跑时实际耗时可能远超。
    // 原 80ms idle + 两次 50ms 等待的容错仅约 30ms，会在整套并发时偶发失败。
    // 语义不变：不 touch 时 200+150 > 300 会过期；touch 后从续期点起 150 < 300 仍存活。
    const s = new SessionStore(300, 100000);
    const r = s.create('o1', 'u1');
    await wait(200);
    s.touch(r.id);
    await wait(150);
    expect(s.get(r.id)?.id).toBe(r.id);
  });

  it('撤销监听按会话隔离，解绑和重复销毁不重复通知', () => {
    const store = new SessionStore(1000, 5000);
    const first = store.create('o1', 'u1');
    const second = store.create('o1', 'u1');
    const revoked = vi.fn();
    const detached = vi.fn();
    const unaffected = vi.fn();
    store.onRevoke(first.id, revoked);
    const unbind = store.onRevoke(first.id, detached);
    store.onRevoke(second.id, unaffected);
    unbind();
    store.destroy(first.id);
    store.destroy(first.id);
    expect(revoked).toHaveBeenCalledTimes(1);
    expect(detached).not.toHaveBeenCalled();
    expect(unaffected).not.toHaveBeenCalled();
  });

  it('get、sweep、rotate均通知撤销；touch不能复活过期会话', () => {
    const store = new SessionStore(1000, 5000);
    for (const action of ['get', 'sweep', 'rotate', 'touch'] as const) {
      const record = store.create('o1', 'u1');
      const revoked = vi.fn();
      store.onRevoke(record.id, revoked);
      if (action !== 'rotate') record.absoluteExpiresAt = Date.now() - 1;
      if (action === 'rotate') store.rotate(record.id, 'o1', 'u1');
      else if (action === 'sweep') store.sweep();
      else store[action](record.id);
      expect(revoked).toHaveBeenCalledTimes(1);
      expect(store.get(record.id)).toBeNull();
    }
  });

  it('已失效会话绑定监听立即通知', () => {
    const store = new SessionStore(1000, 5000);
    const revoked = vi.fn();
    const unbind = store.onRevoke('absent', revoked);
    unbind();
    expect(revoked).toHaveBeenCalledTimes(1);
  });

  it('sweep returns expired count', async () => {
    const s = new SessionStore(10, 100000);
    s.create('o1', 'u1');
    s.create('o1', 'u1');
    await wait(30);
    expect(s.sweep()).toBe(2);
  });
});
