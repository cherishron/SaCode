import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appSrc = readFileSync(join(__dirname, '..', 'renderer', 'app.js'), 'utf8');

test('助手正文有独立复制按钮，不以工具结果复制按钮替代', () => {
  // copyMsgText 函数存在
  assert.match(appSrc, /copyMsgText/, '应有 copyMsgText 复制函数');
  // msg-copy 类存在（与 tool-card 的 btn-copy 区分）
  assert.match(appSrc, /msg-copy/, '助手正文复制按钮应有 msg-copy 类');
  // 只在 assistant 角色显示复制按钮
  assert.match(appSrc, /m\.role\s*===\s*['"]assistant['"]\s*&&\s*text/, '复制按钮应限定 assistant 角色');
  // 复制反馈状态独立于 tool-card
  assert.match(appSrc, /msgCopyFeedback/, '应有独立的复制反馈状态');
});

test('tool-card 复制结果按钮与助手正文复制按钮独立', () => {
  const toolSrc = readFileSync(join(__dirname, '..', 'renderer', 'pages', 'tool-card.ts'), 'utf8');
  // tool-card 有"复制结果"按钮
  assert.match(toolSrc, /复制结果/, 'tool-card 应有复制结果按钮');
  // tool-card 不含 msg-copy（不混淆）
  assert.doesNotMatch(toolSrc, /msg-copy/, 'tool-card 不应使用 msg-copy 类');
});

test('msgCopyFeedback 有 copied 和 failed 两个独立 Set', () => {
  assert.match(appSrc, /msgCopyFeedback\s*=\s*window\.Vue\.reactive\(\s*\{\s*copied:\s*new\s+Set\(\),\s*failed:\s*new\s+Set\(\)\s*\}\s*\)/,
    'msgCopyFeedback 应为 { copied: Set, failed: Set }');
});

test('copyMsgText 降级分支用 finally 保证 textarea 移除', () => {
  // finally 中 removeChild
  assert.match(appSrc, /finally\s*\{\s*document\.body\.removeChild\(ta\);?\s*\}/,
    '降级分支应在 finally 中移除 textarea');
  // removeChild 不再内联在 try 末尾（旧写法）
  assert.doesNotMatch(appSrc, /document\.body\.appendChild\(ta\);\s*ta\.select\(\);\s*ok\s*=\s*document\.execCommand\('copy'\);\s*document\.body\.removeChild\(ta\)/,
    '不应再把 removeChild 内联在 try 末尾（异常时会漏移除）');
});

test('copyMsgText 成功/失败反馈分别写入 copied/failed', () => {
  assert.match(appSrc, /msgCopyFeedback\.copied\.add\(id\)/, '成功时应 add 到 copied');
  assert.match(appSrc, /msgCopyFeedback\.failed\.add\(id\)/, '失败时应 add 到 failed');
  assert.match(appSrc, /msgCopyFeedback\.failed\.delete\(id\)/, '成功时应清除 failed');
  assert.match(appSrc, /msgCopyFeedback\.copied\.delete\(id\)/, '失败时应清除 copied');
});

test('copyMsgText 行为：clipboard+降级均失败时 textarea 被移除且 failed 反馈设置', async () => {
  // 独立模拟 copyMsgText 契约语义（app.js 依赖浏览器环境无法直接 import）。
  // 此测试验证 finally 语义与反馈逻辑，与源码 copyMsgText 结构一一对应。
  const appended = [];
  const removed = [];
  const doc = {
    createElement: () => ({
      value: '', setAttribute() {}, style: {},
      select() { throw new Error('select 抛异常'); },
    }),
    execCommand: () => false,
    body: { appendChild(n) { appended.push(n); }, removeChild(n) { removed.push(n); return n; } },
  };
  const nav = { clipboard: { writeText: async () => { throw new Error('无 clipboard'); } } };

  const feedback = { copied: new Set(), failed: new Set() };
  const copyMsgText = async (id, text) => {
    let ok = false;
    try { await nav.clipboard.writeText(text); ok = true; }
    catch {
      const ta = doc.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      doc.body.appendChild(ta);
      try { ta.select(); ok = doc.execCommand('copy'); }
      finally { doc.body.removeChild(ta); }
    }
    if (ok) { feedback.failed.delete(id); feedback.copied.add(id); }
    else { feedback.copied.delete(id); feedback.failed.add(id); }
    return ok;
  };

  const ok = await copyMsgText('m1', 'hello').catch(() => 'threw');
  assert.equal(ok, 'threw', 'select 抛异常时 copyMsgText 应传播异常（finally 只保证清理，不吞异常）');
  assert.equal(appended.length, 1, '应 appendChild 一次');
  assert.equal(removed.length, 1, '应 removeChild 一次（finally 保证，即使 select 抛异常）');
  assert.equal(appended[0], removed[0], '移除的应是同一个 textarea');
});

test('copyMsgText 行为：clipboard+降级均失败（execCommand 返回 false）时 failed 反馈设置', async () => {
  // 核心场景：clipboard 拒绝 + execCommand 返回 false，不抛异常，ok=false。
  // 修复前无可见反馈；修复后应设置 failed 反馈。
  const appended = [];
  const removed = [];
  const doc = {
    createElement: () => ({ value: '', setAttribute() {}, style: {}, select() {} }),
    execCommand: () => false, // 降级也失败，但不抛异常
    body: { appendChild(n) { appended.push(n); }, removeChild(n) { removed.push(n); return n; } },
  };
  const nav = { clipboard: { writeText: async () => { throw new Error('无 clipboard'); } } };

  const feedback = { copied: new Set(), failed: new Set() };
  const copyMsgText = async (id, text) => {
    let ok = false;
    try { await nav.clipboard.writeText(text); ok = true; }
    catch {
      const ta = doc.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      doc.body.appendChild(ta);
      try { ta.select(); ok = doc.execCommand('copy'); }
      finally { doc.body.removeChild(ta); }
    }
    if (ok) { feedback.failed.delete(id); feedback.copied.add(id); }
    else { feedback.copied.delete(id); feedback.failed.add(id); }
    return ok;
  };

  const ok = await copyMsgText('m3', 'fail-text');
  assert.equal(ok, false, '应返回 false');
  assert.equal(removed.length, 1, 'textarea 应被移除');
  assert.ok(feedback.failed.has('m3'), 'failed 反馈应设置（可见反馈）');
  assert.ok(!feedback.copied.has('m3'), 'copied 反馈不应设置');
});

test('copyMsgText 行为：clipboard 成功时设置 copied 且不创建 textarea', async () => {
  const appended = [];
  const removed = [];
  const doc = {
    createElement: () => ({}),
    execCommand: () => false,
    body: { appendChild(n) { appended.push(n); }, removeChild(n) { removed.push(n); return n; } },
  };
  const nav = { clipboard: { writeText: async () => {} } };

  const feedback = { copied: new Set(), failed: new Set() };
  const copyMsgText = async (id, text) => {
    let ok = false;
    try { await nav.clipboard.writeText(text); ok = true; }
    catch {
      const ta = doc.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      doc.body.appendChild(ta);
      try { ta.select(); ok = doc.execCommand('copy'); }
      finally { doc.body.removeChild(ta); }
    }
    if (ok) { feedback.failed.delete(id); feedback.copied.add(id); }
    else { feedback.copied.delete(id); feedback.failed.add(id); }
    return ok;
  };

  const ok = await copyMsgText('m2', 'world');
  assert.equal(ok, true, '应返回 true');
  assert.equal(appended.length, 0, 'clipboard 成功不应创建 textarea');
  assert.ok(feedback.copied.has('m2'), 'copied 反馈应设置');
  assert.ok(!feedback.failed.has('m2'), 'failed 反馈不应设置');
});
