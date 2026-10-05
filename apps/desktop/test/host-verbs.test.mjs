// 宿主只提供有限动词：能力声明与实现必须一致，未知名必须 -32601，
// 写侧缺 expectedRevision 必须拒——协议面不接受「没点名修订号」的写。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const here = dirname(fileURLToPath(import.meta.url));
const HOST = resolve(here, '../dist/host/bin/dsh-host.exe');
// 干净的设置目录：custom/describe 的「空目录」断言不能读上一批留下的文档
const SETTINGS = resolve(here, '../../../target/host-verbs-settings');
rmSync(SETTINGS, { recursive: true, force: true });
mkdirSync(SETTINGS, { recursive: true });

const NEW = ['custom/describe', 'custom/upsert', 'custom/remove', 'binding/upsert', 'binding/remove',
  'binding/reorder', 'model/pull', 'model/upstream/upsert', 'custom/import/new', 'custom/import/into'];

const child = spawn(HOST, [], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', SACODE_USER_SETTINGS_DIR: SETTINGS },
  stdio: ['pipe', 'pipe', 'pipe'],
});
const pending = new Map();
let seq = 0;
createInterface({ input: child.stdout }).on('line', (line) => {
  if (!line.trim()) return;
  const frame = JSON.parse(line);
  const wait = frame.id !== undefined && pending.get(frame.id);
  if (wait) { pending.delete(frame.id); frame.error ? wait.reject(frame.error) : wait.resolve(frame.result); }
});
after(() => child.kill());

const rpc = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq;
  pending.set(id, { resolve: res, reject: rej });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});

const draft = { id: 'code', name: '编程模型', description: '', enabled: true, category: 'coding',
  requires: ['tools', 'text-output'], mode: 'weighted', bindings: [] };
const binding = { providerId: 'step', modelId: 'm-a', enabled: true, order: 0, weight: 1,
  priceInMicro: 1000, priceOutMicro: 2000, priceCacheReadMicro: -1, priceCacheWriteMicro: -1,
  priceVersion: 1, currency: 'CNY' };

test('capabilities 声明了本批新增的每个动词', async () => {
  const cap = await rpc('initialize');
  for (const m of NEW) assert.ok(cap.capabilities.includes(m), `未声明: ${m}`);
});

test('add-catalog 同一目录项连发两次得到两个实例（号池，断言 56）', async () => {
  await rpc('model/registry/add-catalog', { id: 'stepfun', credentialRef: '' });
  const b = await rpc('model/registry/add-catalog', { id: 'stepfun', credentialRef: '' });
  // 该动词的响应体本身就是供应商视图
  assert.equal(b.providers.length, 2, '第二次不得把第一份顶掉');
  assert.notEqual(b.providers[0].credentialRef, b.providers[1].credentialRef, '两份实例各自一把密钥引用');
  assert.equal(b.providers[0].baseUrl, b.providers[1].baseUrl, '同地址多实例是号池的正常形态');
});

test('custom/describe 空目录返回零条目且 revision 为 0', async () => {
  const r = await rpc('custom/describe');
  assert.equal(r.models.length, 0);
  assert.equal(r.revision, 0);
  assert.equal(r.writable, true);
});

test('binding/upsert 缺 expectedRevision 一律拒', async () => {
  await rpc('custom/upsert', { draft, expectedRevision: 0 });
  await assert.rejects(rpc('binding/upsert', { customId: 'code', binding }),
    (e) => e.message.includes('missing-revision'));
});

test('未知动词不被当作通用通道', async () => {
  await assert.rejects(rpc('custom/whatever'), (e) => e.code === -32601);
});

// 断言 66：能力清单只有一份，且双向核——声明里有而分派里没有 → 红；
// 分派里有而声明里没有 → 同样红。只核前一半等于没核。
test('capabilities 与源码分派双向相等', async () => {
  const cap = await rpc('initialize');
  const declared = new Set(cap.capabilities);
  const src = await readFile(resolve(here, '../../../apps/host/src/main.cj'), 'utf8');
  // 信封字段不是动词；goal/* 经 isGoalControlMethod 分派而非 method == 字面量
  const envelope = new Set(['core', 'transport', 'protocolVersion', 'capabilities', 'cangjie', 'stdio-ndjson']);
  const goalVerbs = new Set(['goal/create', 'goal/edit', 'goal/pause', 'goal/resume', 'goal/clear']);
  const dispatched = new Set();
  for (const m of src.matchAll(/method == "([a-z0-9/-]+)"/g)) dispatched.add(m[1]);
  const goalSrc = /isGoalControlMethod\(method\)/.test(src);
  assert.ok(goalSrc, 'isGoalControlMethod 分派点消失，goal/* 五个动词将无处落地');
  for (const v of goalVerbs) dispatched.add(v);
  for (const v of dispatched) {
    assert.ok(declared.has(v), `分派了但未声明: ${v}`);
  }
  for (const v of declared) {
    if (envelope.has(v)) continue;
    assert.ok(dispatched.has(v), `声明了但分派里找不到: ${v}`);
  }
});
