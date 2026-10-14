import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { normalizeReport } = require('../../scan-adapters/report.cjs');
const { evaluateFreshness, buildScanHandoff } = require('../../scan-adapters/handoff.cjs');
const a = 'a'.repeat(64), b = 'b'.repeat(64);
const files = [{ path: 'a.js', digest: a }, { path: 'b.js', digest: b }];
const context = { projectId: 'p', taskId: 't', requestId: 'r', expectedRevision: 'v1', executionStatus: 'succeeded' };
function report(extra = []) { return normalizeReport({ scanner: 'fixture', level: 'incremental', files, findings: [
  { path: 'a.js', ruleId: 'rule', severity: 'low', startLine: 1, message: '结果' }, ...extra
] }); }
const code = expected => error => error.code === expected;
test('未变化报告可用，新增文件明确为范围外而非已扫描', () => {
  const r = report(), result = buildScanHandoff(r, [...files, { path: 'new.js', digest: a }], context);
  assert.equal(result.usable, true);
  assert.equal(result.freshness.freshness, 'current');
  assert.deepEqual(result.freshness.outsideScope, ['new.js']);
  assert.deepEqual(result.freshness.currentFindingIds, [r.findings[0].id]);
  assert.match(result.reportFingerprint, /^[a-f0-9]{64}$/);
  assert.ok(!Object.hasOwn(result, 'passed'));
});
test('扫描文件变化或删除令整个报告过期，逐发现区分有效性', () => {
  const r = report();
  const changed = evaluateFreshness(r, [{ path: 'a.js', digest: b }]);
  assert.equal(changed.freshness, 'stale');
  assert.deepEqual(changed.changed, ['a.js']);
  assert.deepEqual(changed.deleted, ['b.js']);
  assert.deepEqual(changed.staleFindingIds, [r.findings[0].id]);
  assert.equal(buildScanHandoff(r, [{ path: 'a.js', digest: b }], context).usable, false);
  // 没有发现的文件发生变化也令报告过期。
  assert.equal(evaluateFreshness(r, [files[0]]).freshness, 'stale');
});
test('失败取消未知和部分归一不升级为可用成功事实', () => {
  for (const executionStatus of ['failed', 'cancelled', 'unknown']) assert.equal(buildScanHandoff(report(), files, { ...context, executionStatus }).usable, false);
  assert.equal(buildScanHandoff(report([null]), files, context).usable, false);
});
test('修改摘要或正文、伪造状态以及重复发现拒绝', () => {
  for (const mutate of [r => r.findings[0].message = '变化', r => r.findings[0].digest = b, r => r.findings.push(r.findings[0]), r => { r.normalization = 'partial'; }]) {
    const r = report(); mutate(r);
    assert.throws(() => evaluateFreshness(r, files), error => ['scan-report-changed', 'scan-invalid-handoff-report'].includes(error.code));
  }
});
test('交接上下文严格检查且未知字段不复制', () => {
  assert.throws(() => buildScanHandoff(report(), files, { ...context, expectedRevision: '' }), code('scan-invalid-context'));
  assert.throws(() => buildScanHandoff(report(), files, { ...context, executionStatus: 'pass' }), code('scan-invalid-execution-status'));
  const result = buildScanHandoff(report(), files, { ...context, approval: '秘密' });
  assert.ok(!JSON.stringify(result).includes('秘密'));
});
test('交接为独立副本，结果正文仍是不可信文本', () => {
  const r = report(), result = buildScanHandoff(r, files, context);
  r.findings[0].message = '改变';
  assert.equal(result.report.findings[0].message, '结果');
});
