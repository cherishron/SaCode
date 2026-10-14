import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { previewChatGptAsync } = require('../../import-adapters/async-preview.cjs');
const { previewChatGpt } = require('../../import-adapters/chatgpt.cjs');
const text = JSON.stringify([{ id: 'one', title: '测试', current_node: 'u', mapping: {
  u: { id: 'u', parent: null, message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['你好'] } } }
} }]);
const code = expected => error => error.code === expected;

test('工作线程返回与同步预览一致，等待线程退出', async () => {
  assert.deepEqual(await previewChatGptAsync(text), previewChatGpt(text));
});
test('线程解析错误保留固定码，不回显输入', async () => {
  await assert.rejects(previewChatGptAsync('{secret'), code('import-invalid-json'));
});
test('线程收到收紧的限额与已落库摘要', async () => {
  const candidate = previewChatGpt(text).candidates[0];
  assert.equal((await previewChatGptAsync(text, { existing: [candidate] })).duplicates.length, 1);
  await assert.rejects(previewChatGptAsync(text, { limits: { bytes: 1 } }), code('import-input-limit'));
});
test('预取消不启动任务', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(previewChatGptAsync(text, { signal: controller.signal }), code('import-cancelled'));
});
test('在途取消终止自有工作线程，不返回迟到结果', async () => {
  const controller = new AbortController();
  const pending = previewChatGptAsync(text, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, code('import-cancelled'));
});
test('超时终止自有线程并报告超时', async () => {
  await assert.rejects(previewChatGptAsync(' '.repeat(15 * 1024 * 1024) + '[]', { timeoutMs: 1 }), code('import-timeout'));
});
test('异步选项严格校验', async () => {
  for (const options of [null, [], { timeoutMs: 0 }, { timeoutMs: 120001 }, { signal: {} }]) {
    await assert.rejects(previewChatGptAsync(text, options), error => /^import-invalid-/.test(error.code));
  }
});
test('非法摘要在克隆前拒绝，未知字段不进入线程', async () => {
  await assert.rejects(previewChatGptAsync(text, { existing: [() => {}] }), code('import-invalid-existing'));
  const candidate = previewChatGpt(text).candidates[0];
  const result = await previewChatGptAsync(text, { existing: [{ ...candidate, callback: () => {} }] });
  assert.equal(result.duplicates.length, 1);
});
test('已落库摘要数量有界，同步与异步一致拒绝超限', async () => {
  const candidate = previewChatGpt(text).candidates[0];
  const existing = Array(10001).fill(candidate);
  assert.throws(() => previewChatGpt(text, { existing }), code('import-existing-limit'));
  await assert.rejects(previewChatGptAsync(text, { existing }), code('import-existing-limit'));
});
test('并行预览互不取消，独立线程各自结算', async () => {
  const controller = new AbortController();
  const cancelled = previewChatGptAsync(text, { signal: controller.signal });
  const successful = previewChatGptAsync(text);
  controller.abort();
  await assert.rejects(cancelled, code('import-cancelled'));
  assert.equal((await successful).summary.ready, 1);
});
