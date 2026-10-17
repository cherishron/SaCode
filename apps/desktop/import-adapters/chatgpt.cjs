'use strict';

// F19 来源适配器：只解析调用方提供的文本，不读文件、不执行内容、不写会话。
// 输出是导入预览，不是可信消息历史；落库必须另走共享核心授权与持久化。
const { createHash } = require('node:crypto');
const DEFAULT_LIMITS = Object.freeze({ bytes: 16 * 1024 * 1024, conversations: 2000, nodes: 20000, messages: 10000, textBytes: 1024 * 1024 });
class ImportError extends Error {
  constructor(code) { super(code); this.name = 'ImportError'; this.code = code; }
}
function fail(code) { throw new ImportError(code); }
function checkCancelled(signal) { if (signal?.aborted) fail('import-cancelled'); }
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function boundedString(value, max) { return typeof value === 'string' && value.length > 0 && value.length <= max; }
function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function limitsFor(overrides = {}) {
  if (!record(overrides)) fail('import-invalid-limits');
  const result = { ...DEFAULT_LIMITS };
  for (const [key, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(result, key) || !Number.isSafeInteger(value) || value < 1 || value > result[key]) fail('import-invalid-limits');
    result[key] = value;
  }
  return result;
}
// 工作线程克隆前与同步入口共用校验；未知字段不进入线程，避免放大载荷。
function prepareExisting(existing = [], signal) {
  if (!Array.isArray(existing)) fail('import-invalid-existing');
  if (existing.length > 10000) fail('import-existing-limit');
  const known = new Map(), entries = [];
  for (const entry of existing) {
    checkCancelled(signal);
    if (!record(entry) || entry.source !== 'chatgpt' || !boundedString(entry.sourceId, 256) || typeof entry.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(entry.fingerprint)) fail('import-invalid-existing');
    if (known.has(entry.sourceId) && known.get(entry.sourceId) !== entry.fingerprint) fail('import-invalid-existing');
    if (!known.has(entry.sourceId)) entries.push({ source: 'chatgpt', sourceId: entry.sourceId, fingerprint: entry.fingerprint });
    known.set(entry.sourceId, entry.fingerprint);
  }
  return entries;
}
function parseConversation(item, limits, signal) {
  if (!record(item) || !boundedString(item.id, 256) || !record(item.mapping)) fail('import-invalid-conversation');
  if (typeof item.title !== 'string' || item.title.length > 1000) fail('import-invalid-title');
  const ids = Object.keys(item.mapping);
  if (ids.length > limits.nodes) fail('import-node-limit');
  if (!boundedString(item.current_node, 256)) fail('import-missing-current-node');
  const chain = [], visited = new Set();
  let cursor = item.current_node;
  while (cursor !== null) {
    checkCancelled(signal);
    if (!boundedString(cursor, 256) || !Object.hasOwn(item.mapping, cursor)) fail('import-broken-parent');
    if (visited.has(cursor)) fail('import-parent-cycle');
    visited.add(cursor);
    const node = item.mapping[cursor];
    if (!record(node) || node.id !== cursor || !(node.parent === null || boundedString(node.parent, 256))) fail('import-invalid-node');
    chain.push(node);
    cursor = node.parent;
  }
  const messages = [], warnings = [];
  for (const node of chain.reverse()) {
    checkCancelled(signal);
    if (node.message === null) continue;
    const message = node.message;
    if (!record(message) || !record(message.author)) fail('import-invalid-message');
    const role = message.author.role;
    // 系统/工具消息不得作为新系统提示或可执行工具事件进入 SaCode。
    if (role !== 'user' && role !== 'assistant') {
      warnings.push({ code: 'import-role-skipped', nodeId: node.id });
      continue;
    }
    if (message.metadata?.is_visually_hidden_from_conversation === true) continue;
    const content = message.content;
    if (!record(content) || content.content_type !== 'text' || !Array.isArray(content.parts)) {
      warnings.push({ code: 'import-content-skipped', nodeId: node.id });
      continue;
    }
    if (!content.parts.every(part => typeof part === 'string')) fail('import-invalid-text-parts');
    const text = content.parts.join('\n');
    if (Buffer.byteLength(text, 'utf8') > limits.textBytes) fail('import-text-limit');
    if (!text.trim()) continue;
    if (messages.length >= limits.messages) fail('import-message-limit');
    messages.push({ sourceId: node.id, role, text });
  }
  if (!messages.length) fail('import-empty-conversation');
  // 严格白名单：不复制配置、凭据、metadata、附件路径或工具调用。
  const normalized = { source: 'chatgpt', sourceId: item.id, title: item.title, messages };
  return { ...normalized, fingerprint: digest(normalized), warnings };
}

// existing 由核心提供已落库来源摘要；相同来源不同内容只报告冲突，不覆盖旧记录。
// 同一批次同 ID 有不同内容时整组排除，避免先到的条目决定最终内容。
function previewChatGpt(text, options = {}) {
  if (!record(options)) fail('import-invalid-options');
  const { signal, existing = [], limits: overrides } = options;
  const limits = limitsFor(overrides);
  checkCancelled(signal);
  if (typeof text !== 'string') fail('import-invalid-input');
  if (Buffer.byteLength(text, 'utf8') > limits.bytes) fail('import-input-limit');
  let input;
  try { input = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { fail('import-invalid-json'); }
  if (!Array.isArray(input)) fail('import-invalid-root');
  if (input.length > limits.conversations) fail('import-conversation-limit');
  const known = new Map(prepareExisting(existing, signal).map(entry => [entry.sourceId, entry.fingerprint]));
  const parsed = [], issues = [], groups = new Map();
  for (let index = 0; index < input.length; index++) {
    checkCancelled(signal);
    try {
      const conversation = parseConversation(input[index], limits, signal);
      parsed.push({ index, conversation });
      const group = groups.get(conversation.sourceId) || new Set();
      group.add(conversation.fingerprint);
      groups.set(conversation.sourceId, group);
    } catch (error) {
      if (!(error instanceof ImportError) || error.code === 'import-cancelled') throw error;
      // 报告不回显原始正文、凭据或解析异常载荷。
      issues.push({ index, code: error.code });
    }
  }
  const candidates = [], duplicates = [], conflicts = [], seen = new Set();
  for (const { index, conversation } of parsed) {
    checkCancelled(signal);
    const { sourceId, fingerprint } = conversation;
    if (groups.get(sourceId).size > 1 || (known.has(sourceId) && known.get(sourceId) !== fingerprint)) {
      conflicts.push({ index, sourceId, code: 'import-source-conflict' });
    } else if (seen.has(sourceId) || known.has(sourceId)) {
      duplicates.push({ index, sourceId });
    } else {
      candidates.push(conversation);
    }
    seen.add(sourceId);
  }
  return { format: 'sacode-conversation-preview', version: 1, candidates, duplicates, conflicts, issues,
    summary: { total: input.length, ready: candidates.length, duplicate: duplicates.length, conflict: conflicts.length, invalid: issues.length } };
}
module.exports = { previewChatGpt, ImportError, DEFAULT_LIMITS, prepareExisting, limitsFor };
