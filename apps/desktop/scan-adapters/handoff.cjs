'use strict';

// 扫描事实交接只校验数据，不推断扫描器成功，也不授予修复权限。
const { normalizeReport, incrementalScope, ScanError } = require('./report.cjs');
const { createHash } = require('node:crypto');
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const fail = code => { throw new ScanError(code); };
const identity = v => typeof v === 'string' && v.length > 0 && v.length <= 256 && !/[\x00-\x1f\x7f]/.test(v);
function validateReport(report) {
  if (!object(report) || report.format !== 'sacode-scan-report' || report.version !== 1 || !['valid', 'partial'].includes(report.normalization)) fail('scan-invalid-handoff-report');
  if (!Array.isArray(report.issues) || report.issues.length > 10000) fail('scan-invalid-handoff-report');
  const issues = Array.from(report.issues, issue => {
    if (!object(issue) || !Number.isSafeInteger(issue.index) || issue.index < 0 || typeof issue.code !== 'string' || !/^scan-[a-z-]+$/.test(issue.code) || issue.code.length > 100) fail('scan-invalid-handoff-report');
    return { index: issue.index, code: issue.code };
  });
  if ((issues.length > 0) !== (report.normalization === 'partial')) fail('scan-invalid-handoff-report');
  const normalized = normalizeReport(report);
  if (normalized.issues.length || normalized.findings.length !== report.findings.length) fail('scan-invalid-handoff-report');
  for (let i = 0; i < normalized.findings.length; i++) {
    const expected = normalized.findings[i], actual = report.findings[i];
    if (actual.id !== expected.id || actual.digest !== expected.digest) fail('scan-report-changed');
  }
  return { ...normalized, normalization: report.normalization, issues };
}
function evaluateFreshness(report, current) {
  const normalized = validateReport(report);
  const scope = incrementalScope(normalized.files, current);
  const invalidated = new Set([...scope.changed, ...scope.deleted]);
  return { freshness: invalidated.size ? 'stale' : 'current',
    changed: scope.changed, deleted: scope.deleted, outsideScope: scope.added,
    currentFindingIds: normalized.findings.filter(f => !invalidated.has(f.path)).map(f => f.id),
    staleFindingIds: normalized.findings.filter(f => invalidated.has(f.path)).map(f => f.id) };
}
function buildScanHandoff(report, current, context) {
  if (!object(context) || !identity(context.projectId) || !identity(context.taskId) || !identity(context.requestId) || !identity(context.expectedRevision)) fail('scan-invalid-context');
  if (!['succeeded', 'failed', 'cancelled', 'unknown'].includes(context.executionStatus)) fail('scan-invalid-execution-status');
  const normalized = validateReport(report), freshness = evaluateFreshness(normalized, current);
  const reportFingerprint = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  return { format: 'sacode-scan-handoff', version: 1,
    context: { projectId: context.projectId, taskId: context.taskId, requestId: context.requestId, expectedRevision: context.expectedRevision, executionStatus: context.executionStatus },
    report: normalized, reportFingerprint, freshness,
    // 仅表示可展示完整且未过期的扫描事实，不叫 passed，也不包含修复授权。
    usable: context.executionStatus === 'succeeded' && normalized.normalization === 'valid' && freshness.freshness === 'current' };
}
module.exports = { evaluateFreshness, buildScanHandoff, validateReport };
