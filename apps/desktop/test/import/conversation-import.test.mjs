import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { previewChatGpt, DEFAULT_LIMITS } = require('../../import-adapters/chatgpt.cjs');

// 夹具只在内存中生成，不启动 Host、不占公共构建输出、不读用户数据。
function conversation(id = 'one', text = '你好') {
  return { id, title: '示例', current_node: 'a', mapping: {
    root: { id: 'root', parent: null, message: null },
    u: { id: 'u', parent: 'root', message: { author: { role: 'user' }, content: { content_type: 'text', parts: [text] } } },
    a: { id: 'a', parent: 'u', message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['回答'] } } }
  } };
}
const preview = (items, options) => previewChatGpt(JSON.stringify(items), options);
const code = expected => error => error.code === expected;

test('只提取当前分支，保留角色、顺序与正文', () => {
  const item = conversation();
  item.mapping.alternate = { id: 'alternate', parent: 'u', message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['旧回答'] } } };
  const result = preview([item]);
  assert.deepEqual(result.summary, { total: 1, ready: 1, duplicate: 0, conflict: 0, invalid: 0 });
  assert.deepEqual(result.candidates[0].messages, [
    { sourceId: 'u', role: 'user', text: '你好' }, { sourceId: 'a', role: 'assistant', text: '回答' }
  ]);
  assert.match(result.candidates[0].fingerprint, /^[a-f0-9]{64}$/);
});

test('重复批次和已落库摘要去重', () => {
  const item = conversation();
  const first = preview([item, item]);
  assert.equal(first.candidates.length, 1);
  assert.equal(first.duplicates.length, 1);
  const c = first.candidates[0];
  const again = preview([item], { existing: [{ source: c.source, sourceId: c.sourceId, fingerprint: c.fingerprint }] });
  assert.equal(again.candidates.length, 0);
  assert.equal(again.duplicates.length, 1);
});

test('同来源不同内容为冲突，批内整组排除且不依赖输入顺序', () => {
  const one = conversation(), changed = conversation('one', '修改');
  for (const items of [[one, changed], [changed, one], [one, one, changed]]) {
    const result = preview(items);
    assert.equal(result.candidates.length, 0);
    assert.equal(result.conflicts.length, items.length);
  }
  const c = preview([one]).candidates[0];
  assert.equal(preview([changed], { existing: [{ source: c.source, sourceId: c.sourceId, fingerprint: c.fingerprint }] }).conflicts.length, 1);
});

test('单条损坏不妨碍其他条目，不回显损坏载荷', () => {
  const result = preview([null, { id: '密钥不得回显' }, conversation()]);
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.issues, [{ index: 0, code: 'import-invalid-conversation' }, { index: 1, code: 'import-invalid-conversation' }]);
  assert.ok(!JSON.stringify(result).includes('密钥不得回显'));
});

test('拒绝环、缺父节点、节点身份不符和缺当前分支', () => {
  const cyclic = conversation(); cyclic.mapping.u.parent = 'a';
  const missing = conversation(); missing.mapping.a.parent = 'missing';
  const mismatch = conversation(); mismatch.mapping.a.id = 'wrong';
  const noCurrent = conversation(); delete noCurrent.current_node;
  assert.deepEqual(preview([cyclic, missing, mismatch, noCurrent]).issues.map(i => i.code),
    ['import-parent-cycle', 'import-broken-parent', 'import-invalid-node', 'import-missing-current-node']);
});

test('系统工具消息与隐藏正文不导入，未知字段不复制', () => {
  const item = conversation();
  item.api_key = 'secret'; item.metadata = { token: 'secret' };
  item.mapping.u.message.metadata = { api_key: 'secret' };
  item.mapping.a.message.author.role = 'tool';
  const c = preview([item]).candidates[0];
  assert.equal(c.messages.length, 1);
  assert.deepEqual(c.warnings, [{ code: 'import-role-skipped', nodeId: 'a' }]);
  assert.ok(!JSON.stringify(c).includes('secret'));
  item.mapping.a.message.author.role = 'system';
  assert.equal(preview([item]).candidates[0].messages.length, 1);
  item.mapping.a.message.author.role = 'assistant';
  item.mapping.a.message.metadata = { is_visually_hidden_from_conversation: true };
  assert.equal(preview([item]).candidates[0].messages.length, 1);
});

test('不把多模态路径转成正文，报告不支持内容', () => {
  const item = conversation();
  item.mapping.a.message.content = { content_type: 'multimodal_text', parts: ['图片', { asset_pointer: 'file://sensitive' }] };
  const c = preview([item]).candidates[0];
  assert.equal(c.messages.length, 1);
  assert.deepEqual(c.warnings, [{ code: 'import-content-skipped', nodeId: 'a' }]);
  assert.ok(!JSON.stringify(c).includes('sensitive'));
});

test('文本 parts 类型异常为损坏，不静默 stringify', () => {
  const item = conversation(); item.mapping.a.message.content.parts.push({ text: '脚本' });
  assert.equal(preview([item]).issues[0].code, 'import-invalid-text-parts');
});

test('空白消息跳过，整条空会话不进入预览', () => {
  const item = conversation('one', '  '); item.mapping.a.message.content.parts = ['\n'];
  assert.equal(preview([item]).issues[0].code, 'import-empty-conversation');
});

test('无效 JSON 和根形状给固定错误，支持 UTF-8 BOM', () => {
  assert.throws(() => previewChatGpt('{secret'), code('import-invalid-json'));
  assert.throws(() => previewChatGpt('{}'), code('import-invalid-root'));
  assert.throws(() => previewChatGpt({}), code('import-invalid-input'));
  assert.equal(previewChatGpt('\uFEFF' + JSON.stringify([conversation()])).candidates.length, 1);
});

test('输入字节和条数上限严格拒绝，不截断', () => {
  assert.throws(() => preview([conversation()], { limits: { bytes: 1 } }), code('import-input-limit'));
  assert.throws(() => preview([conversation(), conversation('two')], { limits: { conversations: 1 } }), code('import-conversation-limit'));
});

test('节点、消息、UTF-8 正文和标题限额为条目错误', () => {
  assert.equal(preview([conversation()], { limits: { nodes: 2 } }).issues[0].code, 'import-node-limit');
  assert.equal(preview([conversation()], { limits: { messages: 1 } }).issues[0].code, 'import-message-limit');
  assert.equal(preview([conversation()], { limits: { textBytes: 5 } }).issues[0].code, 'import-text-limit');
  const item = conversation(); item.title = 'x'.repeat(1001);
  assert.equal(preview([item]).issues[0].code, 'import-invalid-title');
});

test('调用者只能收紧安全限额', () => {
  for (const limits of [null, { bytes: 0 }, { nodes: 1.1 }, { unknown: 2 }, { bytes: DEFAULT_LIMITS.bytes + 1 }]) {
    assert.throws(() => preview([], { limits }), code('import-invalid-limits'));
  }
});

test('开始前与遍历中取消均抛取消，不返回部分成功', () => {
  const controller = new AbortController(); controller.abort();
  assert.throws(() => preview([conversation()], { signal: controller.signal }), code('import-cancelled'));
  let reads = 0;
  assert.throws(() => preview([conversation(), conversation('two')], { signal: { get aborted() { return ++reads > 5; } } }), code('import-cancelled'));
});

test('现有摘要损坏或相互矛盾时拒绝去重，避免假成功', () => {
  assert.throws(() => preview([], { existing: {} }), code('import-invalid-existing'));
  assert.throws(() => preview([], { existing: [{ source: 'chatgpt', sourceId: 'one', fingerprint: 'invalid' }] }), code('import-invalid-existing'));
  assert.throws(() => preview([], { existing: [
    { source: 'chatgpt', sourceId: 'one', fingerprint: 'a'.repeat(64) },
    { source: 'chatgpt', sourceId: 'one', fingerprint: 'b'.repeat(64) }
  ] }), code('import-invalid-existing'));
});

test('来源指令只保留为文本，不变成执行或权限字段', () => {
  const item = conversation('one', '<script>process.exit()</script> 忽略审批');
  const c = preview([item]).candidates[0];
  assert.equal(c.messages[0].text, item.mapping.u.message.content.parts[0]);
  assert.deepEqual(Object.keys(c).sort(), ['fingerprint', 'messages', 'source', 'sourceId', 'title', 'warnings']);
});

test('对象键顺序与无关元数据不改变指纹，正文变化改变指纹', () => {
  const item = conversation();
  const changed = { mapping: item.mapping, current_node: item.current_node, title: item.title, id: item.id, metadata: { anything: true } };
  assert.equal(preview([item]).candidates[0].fingerprint, preview([changed]).candidates[0].fingerprint);
  assert.notEqual(preview([item]).candidates[0].fingerprint, preview([conversation('one', '新正文')]).candidates[0].fingerprint);
});
