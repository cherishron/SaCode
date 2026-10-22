import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
export const { HostBridge } = createRequire(import.meta.url)('../../desktop/host-bridge.cjs');
const repo = resolve(import.meta.dirname, '../../..');
export const delay = ms => new Promise(r => setTimeout(r, ms));

// 只用本轮显式指定的产物与合成凭据，留存临时目录供复核，不接触用户配置。
export async function securityFixture(t, { policyFilter = () => true, prepare = async () => {}, extraEnv = {} } = {}) {
  const daemon = process.env.SACODE_DAEMON, host = process.env.SACODE_HOST;
  assert.ok(daemon && existsSync(daemon), '须指定本轮构建的 SACODE_DAEMON');
  assert.ok(host && existsSync(host), '须指定本轮构建的 SACODE_HOST');
  const base = join(repo, 'target/tmp/remote-security-regression');
  mkdirSync(base, { recursive: true });
  const cwd = mkdtempSync(join(base, 'run-'));
  const policy = JSON.parse(readFileSync(join(repo, 'docs/plans/remote-capability-contract.json')))
    .filter(policyFilter).map(p => p.method === 'daemon/shutdown' ? { ...p, permission: 'read' } : p);
  const policyPath = join(cwd, 'policy.json'); writeFileSync(policyPath, JSON.stringify(policy));
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (['path', 'systemroot', 'windir'].includes(k.toLowerCase())) env[k] = v;
  Object.assign(env, { TMP: cwd, TEMP: cwd, SACODE_USER_SETTINGS_DIR: join(cwd, 'settings'), ...extraEnv });
  await prepare({ cwd, env, host });
  const proc = spawn(resolve(daemon), ['--port', '0'], { cwd, env: { ...env,
    SACODE_REMOTE_ACCESS: '1', SACODE_REMOTE_IDENTITY: join(cwd, 'instance.id'),
    SACODE_REMOTE_POLICY: policyPath, SACODE_HOST: resolve(host), SACODE_HOST_TIMEOUT_MS: '20000',
    SACODE_HOST_ARGS: JSON.stringify(['--workspace', cwd]) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  proc.stdout.on('data', b => out += b); proc.stderr.on('data', b => err += b);
  const closed = new Promise(r => proc.once('close', r));
  const until = Date.now() + 15000;
  while (!/127\.0\.0\.1:(\d+)/.test(out) && proc.exitCode === null && Date.now() < until) await delay(20);
  assert.match(out, /127\.0\.0\.1:(\d+)/, `启动失败 ${out} ${err}`);
  const url = `http://127.0.0.1:${out.match(/127\.0\.0\.1:(\d+)/)[1]}`;
  const management = spawnSync(resolve(daemon), ['--manage', 'enroll-ticket', join(cwd, 'instance.id.devices.json'), 'synthetic-principal'],
    { cwd, env, encoding: 'utf8', timeout: 10000 });
  assert.equal(management.status, 0, management.stderr);
  const ticket = management.stdout.trim().split(/\r?\n/)[1];
  async function post(route, body, bearer = '') {
    const r = await fetch(url + route, { method: 'POST', headers: { 'content-type': 'application/json', authorization: bearer },
      body: JSON.stringify(body), signal: AbortSignal.timeout(25000) });
    return r.json();
  }
  const dev = await post('/auth/enroll', { enrollmentSecret: ticket, deviceName: 'synthetic', kind: 'cli' });
  const tok = await post('/auth/token', { deviceId: dev.deviceId, credential: dev.credential });
  assert.ok(tok.accessToken, JSON.stringify(tok));
  const bearer = `Bearer ${tok.accessToken}`;
  let id = 0;
  const rpc = (method, params = {}) => post('/rpc', { jsonrpc: '2.0', id: ++id, method, params }, bearer);
  t.after(async () => {
    if (proc.exitCode === null) await rpc('daemon/shutdown');
    const code = await Promise.race([closed, delay(10000).then(() => 'timeout')]);
    assert.equal(code, 0, `测试进程未正常退出 ${err}`);
  });
  return { cwd, env, url, bearer, rpc, policyPath };
}
