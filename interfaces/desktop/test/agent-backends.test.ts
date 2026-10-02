import assert from 'node:assert/strict';
import test from 'node:test';
import {
  argsToText,
  backendPathText,
  formatQuotaLine,
  healthBadge,
  installHintFor,
  isBackendEditable,
  isBackendUnavailable,
  isQuotaExhausted,
  NATIVE_BACKEND_ID,
  textToArgs,
} from '../src/ui/logic/agent-backends.ts';

// ---- healthBadge（徽标文案 + 色调） ----

test('healthBadge 四态文案与色调', () => {
  assert.deepEqual(healthBadge('ready'), { label: '就绪', tone: 'success' });
  assert.deepEqual(healthBadge('degraded'), { label: '降级', tone: 'warning' });
  assert.deepEqual(healthBadge('unavailable'), { label: '不可用', tone: 'danger' });
  assert.deepEqual(healthBadge('unknown'), { label: '未知', tone: 'muted' });
  assert.deepEqual(healthBadge(undefined), { label: '未知', tone: 'muted' });
});

// ---- formatQuotaLine（O5 额度一行小字） ----

test('无 quota 返回 null（不渲染）', () => {
  assert.equal(formatQuotaLine(null), null);
  assert.equal(formatQuotaLine(undefined), null);
});

test('有 limit：今日 N/limit', () => {
  assert.equal(
    formatQuotaLine({ date: '2026-01-01', used: 3, limit: 10, exhausted: false }),
    '今日 3/10',
  );
});

test('无 limit：今日 N 次', () => {
  assert.equal(
    formatQuotaLine({ date: '2026-01-01', used: 5, limit: null, exhausted: false }),
    '今日 5 次',
  );
});

test('exhausted：追加「已用尽」', () => {
  assert.equal(
    formatQuotaLine({ date: '2026-01-01', used: 10, limit: 10, exhausted: true }),
    '今日 10/10 · 已用尽',
  );
  assert.equal(
    formatQuotaLine({ date: '2026-01-01', used: 7, limit: null, exhausted: true }),
    '今日 7 次 · 已用尽',
  );
});

test('limit=0 视为无上限', () => {
  assert.equal(
    formatQuotaLine({ date: '2026-01-01', used: 1, limit: 0, exhausted: false }),
    '今日 1 次',
  );
});

test('isQuotaExhausted 只认 exhausted === true', () => {
  assert.equal(isQuotaExhausted({ date: '', used: 0, limit: null, exhausted: true }), true);
  assert.equal(isQuotaExhausted({ date: '', used: 0, limit: null, exhausted: false }), false);
  assert.equal(isQuotaExhausted(null), false);
  assert.equal(isQuotaExhausted(undefined), false);
});

// ---- isBackendUnavailable / isBackendEditable ----

test('isBackendUnavailable 仅 health=unavailable', () => {
  assert.equal(isBackendUnavailable({ health: 'unavailable' }), true);
  assert.equal(isBackendUnavailable({ health: 'ready' }), false);
  assert.equal(isBackendUnavailable({ health: 'degraded' }), false);
  assert.equal(isBackendUnavailable({ health: 'unknown' }), false);
  assert.equal(isBackendUnavailable({}), false);
});

test('isBackendEditable：native sacode 不可改，其余可改', () => {
  assert.equal(isBackendEditable({ id: NATIVE_BACKEND_ID }), false);
  assert.equal(isBackendEditable({ id: 'sacode' }), false);
  assert.equal(isBackendEditable({ id: 'opencode' }), true);
  assert.equal(isBackendEditable({ id: 'codebuddy' }), true);
});

// ---- args 编辑（按空白拆行展示 / 按空白还原） ----

test('argsToText 每行一个参数', () => {
  assert.equal(argsToText(['x', 'opencode-ai', 'acp']), 'x\nopencode-ai\nacp');
  assert.equal(argsToText([]), '');
  assert.equal(argsToText(null), '');
  assert.equal(argsToText(undefined), '');
  assert.equal(argsToText(['  ', 'ok']), 'ok', '空白参数被过滤');
});

test('textToArgs 按空格/换行拆分，忽略空段', () => {
  assert.deepEqual(textToArgs('x opencode-ai acp'), ['x', 'opencode-ai', 'acp']);
  assert.deepEqual(textToArgs('x\nopencode-ai\nacp'), ['x', 'opencode-ai', 'acp']);
  assert.deepEqual(textToArgs('  a   b \n\n c '), ['a', 'b', 'c']);
  assert.deepEqual(textToArgs(''), []);
  assert.deepEqual(textToArgs('   \n\t '), []);
});

test('argsToText / textToArgs 往返', () => {
  const args = ['bun', 'x', 'opencode-ai', 'acp'];
  assert.deepEqual(textToArgs(argsToText(args)), args);
});

// ---- 路径 / 安装指引 ----

test('backendPathText 无路径给占位', () => {
  assert.equal(backendPathText({ executable: '/opt/opencode' }), '/opt/opencode');
  assert.equal(backendPathText({ executable: '  ' }), '未设置路径');
  assert.equal(backendPathText({ executable: null }), '未设置路径');
  assert.equal(backendPathText({}), '未设置路径');
});

test('installHintFor 无 hint 给默认一行，不刷红', () => {
  assert.equal(installHintFor({ install_hint: 'npm i -g opencode' }), 'npm i -g opencode');
  assert.equal(installHintFor({ install_hint: null }), '安装对应 CLI 并确保在 PATH 中，然后点击「探测」重试');
  assert.equal(installHintFor({}), '安装对应 CLI 并确保在 PATH 中，然后点击「探测」重试');
});
