import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { render } from 'ink-testing-library';
import { ConfigurationDialog } from '../src/configuration-dialog.mjs';
import { configurationStatus, saveProviderConfiguration, validateProviderDraft, validateProviderField } from '../src/configuration.mjs';

const values = () => ({ id: 'tui-local', baseUrl: 'http://127.0.0.1:1', model: 'synthetic-model', key: '' });
const sleep = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeSettings() {
  const calls = [];
  let view = { providers: [], writable: true, revision: 0, defaultProviderId: '', defaultModel: '' };
  const client = { async request(method, params) {
    calls.push({ method, params: method === 'credential/set' ? { ref: params.ref, value: '[REDACTED]' } : params });
    if (method === 'model/registry/describe') return view;
    if (method === 'model/registry/update') { view = { ...view, revision: 1, providers: [{ ...params.draft, credentialRef: 'SA_CODE_TUI_LOCAL_KEY', keyConfigured: false }] }; return view; }
    if (method === 'credential/set') { view.providers[0].keyConfigured = true; return { ref: params.ref, configured: true }; }
    if (method === 'model/registry/set-default') { view = { ...view, revision: 2, defaultProviderId: params.providerId, defaultModel: params.model }; return view; }
    throw new Error('unexpected-method');
  } };
  return { client, calls };
}

test('配置：逐项拒绝非法地址/冲突ID/外部空密钥，错误不包含输入值', () => {
  for (const baseUrl of ['http://example.test', 'https://user:invalid@example.test', 'https://example.test?key=invalid', 'https://example.test#x', ' https://example.test']) {
    assert.throws(() => validateProviderDraft({ ...values(), baseUrl }));
  }
  assert.throws(() => validateProviderField('id', 'existing', {}, { providers: [{ id: 'existing' }] }), /已存在/);
  assert.throws(() => validateProviderField('key', '', { baseUrl: 'https://example.test' }), /需要填写密钥/);
  assert.doesNotThrow(() => validateProviderDraft(values()));
  assert.throws(() => validateProviderField('key', 'invalid\nplaceholder', values()), (error) => !error.message.includes('invalid'));
});

test('配置：提交前只读冲突检查、三步写和回读，不请求供应商', async () => {
  const { client, calls } = fakeSettings();
  const saved = await saveProviderConfiguration(client, { ...values(), key: 'invalid-synthetic-placeholder' }, 0);
  assert.match(saved.label, /连通未验/);
  assert.deepEqual(calls.map((call) => call.method), ['model/registry/describe', 'model/registry/update', 'credential/set', 'model/registry/set-default', 'model/registry/describe']);
  assert.equal(calls[1].params.expectedRevision, 0);
  assert.equal(calls[3].params.expectedRevision, 1);
});

test('配置：过期修订不写，凭据失败停止默认设置且不泄露原始异常', async () => {
  const fixture = fakeSettings();
  await assert.rejects(saveProviderConfiguration(fixture.client, values(), 3), /未发出写操作/);
  assert.deepEqual(fixture.calls.map((call) => call.method), ['model/registry/describe']);
  const second = fakeSettings();
  const request = second.client.request.bind(second.client);
  second.client.request = async (method, params) => {
    if (method === 'credential/set') throw new Error('invalid-synthetic-placeholder');
    return request(method, params);
  };
  await assert.rejects(saveProviderConfiguration(second.client, { ...values(), key: 'invalid-synthetic-placeholder' }, 0), (error) => /可能已部分生效/.test(error.message) && !error.message.includes('invalid-synthetic-placeholder'));
  assert.ok(!second.calls.some((call) => call.method === 'model/registry/set-default'));
});

test('配置：已配置不等同可用，状态不请求模型或拉取清单', async () => {
  const client = { async request(method) {
    assert.equal(method, 'model/registry/describe');
    return { providers: [{ id: 'p', name: '本地', keyConfigured: false }], defaultProviderId: 'p', defaultModel: 'm' };
  } };
  const status = await configurationStatus(client);
  assert.equal(status.configured, true);
  assert.equal(status.credentialConfigured, false);
  assert.match(status.label, /凭据未确认.*连通未验/);
});

test('表单：Shift+Tab返回修改、校验不前进、密钥不回显且确认前不写', async () => {
  const { client, calls } = fakeSettings();
  let saved;
  const app = render(React.createElement(ConfigurationDialog, { client, view: { providers: [], writable: true, revision: 0 }, onClose() {}, onSaved(value) { saved = value; } }));
  const key = async (text) => { app.stdin.write(text); await sleep(); };
  try {
    await sleep(80);
    await key('tui-local'); await key('\r');
    await key('http://external.invalid'); await key('\r');
    assert.match(app.lastFrame(), /2\/4/);
    assert.match(app.lastFrame(), /仅允许 HTTPS/);
    await key('\x15'); await key('http://127.0.0.1:1'); await key('\r');
    await key('old-model'); await key('\r');
    await key('invalid-synthetic-placeholder');
    assert.ok(app.frames.every((frame) => !frame.includes('invalid-synthetic-placeholder')), '所有渲染帧都不能包含合成密钥输入');
    await key('\x1b[Z');
    assert.match(app.lastFrame(), /3\/4/);
    assert.match(app.lastFrame(), /old-model/);
    await key('\x15'); await key('new-model'); await key('\r'); await key('\r');
    assert.match(app.lastFrame(), /new-model/);
    assert.equal(calls.length, 0);
    await key('\r'); await sleep(50);
    assert.ok(saved);
    assert.ok(app.frames.every((frame) => !frame.includes('invalid-synthetic-placeholder')));
  } finally { app.unmount(); app.cleanup(); }
});

test('表单：保存结果未知不能重复提交或返回编辑，Esc可退出', async () => {
  let writes = 0;
  let closed = false;
  const client = { async request(method) {
    if (method === 'model/registry/describe') return { providers: [], writable: true, revision: 0 };
    writes++; throw new Error('timeout: model/registry/update');
  } };
  const app = render(React.createElement(ConfigurationDialog, { client, view: { providers: [], writable: true, revision: 0 }, onClose() { closed = true; }, onSaved() { assert.fail('不能报告保存成功'); } }));
  const key = async (text) => { app.stdin.write(text); await sleep(); };
  try {
    await sleep(80);
    for (const text of ['tui-local', '\r', 'http://127.0.0.1:1', '\r', 'demo-model', '\r', '\r', '\r']) await key(text);
    assert.match(app.lastFrame(), /已停止提交/);
    await key('\r'); await key('\x1b[Z'); await key('\r');
    assert.equal(writes, 1);
    await key('\x1b'); assert.equal(closed, true);
  } finally { app.unmount(); app.cleanup(); }
});

test('配置：最终回读不符不能报告成功，首次检查ID已存在不能覆盖', async () => {
  const fixture = fakeSettings();
  const request = fixture.client.request.bind(fixture.client);
  let reads = 0;
  fixture.client.request = async (method, params) => {
    const result = await request(method, params);
    if (method === 'model/registry/describe' && ++reads === 2) return { ...result, defaultModel: 'someone-else-changed-it' };
    return result;
  };
  await assert.rejects(saveProviderConfiguration(fixture.client, values(), 0), /保存后回读未确认.*部分生效/);
  let writes = 0;
  const exists = { async request(method) {
    if (method !== 'model/registry/describe') writes++;
    return { providers: [{ id: 'tui-local' }], writable: true, revision: 0 };
  } };
  await assert.rejects(saveProviderConfiguration(exists, values(), 0), /未发出写操作/);
  assert.equal(writes, 0);
});

test('表单：取消时清除隐藏字段，双回车不会重复写入或提前关闭', async () => {
  let resolveUpdate;
  let writes = 0;
  let closed = 0;
  const client = { async request(method) {
    if (method === 'model/registry/describe') return { providers: [], writable: true, revision: 0 };
    if (method === 'model/registry/update') { writes++; return new Promise((resolve) => { resolveUpdate = resolve; }); }
    throw new Error('unexpected');
  } };
  const app = render(React.createElement(ConfigurationDialog, { client, view: { providers: [], writable: true, revision: 0 },
    onClose() { closed++; }, onSaved() { assert.fail('未确认不能报告成功'); } }));
  const key = async (text) => { app.stdin.write(text); await sleep(); };
  try {
    await sleep(80);
    for (const text of ['tui-local', '\r', 'http://127.0.0.1:1', '\r', 'demo-model', '\r', '\r', '\r']) await key(text);
    assert.ok(resolveUpdate);
    await key('\r'); await key('\x1b'); await key('\x03');
    assert.equal(writes, 1);
    assert.equal(closed, 0, '写入未确认时不能通过取消关闭');
    resolveUpdate({ providers: [], revision: 1 }); await sleep(50);
    assert.match(app.lastFrame(), /已停止提交/);
    await key('\x1b'); assert.equal(closed, 1);
  } finally { app.unmount(); app.cleanup(); }
});
