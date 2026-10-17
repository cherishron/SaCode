import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/main.cj', import.meta.url), 'utf8');
test('Host 入口与 RPC 分派不再集中于巨型 main 函数', () => {
  const entry = source.slice(source.lastIndexOf('\nmain('));
  assert.ok(entry.split('\n').length < 20, 'main 必须仅建立运行态并驱动请求循环');
  assert.match(source, /class HostRuntime/);
  const handlers = [...source.matchAll(/func handleRpc\d+\(/g)];
  assert.ok(handlers.length >= 30, 'RPC 分支必须形成独立函数边界');
});
