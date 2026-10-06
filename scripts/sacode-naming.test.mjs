// 产品命名契约：只检查自有入口，不改上游许可证或第三方包名。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const text = relative => readFileSync(new URL('../' + relative, import.meta.url), 'utf8');

test('npm CLI 只注册 sacode 命令，跨平台入口使用同一名称', () => {
  const pkg = JSON.parse(text('npm/sacode-cli/package.json'));
  assert.deepEqual(pkg.bin, { sacode: 'bin/cli.js' });
  const cli = text('npm/sacode-cli/bin/cli.js');
  assert.match(cli, /process\.platform === "win32" \? "sacode\.exe" : "sacode"/);
  assert.ok(cli.includes('SACODE_EXTJS_DIR'));
});

test('桌面有限 IPC 的 preload 与主进程均使用 sacode 前缀', () => {
  const preload = text('apps/desktop/preload.cjs');
  const main = text('apps/desktop/main.cjs');
  assert.match(preload, /exposeInMainWorld\("sacode"/);
  const invoked = [...preload.matchAll(/ipcRenderer\.invoke\("([^"]+)"/g)].map(m => m[1]);
  const handled = new Set([...main.matchAll(/ipcMain\.handle\(['"]([^'"]+)['"]/g)].map(m => m[1]));
  assert.ok(invoked.length > 0);
  for (const channel of invoked) {
    assert.ok(channel.startsWith('sacode:'), channel);
    assert.ok(handled.has(channel), '缺少主进程通道：' + channel);
  }
  assert.ok(!preload.includes('"dsh:'));
  assert.ok(!main.includes('"dsh:'));
});

test('宿主路径、打包名称与渲染桥一致', () => {
  for (const file of ['apps/desktop/paths.cjs', 'scripts/pack-host.mjs']) {
    const source = text(file);
    assert.ok(source.includes('sacode-host.exe'), file);
    assert.ok(!source.includes('dsh-host.exe'), file);
  }
  assert.ok(!text('apps/desktop/renderer/app.js').includes('window.dsh'));
  assert.ok(!text('apps/desktop/renderer/pages/persisted-image.ts').includes(').dsh'));
  assert.ok(text('core/src/sysprompt.cj').includes('you are SaCode'));
});
