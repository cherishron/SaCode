import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { ExtHost } = require('../host.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(t, code) {
  const dir = mkdtempSync(join(tmpdir(), 'sacode-plugin-lifetime-'));
  const file = join(dir, 'plugin.cjs'); writeFileSync(file, code);
  t.after(() => { delete require.cache[file]; rmSync(dir, { recursive: true, force: true }); });
  return { file, mod: require(file) };
}

test('setup 抛错必须撤销工具与已经登记的监听', async t => {
  const { file } = fixture(t, `module.exports={name:'failed',handler(){return 'bad'},setup(ctx){ctx.on('event',()=>{});throw Error('setup-failed')}}`);
  const h = new ExtHost(); t.after(() => h.close());
  await assert.rejects(h.load(file), /setup-failed/);
  assert.deepEqual(h.list(), []); assert.equal(h.listenerCount(), 0);
  await assert.rejects(h.call('failed', {}), /unknown-tool/);
});

test('异步 setup 未完成前不发布工具，完成后才可调用', async t => {
  const { file, mod } = fixture(t, `let release;const gate=new Promise(r=>release=r);module.exports={name:'async-setup',release,handler(){return 'ready'},async setup(ctx){ctx.on('event',()=>{});await gate}}`);
  const h = new ExtHost(); t.after(() => h.close());
  const loading = h.load(file); t.after(() => mod.release()); await tick();
  try { assert.deepEqual(h.list(), []); } finally { mod.release(); await loading; }
  assert.equal(await h.call('async-setup', {}), 'ready');
});

test('宿主关闭期间的异步 setup 不能迟到发布工具', async t => {
  const { file, mod } = fixture(t, `let release;const gate=new Promise(r=>release=r);module.exports={name:'closing-setup',release,handler(){return 'bad'},async setup(ctx){ctx.on('event',()=>{});await gate}}`);
  const h = new ExtHost(); t.after(() => h.close());
  const result = h.load(file).then(() => 'loaded', error => error.message);
  await tick(); h.close(); mod.release();
  assert.match(await result, /host-exiting/);
  assert.deepEqual(h.list(), []); assert.equal(h.listenerCount(), 0);
});

test('同步 handler 抛错也释放调用账目并允许复用 callId', async t => {
  const { file } = fixture(t, `module.exports={name:'thrower',handler(args){if(args.fail)throw Error('sync-failure');return 'ok'}}`);
  const h = new ExtHost(); t.after(() => h.close()); await h.load(file);
  await assert.rejects(h.call('thrower', {fail:true}, 'same-id'), /sync-failure/);
  assert.equal(h.pendingCount(), 0);
  assert.equal(await h.call('thrower', {}, 'same-id'), 'ok');
});

test('卸载向无 callId 的在途工具送达 abort 并结算等待者', async t => {
  const { file, mod } = fixture(t, `const signals=[];let release;module.exports={name:'unloading',signals,release(){release?.('late')},handler(args,ctx){signals.push(ctx.signal);return new Promise(r=>{release=r;ctx.signal.addEventListener('abort',()=>r('stopped'),{once:true})})}}`);
  const h = new ExtHost(); t.after(() => { mod.release(); h.close(); }); await h.load(file);
  const result = h.call('unloading', {}).then(value => ({value}), error => ({error:error.message}));
  await tick(); assert.equal(h.dispose('unloading'), true);
  const outcome = await Promise.race([result, new Promise(r => setTimeout(() => r({error:'timeout'}), 80))]);
  assert.match(outcome.error || '', /extension-disposed/);
  assert.equal(mod.signals[0].aborted, true); assert.equal(h.pendingCount(), 0);
});

test('close 通知全部工具含无 callId 调用，并拒绝再次加载', async t => {
  const { file, mod } = fixture(t, `const signals=[];module.exports={name:'closing',signals,handler(args,ctx){signals.push(ctx.signal);return new Promise(r=>ctx.signal.addEventListener('abort',()=>r('stopped'),{once:true}))}}`);
  const h = new ExtHost(); t.after(() => h.close()); await h.load(file);
  const result = h.call('closing', {}).then(value => ({value}), error => ({error:error.message}));
  await tick(); h.close(); assert.match((await result).error, /host-exiting/);
  assert.equal(mod.signals[0].aborted, true); assert.deepEqual(h.list(), []);
  await assert.rejects(h.load(file), /host-exiting/);
});

test('卸载后旧 setup 句柄不能再次登记监听', async t => {
  const { file, mod } = fixture(t, `let saved;module.exports={name:'stale-setup',handler(){return 'ok'},setup(ctx){saved=ctx;ctx.on('event',()=>{})},late(){return saved.on('event',()=>{})}}`);
  const h = new ExtHost(); t.after(() => h.close()); await h.load(file); h.dispose('stale-setup');
  assert.throws(() => mod.late(), /extension-disposed/); assert.equal(h.listenerCount(), 0);
});

test('取消后立即复用 callId，旧调用 finally 不能撤销新调用', async t => {
  const { file } = fixture(t, `module.exports={name:'reuse-id',handler(args,ctx){return new Promise(r=>ctx.signal.addEventListener('abort',()=>r('late'),{once:true}))}}`);
  const h = new ExtHost(); t.after(() => h.close()); await h.load(file);
  const first = assert.rejects(h.call('reuse-id', {}, 'reused'), /cancelled/);
  await tick(); assert.equal(h.cancel('reused'), true);
  const second = assert.rejects(h.call('reuse-id', {}, 'reused'), /cancelled/);
  await first; await tick(); assert.equal(h.cancel('reused'), true);
  await second; assert.equal(h.pendingCount(), 0);
});
