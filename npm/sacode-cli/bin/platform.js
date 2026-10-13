// 所有 npm 入口共享平台选择和包内加载路径，缺包不回退系统可执行文件。
const path = require('node:path');
const fs = require('node:fs');
const packages = Object.fromEntries(['win32:x64', 'linux:x64', 'linux:arm64', 'darwin:x64', 'darwin:arm64']
  .map(k => [k, `@stand-alone/sacode-${k.replace(':', '-')}`]));
function resolvePlatform(role) {
  const key = packages[`${process.platform}:${process.arch}`];
  if (!key) throw new Error(`未支持当前平台 ${process.platform}/${process.arch}`);
  const pkgDir = path.dirname(require.resolve(`${key}/package.json`));
  const bin = path.join(pkgDir, 'bin');
  const exe = path.join(bin, role + (process.platform === 'win32' ? '.exe' : ''));
  if (!fs.existsSync(exe)) throw new Error(`平台包 ${key} 缺少 ${role}`);
  const env = { ...process.env };
  if (process.platform !== 'win32') {
    const library = process.platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH';
    env[library] = [bin, env[library]].filter(Boolean).join(':');
  }
  if (fs.existsSync(path.join(pkgDir, 'extjs/server.cjs'))) env.SACODE_EXTJS_DIR = path.join(pkgDir, 'extjs');
  const host = path.join(bin, `sacode-host${process.platform === 'win32' ? '.exe' : ''}`);
  if (fs.existsSync(host)) env.SACODE_HOST = host;
  return { exe, env };
}
module.exports = { resolvePlatform };
