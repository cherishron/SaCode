import assert from 'node:assert/strict';
import test from 'node:test';
import { mcpDetail, mcpOptions, modeDetail, skillDetail, skillOptions } from '../src/capability-views.mjs';

const capabilities = new Set(['skill/list', 'skill/get', 'mcp/list', 'mcp/status', 'approval/get-mode', 'plan/get-mode']);

test('能力面：未声明不发请求，格式错误不冒充空目录或安全状态', async () => {
  let calls = 0;
  const client = { async request() { calls++; return {}; } };
  await assert.rejects(skillOptions(client, new Set()), /未声明/);
  assert.equal(calls, 0);
  await assert.rejects(skillOptions(client, capabilities), /格式无效/);
  await assert.rejects(mcpOptions(client, capabilities, 's1'), /格式无效/);
  await assert.rejects(modeDetail(client, capabilities, 'permissions'), /未确认/);
});

test('技能：只按名称读取，不执行或把内容注入消息；回执必须同名', async () => {
  const calls = [];
  const client = { async request(method, params) {
    calls.push({ method, params });
    if (method === 'skill/list') return [{ name: 'review', description: '审查', whenToUse: '审查时' }];
    return { name: params.name, description: '审查', whenToUse: '审查时', content: '# 仅浏览\n不要自动执行' };
  } };
  assert.equal((await skillOptions(client, capabilities))[0].id, 'review');
  const detail = await skillDetail(client, capabilities, 'review');
  assert.match(detail.markdown, /仅浏览/);
  assert.deepEqual(calls.map((call) => call.method), ['skill/list', 'skill/get']);
  assert.deepEqual(calls[1].params, { name: 'review' });
  client.request = async () => ({ name: 'wrong', content: 'wrong' });
  await assert.rejects(skillDetail(client, capabilities, 'review'), /身份/);
});

test('MCP：仅查询注册/连接，不触发tools/list、自动连接或外部探测', async () => {
  const calls = [];
  const client = { async request(method, params) {
    calls.push({ method, params });
    return method === 'mcp/list' ? { servers: ['demo'] } : { connected: false };
  } };
  const entries = await mcpOptions(client, capabilities, 's1');
  assert.match(entries[0].label, /状态待查询/);
  const detail = await mcpDetail(client, capabilities, 's1', 'demo');
  assert.match(detail.text, /未连接/);
  assert.deepEqual(calls, [{ method: 'mcp/list', params: { sessionId: 's1' } }, { method: 'mcp/status', params: { sessionId: 's1', name: 'demo' } }]);
  client.request = async () => ({ connected: 'yes' });
  await assert.rejects(mcpDetail(client, capabilities, 's1', 'demo'), /未确认/);
});

test('模式：只读取权限和计划，不推断OS沙箱、不切换', async () => {
  const calls = [];
  const client = { async request(method, params) { calls.push({ method, params }); return method === 'approval/get-mode' ? { ok: true, mode: 'build' } : { ok: true, active: false }; } };
  assert.match((await modeDetail(client, capabilities, 'permissions')).text, /build/);
  assert.match((await modeDetail(client, capabilities, 'plan')).text, /未进入/);
  assert.deepEqual(calls.map((call) => call.method), ['approval/get-mode', 'plan/get-mode']);
  client.request = async () => ({ ok: true, mode: 'unknown' });
  await assert.rejects(modeDetail(client, capabilities, 'permissions'), /未知权限/);
});
