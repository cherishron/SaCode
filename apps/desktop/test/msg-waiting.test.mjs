// 等待提示：发送后到首字到达之间，live 助手气泡正文为空，
// 回复位此前只留一块无提示的空白。这里锁定三件事：
// ①msgfold 在 running 且无正文时确实产出空正文的 live 助手消息（空白来源）；
// ②app.js TextBubble 对该空正文渲染 .msg-waiting 占位，且限定 live 助手角色；
// ③styles.css 提供 .msg-waiting 与跳动动画（reduced-motion 下静止）。
// 依赖浏览器环境的 app.js 无法直接 import，故与 msg-copy 一致走源码扫描。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const appSrc = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');
const cssSrc = readFileSync(new URL('../renderer/styles.css', import.meta.url), 'utf8');

test('running 且无正文时 msgfold 产出空正文的 live 助手消息', () => {
  const context = { window: {} };
  vm.runInNewContext(readFileSync(new URL('../renderer/msgfold.js', import.meta.url), 'utf8'), context);
  const rows = context.window.SaCodeMsgFold.withStreamingMessage([], { running: true, text: '' }, 's1');
  assert.equal(rows.length, 1, '应追加一条 live 消息');
  assert.equal(rows[0].role, 'assistant');
  assert.equal(rows[0].content, '', '正文为空——这正是需要占位提示的时刻');
  assert.equal(rows[0].live, true);
});

test('TextBubble 对空正文的 live 助手气泡渲染 .msg-waiting 占位', () => {
  assert.match(appSrc, /!!m\.live\s*&&\s*m\.role\s*===\s*"assistant"\s*&&\s*!text/, '等待判据应限 live 助手且正文为空');
  assert.match(appSrc, /class:\s*"msg-waiting"/, '应渲染 .msg-waiting 占位节点');
  assert.match(appSrc, /"msg-waiting-text"[\s\S]*正在等待模型响应/, '占位应含等待文案');
  assert.match(appSrc, /"aria-live":\s*"polite"/, '等待占位应可被读屏播报');
});

test('styles.css 提供等待占位与跳动动画，reduced-motion 下静止', () => {
  assert.match(cssSrc, /\.msg-waiting\s*\{/, '应有 .msg-waiting 样式');
  assert.match(cssSrc, /\.msg-waiting-dots\s*>?\s*span/, '应有圆点样式');
  assert.match(cssSrc, /@keyframes\s+msg-waiting-pulse/, '应有跳动动画');
  assert.match(cssSrc, /prefers-reduced-motion:\s*reduce[\s\S]*\.msg-waiting-dots/, 'reduced-motion 下应停动画');
});