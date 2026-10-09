import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ComputerUseProvider, runStdio } from '../provider.mjs';

const ref = { pid: 17, windowId: 23 };
const action = { effect: 'confirmed', route: 'accessibility', operation: { id: 'native-1', state: 'completed', dispatched: true, committed: true, cancellationRequested: false } };
const methods = { 'windows.list': 'listWindows', 'windows.get': 'getWindow', 'window.observe': 'observeWindow', click: 'click', double_click: 'doubleClick', right_click: 'rightClick', drag: 'drag', scroll: 'scroll', type: 'typeText', press_key: 'pressKey', hotkey: 'hotkey', set_value: 'setValue', verify_state: 'verifyState' };
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function fixture(overrides = {}, options = {}) {
  const calls = [];
  const client = Object.fromEntries(Object.values(methods).map(method => [method, async args => {
    calls.push({ method, args });
    if (overrides[method]) return overrides[method](args);
    if (method === 'observeWindow') return { ...ref, pid: args.pid, windowId: args.windowId, mode: 'full', text: '按钮', elements: [{ element_token: 'seen' }], screenshot: { width: 100, height: 80, images: [{ mimeType: 'image/png', dataBase64: 'YWJj' }] }, context: {}, diagnostics: {} };
    if (method === 'listWindows') return [ref];
    if (method === 'getWindow') return ref;
    if (method === 'verifyState') return { status: 'satisfied', stable: true, elapsed_ms: 2, samples: 1, predicates: [] };
    return action;
  }]));
  client.close = async () => { calls.push({ method: 'close' }); await overrides.close?.(); };
  const provider = new ComputerUseProvider({ client, ...options });
  let id = 0;
  const invoke = (verb, args = {}) => provider.invoke(++id, { verb, args });
  const observe = async (target = ref) => (await invoke('window.observe', target)).content.observationId;
  return { calls, client, provider, invoke, observe };
}

for (const [verb, method] of Object.entries(methods)) {
  test(`真实 SDK 映射：${verb} → ${method}`, async () => {
    const f = fixture();
    let args = {};
    if (verb !== 'windows.list') args = { ...ref };
    if (!['windows.list', 'windows.get', 'window.observe', 'verify_state'].includes(verb)) args.observationId = await f.observe();
    if (['click', 'double_click', 'right_click', 'scroll', 'set_value'].includes(verb)) args.elementToken = 'seen';
    if (verb === 'drag') Object.assign(args, { fromX: 0, fromY: 0, toX: 99, toY: 79, steps: 2 });
    if (verb === 'scroll') Object.assign(args, { direction: 'down', amount: 3, by: 'line' });
    if (verb === 'type') Object.assign(args, { text: '你好', delayMs: 1 });
    if (verb === 'press_key') Object.assign(args, { key: 'Enter', modifiers: ['Control'] });
    if (verb === 'hotkey') args.keys = ['Control', 'a'];
    if (verb === 'set_value') args.value = '';
    if (verb === 'verify_state') Object.assign(args, { expect: [{ kind: 'exists', elementToken: 'seen' }], timeoutMs: 20, stableSamples: 2 });
    const result = await f.invoke(verb, args);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(f.calls.at(-1).method, method);
    const actual = f.calls.at(-1).args;
    assert.ok(actual.signal instanceof AbortSignal);
    const expected = { ...args }; delete expected.observationId;
    if (verb === 'window.observe') Object.assign(expected, { disableDiff: true, includeScreenshot: true });
    const withoutSignal = { ...actual }; delete withoutSignal.signal;
    assert.deepEqual(withoutSignal, expected);
    assert.equal(typeof result.content, 'object');
  });
}

test('观察 UUID、强制完整状态并无损保留图片', async () => {
  const f = fixture(); const a = await f.invoke('window.observe', ref); const b = await f.observe();
  assert.match(a.content.observationId, /^[0-9a-f-]{36}$/);
  assert.notEqual(a.content.observationId, b);
  assert.deepEqual(a.content.screenshot.images, [{ mimeType: 'image/png', dataBase64: 'YWJj' }]);
  for (const call of f.calls) assert.equal(call.args.disableDiff, true);
});

test('过期、跨窗口、未观察 token 拒绝且不投递', async () => {
  const f = fixture(); const old = await f.observe(); const latest = await f.observe();
  for (const args of [ { ...ref, observationId: old, elementToken: 'seen' }, { ...ref, windowId: 24, observationId: latest, elementToken: 'seen' }, { ...ref, pid: 18, observationId: latest, elementToken: 'seen' }, { ...ref, observationId: latest, elementToken: 'missing' } ]) {
    assert.equal((await f.invoke('click', args)).failureKind, 'stale-observation');
  }
  assert.equal(f.calls.filter(x => x.method === 'click').length, 0);
});

test('输入成功及 SDK 失败均消费观察，写调用不重试', async () => {
  for (const fail of [false, true]) {
    const f = fixture({ click: async () => { if (fail) throw Object.assign(new Error('投递失败'), { code: 'session_unavailable', details: { operation: action.operation, effect: 'partial' } }); return action; } });
    const args = { ...ref, observationId: await f.observe(), elementToken: 'seen' };
    const first = await f.invoke('click', args);
    assert.equal(first.ok, !fail);
    if (fail) assert.deepEqual(first.content.operation, action.operation);
    assert.equal((await f.invoke('click', args)).failureKind, 'stale-observation');
    assert.equal(f.calls.filter(x => x.method === 'click').length, 1);
  }
});

test('坐标与拖拽两端必须落在截图内，拒绝非有限值', async () => {
  const f = fixture(); const observationId = await f.observe();
  for (const [x, y] of [[-1, 0], [100, 0], [0, 80], [Infinity, 0], [NaN, 0], [0, -1]]) {
    assert.equal((await f.invoke('click', { ...ref, observationId, x, y })).ok, false);
  }
  for (const endpoint of [{ fromX: -1 }, { fromY: 80 }, { toX: 100 }, { toY: Infinity }]) {
    assert.equal((await f.invoke('drag', { ...ref, observationId, fromX: 1, fromY: 1, toX: 2, toY: 2, ...endpoint })).ok, false);
  }
  assert.equal((await f.invoke('click', { ...ref, observationId, x: 99.5, y: 79.5 })).ok, true);
});

test('截图尺寸未知时拒绝坐标但允许已观察 token', async () => {
  const f = fixture({ observeWindow: async () => ({ ...ref, mode: 'full', elements: [{ element_token: 'seen' }], context: {}, diagnostics: {} }) });
  const observationId = await f.observe();
  assert.equal((await f.invoke('click', { ...ref, observationId, x: 0, y: 0 })).ok, false);
  assert.equal((await f.invoke('click', { ...ref, observationId, elementToken: 'seen' })).ok, true);
});

test('diff、身份不符、失败的重新观察不得保留旧凭据', async () => {
  for (const bad of [{ ...ref, mode: 'diff', elements: [] }, { ...ref, windowId: 24, mode: 'full', elements: [] }, new Error('失败')]) {
    let state; const f = fixture(); const old = await f.observe();
    f.client.observeWindow = async () => { state = true; if (bad instanceof Error) throw bad; return bad; };
    assert.equal((await f.invoke('window.observe', ref)).ok, false); assert.equal(state, true);
    assert.equal((await f.invoke('type', { ...ref, observationId: old, text: 'x' })).ok, false);
  }
});

test('严格拒绝未知 verb、额外字段、路径、JS、shell 及非法值', async () => {
  const f = fixture(); const observationId = await f.observe();
  const base = { ...ref, observationId, elementToken: 'seen' };
  const cases = [
    ['exec', {}], ['constructor', {}], ['windows.list', { onScreenOnly: 'yes' }], ['windows.list', { pid: 0 }],
    ['windows.get', { ...ref, windowId: 1.5 }], ['window.observe', { ...ref, screenshotOutFile: 'C:/x.png' }],
    ['window.observe', { ...ref, disableDiff: false }], ['window.observe', { ...ref, maxDepth: 0 }],
    ['click', { ...base, shell: 'cmd' }], ['click', { ...base, js: 'alert(1)' }], ['click', { ...base, x: 0, y: 0 }],
    ['click', { ...base, count: 4 }], ['click', { ...base, button: 'evil' }], ['click', { ...base, signal: {} }],
    ['scroll', { ...base, direction: 'diagonal' }], ['scroll', { ...base, direction: 'up', amount: 51 }],
    ['drag', { ...ref, observationId, fromX: 1, fromY: 1, toX: 2, toY: 2, steps: 201 }],
    ['type', { ...ref, observationId, text: 'x'.repeat(65537) }], ['type', { ...ref, observationId, text: 1 }],
    ['press_key', { ...ref, observationId, key: '' }], ['hotkey', { ...ref, observationId, keys: ['a'] }],
    ['set_value', { ...ref, observationId, value: 'x' }], ['verify_state', { ...ref, expect: [] }],
    ['verify_state', { ...ref, expect: [{}], timeoutMs: 10001 }], ['verify_state', { ...ref, expect: [{}], stableSamples: 6 }],
    ['verify_state', { ...ref, expect: [{ shell: 'cmd' }] }],
  ];
  for (const [verb, args] of cases) assert.equal((await f.invoke(verb, args)).ok, false, verb + JSON.stringify(args));
  assert.equal(f.calls.length, 1);
});

test('所有 SDK 调用串行，队列内重新校验观察', async () => {
  const gate = deferred(); const entered = deferred();
  const f = fixture({ click: async () => { entered.resolve(); await gate.promise; return action; } });
  const args = { ...ref, observationId: await f.observe(), elementToken: 'seen' };
  const first = f.invoke('click', args); await entered.promise;
  const second = f.invoke('click', args); const third = f.invoke('windows.list');
  await new Promise(r => setImmediate(r)); assert.deepEqual(f.calls.map(x => x.method), ['observeWindow', 'observeWindow', 'click']);
  gate.resolve(); assert.equal((await first).ok, true); assert.equal((await second).ok, false); assert.equal((await third).ok, true);
  assert.deepEqual(f.calls.map(x => x.method), ['observeWindow', 'observeWindow', 'click', 'listWindows']);
});

test('带外取消排队输入不执行，观察不可重用', async () => {
  const gate = deferred(); const entered = deferred();
  const f = fixture({ listWindows: async () => { entered.resolve(); await gate.promise; return []; } });
  const observationId = await f.observe(); const busy = f.invoke('windows.list'); await entered.promise;
  const queued = f.provider.invoke(100, { verb: 'type', args: { ...ref, observationId, text: 'x' } });
  assert.equal(f.provider.cancel(100).content.cancellationRequested, true);
  gate.resolve(); await busy; assert.equal((await queued).failureKind, 'cancelled');
  assert.equal((await f.invoke('type', { ...ref, observationId, text: 'x' })).ok, false);
  assert.equal(f.calls.some(x => x.method === 'typeText'), false);
});

test('已投递取消等待真实结果并保留 operation/effect', async () => {
  const gate = deferred(); const entered = deferred(); let signal;
  const f = fixture({ click: async args => { signal = args.signal; entered.resolve(); await gate.promise; return { ...action, operation: { ...action.operation, cancellationRequested: signal.aborted } }; } });
  const args = { ...ref, observationId: await f.observe(), elementToken: 'seen' };
  let settled = false; const pending = f.provider.invoke(100, { verb: 'click', args }).then(x => { settled = true; return x; });
  await entered.promise; f.provider.cancel(100); assert.equal(signal.aborted, true);
  await new Promise(r => setImmediate(r)); assert.equal(settled, false);
  gate.resolve(); const result = await pending;
  assert.equal(result.ok, true); assert.equal(result.content.effect, 'confirmed');
  assert.equal(result.content.operation.committed, true); assert.equal(result.content.operation.cancellationRequested, true);
});

test('初始化失败明确 provider-unavailable 且不重复初始化', async () => {
  let count = 0; const p = new ComputerUseProvider({ createClient: async () => { count++; throw new Error('SDK 缺失'); } });
  for (const id of [1, 2]) assert.equal((await p.invoke(id, { verb: 'windows.list', args: {} })).failureKind, 'provider-unavailable');
  assert.equal(count, 1); await p.close();
});

test('响应超过上限明确失败，不截断且不留观察', async () => {
  const f = fixture({}, { maxResponseBytes: 1024 });
  f.client.observeWindow = async () => ({ ...ref, mode: 'full', elements: [{ element_token: 'seen' }], text: 'x'.repeat(2048) });
  const result = await f.invoke('window.observe', ref);
  assert.equal(result.failureKind, 'response-too-large'); assert.equal(result.ok, false);
  assert.deepEqual(result.content, {});
});

test('SDK 原生 BigInt 记录转为无损 JSON 字符串', async () => {
  const f = fixture({ getWindow: async () => ({ window_id: 9007199254740993n }) });
  assert.equal((await f.invoke('windows.get', ref)).content.window_id, '9007199254740993');
});

test('close 停止准入、abort 在途与队列，等待结算后关闭 SDK', async () => {
  const gate = deferred(); const entered = deferred(); let signal;
  const f = fixture({ listWindows: async args => { signal = args.signal; entered.resolve(); await gate.promise; return []; } });
  const pending = f.invoke('windows.list'); await entered.promise;
  const queued = f.invoke('windows.get', ref); const closing = f.provider.close();
  assert.equal(signal.aborted, true); assert.equal(f.calls.some(x => x.method === 'close'), false);
  assert.equal((await f.invoke('windows.list')).failureKind, 'provider-closed');
  gate.resolve(); await pending; assert.equal((await queued).failureKind, 'cancelled'); await closing;
  assert.deepEqual(f.calls.map(x => x.method), ['listWindows', 'close']); await f.provider.close();
  assert.equal(f.calls.filter(x => x.method === 'close').length, 1);
});

async function transport(lines, options = {}) {
  const input = new PassThrough(); const output = new PassThrough(); let text = '';
  output.on('data', x => { text += x.toString(); });
  const f = fixture(); const running = runStdio({ input, output, provider: f.provider, ...options });
  input.write(lines);
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  input.end(); await running;
  return { frames: text.trim().split('\n').filter(Boolean).map(x => JSON.parse(x)), f };
}
const rpc = (id, method, params) => JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';

test('NDJSON 非法帧、非法 id/method/params 与正常多请求互不污染', async () => {
  const { frames, f } = await transport('{broken\n' + '[]\n' + rpc(0, 'computer/invoke', { verb: 'windows.list', args: {} }) + rpc(1.5, 'computer/invoke', {}) + rpc(3, 'unknown', {}) + rpc(4, 'computer/invoke', { verb: 'windows.list', args: {}, extra: 1 }) + rpc(5, 'computer/invoke', { verb: 'windows.list', args: {} }) + rpc(6, 'computer/invoke', { verb: 'missing', args: {} }));
  assert.equal(frames.length, 8);
  assert.deepEqual(frames.slice(0, 6).map(x => x.error.code), [-32700, -32600, -32600, -32600, -32601, -32602]);
  assert.equal(frames.find(x => x.id === 5).result.ok, true);
  assert.equal(frames.find(x => x.id === 6).result.failureKind, 'unknown-verb');
  assert.equal(f.calls.filter(x => x.method === 'listWindows').length, 1);
});

test('NDJSON 超大帧拒绝后恢复，UTF-8 分片正常解析', async () => {
  const input = new PassThrough(); const output = new PassThrough(); let text = ''; output.on('data', x => { text += x; });
  const f = fixture(); const pending = runStdio({ input, output, provider: f.provider, maxFrameBytes: 512 });
  input.write('x'.repeat(600)); input.write('\n');
  const bytes = Buffer.from(rpc(1, 'computer/invoke', { verb: 'windows.list', args: {} }));
  for (const byte of bytes) input.write(Buffer.from([byte]));
  await new Promise(r => setImmediate(r)); input.end(); await pending;
  const frames = text.trim().split('\n').map(x => JSON.parse(x));
  assert.equal(frames[0].error.code, -32600); assert.equal(frames[1].result.ok, true);
});

test('NDJSON 取消通知带外执行且无 notification 响应', async () => {
  const input = new PassThrough(); const output = new PassThrough(); let text = ''; output.on('data', x => { text += x; });
  const entered = deferred(); const gate = deferred(); let signal;
  const f = fixture({ listWindows: async args => { signal = args.signal; entered.resolve(); await gate.promise; return []; } });
  const running = runStdio({ input, output, provider: f.provider });
  input.write(rpc(1, 'computer/invoke', { verb: 'windows.list', args: {} })); await entered.promise;
  input.write(JSON.stringify({ jsonrpc: '2.0', method: 'computer/cancel', params: { requestId: 1 } }) + '\n');
  assert.equal(signal.aborted, true); gate.resolve(); await new Promise(r => setImmediate(r)); input.end(); await running;
  const frames = text.trim().split('\n').map(x => JSON.parse(x)); assert.equal(frames.length, 1); assert.equal(frames[0].id, 1);
});

test('SDK 连接代次变化使旧观察失效', async () => {
  const f = fixture(); f.client.connectionGeneration = 1;
  const observationId = await f.observe(); f.client.connectionGeneration = 2;
  assert.equal((await f.invoke('click', { ...ref, observationId, elementToken: 'seen' })).failureKind, 'stale-observation');
  assert.equal(f.calls.filter(x => x.method === 'click').length, 0);
});

test('取消后原生异常仍保留已投递证据及 effect', async () => {
  const entered = deferred(); const gate = deferred();
  const f = fixture({ click: async () => { entered.resolve(); await gate.promise; throw Object.assign(new Error('终局失败'), { details: { operation: { ...action.operation, cancellationRequested: true }, effect: 'partial' } }); } });
  const observationId = await f.observe();
  const pending = f.provider.invoke(100, { verb: 'click', args: { ...ref, observationId, elementToken: 'seen' } });
  await entered.promise; f.provider.cancel(100); gate.resolve(); const response = await pending;
  assert.equal(response.ok, false); assert.equal(response.failureKind, 'sdk-error');
  assert.equal(response.content.operation.committed, true); assert.equal(response.content.effect, 'partial');
  assert.equal((await f.invoke('click', { ...ref, observationId, elementToken: 'seen' })).failureKind, 'stale-observation');
});

test('stdio 可执行入口的非法帧只输出 JSON-RPC，且不加载 SDK', async () => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../provider.mjs', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', x => { stdout += x; }); child.stderr.on('data', x => { stderr += x; });
  const exit = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  child.stdin.end('{bad\n');
  assert.equal(await exit, 0); assert.equal(stderr, '');
  const frames = stdout.trim().split('\n').map(x => JSON.parse(x));
  assert.equal(frames.length, 1); assert.equal(frames[0].error.code, -32700);
});

for (const effect of ['confirmed', 'refused', 'suspected_noop', 'partial', 'unverifiable', 'unexpected']) {
  test(`动作终局按真实 effect 判定：${effect}`, async () => {
    const value = { ...action, effect, text: '真实原生结算' };
    const f = fixture({ click: async () => value });
    const response = await f.invoke('click', { ...ref, observationId: await f.observe(), elementToken: 'seen' });
    assert.equal(response.ok, effect === 'confirmed');
    assert.equal(response.failureKind, effect === 'confirmed' ? '' : effect === 'refused' && response.content.operation?.dispatched !== true ? 'action-refused' : 'action-unverified');
    assert.deepEqual(response.content, value);
  });
}

for (const [status, stable] of [['satisfied', true], ['satisfied', false], ['unsatisfied', true], ['unknown', false]]) {
  test(`verifyState 独立状态契约：${status}/${stable}`, async () => {
    const value = { status, stable, elapsed_ms: 2, samples: 1, predicates: [] };
    const f = fixture({ verifyState: async () => value });
    const response = await f.invoke('verify_state', { ...ref, expect: [{}] });
    assert.equal(response.ok, status === 'satisfied' && stable);
    assert.deepEqual(response.content, value);
    assert.equal(response.failureKind, response.ok ? '' : 'action-unverified');
  });
}

for (const throws of [false, true]) {
  test(`超限保留真实提交证据及有界白名单：异常=${throws}`, async () => {
    const value = { ...action, delivery: { mode: 'foreground', delivered_count: 1, image: 'x'.repeat(10000) }, text: 'x'.repeat(10000), image: 'x'.repeat(10000) };
    const f = fixture({ click: async () => { if (throws) throw Object.assign(new Error('失败'), { details: value }); return value; } }, { maxResponseBytes: 1024 });
    const observationId = await f.observe();
    const response = await f.invoke('click', { ...ref, observationId, elementToken: 'seen' });
    assert.equal(response.failureKind, 'response-too-large');
    assert.equal(response.ok, false);
    assert.deepEqual(response.content, { operation: action.operation, effect: 'confirmed', route: 'accessibility', delivery: { mode: 'foreground', delivered_count: 1 } });
    assert.ok(Buffer.byteLength(JSON.stringify(response)) + 128 <= 1024);
    assert.equal((await f.invoke('click', { ...ref, observationId, elementToken: 'seen' })).failureKind, 'stale-observation');
  });
}

test('同 pid/windowId 窗口替换使旧 epoch token 拒绝且不投递', async () => {
  const f = fixture(); const observationId = await f.observe();
  f.client.observeWindow = async () => ({ ...ref, mode: 'full', elements: [{ element_token: 'new-epoch-token' }], screenshot: { width: 100, height: 80 } });
  const response = await f.invoke('click', { ...ref, observationId, elementToken: 'seen' });
  assert.equal(response.failureKind, 'stale-observation');
  assert.equal(f.calls.filter(x => x.method === 'click').length, 0);
  assert.equal((await f.invoke('click', { ...ref, observationId, x: 1, y: 1 })).failureKind, 'stale-observation');
});

for (const hanging of ['invoke', 'close']) {
  test(`真实 stdin EOF 有界退出：${hanging} 永不结算`, { timeout: 5000 }, async () => {
    const url = new URL('../provider.mjs', import.meta.url).href;
    const code = `import { ComputerUseProvider, runStdio } from ${JSON.stringify(url)};
      const client = { listWindows: async () => { console.error('ENTERED'); ${hanging === 'invoke' ? "setInterval(() => {}, 1000); return new Promise(() => {});" : 'return [];'} },
        close: async () => { ${hanging === 'close' ? "setInterval(() => {}, 1000); return new Promise(() => {});" : ''} } };
      try { await runStdio({ provider: new ComputerUseProvider({ client, closeTimeoutMs: 80 }) }); }
      catch (error) { console.error(error.kind, error.message); process.exit(1); }`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = ''; let stdout = ''; let watchdog;
    const entered = deferred();
    child.stderr.on('data', x => { stderr += x; if (stderr.includes('ENTERED')) entered.resolve(); });
    child.stdout.on('data', x => { stdout += x; });
    const exit = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => resolve(code)); });
    watchdog = setTimeout(() => child.kill(), 2000);
    try {
      child.stdin.write(rpc(1, 'computer/invoke', { verb: 'windows.list', args: {} }));
      await Promise.race([entered.promise, exit.then(() => { throw new Error('子进程未进入调用'); })]);
      child.stdin.end();
      assert.equal(await exit, 1, stderr);
      assert.match(stderr, /outcome-unknown/);
      assert.match(stderr, /不能确认原生副作用停止/);
      for (const line of stdout.trim().split('\n').filter(Boolean)) assert.doesNotThrow(() => JSON.parse(line));
    } finally { clearTimeout(watchdog); if (child.exitCode === null && child.signalCode === null) child.kill(); }
  });
}

test('stdin 断开取消在途并等待结算后 close', async () => {
  const input = new PassThrough(); const output = new PassThrough(); output.resume();
  const entered = deferred(); const gate = deferred(); let signal;
  const f = fixture({ listWindows: async args => { signal = args.signal; entered.resolve(); await gate.promise; return []; } });
  const running = runStdio({ input, output, provider: f.provider });
  input.write(rpc(1, 'computer/invoke', { verb: 'windows.list', args: {} })); await entered.promise;
  input.destroy(); await new Promise(r => setImmediate(r)); assert.equal(signal.aborted, true);
  assert.equal(f.calls.some(x => x.method === 'close'), false); gate.resolve(); await running;
  assert.equal(f.calls.at(-1).method, 'close');
});
