// SSE 夹具的可执行定位必须是纯文件系统探测。
// 反证背景：曾用 where/which 子进程（5 秒超时）解析 git 安装根，在编译与测试并发时
// 偶发超时，一次超时会让 9 条 sseNetwork* 用例整组 ERROR（实测出现过一次不可复现的 ERROR 1）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./sse-contract-server.cjs', import.meta.url)), 'utf8');

test('SSE 夹具不通过 where/which 子进程解析可执行文件', () => {
  assert.ok(!/execFileSync\(\s*(process\.platform[^)]*)?['"]where['"]/.test(source), '不得调用 where');
  assert.ok(!/['"]which['"]/.test(source), '不得调用 which');
  assert.match(source, /fs\.statSync\(full\)/, 'PATH 探测必须走文件系统');
  assert.match(source, /function resolveOnPath\(name\)/);
});

test('SSE 夹具显式覆盖仍优先，且缺失时不静默回退', () => {
  assert.match(source, /if \(process\.env\.SSE_OPENSSL\) list\.push/, 'SSE_OPENSSL 必须最先考虑');
  assert.match(source, /throw new Error\('openssl 未找到/, '找不到必须 fail-loud');
});

test('SSE 夹具在真实启动时输出两个端口且不报错', { timeout: 30000 }, async () => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./sse-contract-server.cjs', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && out.trim().split(/\r?\n/).filter(Boolean).length < 2 && child.exitCode === null) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const ports = out.trim().split(/\r?\n/).filter(Boolean);
  if (child.exitCode === null) { child.stdin.end(); await once(child, 'exit'); }
  assert.equal(err.trim(), '', '夹具不得在 stderr 报错');
  assert.equal(ports.length, 2, '必须交回明文与 TLS 两个端口');
  for (const port of ports) assert.ok(Number(port) > 0 && Number(port) < 65536, `端口非法：${port}`);
  assert.notEqual(ports[0], ports[1], '两个端口必须不同');
});
