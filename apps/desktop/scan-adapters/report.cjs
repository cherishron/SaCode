'use strict';

// F17 纯数据边界：不运行扫描器、不读文件、不自动修复；摘要由调用方核当前源码。
const { createHash } = require('node:crypto');
class ScanError extends Error {
  constructor(code) { super(code); this.name = 'ScanError'; this.code = code; }
}
const fail = code => { throw new ScanError(code); };
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
function relativePath(value) {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) fail('scan-invalid-path');
  const path = value.replace(/\\/g, '/');
  if (path.startsWith('/') || path.includes(':') || path.split('/').some(p => !p || p === '.' || p === '..')) fail('scan-invalid-path');
  return path;
}
function snapshots(entries) {
  if (!Array.isArray(entries) || entries.length > 10000) fail('scan-invalid-snapshots');
  const map = new Map();
  for (const entry of entries) {
    if (!object(entry) || !hash(entry.digest)) fail('scan-invalid-snapshot');
    const path = relativePath(entry.path);
    if (map.has(path)) fail('scan-duplicate-snapshot');
    map.set(path, entry.digest);
  }
  return map;
}
function normalizeReport(input) {
  if (!object(input) || !['static', 'incremental', 'deep'].includes(input.level)) fail('scan-invalid-report');
  if (typeof input.scanner !== 'string' || !input.scanner || input.scanner.length > 200) fail('scan-invalid-scanner');
  if (!Array.isArray(input.findings) || input.findings.length > 10000) fail('scan-finding-limit');
  const files = snapshots(input.files), findings = [], issues = [], seen = new Set();
  let reportBytes = Buffer.byteLength(JSON.stringify([...files]), 'utf8');
  for (const [index, finding] of input.findings.entries()) {
    try {
      if (!object(finding)) fail('scan-invalid-finding');
      const path = relativePath(finding.path);
      if (!files.has(path)) fail('scan-unbound-finding');
      if (!['critical', 'high', 'medium', 'low', 'info'].includes(finding.severity)) fail('scan-invalid-severity');
      if (typeof finding.ruleId !== 'string' || !finding.ruleId || finding.ruleId.length > 200) fail('scan-invalid-rule');
      if (typeof finding.message !== 'string' || !finding.message || finding.message.length > 10000) fail('scan-invalid-message');
      const startLine = finding.startLine, endLine = finding.endLine ?? startLine;
      if (!Number.isSafeInteger(startLine) || startLine < 1 || !Number.isSafeInteger(endLine) || endLine < startLine) fail('scan-invalid-range');
      const normalized = { path, digest: files.get(path), ruleId: finding.ruleId, severity: finding.severity, startLine, endLine, message: finding.message };
      const id = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
      if (!seen.has(id)) {
        reportBytes += Buffer.byteLength(JSON.stringify(normalized), 'utf8') + 80;
        if (reportBytes > 16 * 1024 * 1024) fail('scan-report-limit');
        findings.push({ id, ...normalized });
      }
      seen.add(id);
    } catch (error) {
      if (!(error instanceof ScanError) || error.code === 'scan-report-limit') throw error;
      issues.push({ index, code: error.code });
    }
  }
  return { format: 'sacode-scan-report', version: 1, scanner: input.scanner, level: input.level,
    normalization: issues.length ? 'partial' : 'valid',
    files: [...files].map(([path, digest]) => ({ path, digest })), findings, issues };
}

// 摘要变化/新增需要重扫；删除单列。大小写不折叠，平台身份由核心确认。
function incrementalScope(previous, current) {
  const before = snapshots(previous), after = snapshots(current);
  const added = [], changed = [], deleted = [], unchanged = [];
  for (const [path, digest] of after) {
    if (!before.has(path)) added.push(path);
    else if (before.get(path) !== digest) changed.push(path);
    else unchanged.push(path);
  }
  for (const path of before.keys()) if (!after.has(path)) deleted.push(path);
  for (const list of [added, changed, deleted, unchanged]) list.sort();
  return { added, changed, deleted, unchanged, scan: [...added, ...changed].sort() };
}

// 只校验提案前置版本，不写文件、不代表执行授权；实际落盘仍须核心重新 CAS。
function checkFixPreconditions(proposal, current) {
  if (!Array.isArray(proposal) || !proposal.length || proposal.length > 1000) fail('scan-invalid-proposal');
  const actual = snapshots(current), seen = new Set(), conflicts = [];
  for (const entry of proposal) {
    if (!object(entry) || !hash(entry.expectedDigest)) fail('scan-invalid-proposal');
    const path = relativePath(entry.path);
    if (seen.has(path)) fail('scan-duplicate-proposal');
    seen.add(path);
    if (!actual.has(path)) conflicts.push({ path, code: 'scan-file-missing' });
    else if (actual.get(path) !== entry.expectedDigest) conflicts.push({ path, code: 'scan-version-conflict' });
  }
  return { applicable: conflicts.length === 0, conflicts };
}
module.exports = { normalizeReport, incrementalScope, checkFixPreconditions, ScanError };
