import { fixtureHostEnv } from '../test-support/fixture-env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { HostBridge } = require('../host-bridge.cjs');
const host = process.env.SACODE_HOST || resolve('dist/host/bin/sacode-host.exe');

test('会话目录读取落盘事实，隔离损坏日志并且不递归到目录外', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sacode-catalog-'));
  const outside = mkdtempSync(join(tmpdir(), 'sacode-outside-'));
  mkdirSync(join(dir, 'sessions', '中文 会话'), { recursive:true });
  mkdirSync(join(dir, 'sessions', 'broken'), { recursive:true });
  mkdirSync(join(dir, 'sessions', 'parent', 'nested'), { recursive:true });
  const original='0\tuser/message\t根任务\n';
  writeFileSync(join(dir, 'session.log'), original);
  writeFileSync(join(dir, 'sessions', '中文 会话', 'session.log'), '0\tuser/message\t引号"与\\n换行\n1\tappearance/theme\tdark\n');
  writeFileSync(join(dir, 'sessions', 'broken', 'session.log'), '0\tuser/message\t前缀\n8\tuser/message\t断裂\n9\tuser/message\t尾部\n');
  writeFileSync(join(dir, 'sessions', 'parent', 'nested', 'session.log'), original);
  writeFileSync(join(outside, 'session.log'), '0\tuser/message\t目录外的私有消息\n');
  symlinkSync(outside, join(dir, 'sessions', 'outside'), process.platform==='win32' ? 'junction' : 'dir');
  const bridge = new HostBridge(host, fixtureHostEnv(dir));
  await bridge.start(dir);
  try {
    assert.ok((await bridge.request('initialize')).capabilities.includes('session/catalog'));
    const catalog = await bridge.request('session/catalog');
    assert.equal(catalog.source, 'durable-log');
    assert.equal(catalog.entries.length, 3);
    const current = catalog.entries.find(e=>e.current);
    assert.deepEqual(current, {id:'current',title:'根任务',durable:1,status:'ready',workspaceDirectory:'',current:true});
    assert.equal(catalog.entries.find(e=>e.id==='sessions/中文 会话').title, '引号"与\n换行');
    assert.equal(catalog.entries.find(e=>e.id==='sessions/broken').status, 'replay-rejected');
    assert.doesNotMatch(JSON.stringify(catalog), /目录外的私有消息/);
    assert.equal(readFileSync(join(dir,'session.log'),'utf8'), original);
    await bridge.request('session/submit', {eventType:'user/message',data:'内存待保存'});
    assert.equal((await bridge.request('session/catalog')).entries.find(e=>e.current).durable, 1);
    await bridge.request('session/flush');
    assert.equal((await bridge.request('session/catalog')).entries.find(e=>e.current).durable, 2);
  } finally { await bridge.stop(); }
});

test('全新目录不由只读清单创建会话', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sacode-catalog-empty-'));
  const bridge = new HostBridge(host, fixtureHostEnv(dir));
  await bridge.start(dir);
  try { assert.deepEqual((await bridge.request('session/catalog')).entries, []); }
  finally { await bridge.stop(); }
});
