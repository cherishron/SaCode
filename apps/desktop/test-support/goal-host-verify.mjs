import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fixtureHostEnv } from './fixture-env.mjs';
const { HostBridge } = createRequire(import.meta.url)('../host-bridge.cjs');
const exe = resolve(process.env.SACODE_HOST || '');
assert.ok(process.env.SACODE_HOST && existsSync(exe), '必须指定本轮新 Host');
const base = resolve('apps/desktop/.tmp-test'); mkdirSync(base, { recursive: true });
const evidence = mkdtempSync(join(base, 'goal-host-proof-'));
const results = [];
let bridge;
const allCases = ['complete', 'approved-write', 'budget', 'claim-only', 'freeze', 'cancel'];
const cases = process.env.SACODE_GOAL_CASE ? [process.env.SACODE_GOAL_CASE] : allCases;
assert.ok(cases.every(mode => allCases.includes(mode)), '未知目标验收场景');
const server = createServer();
let scenario;
function toolsResponse(res, tools) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: tools.map(([name, args], index) => ({ index, id: `call-${scenario.requests.length}-${index}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })) } }] })}\n\n`);
  res.end('data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"total_tokens":3}}\n\ndata: [DONE]\n\n');
}
function finishResponse(res) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end('data: {"choices":[{"index":0,"delta":{"content":"本地协议验收"}}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"total_tokens":3}}\n\ndata: [DONE]\n\n');
}
server.on('request', async (req, res) => {
  let text = ''; for await (const chunk of req) text += chunk;
  const body = JSON.parse(text);
  const disk = readFileSync(join(scenario.root, 'session.log'), 'utf8');
  // 只认本次请求对应的轮次；旧轮次的准入事件不能替下一轮证明屏障。
  const decodeField = value => value.replace(/\\([\\nrt])/g, (_, code) => ({ '\\': '\\', n: '\n', r: '\r', t: '\t' })[code]);
  const admissions = disk.split('\n').map(line => line.split('\t'))
    .filter(fields => fields[1] === 'goal/round-prompt')
    .map(fields => JSON.parse(decodeField(fields[2])));
  const admission = admissions.at(-1);
  const requestPrompt = body.messages.filter(message => message.role === 'developer' && message.content.includes('<goal_round>')).at(-1);
  const expectedRound = Math.floor(scenario.requests.length / 2) + 1;
  scenario.requests.push({ body, admission, expectedRound,
    admissionDurable: !!admission && admission.round === expectedRound && admission.revision === 1
      && admission.text === requestPrompt?.content });
  if (scenario.mode === 'cancel') {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"choices":[{"index":0,"delta":{"content":"等待取消"}}]}\n\n');
    return;
  }
  const count = scenario.requests.length;
  const todo = ['todo_write', { todos: [{ content: scenario.mode === 'freeze' ? 'x'.repeat(5000) : '协议夹具机械步骤', status: 'completed' }] }];
  const claim = ['update_goal', { goal_id: 'goal-1', status: 'completed' }];
  if (count % 2 === 0) { finishResponse(res); return; }
  if (scenario.mode === 'claim-only') { toolsResponse(res, [claim]); return; }
  if (scenario.mode === 'approved-write') {
    toolsResponse(res, [['write', { path: 'approved-result.txt', content: '明确审批后的真实文件结果\n' }], claim]); return;
  }
  toolsResponse(res, scenario.mode === 'complete' && count === 1 ? [todo] : [todo, claim]);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/v1/chat/completions`;
async function boot(mode) {
  const root = join(evidence, mode); mkdirSync(root);
  scenario = { mode, root, requests: [], rpc: [] };
  const env = fixtureHostEnv(root, { PATH: join(process.env.SystemRoot, 'System32'), TEMP: root, TMP: root,
    SACODE_PROVIDER_BASE_URL: url, SACODE_PROVIDER_MODEL: 'local-goal-contract' });
  bridge = new HostBridge(exe, env); await bridge.start(root);
  const request = bridge.request.bind(bridge);
  const current = scenario;
  bridge.request = async (method, params) => {
    const record = { method, start: Date.now() }; current.rpc.push(record);
    try { const result = await request(method, params); record.result = result; return result; }
    catch (error) { record.error = error.message; throw error; }
    finally { record.elapsedMs = Date.now() - record.start; }
  };
  await bridge.request('goal/create', { sessionId: 'current', objective: '本地真实 Host 目标轮次验收' });
  await bridge.request('session/append', { eventType: 'user/message', data: '验证本地协议链路' });
  return scenario;
}
async function terminal() {
  for (let i = 0; i < 600; i++) {
    const poll = await bridge.request('turn/poll');
    if (scenario.mode === 'approved-write' && !scenario.approvalAnswered) {
      const notification = bridge.notifications.find(message => message.method === 'approval/asked');
      if (notification) {
        const proposal = notification.params;
        scenario.approvalProposal = proposal;
        assert.equal(proposal.sessionId, 'current', '提案必须绑定起轮会话');
        assert.equal(proposal.source, 'model'); assert.equal(proposal.tool, 'write');
        assert.deepEqual(JSON.parse(proposal.argumentsJson), { path: 'approved-result.txt', content: '明确审批后的真实文件结果\n' }, '只有完整参数一致才允许一次');
        scenario.approvalAnswered = true;
        assert.equal((await bridge.request('approval/answer', { approvalId: proposal.approvalId, decision: 'allowed-once' })).accepted, true);
      }
    }
    if (poll.settled) {
      if (scenario.cancelStarted) {
        const elapsedMs = Date.now() - scenario.cancelStarted;
        results.push({ mode: scenario.mode, cancelElapsedMs: elapsedMs });
        assert.ok(elapsedMs < 5000, `Host 取消到终态超出 5 秒：${elapsedMs}ms`);
      }
      return poll;
    }
    await sleep(50);
  }
  throw Error('目标任务没有终态');
}
try {
  for (const mode of cases) {
    const s = await boot(mode);
    if (mode === 'budget') await bridge.request('usage/set-budget', { budget: 5 });
    if (mode === 'complete') {
      await bridge.request('queue/enqueue', { text: '排队补充一', rpcId: 'queue-1' });
      await bridge.request('queue/enqueue', { text: '排队补充二', rpcId: 'queue-2' });
    }
    const started = await bridge.request('task/start', {});
    assert.equal(started.goal, true);
    if (mode === 'cancel') {
      for (let i = 0; s.requests.length === 0 && i < 100; i++) await sleep(50);
      assert.equal(s.requests.length, 1);
      s.cancelStarted = Date.now();
      assert.equal((await bridge.request('turn/cancel')).cancelRequested, true);
    }
    if (mode === 'freeze') {
      await assert.rejects(terminal(), e => /session-durable-frozen/.test(e.message) && e.data?.leaseRetained === true);
      await assert.rejects(bridge.request('goal/describe', { sessionId: 'current' }), /session-durable-frozen/);
      await assert.rejects(bridge.request('session/projection'), /session-durable-frozen/);
      assert.equal((await bridge.request('initialize')).core, 'cangjie');
      assert.ok(!readFileSync(join(s.root, 'session.log'), 'utf8').includes('complete|'));
    } else {
      const poll = await terminal();
      const goal = await bridge.request('goal/describe', { sessionId: 'current' });
      const disk = readFileSync(join(s.root, 'session.log'), 'utf8');
      const usage = await bridge.request('usage/status');
      results.push({ mode, poll, goal, usage });
      if (mode === 'complete') {
        assert.equal(poll.finishReason, 'completed'); assert.equal(goal.phase, 'complete');
        assert.equal(goal.roundsDone, 2); assert.equal(s.requests.length, 4);
        assert.equal(usage.used, 12); assert.equal(Number(poll.usage), 12);
        assert.equal(disk.split('\n').filter(line => line.includes('\tturn/usage\t')).length, 2);
        assert.ok(s.requests[0].body.messages.some(m => m.role === 'developer' && m.content.includes('轮次：1/8')));
        assert.ok(s.requests[2].body.messages.some(m => m.role === 'developer' && m.content.includes('轮次：2/8')));
        assert.ok(s.requests[0].body.messages.some(m => m.role === 'user' && m.content === '排队补充一'));
        assert.ok(!s.requests[0].body.messages.some(m => m.role === 'user' && m.content === '排队补充二'));
        assert.ok(s.requests[2].body.messages.some(m => m.role === 'user' && m.content === '排队补充二'));
      } else if (mode === 'approved-write') {
        assert.equal(s.approvalAnswered, true);
        assert.equal(poll.finishReason, 'completed'); assert.equal(goal.phase, 'complete');
        assert.equal(goal.roundsDone, 1); assert.equal(s.requests.length, 2);
        assert.equal(readFileSync(join(s.root, 'approved-result.txt'), 'utf8'), '明确审批后的真实文件结果\n');
        const events = disk.split('\n').map(line => line.split('\t'));
        const jsonEvent = kind => events.filter(fields => fields[1] === kind).map(fields => JSON.parse(fields[2].replace(/\\([\\nrt])/g, (_, code) => ({ '\\': '\\', n: '\n', r: '\r', t: '\t' })[code])));
        assert.deepEqual(jsonEvent('goal/claim'), [{ goal_id: 'goal-1', revision: 1, round: 1, status: 'completed' }]);
        assert.deepEqual(jsonEvent('goal/evidence'), [{ revision: 1, round: 1 }]);
      } else if (mode === 'budget') {
        assert.equal(poll.finishReason, 'budget'); assert.equal(goal.blockedReason, 'goal-budget');
        assert.equal(goal.phase, 'blocked'); assert.equal(s.requests.length, 2); assert.equal(usage.over, true);
      } else if (mode === 'claim-only') {
        assert.equal(poll.finishReason, 'no-progress'); assert.equal(goal.phase, 'blocked');
        assert.equal(goal.blockedReason, 'goal-no-progress'); assert.equal(s.requests.length, 6);
        assert.ok(!disk.includes('\tgoal/evidence\t'));
      } else {
        assert.equal(poll.cancelled, true); assert.equal(poll.finishReason, 'cancelled');
        assert.equal(goal.phase, 'active'); assert.equal(s.requests.length, 1);
      }
    }
    assert.ok(s.requests.every(r => r.admissionDurable));
    writeFileSync(join(s.root, 'requests.json'), JSON.stringify(s.requests, null, 2));
    writeFileSync(join(s.root, 'rpc.json'), JSON.stringify(s.rpc, null, 2));
    writeFileSync(join(s.root, 'approval-proposal.json'), JSON.stringify(s.approvalProposal ?? null, null, 2));
    assert.equal((await bridge.stop()).code, 0); bridge = null;
    const requestsBefore = s.requests.length;
    bridge = new HostBridge(exe, fixtureHostEnv(s.root, { PATH: join(process.env.SystemRoot, 'System32'), TEMP: s.root, TMP: s.root,
      SACODE_PROVIDER_BASE_URL: url, SACODE_PROVIDER_MODEL: 'local-goal-contract' }));
    await bridge.start(s.root);
    await bridge.request('goal/describe', { sessionId: 'current' }); await sleep(200);
    assert.equal(s.requests.length, requestsBefore, '恢复读取不应发模型请求');
    assert.equal((await bridge.stop()).code, 0); bridge = null;
    results.push({ mode, requests: requestsBefore, recoveryDidNotExecute: true, passed: true });
  }
  console.log('GOAL_HOST_PASS：' + cases.join(', '));
} finally {
  if (bridge) await bridge.stop();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  if (scenario) {
    writeFileSync(join(scenario.root, 'requests.json'), JSON.stringify(scenario.requests, null, 2));
    writeFileSync(join(scenario.root, 'rpc.json'), JSON.stringify(scenario.rpc, null, 2));
  }
  writeFileSync(join(evidence, 'results.json'), JSON.stringify(results, null, 2));
  console.log('GOAL_HOST_EVIDENCE=' + evidence);
}
