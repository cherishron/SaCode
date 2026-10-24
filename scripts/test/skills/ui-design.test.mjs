import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// 仅验证发布包结构与关键约束存在，不证明模型遵循或 GUI 验收。
const root = new URL('../../../.agents/skills/ui-design/', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const entry = read('SKILL.md');
const principles = read('references/design-principles.md');
const verification = read('references/verification.md');

test('发布元数据及引用资源齐全', () => {
  for (const field of ['name: ui-design', 'slug: ui-design', 'version: 1.0.0', 'license: MulanPSL-2.0']) assert.ok(entry.includes(field));
  assert.match(entry, /^---\n[\s\S]+\n---\n/);
  for (const match of entry.matchAll(/references\/[a-z-]+\.md/g)) assert.ok(read(match[0]).length > 0);
  assert.match(read('LICENSE.txt'), /木兰宽松许可证/);
});

test('仅截图和只读审查边界明确', () => {
  assert.ok(entry.includes('只读审查不修改文件'));
  assert.ok(entry.includes('仅截图或限定文件审查时不额外探索项目'));
  assert.ok(entry.includes('不编造路径、令牌或已完成事实'));
});

test('复用令牌且区分 Web 与 Electron', () => {
  assert.ok(entry.includes('不平行建立第二套设计系统'));
  assert.ok(principles.includes('不将某个 Electron 项目的“禁 ESM”误推广到普通 Web'));
});

test('失败和 GUI 阻塞不得伪报通过', () => {
  assert.ok(principles.includes('失败自动收起成成功'));
  assert.ok(verification.includes('不加 --no-sandbox 或关闭 CSP 来冒充通过'));
  assert.ok(verification.includes('用户视觉认可'));
  assert.ok(entry.includes('不将跳过记为通过'));
});

test('发布目录仅有四个可读文件且没有损坏字符或本机绝对路径', () => {
  assert.deepEqual(readdirSync(root).sort(), ['LICENSE.txt', 'SKILL.md', 'references']);
  assert.deepEqual(readdirSync(new URL('references/', root)).sort(), ['design-principles.md', 'verification.md']);
  for (const text of [entry, principles, verification, read('LICENSE.txt')]) {
    assert.doesNotMatch(text, /\uFFFD|C:\\Users\\|D:\\Project\\|skh_[a-z0-9]{16}/i);
  }
});
