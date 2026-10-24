import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('技能只读入口不得缓存按会话首次装配的空工作区，必须回放未持租约日志', () => {
  const source = readFileSync(new URL('../../src/main.cj', import.meta.url), 'utf8');
  const start = source.indexOf('func handleAdapterRpc(');
  const body = source.slice(start, source.indexOf('if (WebRpc.handles(method))', start));
  assert.doesNotMatch(source, /var skillRpc:\s*\?SkillRpc/);
  assert.match(body, /if \(SkillRpc\.handles\(method\)\)/);
  assert.match(body, /if \(!leaseHeld\)\s*\{\s*source = SessionLog\(p\)/);
  assert.match(body, /source\.load\(\)/);
  assert.match(body, /SkillRpc\(source, workingDirectory: sessionWorkingDirectory\(source\)\)/);
});
