import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { previewChatGpt } = require('../../import-adapters/chatgpt.cjs');
const { buildImportHandoff } = require('../../import-adapters/handoff.cjs');
const target = { projectId: 'project', expectedRevision: 'rev-1', requestId: 'request-1' };
function preview() {
  return previewChatGpt(JSON.stringify(['one', 'two'].map(id => ({ id, title: id, current_node: 'u', mapping: {
    u: { id: 'u', parent: null, message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['正文'] } } }
  } }))));
}
const choose = c => ({ sourceId: c.sourceId, fingerprint: c.fingerprint });
const code = expected => error => error.code === expected;
test('只交接显式选择的候选与目标修订，标题映射保留原来源指纹', () => {
  const p = preview(), c = p.candidates[1];
  const result = buildImportHandoff(p, [{ ...choose(c), displayTitle: '新标题', role: 'system' }], { ...target, approval: '不可信', path: '../x' });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].sourceId, 'two');
  assert.equal(result.items[0].title, 'two');
  assert.equal(result.items[0].displayTitle, '新标题');
  assert.equal(result.items[0].fingerprint, c.fingerprint);
  assert.deepEqual(result.target, target);
  assert.ok(!JSON.stringify(result).includes('不可信'));
  assert.equal(result.operation, 'append-imported-transcripts');
});
test('被编辑的正文、角色或标题拒绝旧指纹', () => {
  for (const change of [c => c.messages[0].text = '改变', c => c.messages[0].role = 'assistant', c => c.title = '改变']) {
    const p = preview(), selection = p.candidates.map(choose); change(p.candidates[0]);
    assert.throws(() => buildImportHandoff(p, selection, target), code('import-preview-changed'));
  }
});
test('缺失候选、陈旧选择、重复选择、空选择均拒绝', () => {
  const p = preview(), choice = choose(p.candidates[0]);
  assert.throws(() => buildImportHandoff(p, [{ ...choice, sourceId: 'gone' }], target), code('import-preview-changed'));
  assert.throws(() => buildImportHandoff(p, [{ ...choice, fingerprint: 'a'.repeat(64) }], target), code('import-preview-changed'));
  assert.throws(() => buildImportHandoff(p, [choice, choice], target), code('import-invalid-selection'));
  assert.throws(() => buildImportHandoff(p, [], target), code('import-invalid-selection'));
});
test('重复来源、非法角色、重复消息与非法消息 ID 拒绝', () => {
  const p = preview(); p.candidates.push(p.candidates[0]);
  assert.throws(() => buildImportHandoff(p, [choose(p.candidates[0])], target), code('import-invalid-preview'));
  for (const change of [c => c.messages[0].role = 'tool', c => c.messages.push(c.messages[0]), c => c.messages[0].sourceId = '\u0000']) {
    const p = preview(); change(p.candidates[0]);
    assert.throws(() => buildImportHandoff(p, [choose(p.candidates[1])], target), code('import-invalid-candidate'));
  }
});
test('无效目标、格式和标题映射拒绝', () => {
  const p = preview(), choice = choose(p.candidates[0]);
  for (const value of [null, {}, { ...target, expectedRevision: '' }, { ...target, requestId: '\n' }]) {
    assert.throws(() => buildImportHandoff(p, [choice], value), code('import-invalid-target'));
  }
  assert.throws(() => buildImportHandoff({ ...p, version: 2 }, [choice], target), code('import-invalid-preview'));
  assert.throws(() => buildImportHandoff(p, [{ ...choice, displayTitle: ' ' }], target), code('import-invalid-mapping'));
});
test('单候选累计体积在计算大指纹前拒绝，稀疏消息数组拒绝', () => {
  const p = preview();
  p.candidates[0].messages = Array.from({ length: 17 }, (_, i) => ({ sourceId: String(i), role: 'user', text: 'x'.repeat(1024 * 1024) }));
  assert.throws(() => buildImportHandoff(p, [choose(p.candidates[0])], target), code('import-handoff-limit'));
  p.candidates[0].messages = Array(1);
  assert.throws(() => buildImportHandoff(p, [choose(p.candidates[0])], target), code('import-invalid-candidate'));
});
test('输出为独立白名单副本，后续预览变化不污染交接', () => {
  const p = preview(); p.candidates[0].secret = '不得复制';
  const result = buildImportHandoff(p, [choose(p.candidates[0])], target);
  p.candidates[0].messages[0].text = '后续变化';
  assert.equal(result.items[0].messages[0].text, '正文');
  assert.ok(!JSON.stringify(result).includes('不得复制'));
});
