import test from 'node:test';
import assert from 'node:assert/strict';
import { securityFixture } from './security-fixture.mjs';

test('真实 daemon 并发同操作只向真实 Host 提交一次，同键异内容拒绝', { timeout: 45000 }, async t => {
  const f = await securityFixture(t);
  const made = await f.rpc('session/create', { workspaceId: f.cwd, operationId: 'create', title: '合成幂等会话' });
  assert.ok(made.result?.id, JSON.stringify(made));
  const sessionId = made.result.id;
  await f.rpc('session/select', { workspaceId: f.cwd, sessionId });
  const params = { workspaceId: f.cwd, sessionId, operationId: 'same-concurrent-operation',
    eventType: 'user/message', data: 'synthetic-once-only' };
  const responses = await Promise.all(Array.from({ length: 6 }, () => f.rpc('session/submit', params)));
  assert.ok(responses.some(r => r.result), JSON.stringify(responses));
  for (const r of responses) {
    if (r.error) assert.match(r.error.message, /^idempotency-unknown:/);
  }
  const retry = await f.rpc('session/submit', params);
  assert.ok(retry.result, JSON.stringify(retry));
  const conflict = await f.rpc('session/submit', { ...params, data: 'different-intent' });
  assert.match(conflict.error?.message || '', /idempotency-conflict/);
  const flush = await f.rpc('session/flush', { workspaceId: f.cwd, sessionId, operationId: 'flush' });
  assert.ok(flush.result, JSON.stringify(flush));
  const events = await f.rpc('session/events', { workspaceId: f.cwd, sessionId, afterSeq: '0', limit: '200' });
  assert.ok(events.result?.events, JSON.stringify(events));
  assert.equal(events.result.events.filter(e => e.data === 'synthetic-once-only').length, 1);
  assert.equal(events.result.events.filter(e => e.data === 'different-intent').length, 0);
});
