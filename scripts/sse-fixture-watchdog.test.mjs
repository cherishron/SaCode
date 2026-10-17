// 夹具看门狗的预算由「消费方声明」决定，不是把默认硬时限抬高。
// 规矩本身来自 scripts/sse-contract-server.cjs 顶部注释：默认 20 秒硬时限不变，
// 需要跨过多轮停滞路由的消费方自己声明更长预算——金路径已经用环境变量声明 60 秒，
// 核心单测里最长的 SSE 用例（实测 23.45 秒）却没有声明通道，只能在 20 秒上赌运气。
// 这里钉的是优先级：命令行 --watchdog-ms > 环境变量 > 20 秒默认，且撤销路径（stdin）不受影响。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'sse-contract-server.cjs');
const nap = (ms) => new Promise((r) => setTimeout(r, ms));

// 只读第一行（http 端口），读完就把 stdin 关掉走正常撤销路径。
function start(args, env) {
  const proc = spawn(process.execPath, [FIXTURE, ...args], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, ...env },
  });
  const h = { proc, exited: false, exitCode: null };
  proc.on('exit', (code) => { h.exited = true; h.exitCode = code; });
  h.port = new Promise((resolve, reject) => {
    let buf = '';
    const onData = (d) => {
      buf += d.toString();
      const i = buf.indexOf('\n');
      if (i >= 0) { proc.stdout.off('data', onData); resolve(buf.slice(0, i).trim()); }
    };
    proc.stdout.on('data', onData);
    proc.on('exit', (code) => reject(Error('fixture-exited-early:' + code)));
  });
  return h;
}

async function stop(h) {
  const exited = new Promise((resolve) => h.proc.on('exit', resolve));
  h.proc.stdin.write('stop\n');
  const code = await Promise.race([exited, nap(5000).then(() => 'timeout')]);
  return code;
}

test('看门狗预算可用 --watchdog-ms 声明并压过更短的环境变量', async () => {
  // 环境变量给 500 毫秒、命令行给 10 秒：如果 argv 生效，夹具必须活过 1.5 秒。
  const h = start(['--watchdog-ms', '10000'], { SSE_WATCHDOG_MS: '500' });
  assert.ok(Number(await h.port) > 0, '夹具要真的在监听');
  await nap(1500);
  assert.equal(h.exited, false, '声明了长预算就不该被更短的环境变量提前杀掉');
  assert.equal(await stop(h), 0, '撤销仍走正常退出码 0');
});

test('没有 --watchdog-ms 时环境变量依旧生效（不抬高默认语义）', async () => {
  const h = start([], { SSE_WATCHDOG_MS: '600' });
  assert.ok(Number(await h.port) > 0);
  const code = await Promise.race([
    new Promise((resolve) => h.proc.on('exit', resolve)),
    nap(4000).then(() => 'alive'),
  ]);
  assert.equal(code, 2, '看门狗到点要以退出码 2 撤走，这是「失控也不留服务」的那条保证');
});
