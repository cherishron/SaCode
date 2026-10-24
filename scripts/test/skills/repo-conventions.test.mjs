import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// 仅验证发布包结构与关键约束存在，不证明模型实际遵循。
const root = new URL('../../../.agents/skills/repo-conventions/', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const entry = read('SKILL.md');
const FILES = ['references/structure.md', 'references/docs.md', 'references/tests.md',
  'references/commit-security.md', 'references/agent-collaboration.md', 'references/init-and-audit.md',
  'references/error-book.md', 'references/prd-management.md', 'references/docs-maintenance.md',
  'references/code-review.md', 'references/security-review.md', 'references/commit-orchestration.md'];

test('发布元数据与引用资源齐全', () => {
  for (const field of ['name: repo-conventions', 'slug: repo-conventions', 'version: 1.1.0', 'license: MulanPSL-2.0']) assert.ok(entry.includes(field));
  assert.match(entry, /^---\n[\s\S]+\n---\n/);
  for (const match of entry.matchAll(/references\/[a-z-]+\.md/g)) assert.ok(read(match[0]).length > 0);
  assert.match(read('LICENSE.txt'), /木兰宽松许可证/);
});

test('十二个引用域与体检/初始化口径齐全', () => {
  for (const f of FILES) assert.ok(read(f).length > 0);
  assert.ok(entry.includes('P0') && entry.includes('P1') && entry.includes('P2'));
  assert.ok(entry.includes('只读') || entry.includes('只给建议'));
});

test('提交安全红线与暂存规则明确', () => {
  const c = read('references/commit-security.md');
  assert.ok(c.includes('git add -A'));
  assert.ok(c.includes('不回显'));
  assert.ok(c.includes('.gitignore'));
  assert.ok(c.includes('停止提交'));
});

test('多 agent 协作含登记约定、看板脚本与告警', () => {
  const a = read('references/agent-collaboration.md');
  assert.ok(a.includes('只改自己的'));
  assert.ok(a.includes('agent-board.mjs'));
  assert.ok(a.includes('未登记告警'));
});

test('默认只读、不擅自搬目录、不擅自提交', () => {
  const s = read('references/structure.md');
  const g = read('references/init-and-audit.md');
  assert.ok(s.includes('不擅自搬目录') || s.includes('不擅自搬'));
  assert.ok(g.includes('只读'));
  assert.ok(g.includes('须独立授权') || g.includes('须用户授权') || g.includes('须授权'));
});

test('错题本含条目模板、按需检索且不自动注入', () => {
  const e = read('references/error-book.md');
  assert.ok(e.includes('触发场景'));
  assert.ok(e.includes('根因'));
  assert.ok(e.includes('正确做法'));
  assert.ok(e.includes('关键词'));
  assert.ok(e.includes('按需检索'));
  assert.ok(e.includes('不自动注入'));
});

test('PRD 管理与文档维护强调唯一权威与同批同步', () => {
  const i = read('references/prd-management.md');
  const j = read('references/docs-maintenance.md');
  assert.ok(i.includes('唯一权威'));
  assert.ok(i.includes('验收'));
  assert.ok(j.includes('同批') || j.includes('变更即同步'));
  assert.ok(j.includes('断链'));
});

test('项目评审与安全审查分级与边界明确', () => {
  const k = read('references/code-review.md');
  const l = read('references/security-review.md');
  assert.ok(k.includes('P0') && k.includes('P1') && k.includes('P2'));
  assert.ok(k.includes('抽样'));
  assert.ok(l.includes('授权'));
  assert.ok(l.includes('不回显'));
});

test('提交编排：先同步解冲突、AI 判边界、推送前确认', () => {
  const m = read('references/commit-orchestration.md');
  assert.ok(m.includes('rebase'));
  assert.ok(m.includes('冲突'));
  assert.ok(m.includes('git add -A'));
  assert.ok(m.includes('推送前'));
  assert.ok(m.includes('已确认') || m.includes('用户确认') || m.includes('用户点头'));
  assert.ok(m.includes('精确 add') || m.includes('精确'));
});

test('发布目录仅含预期文件且无损坏字符或本机绝对路径', () => {
  assert.deepEqual(readdirSync(root).filter(f => f !== '_meta.json').sort(), ['LICENSE.txt', 'SKILL.md', 'references']);
  assert.deepEqual(readdirSync(new URL('references/', root)).sort(),
    ['agent-collaboration.md', 'code-review.md', 'commit-orchestration.md', 'commit-security.md',
      'docs-maintenance.md', 'docs.md', 'error-book.md', 'init-and-audit.md', 'prd-management.md',
      'security-review.md', 'structure.md', 'tests.md']);
  for (const p of ['SKILL.md', 'LICENSE.txt', ...FILES]) {
    assert.doesNotMatch(read(p), /\uFFFD|C:\\Users\\|D:\\Project\\/i);
  }
});