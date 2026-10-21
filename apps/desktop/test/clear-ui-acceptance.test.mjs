// UI-FIX-7：clear 命令 Electron UI 实机验收包装器（node:test 侧）。
// 不 mock preload、不自带 main.cjs、不装假处理器——直接 spawn 真实 electron .，
// 由 apps/desktop/main.cjs 的 --ui-smoke 分发进 test-support/ui-smoke.cjs，
// 再按 SACODE_UI_SMOKE_SUITE=clear-acceptance 调 clear-acceptance-main-smoke.cjs。
// 两阶段共用同一个 --session-dir（mkdtemp 一次性目录），模拟「清空 → 重开应用 → 再发」：
//   阶段一 fill-and-clear：消息面 10 条（种子可见 2 条 + 界面真实发送 8 条）→
//                         点「清空对话」→ 消息面与真源归零、标题基线保留；
//   阶段二 reopen-and-send：同一 session-dir 重启整个 Electron → 仍空 → 再发 1 条正常落盘。
// 本代理环境 electron 受限（env-blocked-electron）时由 electronTestOptions 标 SKIP，
// 不计失败；须由用户在已登录交互会话中经 scripts/run-electron-tests-interactive.cmd 实跑。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { electronTestOptions } from '../test-support/electron-env-gate.mjs';

const require = createRequire(import.meta.url);
const desktop = dirname(dirname(fileURLToPath(import.meta.url)));
// 与交互跑道同口径：宿主可用 SACODE_HOST 覆盖（供打包态/别处宿主复验），缺省用 dev 态默认位置。
const HOST = process.env.SACODE_HOST || join(desktop, 'dist', 'host', 'bin', 'sacode-host.exe');

function runPhase(dir, phase, timeoutMs) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, SACODE_UI_SMOKE_SUITE: 'clear-acceptance', SACODE_CLEAR_PHASE: phase };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require('electron'), ['.', `--session-dir=${dir}`, '--ui-smoke'], { cwd: desktop, env, windowsHide: true });
    let output = '';
    child.stdout.on('data', (v) => { output += v; });
    child.stderr.on('data', (v) => { output += v; });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.once('error', (e) => { clearTimeout(timer); reject(e); });
    child.once('exit', (code) => { clearTimeout(timer); resolve({ code, output }); });
  });
}

test('clear 命令 UI 实机验收：10 条消息 → 清空 → 重开仍空 → 再发', electronTestOptions({ timeout: 120000 }), async () => {
  assert.ok(existsSync(HOST), `缺少自包含宿主 ${HOST}；先运行 node scripts/pack-host.mjs 打包（或用 SACODE_HOST 指向已有宿主）`);
  const dir = mkdtempSync(join(tmpdir(), 'sacode-clear-ui-'));

  // 阶段一：填满 10 条 → 界面点「清空对话」→ 界面与真源一起归零。
  const first = await runPhase(dir, 'fill-and-clear', 90000);
  assert.equal(first.code, 0, `fill-and-clear 阶段失败（exit ${first.code}）\n${first.output}`);
  assert.ok(first.output.includes('CLEAR_UI_ACCEPTANCE PASS'), first.output);

  // 阶段二：同一 session-dir 重启整个 Electron（重开应用语义）→ 仍空 → 再发 1 条。
  const second = await runPhase(dir, 'reopen-and-send', 90000);
  assert.equal(second.code, 0, `reopen-and-send 阶段失败（exit ${second.code}）\n${second.output}`);
  assert.ok(second.output.includes('CLEAR_UI_ACCEPTANCE PASS'), second.output);
});
