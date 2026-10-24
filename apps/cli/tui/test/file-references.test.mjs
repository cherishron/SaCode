import assert from 'node:assert/strict';
import test from 'node:test';
import { readReferenceMessage, referenceMessage, referenceMessageView, referencePaths } from '../src/file-references.mjs';

const identity = { sessionId: 's1', directory: 'D:/demo' };
function fixture() {
  const calls = [];
  const content = '第一行\n正文含引号"与emoji😀\n';
  const client = { async request(method, params) {
    calls.push({ method, params });
    if (method === 'workspace/get') return identity;
    if (method === 'extension/list') return { tools: [{ name: 'read', needsApproval: false }] };
    if (method === 'workspace/files') return { directory: identity.directory, files: [{ name: '中文 a.txt', isDir: false, size: Buffer.byteLength(content) }] };
    if (method === 'extension/call') return { result: content };
    if (method === 'session/flush') return { events: 2, durable: 2 };
    throw new Error('unexpected method');
  } };
  return { client, calls, content, snapshot: { text: '解释 @"中文 a.txt"', paths: ['中文 a.txt'], identity } };
}

test('文本引用：解析中文/引号/重复去重，邮箱/转义/行内代码/代码围栏不是引用', () => {
  assert.deepEqual(referencePaths('读 @src/a.cj 和 @"中文 a.txt" 再读 @src/a.cj'), ['src/a.cj', '中文 a.txt']);
  assert.deepEqual(referencePaths('mail@example.test \\@literal `@code`\n```ts\n@decorator\n```\n正文'), []);
  assert.deepEqual(referencePaths('@"a\\\"b.txt"'), ['a"b.txt']);
  for (const text of ['@../outside', '@/etc/a', '@C:/x', '@a\\b', '@"未闭合', '@"file"suffix',
    Array.from({ length: 9 }, (_, i) => '@file' + i).join(' ')]) assert.throws(() => referencePaths(text));
});

test('文本引用：经Host读完整原文、固定工作区、多步回读，工具事实先flush不自动发消息', async () => {
  const { client, calls, content, snapshot } = fixture();
  const out = await readReferenceMessage(client, snapshot);
  assert.equal(out.files[0].content, content);
  assert.deepEqual(calls.find((call) => call.method === 'extension/call').params,
    { name: 'read', args: JSON.stringify({ path: '中文 a.txt', offset: 0, limit: 2000 }) });
  assert.equal(calls.at(-2).method, 'session/flush');
  assert.equal(calls.at(-1).method, 'workspace/get');
  const view = referenceMessageView(out.message);
  assert.equal(view.text, snapshot.text);
  assert.deepEqual(view.references, [{ path: '中文 a.txt', bytes: Buffer.byteLength(content) }]);
  assert.ok(!calls.some((call) => ['attachment/upload', 'session/append', 'task/start'].includes(call.method)));
});

test('文本引用：工作区错配/需审批/缺失/目录/超限均先拒绝，不调用read', async () => {
  for (const override of [
    { method: 'workspace/get', value: { ...identity, sessionId: 'other' } },
    { method: 'extension/list', value: { tools: [{ name: 'read', needsApproval: true }] } },
    { method: 'workspace/files', value: { directory: 'elsewhere', files: [] } },
    { method: 'workspace/files', value: { directory: identity.directory, files: [] } },
    { method: 'workspace/files', value: { directory: identity.directory, files: [{ name: '中文 a.txt', isDir: true, size: 0 }] } },
    { method: 'workspace/files', value: { directory: identity.directory, files: [{ name: '中文 a.txt', isDir: false, size: 65537 }] } },
  ]) {
    const { client, calls, snapshot } = fixture();
    const request = client.request.bind(client);
    client.request = async (method, params) => method === override.method ? override.value : request(method, params);
    await assert.rejects(readReferenceMessage(client, snapshot));
    assert.ok(!calls.some((call) => ['extension/call', 'session/append', 'task/start'].includes(call.method)));
  }
});

test('文本引用：截断/二进制/超预算/工具失败整条拒绝，已有工具事实仍结算', async () => {
  for (const result of ['正文\n[read-truncated:offset=0,lines=2000/2001]', 'abc\0def', '中'.repeat(30000), null, new Error('-32010 invalid-encoding:private-path')]) {
    const { client, calls, snapshot } = fixture();
    const request = client.request.bind(client);
    client.request = async (method, params) => {
      if (method === 'extension/call') { calls.push({ method, params }); if (result instanceof Error) throw result; return { result }; }
      return request(method, params);
    };
    await assert.rejects(readReferenceMessage(client, snapshot), (error) => /消息未发送/.test(error.message) && !error.message.includes('private-path'));
    assert.equal(calls.filter((call) => call.method === 'session/flush').length, 1);
  }
});

test('文本引用：取消不继续读/发送；读取超时或flush未知不自动重试', async () => {
  for (const scenario of ['cancel', 'timeout', 'flush', 'flush-rejected']) {
    const { client, calls, snapshot } = fixture();
    const request = client.request.bind(client);
    let cancelled = false;
    client.request = async (method, params) => {
      if (method === 'extension/call') {
        if (scenario === 'timeout') { calls.push({ method, params }); throw new Error('timeout: extension/call'); }
        const result = await request(method, params); if (scenario === 'cancel') cancelled = true; return result;
      }
      if (method === 'session/flush' && scenario.startsWith('flush')) { calls.push({ method, params }); throw new Error(scenario === 'flush' ? 'timeout: session/flush' : '-32003 flush-failed'); }
      return request(method, params);
    };
    await assert.rejects(readReferenceMessage(client, snapshot, { cancelled: () => cancelled }), (error) => scenario === 'cancel'
      ? /消息未发送/.test(error.message) : error.outcomeUnknown === true);
    assert.equal(calls.filter((call) => call.method === 'extension/call').length, 1);
    assert.equal(calls.filter((call) => call.method === 'session/flush').length, scenario === 'timeout' ? 0 : 1);
  }
});

test('文本引用：消息快照可折叠显示但恶意/损坏信封保留原文', () => {
  const text = referenceMessage('任务', [{ path: 'a.txt', bytes: 3, content: 'abc' }]);
  assert.equal(referenceMessageView(text).text, '任务');
  for (const value of [text.replace('"bytes":3', '"bytes":9'), text.replace('a.txt', '../escape'), text + 'suffix']) {
    assert.equal(referenceMessageView(value).text, value);
  }
});

test('文本引用：多文件后续失败不返回部分快照，已读记录只结算一次', async () => {
  const { client, calls } = fixture();
  const request = client.request.bind(client);
  client.request = async (method, params) => method === 'workspace/files'
    ? { directory: identity.directory, files: [{ name: 'good.txt', isDir: false, size: 1 }] } : request(method, params);
  await assert.rejects(readReferenceMessage(client, { text: '@good.txt @missing.txt', paths: ['good.txt', 'missing.txt'], identity }), /消息未发送/);
  assert.equal(calls.filter((call) => call.method === 'extension/call').length, 1);
  assert.equal(calls.filter((call) => call.method === 'session/flush').length, 1);
  assert.ok(!calls.some((call) => call.method === 'session/append'));
});

test('文本引用：读取后工作区变化不能返回可发送内容，结算不修改用户消息', async () => {
  const { client, calls, snapshot } = fixture();
  const request = client.request.bind(client);
  let changed = false;
  client.request = async (method, params) => {
    if (method === 'workspace/get' && changed) return { ...identity, directory: 'D:/other' };
    const reply = await request(method, params);
    if (method === 'extension/call') changed = true;
    return reply;
  };
  await assert.rejects(readReferenceMessage(client, snapshot), /消息未发送/);
  assert.equal(calls.filter((call) => call.method === 'session/flush').length, 1);
  assert.ok(!calls.some((call) => ['session/append', 'task/start'].includes(call.method)));
});
