// CLI 入口门禁：与 electron-env-gate.mjs 同构。
// 当未设置 SACODE_CLI 或指向的二进制不存在时，把“CLI 与 Host 双入口”用例标成
// env-blocked-missing-cli 跳过，不计失败也不计通过；原因写清楚。
// 不降级断言、不伪造 CLI；候选包未含 CLI 或本批未构建 CLI 时如实跳过。
import { existsSync } from 'node:fs';

let cached;
export function cliEnvSkip() {
  if (cached !== undefined) return cached;
  const cli = process.env.SACODE_CLI;
  if (!cli) {
    cached = 'env-blocked-missing-cli: 未设置 SACODE_CLI（当前候选包未含 CLI，本批未提供匹配的 CLI 二进制）；CLI 与 Host 双入口用例跳过';
    return cached;
  }
  if (!existsSync(cli)) {
    cached = `env-blocked-missing-cli: SACODE_CLI 指向的路径不存在: ${cli}`;
    return cached;
  }
  cached = false;
  return cached;
}
