import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { securityFixture, delay } from './security-fixture.mjs';

for (const allowReplay of [false, true]) {
  test(`SSE 历史补读遵守 session/events 方法策略：${allowReplay ? '允许' : '拒绝'}`, { timeout: 45000 }, async t => {
    const f = await securityFixture(t, { policyFilter: p => allowReplay || p.method !== 'session/events' });
    const made = await f.rpc('session/create', { workspaceId: f.cwd, title: '合成补读会话', operationId: 'create' });
    assert.ok(made.result?.id, JSON.stringify(made));
    const sid = made.result.id;
    await f.rpc('session/select', { workspaceId: f.cwd, sessionId: sid });
    for (let i = 0; i < 2; i++) {
      const r = await f.rpc('session/submit', { workspaceId: f.cwd, sessionId: sid,
        operationId: `submit-${i}`, eventType: 'user/message', data: `synthetic-private-${i}` });
      assert.ok(r.result, JSON.stringify(r));
    }
    const flushed = await f.rpc('session/flush', { workspaceId: f.cwd, sessionId: sid, operationId: 'flush' });
    assert.ok(flushed.result, JSON.stringify(flushed));
    const direct = await f.rpc('session/events', { workspaceId: f.cwd, sessionId: sid, afterSeq: '0', limit: '200' });
    if (allowReplay) assert.ok(direct.result, JSON.stringify(direct));
    else assert.match(direct.error?.message || '', /method-not-registered/);
    const ac = new AbortController();
    t.after(() => ac.abort());
    const res = await fetch(f.url + '/sse', { headers: { authorization: f.bearer, 'Last-Event-ID': `${sid}|0` }, signal: ac.signal });
    assert.equal(res.status, 200);
    let text = '';
    const reader = res.body.getReader();
    const reading = (async () => { for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      text += Buffer.from(value).toString();
    } })().catch(e => { if (e.name !== 'AbortError') throw e; });
    const until = Date.now() + 2000;
    while (Date.now() < until && !text.includes('synthetic-private-1')) await delay(25);
    ac.abort(); await reading;
    if (allowReplay) assert.match(text, /synthetic-private-1/);
    else { assert.doesNotMatch(text, /synthetic-private|event: durable/); assert.match(text, /connected/); }
    assert.ok(readFileSync(join(f.cwd, 'instance.id.audit.log'), 'utf8').length > 0);
  });
}
