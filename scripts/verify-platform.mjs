// 只验证本批新增的路径、平台选择、清单与语法；不读取/运行旧测试。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platforms } from './platform.mjs';
const require = createRequire(import.meta.url);
const { hostExePath, hostRuntimeEnv, hostEnvWithCaBundle } = require('../apps/desktop/paths.cjs');
const { configureDataPaths } = require('../apps/desktop/data-paths.cjs');
const root = fileURLToPath(new URL('..', import.meta.url));
const tmp = join(root, 'apps/desktop/.tmp-test/platform-verifier');
mkdirSync(tmp, { recursive: true });
let count = 0;
for (const platform of ['win32', 'linux', 'darwin']) {
  const host = hostExePath({ packaged: true, resourcesPath: tmp, platform });
  assert.equal(host, join(tmp, 'host/bin', platform === 'win32' ? 'sacode-host.exe' : 'sacode-host')); count++;
  const env = hostRuntimeEnv({ LANG: 'zh_CN.UTF-8' }, host, platform);
  assert.equal(env.LANG, 'zh_CN.UTF-8'); count++;
  if (platform !== 'win32') { assert.equal(env[platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH'], join(tmp, 'host/bin')); count++; }
  assert.throws(() => hostExePath({ packaged: true, platform })); count++;
}
for (const platform of ['linux', 'darwin']) {
  const base = join(tmp, platform); const seen = {};
  const app = { isPackaged: true, getPath: name => { assert.equal(name, 'userData'); return base; }, setPath: (name, value) => seen[name] = value };
  const paths = configureDataPaths({ app, env: {}, platform });
  assert.equal(paths.sessions, join(base, 'sessions')); assert.equal(seen.temp, join(base, 'temp')); count += 2;
  assert.equal(configureDataPaths({ app, env: {}, platform, isolated: true }), null); count++;
}
const pkg = JSON.parse(readFileSync(join(root, 'npm/sacode-cli/package.json'), 'utf8'));
for (const [target, spec] of Object.entries(platforms).filter(([,s]) => s.os !== 'ohos')) {
  const json = JSON.parse(readFileSync(join(root, `npm/sacode-cli-${target}/package.json`), 'utf8'));
  assert.equal(pkg.optionalDependencies[json.name], pkg.version);
  assert.equal(json.version, pkg.version); assert.deepEqual(json.os, [spec.os]); assert.deepEqual(json.cpu, [spec.cpu]); count += 4;
}
assert(pkg.files.includes('bin/platform.js')); count++;
assert.equal(hostEnvWithCaBundle({}, { sidecarPath: '/missing.pem', exists: () => false }).SACODE_CA_BUNDLE, undefined); count++;
assert.equal(hostEnvWithCaBundle({}, { sidecarPath: '/ca.pem', exists: () => true }).SACODE_CA_BUNDLE, '/ca.pem'); count++;
const desktop = JSON.parse(readFileSync(join(root, 'apps/desktop/package.json'), 'utf8'));
assert(desktop.build.linux.target.includes('AppImage')); assert(desktop.build.mac.target.includes('dmg')); count += 2;
const files = ['platform.mjs','build-native.mjs','build-platform.mjs','pack-cli.mjs','pack-cli-windows.mjs','pack-host.mjs','package-platform.mjs','setup-sdk.mjs','setup-stdx.mjs','verify-platform.mjs','run-build.mjs','verify-npm-install.mjs','verify-desktop-payload.mjs'];
for (const f of files) { execFileSync(process.execPath, ['--check', join(root, 'scripts', f)]); count++; }
console.log(`平台静态/路径检查 PASS ${count}；未运行仓颉旧测试或设备任务`);
