import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fixtureHostEnv } from './fixture-env.mjs';
const exe = resolve(process.env.SACODE_CLI || '');
assert.ok(process.env.SACODE_CLI && existsSync(exe), '必须指定本轮新 CLI');
const evidence = mkdtempSync(resolve('apps/desktop/.tmp-test/goal-cli-proof-'));
const results = []; let scenario;
const server = createServer(async (req, res) => {
  try {
    let text = ''; for await (const b of req) text += b;
    const body = JSON.parse(text);
    const disk = readFileSync(join(scenario.root, 'session.log'), 'utf8');
    const decode = value => value.replace(/\\([\\nrt])/g, (_, code) => ({ '\\': '\\', n: '\n', r: '\r', t: '\t' })[code]);
    const admissions = disk.split('\n').map(line => line.split('\t')).filter(fields => fields[1] === 'goal/round-prompt').map(fields => JSON.parse(decode(fields[2])));
    const expectedRound = Math.floor(scenario.requests.length / 2) + 1;
    const prompt = body.messages.filter(message => message.role === 'developer' && message.content.includes('<goal_round>')).at(-1);
    assert.equal(admissions.at(-1)?.round, expectedRound, '请求必须绑定当前轮次的持久准入');
    assert.equal(admissions.at(-1)?.revision, 1);
    assert.equal(admissions.at(-1)?.text, prompt?.content);
    scenario.requests.push(body);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (scenario.requests.length % 2 === 0) {
      res.end('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"total_tokens":3}}\n\ndata: [DONE]\n\n'); return;
    }
    const calls = [['update_goal', { goal_id: 'goal-1', status: 'completed' }]];
    if (scenario.mode === 'complete' || scenario.mode === 'budget') calls.unshift(['todo_write', { todos: [{ content: 'CLI 协议夹具步骤', status: 'completed' }] }]);
    if (scenario.mode === 'freeze') calls.unshift(['todo_write', { todos: [{ content: 'x'.repeat(5000), status: 'completed' }] }]);
    if (scenario.mode === 'denied-write') calls.unshift(['write', { path: 'must-not-exist.txt', content: '无人审批不得写入' }]);
    if (scenario.mode === 'approved-write') calls.unshift(['write', { path: 'approved-result.txt', content: '明确审批后的真实文件结果\n' }]);
    res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: calls.map(([name, args], index) => ({ index, id: `cli-${scenario.requests.length}-${index}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })) } }] })}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"total_tokens":3}}\n\ndata: [DONE]\n\n`);
  } catch (e) { scenario.serverFailure = e.stack; res.destroy(e); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/v1/chat/completions`;
async function run(args, root, configured = true) {
    const approveWrite = scenario.mode === 'approved-write' && args[1] === 'run';
    const child = spawn(exe, args, { cwd: root, windowsHide: true, stdio: [approveWrite ? 'pipe' : 'ignore', 'pipe', 'pipe'], env: fixtureHostEnv(root, {
    PATH: join(process.env.SystemRoot, 'System32'), TMP: root, TEMP: root,
    SACODE_PROVIDER_BASE_URL: configured ? url : '', SACODE_PROVIDER_MODEL: configured ? 'local-cli-goal' : ''
  }) });
    let stdout = '', stderr = '', approvalFailure; let approvalAnswered = false;
    child.stdout.on('data', b => stdout += b);
    child.stderr.on('data', b => {
      stderr += b;
      if (approveWrite && !approvalAnswered && stderr.includes('允许一次？[y/N]')) {
        approvalAnswered = true;
        try {
          const proposal = stderr.split('\n').find(line => line.startsWith('approval\t'))?.trim().split('\t');
          assert.ok(proposal && proposal.length === 4, '必须看到完整、明确的审批提案');
          assert.equal(proposal[2], 'write');
          assert.deepEqual(JSON.parse(proposal[3]), { path: 'approved-result.txt', content: '明确审批后的真实文件结果\n' });
          child.stdin.end('y\n');
        } catch (error) { approvalFailure = error.stack; child.stdin.end('n\n'); }
      }
    });
  let killed = false;
  const timer = setTimeout(() => { killed = true; child.kill(); }, 90000);
  try { return await new Promise((resolve, reject) => {
    child.on('error', reject); child.on('exit', (code, signal) => resolve({ code, signal, stdout, stderr, killed, approvalAnswered, approvalFailure }));
  }); } finally { clearTimeout(timer); }
}
try {
  for (const mode of ['complete', 'approved-write', 'budget', 'claim-only', 'denied-write', 'freeze', 'missing-provider', 'invalid-budget']) {
    const root = join(evidence, mode); mkdirSync(root); scenario = { root, mode, requests: [] };
    const runResult = await run(['goal', 'run', '验证 CLI 真实轮次', ...(mode === 'budget' ? ['--budget', '5'] : mode === 'invalid-budget' ? ['--budget', '0'] : [])], root, mode !== 'missing-provider');
    writeFileSync(join(root, 'run.json'), JSON.stringify({ ...runResult, requests: scenario.requests, serverFailure: scenario.serverFailure }, null, 2));
    assert.equal(runResult.killed, false); assert.equal(scenario.serverFailure, undefined); assert.equal(runResult.approvalFailure, undefined);
    if (mode === 'missing-provider' || mode === 'invalid-budget') {
      assert.equal(runResult.code, mode === 'missing-provider' ? 69 : 64); assert.equal(existsSync(join(root, 'session.log')), false);
    } else {
      assert.equal(runResult.code, mode === 'complete' || mode === 'approved-write' ? 0 : 1);
      const read = await run(['goal', 'describe'], root); assert.equal(read.code, 0);
      const projection = JSON.parse(read.stdout.trim());
      assert.equal(projection.phase, mode === 'complete' || mode === 'approved-write' ? 'complete' : mode === 'freeze' ? 'active' : 'blocked');
      if (mode === 'claim-only' || mode === 'denied-write') assert.equal(projection.blockedReason, 'goal-no-progress');
      if (mode === 'budget') assert.equal(projection.blockedReason, 'goal-budget');
      assert.equal(scenario.requests.length, mode === 'claim-only' || mode === 'denied-write' ? 6 : 2, 'describe 不能恢复执行');
      if (mode === 'denied-write') assert.equal(existsSync(join(root, 'must-not-exist.txt')), false, '无人审批不能产生文件副作用');
      if (mode === 'approved-write') {
        assert.equal(runResult.approvalAnswered, true, '必须实际消费一次精确审批');
        assert.equal(readFileSync(join(root, 'approved-result.txt'), 'utf8'), '明确审批后的真实文件结果\n');
        const events = readFileSync(join(root, 'session.log'), 'utf8').split('\n').map(line => line.split('\t'));
        const jsonEvent = kind => events.filter(fields => fields[1] === kind).map(fields => JSON.parse(fields[2].replace(/\\([\\nrt])/g, (_, code) => ({ '\\': '\\', n: '\n', r: '\r', t: '\t' })[code])));
        assert.equal(events.filter(fields => fields[1] === 'approval/asked').length, 1);
        assert.deepEqual(events.filter(fields => fields[1] === 'approval/decided').map(fields => fields[2]), ['1:allowed-once']);
        assert.deepEqual(jsonEvent('goal/claim'), [{ goal_id: 'goal-1', revision: 1, round: 1, status: 'completed' }]);
        assert.deepEqual(jsonEvent('goal/evidence'), [{ revision: 1, round: 1 }]);
      }
      if (projection.phase === 'blocked') {
        const before = scenario.requests.length;
        const rejected = await run(['goal', 'run', '不允许覆盖受阻目标'], root);
        assert.equal(rejected.code, 1); assert.match(rejected.stderr, /goal-already-exists/);
        assert.equal(scenario.requests.length, before);
      }
      if (mode === 'freeze') assert.match(runResult.stderr, /session-durable-frozen.*lease-retained/);
      assert.equal(existsSync(join(root, 'session.log.lease')), mode === 'freeze');
      writeFileSync(join(root, 'describe.json'), JSON.stringify(read, null, 2));
    }
    results.push({ mode, passed: true });
  }
  console.log('GOAL_CLI_PASS');
} finally {
  server.closeAllConnections(); await new Promise(r => server.close(r));
  writeFileSync(join(evidence, 'results.json'), JSON.stringify(results, null, 2));
  console.log('GOAL_CLI_EVIDENCE=' + evidence);
}
