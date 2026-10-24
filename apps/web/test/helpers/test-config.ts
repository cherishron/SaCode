// 测试用内存配置：一个 sim 目标 + 一个已知口令账号（Argon2id）。不读取任何磁盘文件。
import { hashPassword } from '../../server/auth/password.js';
import type { AuthAccount, TargetConfig, WebConfig } from '../../server/config.js';

export async function buildTestConfig(): Promise<WebConfig> {
  const passwordHash = await hashPassword('test-password');
  const account: AuthAccount = { id: 'owner-1', username: 'tester', passwordHash };
  const target: TargetConfig = {
    id: 'sim-1',
    label: 'Simulated',
    baseUrl: 'http://localhost:9999',
    credentialRef: 'ref-1',
  };
  return {
    bind: '127.0.0.1',
    port: 18787,
    origin: 'http://localhost:18787',
    targets: [target],
    accounts: [account],
    sessionIdleMs: 30 * 60 * 1000,
    sessionAbsoluteMs: 8 * 60 * 60 * 1000,
    isDev: true,
  };
}
