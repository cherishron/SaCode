// 测试侧环境门禁：受限代理上下文里把依赖真实 Electron 的用例标成 env-blocked-electron，
// 不计失败也不计通过；正常上下文返回原 options，不做任何降级。
// 判据与 `electron-env-probe.cjs` 同一来源，不复制逻辑。
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { probe } = require('./electron-env-probe.cjs');

let cached;

export function electronEnvStatus() {
  if (!cached) cached = probe();
  return cached;
}

export function electronEnvSkip() {
  const status = electronEnvStatus();
  if (!status.blocked) return false;
  return `env-blocked-electron: ${status.detail}；须在已登录交互会话中由用户直接运行 scripts/run-electron-tests-interactive.cmd`;
}

// 保留用例原有的 skip（例如缺 SACODE_HOST）；环境受限优先，因为那是整条链跑不了。
export function electronTestOptions(base = {}) {
  const envSkip = electronEnvSkip();
  if (!envSkip) return base;
  return { ...base, skip: envSkip };
}
