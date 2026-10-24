// 回归护栏：审批/计划模式切换是「人在环」配置写，turn 在途时也放行
// （与 main.cj 的 allowedDuringTurn 声明一致：SessionLog.append 自带互斥、
//  setDurable 经同一实例锁与写租约落持久检查点，在途写不会损坏日志）。
// 曾因 handleRpc28 在途一律拒绝，导致桌面「工具审批」在 turn 未结算时
// 永久不可切（用户只看到「执行中不能切换权限模式」且点按无变化）。
// 这条护栏防止把该拒绝重新加回去。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/main.cj', import.meta.url), 'utf8');

test('handleRpc28 不再以 turnBusy 拦审批/计划模式切换', () => {
  const start = source.indexOf('func handleRpc28(');
  const end = source.indexOf('func handleRpc29(');
  assert.ok(start > 0 && end > start, '应能定位 handleRpc28 边界');
  const handler = source.slice(start, end);
  assert.match(handler, /method == "approval\/set-mode"/, '应含 approval/set-mode 分支');
  assert.match(handler, /method == "plan\/set-mode"/, '应含 plan/set-mode 分支');
  assert.ok(!/turnBusy/.test(handler), 'handleRpc28 不得再以 turnBusy 拦 set-mode');
});

test('allowedDuringTurn 声明放行 approval/plan 的 set-mode 与 get-mode', () => {
  const start = source.indexOf('func allowedDuringTurn(');
  const end = source.indexOf('func isQueueMethod(');
  assert.ok(start > 0 && end > start, '应能定位 allowedDuringTurn 边界');
  const allowed = source.slice(start, end);
  assert.match(allowed, /method == "approval\/set-mode"/);
  assert.match(allowed, /method == "plan\/set-mode"/);
  assert.match(allowed, /method == "approval\/get-mode"/);
});