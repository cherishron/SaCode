// 产品命名契约：只检查自有入口，不改上游许可证或第三方包名。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const text = relative => readFileSync(new URL('../' + relative, import.meta.url), 'utf8');

test('npm CLI 入口全部用 sacode 品牌，注册表与包内文件一致', () => {
  const pkg = JSON.parse(text('npm/sacode-cli/package.json'));
  // 穷尽比对（不是「至少有一个」）：新增入口要同时改这张表与这条断言，品牌漂移才会被钉住。
  assert.deepEqual(pkg.bin, { sacode: 'bin/cli.js', 'sacode-daemon': 'bin/daemon.js' });
  for (const name of Object.keys(pkg.bin)) {
    assert.ok(name === 'sacode' || name.startsWith('sacode-'), `入口名不在品牌集里：${name}`);
  }
  assert.deepEqual([...pkg.files].sort(), Object.values(pkg.bin).sort(), 'files 清单必须与入口脚本集合一致');
  const cli = text('npm/sacode-cli/bin/cli.js');
  assert.match(cli, /process\.platform === "win32" \? "sacode\.exe" : "sacode"/);
  assert.ok(cli.includes('SACODE_EXTJS_DIR'));
  const daemon = text('npm/sacode-cli/bin/daemon.js');
  assert.match(daemon, /process\.platform === "win32" \? "sacode-daemon\.exe" : "sacode-daemon"/);
});

// 主进程 IPC 注册面有三种形态，扫描必须都认得：
//   ① 字面量 `ipcMain.handle("sacode:xxx", …)`
//   ② 表驱动 `ipcMain.handle(\`sacode:${action}\`, …)` 配合一张 `action: ['method', [字段]]` 路由表
//   ③ 别的注册器（如 registerWorktreeIpc）内部自己 handle —— 本文件不展开，靠 ①② 覆盖
// 上一版只认 ①，于是把 ② 注册的那批通道全报成「缺少主进程通道」——那是门禁自己的
// 假阳性（2026-10-10 在固定提交副本与开发工作区各红一次后才定位到这里）。
// 表键收集用的是「缩进后的 `name: [`」这个形状，比 ① 宽，但只用来**放宽识别**：
// preload 声明了而主进程既无字面量也无表键的通道，仍然照样红。
function ipcSurfaces(...sources) {
  const main = sources.join('\n');
  const literal = new Set([...main.matchAll(/ipcMain\.handle\(['"]([^'"]+)['"]/g)].map(m => m[1]));
  const templates = [...main.matchAll(/ipcMain\.handle\(`([^`$]*?):\$\{[^}]+\}`/g)].map(m => m[1] + ':');
  const tableKeys = new Set([...main.matchAll(/^\s+([A-Za-z][A-Za-z0-9_]*)\s*:\s*\[/gm)].map(m => m[1]));
  return { literal, templates, tableKeys };
}

test('桌面有限 IPC 的 preload 与主进程均使用 sacode 前缀', () => {
  const preload = text('apps/desktop/preload.cjs');
  const main = text('apps/desktop/main.cjs');
  // 通道注册分散在两处：main.cjs（字面量 + execution 路由表）和 worktree-ipc.cjs
  // （被 registerWorktreeIpc 调用的模块）。只扫 main.cjs 会把后者全判成悬空。
  const worktreeIpc = text('apps/desktop/worktree-ipc.cjs');
  assert.match(preload, /exposeInMainWorld\("sacode"/);
  const invoked = [...preload.matchAll(/ipcRenderer\.invoke\("([^"]+)"/g)].map(m => m[1]);
  const surface = ipcSurfaces(main, worktreeIpc);
  assert.ok(invoked.length > 0);
  for (const channel of invoked) {
    assert.ok(channel.startsWith('sacode:'), channel);
    const name = channel.slice('sacode:'.length);
    const viaLiteral = surface.literal.has(channel);
    const viaTable = surface.templates.includes('sacode:') && surface.tableKeys.has(name);
    assert.ok(viaLiteral || viaTable, '缺少主进程通道：' + channel);
  }
  // 模板注册的前缀只允许 sacode:，否则品牌改名会只改了一半。
  const strayPrefixes = surface.templates.filter(p => p !== 'sacode:');
  assert.deepEqual(strayPrefixes, [], `模板注册里出现非 sacode: 前缀：${strayPrefixes.join('、')}`);
  assert.ok(!preload.includes('"dsh:'));
  assert.ok(!main.includes('"dsh:'));
  assert.ok(!worktreeIpc.includes('"dsh:'), 'worktree-ipc.cjs 里出现旧前缀');
});

// 反证扫描器本身：喂两份合成源码，一份表驱动 + 新前缀，一份旧前缀，
// 证明「认得模板注册」不是把断言改成永真。
test('IPC 通道扫描认得表驱动注册，也认得出旧前缀的模板', () => {
  const withTable = [
    'const executionActions = {',
    '  executionPropose: [\'execution/propose\', [\'sessionId\']],',
    '};',
    'for (const [action] of Object.entries(executionActions)) {',
    '  ipcMain.handle(`sacode:${action}`, handler);',
    '}',
  ].join('\n');
  const s1 = ipcSurfaces(withTable);
  assert.deepEqual(s1.templates, ['sacode:']);
  assert.ok(s1.tableKeys.has('executionPropose'), '表驱动注册的通道应被识别');
  assert.ok(!s1.literal.has('sacode:executionPropose'), '字面量集里不该凭空多出这条');

  const withOldPrefix = 'for (const [action] of x) { ipcMain.handle(`dsh:${action}`, handler); }';
  const s2 = ipcSurfaces(withOldPrefix);
  assert.deepEqual(s2.templates, ['dsh:'], '旧前缀必须原样报出来，不能静默接受');

  const dangling = 'const t = { otherThing: [\'m\', []] }; ipcMain.handle(`sacode:${a}`, h);';
  const s3 = ipcSurfaces(dangling);
  assert.ok(!s3.tableKeys.has('executionPropose'), '表里没有的通道不能被模板放宽放过');
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
