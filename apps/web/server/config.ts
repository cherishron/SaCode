import { readFileSync, statSync } from 'node:fs';

export interface TargetConfig {
  id: string;
  label: string;
  baseUrl: string;
  /** 凭据引用，仅 BFF 侧读取，绝不返回浏览器 */
  credentialRef: string;
  /** 真实只读目标的服务端资源绑定；不从浏览器请求中接受。 */
  workspaceId?: string;
  instanceId?: string;
  caCertificates?: string[];
  instanceFingerprint?: string;
}

export interface AuthAccount {
  id: string;
  username: string;
  /** Argon2id 哈希 */
  passwordHash: string;
}

export interface WebConfig {
  bind: string;
  port: number;
  /** 精确 Origin，如 https://sacode.example.com */
  origin: string;
  targets: TargetConfig[];
  accounts: AuthAccount[];
  sessionIdleMs: number;
  sessionAbsoluteMs: number;
  isDev: boolean;
}

const REQUIRED_FILE_MODE = 0o600;
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

export class ConfigError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * 加载并校验配置。
 * 缺失必需项、文件权限不符、绑定非回环地址时直接抛 ConfigError 失败，
 * 不降级为无认证运行（§8.3）。
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): WebConfig {
  const origin = env['SACODE_WEB_ORIGIN'];
  const targetsFile = env['SACODE_WEB_TARGETS_FILE'];
  const authFile = env['SACODE_WEB_AUTH_FILE'];

  const missing: string[] = [];
  if (!origin) missing.push('SACODE_WEB_ORIGIN');
  if (!targetsFile) missing.push('SACODE_WEB_TARGETS_FILE');
  if (!authFile) missing.push('SACODE_WEB_AUTH_FILE');
  if (missing.length) {
    throw new ConfigError('missing-required-config', `缺少必需配置: ${missing.join(', ')}`);
  }

  assertSecureFile(targetsFile!, 'SACODE_WEB_TARGETS_FILE');
  assertSecureFile(authFile!, 'SACODE_WEB_AUTH_FILE');

  const bind = env['SACODE_WEB_BIND'] || '127.0.0.1';
  if (!LOOPBACK.has(bind)) {
    throw new ConfigError('bind-not-loopback', `SACODE_WEB_BIND=${bind} 非回环，首版拒绝无 TLS 公网监听`);
  }

  const port = parseInt(env['SACODE_WEB_PORT'] || '18787', 10);
  const sessionIdleMs = parseInt(env['SACODE_WEB_SESSION_IDLE_MS'] || '1800000', 10);
  const sessionAbsoluteMs = parseInt(env['SACODE_WEB_SESSION_ABSOLUTE_MS'] || '28800000', 10);
  const isDev = env['NODE_ENV'] !== 'production';

  let targets: TargetConfig[];
  try {
    const parsed = JSON.parse(readFileSync(targetsFile!, 'utf8'));
    targets = Array.isArray(parsed.targets) ? (parsed.targets as TargetConfig[]) : [];
  } catch (e) {
    throw new ConfigError('targets-parse', `读取/解析 targets 文件失败: ${(e as Error).message}`);
  }

  let accounts: AuthAccount[];
  try {
    const parsed = JSON.parse(readFileSync(authFile!, 'utf8'));
    accounts = Array.isArray(parsed.accounts) ? (parsed.accounts as AuthAccount[]) : [];
  } catch (e) {
    throw new ConfigError('auth-parse', `读取/解析 auth 文件失败: ${(e as Error).message}`);
  }
  if (accounts.length === 0) {
    throw new ConfigError('auth-empty', 'auth 文件未配置任何账号');
  }

  return { bind, port, origin: origin!, targets, accounts, sessionIdleMs, sessionAbsoluteMs, isDev };
}

function assertSecureFile(path: string, label: string): void {
  let st;
  try {
    st = statSync(path);
  } catch {
    throw new ConfigError('file-missing', `${label}=${path} 不存在或无权限`);
  }
  if (process.platform !== 'win32') {
    const mode = st.mode & 0o777;
    if (mode !== REQUIRED_FILE_MODE) {
      throw new ConfigError('file-perm', `${label}=${path} 权限应为 0600，实际 ${mode.toString(8)}`);
    }
  }
  // Windows 不读取 DACL；由运维确保仅当前用户可读，启动时在日志提示但不强制失败。
}
