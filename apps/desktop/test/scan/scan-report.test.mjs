import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { normalizeReport, incrementalScope, checkFixPreconditions } = require('../../scan-adapters/report.cjs');
const a = 'a'.repeat(64), b = 'b'.repeat(64);
const snapshot = (path, digest = a) => ({ path, digest });
const finding = (overrides = {}) => ({ path: 'src/main.js', ruleId: 'unsafe-call', severity: 'high', startLine: 2, message: '检查调用', ...overrides });
const report = (findings = [finding()], files = [snapshot('src/main.js')]) => ({ scanner: 'fixture', level: 'static', files, findings });
const code = expected => error => error.code === expected;

test('扫描结果白名单绑定源码摘要，规范路径与行号', () => {
  const result = normalizeReport(report([finding({ path: 'src\\main.js', metadata: { secret: true }, patch: '不得执行' })]));
  assert.equal(result.findings[0].path, 'src/main.js');
  assert.equal(result.findings[0].digest, a);
  assert.equal(result.findings[0].endLine, 2);
  assert.match(result.findings[0].id, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(result).includes('不得执行'));
});
test('损坏发现明确标为部分归一，空发现不等同扫描通过', () => {
  assert.equal(normalizeReport(report([null])).normalization, 'partial');
  assert.equal(normalizeReport(report([])).normalization, 'valid');
  assert.ok(!Object.hasOwn(normalizeReport(report([])), 'passed'));
});
test('完全相同结果去重，不合并不同规则或版本', () => {
  assert.equal(normalizeReport(report([finding(), finding()])).findings.length, 1);
  assert.equal(normalizeReport(report([finding(), finding({ ruleId: 'other' })])).findings.length, 2);
  assert.notEqual(normalizeReport(report()).findings[0].id, normalizeReport(report([finding()], [snapshot('src/main.js', b)])).findings[0].id);
});
test('损坏结果逐项报告，不回显原始载荷', () => {
  const result = normalizeReport(report([null, finding({ severity: 'secret' }), finding()]));
  assert.equal(result.findings.length, 1);
  assert.deepEqual(result.issues, [{ index: 0, code: 'scan-invalid-finding' }, { index: 1, code: 'scan-invalid-severity' }]);
  assert.ok(!JSON.stringify(result).includes('secret'));
});
test('拒绝绝对路径、穿越、空片段、URI与控制字符', () => {
  for (const path of ['/etc/passwd', 'C:\\data', '../x', 'src/../x', './x', 'src//x', '\\\\server\\x', 'file://x', 'x\u0000y', 'x/']) {
    assert.equal(normalizeReport(report([finding({ path })])).issues[0].code, 'scan-invalid-path');
  }
});
test('结果必须属于扫描文件，不能凭未绑定发现自报通过', () => {
  assert.equal(normalizeReport(report([finding({ path: 'other.js' })])).issues[0].code, 'scan-unbound-finding');
});
test('规则、消息、范围严格校验', () => {
  for (const [override, expected] of [
    [{ ruleId: '' }, 'scan-invalid-rule'], [{ message: '' }, 'scan-invalid-message'],
    [{ startLine: 0 }, 'scan-invalid-range'], [{ startLine: 1.5 }, 'scan-invalid-range'],
    [{ endLine: 1 }, 'scan-invalid-range'], [{ startLine: Number.MAX_SAFE_INTEGER + 1 }, 'scan-invalid-range']
  ]) assert.equal(normalizeReport(report([finding(override)])).issues[0].code, expected);
});
test('扫描级别和文件快照损坏整批拒绝', () => {
  assert.throws(() => normalizeReport({ ...report(), level: 'pretend' }), code('scan-invalid-report'));
  assert.throws(() => normalizeReport({ ...report(), scanner: '' }), code('scan-invalid-scanner'));
  assert.throws(() => normalizeReport(report([], [snapshot('a', 'wrong')])), code('scan-invalid-snapshot'));
  assert.throws(() => normalizeReport(report([], [snapshot('src/main.js'), snapshot('src\\main.js')])), code('scan-duplicate-snapshot'));
  assert.throws(() => normalizeReport(report(Array(10001).fill(finding()))), code('scan-finding-limit'));
});
test('每个需求级别仅作为报告标签，不推导真实扫描能力', () => {
  for (const level of ['static', 'incremental', 'deep']) assert.equal(normalizeReport({ ...report(), level }).level, level);
});
test('增量范围区分新增、变化、删除与未变且顺序稳定', () => {
  const result = incrementalScope([snapshot('same'), snapshot('change'), snapshot('gone')], [snapshot('new'), snapshot('change', b), snapshot('same')]);
  assert.deepEqual(result, { added: ['new'], changed: ['change'], deleted: ['gone'], unchanged: ['same'], scan: ['change', 'new'] });
});
test('增量路径不折叠大小写，不假装判断重命名', () => {
  assert.deepEqual(incrementalScope([snapshot('A.js')], [snapshot('a.js')]), { added: ['a.js'], changed: [], deleted: ['A.js'], unchanged: [], scan: ['a.js'] });
});
test('空增量与重复快照边界', () => {
  assert.deepEqual(incrementalScope([], []), { added: [], changed: [], deleted: [], unchanged: [], scan: [] });
  assert.throws(() => incrementalScope([], [snapshot('a'), snapshot('a')]), code('scan-duplicate-snapshot'));
});
test('修复版本一致只通过前置检查，不执行补丁', () => {
  assert.deepEqual(checkFixPreconditions([{ path: 'src\\main.js', expectedDigest: a, patch: '不得执行' }], [snapshot('src/main.js')]), { applicable: true, conflicts: [] });
});
test('修复版本变化或文件消失整组不可应用，报告所有冲突', () => {
  assert.deepEqual(checkFixPreconditions([{ path: 'a', expectedDigest: a }, { path: 'b', expectedDigest: a }], [snapshot('a', b)]), {
    applicable: false, conflicts: [{ path: 'a', code: 'scan-version-conflict' }, { path: 'b', code: 'scan-file-missing' }]
  });
});
test('稀疏发现不能静默跳过，归一报告累计字节超限整批拒绝', () => {
  assert.equal(normalizeReport(report(Array(1))).normalization, 'partial');
  const findings = Array.from({ length: 2000 }, (_, i) => finding({ startLine: i + 1, message: 'x'.repeat(10000) }));
  assert.throws(() => normalizeReport(report(findings)), code('scan-report-limit'));
});
test('空修复、非法摘要、重复提案与穿越均拒绝', () => {
  assert.throws(() => checkFixPreconditions([], []), code('scan-invalid-proposal'));
  assert.throws(() => checkFixPreconditions([{ path: 'a', expectedDigest: 'bad' }], []), code('scan-invalid-proposal'));
  assert.throws(() => checkFixPreconditions([{ path: 'a', expectedDigest: a }, { path: 'a', expectedDigest: a }], []), code('scan-duplicate-proposal'));
  assert.throws(() => checkFixPreconditions([{ path: '../a', expectedDigest: a }], []), code('scan-invalid-path'));
});
