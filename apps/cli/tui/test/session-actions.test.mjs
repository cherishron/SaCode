import assert from 'node:assert/strict';
import test from 'node:test';
import { compactDetailLines } from '../src/session-actions.mjs';

test('compact详情：含状态/事件/字节/节省量，空值兜底', () => {
  const lines = compactDetailLines({ sessionId: 's1', strategy: 'local-extractive-v1', lossy: true,
    state: 'ready', reason: '', eventCount: 42, durableCount: 40, indexRevision: 0, workspaceBound: true,
    beforeInputBound: 10000, afterInputBound: 3000, savedInputBound: 7000 });
  assert.ok(lines.some((l) => l.includes('ready')));
  assert.ok(lines.some((l) => l.includes('7000 字节')));
  const minimal = compactDetailLines({ sessionId: 's2', state: 'not-applicable', lossy: false });
  assert.ok(minimal.some((l) => l.includes('有损：否')));
  assert.ok(!minimal.some((l) => l.includes('字节')));
});

test('compact详情：queued/applied/null产物都能展示', () => {
  for (const reply of [
    { sessionId: 's', state: 'queued', reason: 'turn-in-flight', lossy: true },
    { sessionId: 's', state: 'applied', lossy: true, beforeInputBound: 500, afterInputBound: 200 },
    { sessionId: 's', state: 'ready', lossy: true, beforeInputBound: null, afterInputBound: null },
  ]) {
    const lines = compactDetailLines(reply);
    assert.ok(lines.length >= 5);
    assert.ok(lines.some((l) => l.includes(reply.state)));
  }
});
