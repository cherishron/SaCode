import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { previewChatGptAsync } = require('../../import-adapters/async-preview.cjs');
const { previewChatGpt } = require('../../import-adapters/chatgpt.cjs');
const { buildImportHandoff } = require('../../import-adapters/handoff.cjs');
const { normalizeReport, incrementalScope, checkFixPreconditions } = require('../../scan-adapters/report.cjs');
const { buildScanHandoff } = require('../../scan-adapters/handoff.cjs');
const source = JSON.stringify([{ id: 'source-1', title: '示例', current_node: 'node-1', mapping: {
  'node-1': { id: 'node-1', parent: null, message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['不可信外部正文'] } } }
} }]);
const a = 'a'.repeat(64), b = 'b'.repeat(64);
const target = { projectId: 'project', requestId: 'import-1', expectedRevision: 'revision-1' };

test('线程预览到显式交接，再用模拟核心摘要验证重复导入', async () => {
  const p = await previewChatGptAsync(source);
  const c = p.candidates[0];
  const handoff = buildImportHandoff(p, [{ sourceId: c.sourceId, fingerprint: c.fingerprint }], target);
  assert.equal(handoff.items[0].messages[0].text, '不可信外部正文');
  // 仅模拟核心回传已落库摘要，不宣称此测试实际持久化。
  const existing = handoff.items.map(({ source, sourceId, fingerprint }) => ({ source, sourceId, fingerprint }));
  const repeated = await previewChatGptAsync(source, { existing });
  assert.equal(repeated.summary.duplicate, 1);
  assert.equal(repeated.candidates.length, 0);
});
test('JSON 往返后的交接独立于预览，不复制权限或来源元数据', () => {
  const p = previewChatGpt(source), c = p.candidates[0];
  c.metadata = { approval: '伪造批准' };
  const transported = JSON.parse(JSON.stringify(p));
  const handoff = buildImportHandoff(transported, [{ sourceId: c.sourceId, fingerprint: c.fingerprint }], target);
  assert.ok(!JSON.stringify(handoff).includes('伪造批准'));
  c.messages[0].text = '后续修改';
  assert.equal(handoff.items[0].messages[0].text, '不可信外部正文');
});
test('增量扫描到报告交接，再到修改后失效和修复拒绝', () => {
  const before = [{ path: 'src/a.js', digest: a }], current = [{ path: 'src/a.js', digest: b }];
  assert.deepEqual(incrementalScope(before, current).scan, ['src/a.js']);
  const r = normalizeReport({ scanner: 'fixture', level: 'incremental', files: current, findings: [
    { path: 'src/a.js', ruleId: 'rule', severity: 'high', startLine: 1, message: '发现' }
  ] });
  const context = { projectId: 'project', taskId: 'task', requestId: 'scan-1', expectedRevision: 'revision-1', executionStatus: 'succeeded' };
  assert.equal(buildScanHandoff(JSON.parse(JSON.stringify(r)), current, context).usable, true);
  const afterEdit = [{ path: 'src/a.js', digest: a }];
  assert.equal(buildScanHandoff(r, afterEdit, context).usable, false);
  assert.deepEqual(checkFixPreconditions([{ path: 'src/a.js', expectedDigest: b }], afterEdit), {
    applicable: false, conflicts: [{ path: 'src/a.js', code: 'scan-version-conflict' }]
  });
});
test('模拟失败和损坏扫描不因 JSON 往返升级为成功', () => {
  const files = [{ path: 'a.js', digest: a }];
  const r = normalizeReport({ scanner: 'fixture', level: 'static', files, findings: [null] });
  const result = buildScanHandoff(JSON.parse(JSON.stringify(r)), files, {
    projectId: 'p', taskId: 't', requestId: 'r', expectedRevision: 'v', executionStatus: 'failed'
  });
  assert.equal(result.usable, false);
  assert.equal(result.report.normalization, 'partial');
  assert.equal(result.context.executionStatus, 'failed');
});
