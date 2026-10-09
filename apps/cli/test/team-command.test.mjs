import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exe = path.resolve(process.env.SACODE_CLI || fileURLToPath(new URL('../target/release/bin/main.exe', import.meta.url)));
const env = { ...process.env };
const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH';
env[pathKey] = [process.env.SACODE_STDX_DLL_DIR || 'C:/Users/jingg/stdx-work/stdx-1.1.3.1/windows_x86_64_cjnative/dynamic/stdx', process.env.SACODE_RUNTIME_DLL_DIR || 'D:/Program Files/HuaWei/Cangjie/runtime/lib/windows_x86_64_cjnative', env[pathKey]].join(path.delimiter);
env.http_proxy = env.HTTP_PROXY = 'http://127.0.0.1:1';

async function run(args) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'sacode-team-cli-'));
  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(exe, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('真实 CLI 超时')); }, 12000);
      child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
      child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
    });
    assert.equal(result.signal, null, result.stderr);
    assert.deepEqual(await readdir(cwd), [], '团队远程命令不得创建本地状态或日志');
    return result;
  } finally { await rm(cwd, { recursive: true, force: true }); }
}

// 这里只控制 HTTP 传输边界；不模拟团队业务，也不证明 daemon 已接入团队运行时。
async function boundary(response, body) {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    seen.push({ method: req.method, url: req.url, type: req.headers['content-type'], json: JSON.parse(text) });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { return await body(String(server.address().port), seen); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

const session = 'sessions/团队甲';
const text = '中文 "引号"\\路径\n下一行\t制表';
const cases = [
  ['describe', 'team/describe', [], {}],
  ['member-create', 'team/member/create', ['--name', '成员甲', '--role', 'worker'], { name: '成员甲', role: 'worker' }],
  ['message-send', 'team/message/send', ['--target', 'member-1', '--text', text], { target: 'member-1', text }],
  ['message-broadcast', 'team/message/broadcast', ['--text', text], { text }],
  ['task-create', 'team/task/create', ['--title', text], { title: text, dependencies: [] }],
  ['task-create', 'team/task/create', ['--title', '任务乙', '--dependencies', '["task-1","任务甲"]'], { title: '任务乙', dependencies: ['task-1', '任务甲'] }],
  ['task-assign', 'team/task/assign', ['--task-id', 'task-1', '--member-id', 'member-1'], { taskId: 'task-1', memberId: 'member-1' }],
  ['task-claim', 'team/task/claim', ['--task-id', 'task-1'], { taskId: 'task-1' }],
  ['task-complete', 'team/task/complete', ['--task-id', 'task-1', '--result', text], { taskId: 'task-1', result: text }],
  ['member-stop', 'team/member/stop', ['--member-id', 'member-1'], { memberId: 'member-1' }],
];
for (const [command, method, flags, params] of cases) {
  test(`真实 CLI 映射 ${command} ${JSON.stringify(flags)}`, async () => {
    const response = { jsonrpc: '2.0', id: 1, result: { transportOnly: true, text } };
    await boundary(response, async (port, seen) => {
      const result = await run(['team', command, '--remote', port, '--session', session, ...flags]);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stderr, '');
      assert.deepEqual(JSON.parse(result.stdout), response);
      assert.deepEqual(seen, [{ method: 'POST', url: '/rpc', type: 'application/json', json: { jsonrpc: '2.0', id: 1, method, params: { teamSessionId: session, ...params } } }]);
    });
  });
}

test('daemon 尚未接线时保留真实 method-not-found 并退出1', async () => {
  const response = { jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'method not found', data: { method: 'team/describe' } } };
  await boundary(response, async (port, seen) => {
    const result = await run(['team', 'describe', '--remote', port, '--session', session]);
    assert.equal(result.code, 1, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), response);
    assert.match(result.stderr, /remote-rpc-error/);
    assert.match(result.stderr, /接线未完成/);
    assert.equal(seen.length, 1, '不重试、不回退本地');
  });
});

test('服务端身份拒绝原样透传，不自造成功', async () => {
  const response = { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'team-leader-required' } };
  await boundary(response, async (port, seen) => {
    const result = await run(['team', 'task-claim', '--remote', port, '--session', session, '--task-id', 'task-1']);
    assert.equal(result.code, 1);
    assert.deepEqual(JSON.parse(result.stdout), response);
    assert.deepEqual(seen[0].json.params, { teamSessionId: session, taskId: 'task-1' });
  });
});

const invalid = [
  [], ['describe'], ['unknown', '--remote', '80', '--session', session],
  ['describe', '--remote', '0', '--session', session], ['describe', '--remote', '65536', '--session', session],
  ['describe', '--remote', '+80', '--session', session], ['describe', '--remote', 'abc', '--session', session],
  ['describe', '--remote', '80'], ['describe', '--remote', '80', '--session', ' '],
  ['describe', '--remote', '80', '--session', session, '--remote', '81'],
  ['describe', '--remote', '80', '--session', session, '--session', 'other'],
  ['describe', '--remote', '80', '--session', session, '--actor-session-id', 'self'],
  ['describe', '--remote', '80', '--session', session, '--actor', 'self'],
  ['describe', '--remote', '80', '--session', session, '--name', '多余字段'],
  ['member-create', '--remote', '80', '--session', session, '--name', '甲'],
  ['message-send', '--remote', '80', '--session', session, '--target', '甲', '--text', ''],
  ['task-create', '--remote', '80', '--session', session, '--title', '任务', '--dependencies', 'null'],
  ['task-create', '--remote', '80', '--session', session, '--title', '任务', '--dependencies', '[1]'],
  ['task-create', '--remote', '80', '--session', session, '--title', '任务', '--dependencies', '[" "]'],
  ['task-create', '--remote', '80', '--session', session, '--title', '任务', '--dependencies', '{broken'],
  ['task-complete', '--remote', '80', '--session', session, '--task-id', 't'],
  ['member-stop', '--remote', '80', '--session', session, '--member-id'],
];
for (const args of invalid) test(`非法团队参数拒绝64 ${JSON.stringify(args)}`, async () => {
  const result = await run(['team', ...args]);
  assert.equal(result.code, 64, result.stderr);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /sacode team/);
});

test('参数非法时不发 HTTP 请求', async () => {
  await boundary({}, async (port, seen) => {
    const result = await run(['team', 'describe', '--remote', port, '--session', session, '--actorSessionId', 'self']);
    assert.equal(result.code, 64);
    assert.deepEqual(seen, []);
  });
});

test('网络失败退出1且不回退本地', async () => {
  let closedPort;
  await boundary({}, async port => { closedPort = port; });
  const result = await run(['team', 'describe', '--remote', closedPort, '--session', session]);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /remote/);
});
