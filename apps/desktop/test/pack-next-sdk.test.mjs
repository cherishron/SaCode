import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { assertStaticRendererBundle } from '../../../scripts/renderer-bundle-guard.mjs';

const desktop = fileURLToPath(new URL('../', import.meta.url));
const root = resolve(desktop, '../..');
const source = readFileSync(join(root, 'scripts/pack-next-sdk.mjs'), 'utf8');

function build(t, mutate = value => value) {
  const parent = join(desktop, '.tmp-test');
  mkdirSync(parent, { recursive: true });
  const work = mkdtempSync(join(parent, 'pack-next-sdk-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  const scripts = join(work, 'scripts');
  const app = join(work, 'apps/desktop');
  mkdirSync(scripts, { recursive: true });
  mkdirSync(join(app, 'renderer/vendor'), { recursive: true });
  copyFileSync(join(desktop, 'package.json'), join(app, 'package.json'));
  symlinkSync(join(desktop, 'node_modules'), join(app, 'node_modules'), 'junction');
  copyFileSync(join(root, 'scripts/renderer-bundle-guard.mjs'), join(scripts, 'renderer-bundle-guard.mjs'));
  writeFileSync(join(scripts, 'pack-next-sdk.mjs'), mutate(source));
  const result = spawnSync(process.execPath, [join(scripts, 'pack-next-sdk.mjs')], { encoding: 'utf8', timeout: 120000 });
  return { app, result, output: `${result.stdout}\n${result.stderr}` };
}

test('Next SDK 真实生产构建必须成功且无运行时求值或模块加载', t => {
  const { app, result, output } = build(t);
  assert.equal(result.status, 0, output);
  const code = readFileSync(join(app, 'renderer/vendor/next-sdk.iife.js'), 'utf8');
  assert.doesNotMatch(code, /new Function\(|\beval\(|import\(/);
  assert.ok(code.includes('__nextSDK'));
  assert.deepEqual(readdirSync(join(app, '.tmp-test')), [], '成功后必须清理临时入口');
});

for (const expression of ['eval("1")', 'new Function("return 1")']) {
  test(`真实构建负向守卫仍拒绝 ${expression}`, t => {
    const { app, result, output } = build(t, value => value.replace(
      'const code = readFileSync(OUT_JS, \'utf8\');',
      `const code = readFileSync(OUT_JS, 'utf8') + ${JSON.stringify(expression)};`,
    ));
    assert.equal(result.status, 2, output);
    assert.match(output, /渲染产物含运行时求值/);
    assert.deepEqual(readdirSync(join(app, '.tmp-test')), []);
  });
}

test('真实 Electron 严格 CSP 下初始化并注册、发现、执行全部页面工具', t => {
  const { app, result, output } = build(t);
  assert.equal(result.status, 0, output);
  copyFileSync(join(desktop, 'renderer/page-tools.js'), join(app, 'renderer/page-tools.js'));
  // 仅替代有限 IPC 的外部边界，初始化、注册、发现与执行均使用真实 SDK 和页面脚本。
  writeFileSync(join(app, 'renderer/probe.js'), `
(async () => {
  try {
    const violations = [];
    document.addEventListener('securitypolicyviolation', event => violations.push(event.violatedDirective));
    globalThis.__nextSDK.initializeBuiltinWebMCP();
    if (!document.modelContext) throw new Error('modelContext 未初始化');
    globalThis.sacode = { pageToolCall: async (name, args) => ({ name, args, via: '有限 IPC' }) };
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/page-tools.js'; script.onload = resolve; script.onerror = reject;
      document.head.appendChild(script);
    });
    const mc = document.modelContext;
    const tools = await mc.getTools();
    const cases = {
      'page.readState': { selector: '#state' },
      'page.clickElement': { selector: '#button', selectorType: 'css' },
      'page.inputText': { selector: '#input', text: '测试输入' },
      'page.scroll': { x: 1, y: 2 },
    };
    const results = [];
    for (const tool of tools) results.push(JSON.parse(await mc.executeTool(tool, JSON.stringify(cases[tool.name]))));
    await mc.registerTool({ name: 'probe.echo', description: '自定义工具', inputSchema: { type: 'object' }, execute: args => ({ echoed: args }) });
    const custom = (await mc.getTools()).find(tool => tool.name === 'probe.echo');
    const echoed = JSON.parse(await mc.executeTool(custom, '{"value":7}'));
    let malformedRejected = false;
    try { await mc.executeTool(custom, '{'); } catch { malformedRejected = true; }
    await mc.registerTool({ name: 'probe.error', description: '错误工具', execute: () => { throw new Error('预期失败'); } });
    const errorTool = (await mc.getTools()).find(tool => tool.name === 'probe.error');
    let executionRejected = false;
    try { await mc.executeTool(errorTool, '{}'); } catch { executionRejected = true; }
    globalThis.__probe = { names: tools.map(tool => tool.name), schemas: tools.map(tool => tool.inputSchema), registered: DshPageTools.list(), results, echoed, malformedRejected, executionRejected, violations };
  } catch (error) { globalThis.__probe = { error: error.stack || String(error) }; }
})();
`);
  writeFileSync(join(app, 'electron-probe.cjs'), `
const { app, BrowserWindow } = require('electron');
const { createServer } = require('node:http');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
app.setPath('userData', join(__dirname, 'profile'));
let server;
const watchdog = setTimeout(() => { console.error('浏览器探针超时'); app.exit(2); }, 20000);
app.whenReady().then(async () => {
  server = createServer((req, res) => {
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<meta http-equiv="Content-Security-Policy" content="default-src \\'self\\'; script-src \\'self\\'"><script src="/vendor/next-sdk.iife.js"></script><script src="/probe.js"></script>');
    } else {
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      res.end(readFileSync(join(__dirname, 'renderer', req.url.slice(1))));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await win.loadURL('http://127.0.0.1:' + server.address().port);
  const timer = setInterval(async () => {
    const result = await win.webContents.executeJavaScript('globalThis.__probe');
    if (!result) return;
    clearInterval(timer); clearTimeout(watchdog);
    console.log('WEBMCP_RESULT=' + JSON.stringify(result));
    win.destroy(); server.close(() => app.exit(result.error ? 1 : 0));
  }, 20);
}).catch(error => { console.error(error); app.exit(1); });
`);
  const electron = join(desktop, 'node_modules/electron/dist/electron.exe');
  const env = { ...process.env, TEMP: app, TMP: app };
  delete env.ELECTRON_RUN_AS_NODE;
  const browser = spawnSync(electron, ['--no-sandbox', join(app, 'electron-probe.cjs')], {
    encoding: 'utf8', timeout: 30000, env,
  });
  const browserOutput = `${browser.stdout}\n${browser.stderr}`;
  assert.equal(browser.status, 0, browserOutput);
  const match = browser.stdout.match(/WEBMCP_RESULT=(.*)/);
  assert.ok(match, browserOutput);
  const actual = JSON.parse(match[1]);
  assert.deepEqual(actual.names, ['page.clickElement', 'page.inputText', 'page.readState', 'page.scroll']);
  assert.deepEqual(actual.schemas.map(schema => schema.type), ['object', 'object', 'object', 'object']);
  assert.deepEqual(actual.schemas[0].required, ['selector']);
  assert.deepEqual(actual.schemas[1].required, ['selector', 'text']);
  assert.deepEqual(actual.schemas[0].properties.selectorType.enum, ['css', 'text', 'role']);
  assert.ok(actual.registered.every(tool => tool.registered && !tool.error));
  assert.deepEqual(actual.results, [
    { name: 'page.clickElement', args: { selector: '#button', selectorType: 'css' }, via: '有限 IPC' },
    { name: 'page.inputText', args: { selector: '#input', text: '测试输入' }, via: '有限 IPC' },
    { name: 'page.readState', args: { selector: '#state' }, via: '有限 IPC' },
    { name: 'page.scroll', args: { x: 1, y: 2 }, via: '有限 IPC' },
  ]);
  assert.deepEqual(actual.echoed, { echoed: { value: 7 } });
  assert.equal(actual.malformedRejected, true);
  assert.equal(actual.executionRejected, true);
  assert.deepEqual(actual.violations, []);
});

test('活跃 Ajv 实现未被替换，真正使用动态校验器仍被原守卫拒绝', t => {
  const { app, result, output } = build(t, value => value.replace(
    'globalThis.__nextSDK = { initializeBuiltinWebMCP };',
    'globalThis.__nextSDK = { initializeBuiltinWebMCP }; import { Ajv } from "@opentiny/next-sdk/core"; globalThis.__activeValidator = new Ajv().compile({ type: "object" });',
  ));
  assert.equal(result.status, 2, output);
  assert.match(output, /渲染产物含运行时求值/);
  const code = readFileSync(join(app, 'renderer/vendor/next-sdk.iife.js'), 'utf8');
  assert.throws(() => assertStaticRendererBundle(code), /渲染产物含运行时求值/);
  assert.deepEqual(readdirSync(join(app, '.tmp-test')), []);
});

test('真实构建反证：块内 buildResult 必须被拒绝且清理临时入口', t => {
  const { app, result, output } = build(t, value => {
    assert.ok(value.includes('let buildResult;'));
    assert.ok(value.includes('buildResult = await esbuild.build('));
    return value.replace('let buildResult;', '').replace('buildResult = await esbuild.build(', 'const buildResult = await esbuild.build(');
  });
  assert.equal(result.status, 2, output);
  assert.match(output, /buildResult is not defined/);
  assert.equal(existsSync(join(app, 'renderer/vendor/.next-sdk-tmp')), false, '失败路径不能残留源码目录临时入口');
  if (existsSync(join(app, '.tmp-test'))) assert.deepEqual(readdirSync(join(app, '.tmp-test')), []);
});
