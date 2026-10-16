import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(dir, '../src/main.cj'), 'utf8');

test('CLI main 只负责装配与分派，不自测', () => {
  const entry = source.slice(source.lastIndexOf('\nmain('));
  const lines = entry.split('\n');
  assert.ok(lines.length < 50, `main 必须仅做路由与分派，当前 ${lines.length} 行`);
});

test('CLI 各模式块已提取为独立函数', () => {
  const fns = [...source.matchAll(/func run(Projection|Seed|StreamTests|CancelTests|PluginTests|AttachmentTests|SignalTests|ExtTests|ToolTests|HeadlessTests|ExtjsTests|ToolsList|ToolCall|RealStreamTests|GoalTests)\(/g)];
  assert.ok(fns.length >= 10, `至少提取 10 个模式函数，当前 ${fns.length}`);
});
