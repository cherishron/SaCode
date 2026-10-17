'use strict';

// 预览选择交接数据，不创建原生会话事件、不授予权限、不写存储。
const { createHash } = require('node:crypto');
const { ImportError, DEFAULT_LIMITS } = require('./chatgpt.cjs');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = code => { throw new ImportError(code); };
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function normalizeCandidate(candidate) {
  if (!object(candidate) || candidate.source !== 'chatgpt' || !id(candidate.sourceId) || !hash(candidate.fingerprint)) fail('import-invalid-candidate');
  if (typeof candidate.title !== 'string' || candidate.title.length > 1000) fail('import-invalid-candidate');
  if (!Array.isArray(candidate.messages) || !candidate.messages.length || candidate.messages.length > DEFAULT_LIMITS.messages) fail('import-invalid-candidate');
  const seen = new Set();
  let serializedBytes = Buffer.byteLength(JSON.stringify({ source: candidate.source, sourceId: candidate.sourceId, title: candidate.title }), 'utf8');
  const messages = Array.from(candidate.messages, message => {
    if (!object(message) || !id(message.sourceId) || seen.has(message.sourceId) || !['user', 'assistant'].includes(message.role)) fail('import-invalid-candidate');
    if (typeof message.text !== 'string' || !message.text.trim() || Buffer.byteLength(message.text, 'utf8') > DEFAULT_LIMITS.textBytes) fail('import-invalid-candidate');
    const normalizedMessage = { sourceId: message.sourceId, role: message.role, text: message.text };
    serializedBytes += Buffer.byteLength(JSON.stringify(normalizedMessage), 'utf8') + 1;
    if (serializedBytes > DEFAULT_LIMITS.bytes) fail('import-handoff-limit');
    seen.add(message.sourceId);
    return normalizedMessage;
  });
  const normalized = { source: 'chatgpt', sourceId: candidate.sourceId, title: candidate.title, messages };
  const fingerprint = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  if (fingerprint !== candidate.fingerprint) fail('import-preview-changed');
  return { ...normalized, fingerprint };
}

// selection 明确绑定用户看到的来源指纹；target 只传不透明身份，不接受路径/权限。
// 映射仅允许改展示标题，不改来源指纹、角色或正文。
function buildImportHandoff(preview, selection, target) {
  if (!object(preview) || preview.format !== 'sacode-conversation-preview' || preview.version !== 1 || !Array.isArray(preview.candidates) || preview.candidates.length > DEFAULT_LIMITS.conversations) fail('import-invalid-preview');
  if (!Array.isArray(selection) || !selection.length || selection.length > DEFAULT_LIMITS.conversations) fail('import-invalid-selection');
  if (!object(target) || !id(target.projectId) || !id(target.expectedRevision) || !id(target.requestId)) fail('import-invalid-target');
  const candidates = new Map();
  let bytes = 0;
  for (const raw of preview.candidates) {
    const candidate = normalizeCandidate(raw);
    bytes += Buffer.byteLength(JSON.stringify(candidate), 'utf8');
    if (bytes > DEFAULT_LIMITS.bytes) fail('import-handoff-limit');
    if (candidates.has(candidate.sourceId)) fail('import-invalid-preview');
    candidates.set(candidate.sourceId, candidate);
  }
  const items = [], seen = new Set();
  for (const choice of selection) {
    if (!object(choice) || !id(choice.sourceId) || !hash(choice.fingerprint) || seen.has(choice.sourceId)) fail('import-invalid-selection');
    seen.add(choice.sourceId);
    const candidate = candidates.get(choice.sourceId);
    if (!candidate || choice.fingerprint !== candidate.fingerprint) fail('import-preview-changed');
    const displayTitle = choice.displayTitle ?? candidate.title;
    if (typeof displayTitle !== 'string' || !displayTitle.trim() || displayTitle.length > 1000) fail('import-invalid-mapping');
    items.push({ ...candidate, displayTitle });
  }
  const handoff = { format: 'sacode-import-handoff', version: 1, operation: 'append-imported-transcripts',
    target: { projectId: target.projectId, expectedRevision: target.expectedRevision, requestId: target.requestId }, items };
  if (Buffer.byteLength(JSON.stringify(handoff), 'utf8') > DEFAULT_LIMITS.bytes) fail('import-handoff-limit');
  return handoff;
}
module.exports = { buildImportHandoff, normalizeCandidate };
