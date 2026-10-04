// 产品发送链路要能真正跑一轮：桌面只能点名有限集合里的动作，
// 「跑一轮」必须走 task/start（未配置就显式失败），而不是留下静默兜底的 turn/start。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function load() {
  let api;
  const calls = [];
  vm.runInNewContext(readFileSync(new URL('../preload.cjs', import.meta.url), 'utf8'), {
    require: () => ({
      contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } },
      ipcRenderer: { invoke: (...args) => { calls.push(args); return Promise.resolve(); } },
    }),
  });
  return { api, calls };
}

test('发送后跑一轮 preload 只发固定动作且不带可变负载', async () => {
  const { api, calls } = load();
  await api.taskStart();
  assert.equal(calls[0][0], 'dsh:taskStart');
  // 负载必须是那一个对象：给它塞任意方法或参数的通路等于把有限集合打开
  assert.equal(calls[0].length, 1);
  assert.equal('request' in api, false);
  assert.equal(typeof api.turnStart, 'function');
});

test('队列 preload 只发固定动作并把身份字段交给主进程校验', async () => {
  const { api, calls } = load();
  await api.queueDescribe();
  await api.queueEnqueue('排队的一条', 'r7');
  await api.queueUpdate('q12', 'edit', '改过的正文');
  await api.queueUpdate('q12', 'remove', '');
  assert.equal(calls[0][0], 'dsh:queueDescribe'); assert.equal(calls[0].length, 1);
  assert.equal(calls[1][0], 'dsh:queueEnqueue');
  assert.equal(JSON.stringify(calls[1][1]), '{"text":"排队的一条","rpcId":"r7"}');
  assert.equal(calls[2][0], 'dsh:queueUpdate');
  assert.equal(JSON.stringify(calls[2][1]), '{"itemId":"q12","kind":"edit","text":"改过的正文"}');
  assert.equal(JSON.stringify(calls[3][1]), '{"itemId":"q12","kind":"remove","text":""}');
  // 队列没有「发任意方法」的兜底通路
  assert.equal('request' in api, false);
});
