import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const { caBundleSidecar, hostEnvWithCaBundle } = createRequire(import.meta.url)('../paths.cjs');

// 真实远端用例共用的宿主环境。测试直接 spawn 宿主，绕过了壳层，所以这里补上壳层生产里那一跳：
// 随包信任锚经 SACODE_CA_BUNDLE 交给宿主，且复用 paths.cjs 的同一套函数，不复制判断。
// 根因实测（2026-10-11）：宿主不带锚时 https 请求在传输层塌成 http-request-error，补上锚立刻出真实流。
// 锚缺失时这里干脆不设变量，核心仍如实失败——不降级校验、不 TrustAll。
export function realHostEnv(directory, host, extra = {}) {
  const env = { ...process.env, SACODE_USER_SETTINGS_DIR: join(directory, 'settings'), ...extra };
  // 不允许继承本地 provider 夹具覆盖本次真实测试。
  for (const name of ['SACODE_PROVIDER_BASE_URL', 'SACODE_PROVIDER_KEY', 'SACODE_PROVIDER_MODEL']) delete env[name];
  const sidecarPath = caBundleSidecar(host);
  return hostEnvWithCaBundle(env, { sidecarPath, exists: existsSync(sidecarPath) });
}
