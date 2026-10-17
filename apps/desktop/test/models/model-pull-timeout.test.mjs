// 通过真实 HostBridge 的 JSON-RPC 编解码与定时器路径验证桌面拉取契约。
// 时钟和进程为合成夹具，不依赖仓颉 SDK、网络、真实凭据或用户配置。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { registerCustomsIpc } = require('../../customs-ipc.cjs');
const guard = require('../../customs-guard.cjs');
const source = readFileSync(new URL('../../host-bridge.cjs', import.meta.url), 'utf8');

async function fixture() {
  let now = 0;
  const timers = new Map();
  const child = new EventEmitter();
  Object.assign(child, { pid: 1, exitCode: null, signalCode: null });
  child.stdin = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const frames = [];
  child.stdin.write = (body, done) => { frames.push(JSON.parse(body)); done?.(); };
  child.stdin.end = () => { child.exitCode = 0; child.emit('exit', 0, null); };
  const context = {
    module: { exports: {} },
    process: { env: {}, stderr: { write() {} } },
    require(name) {
      if (name === './paths.cjs') return { hostRuntimeEnv: env => env };
      assert.equal(name, 'node:child_process');
      return { spawn: () => { queueMicrotask(() => child.emit('spawn')); return child; } };
    },
    setTimeout(fn, ms) {
      const timer = { unref() { return timer; } };
      timers.set(timer, { at: now + ms, fn });
      return timer;
    },
    clearTimeout(timer) { timers.delete(timer); },
  };
  vm.runInNewContext(source, context);
  const bridge = new context.module.exports.HostBridge('fixture-host');
  await bridge.start('.');
  const handlers = {};
  registerCustomsIpc({ handle: (name, handler) => { handlers[name] = handler; } },
    (method, args, timeout) => bridge.request(method, args, timeout), guard, x => typeof x === 'string');
  return {
    bridge, frames, handlers,
    advance(ms) {
      now += ms;
      for (const [timer, entry] of [...timers]) {
        if (entry.at <= now) { timers.delete(timer); entry.fn(); }
      }
    },
    respond(frame, result) { child.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', id: frame.id, result }) + '\n'); },
    fail(frame) { child.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', id: frame.id, error: { code: -32020, message: 'http-status:401' } }) + '\n'); },
  };
}

test('真实桥接路径：8秒响应超过通用5秒窗口但拉取成功，其他动作仍5秒超时', async t => {
  const f = await fixture();
  t.after(() => f.bridge.stop());
  const pull = f.handlers['sacode:modelPull']({}, { providerId: 'fixture', expectedRevision: 0 });
  const projection = f.bridge.request('session/projection');
  const rejected = assert.rejects(projection, /timeout: session\/projection/);
  f.advance(8000);
  await rejected;
  assert.equal(f.bridge.pending.size, 1);
  f.respond(f.frames[0], { revision: 1, providers: [{ id: 'fixture', models: [{ id: 'synthetic-model' }] }] });
  const result = await pull;
  assert.equal(result.providers[0].models[0].id, 'synthetic-model');
  assert.equal(result.late, undefined);
  assert.equal(f.bridge.pending.size, 0);
});

test('真实桥接路径：30秒超时标未知；迟到响应不冒充成功、不重发、不污染后续查询', async t => {
  const f = await fixture();
  t.after(() => f.bridge.stop());
  const pull = f.handlers['sacode:modelPull']({}, { providerId: 'fixture', expectedRevision: 5 });
  const rejected = assert.rejects(pull, /model-pull-timeout-unknown:.*后台可能仍在处理/);
  f.advance(30000);
  await rejected;
  assert.equal(f.frames.length, 1);
  assert.equal(f.bridge.pending.size, 0);
  // 旧操作迟到成功只能作为未知期间的事实，不能通过另一个请求的 id 窜入。
  f.respond(f.frames[0], { revision: 6, providers: [] });
  const refresh = f.bridge.request('model/registry/describe');
  assert.equal(f.bridge.pending.size, 1);
  f.respond(f.frames[0], { revision: 7, providers: [] });
  assert.equal(f.bridge.pending.size, 1);
  f.respond(f.frames[1], { revision: 8, providers: [] });
  assert.equal((await refresh).revision, 8);
  assert.deepEqual(f.frames.map(frame => frame.method), ['model/pull', 'model/registry/describe']);
});

test('真实桥接路径：HTTP失败保持失败，宿主退出及时结束，不等30秒', async t => {
  const f = await fixture();
  t.after(() => f.bridge.stop());
  const pull = f.handlers['sacode:modelPull']({}, { providerId: 'fixture', expectedRevision: 0 });
  const failed = assert.rejects(pull, /-32020 http-status:401/);
  f.fail(f.frames[0]);
  await failed;
  const again = f.handlers['sacode:modelPull']({}, { providerId: 'fixture', expectedRevision: 0 });
  const gone = assert.rejects(again, /host-gone: exit code 0/);
  await f.bridge.stop();
  await gone;
  assert.equal(f.bridge.pending.size, 0);
});
