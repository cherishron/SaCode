import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// 宿主 exe 必须与依赖 DLL 同目录（仓颉构建目录 target/release/bin 里没有 DLL），
// 所以默认取 pack-host 产出的 dev 态宿主；SACODE_HOST 可指到别处或红灯旧宿主。
const host = resolve(process.env.SACODE_HOST || join(here, '../../desktop/dist/host/bin/sacode-host.exe'));
const methods = ['worktree/enter', 'worktree/describe', 'worktree/exit', 'worktree/agent-prepare', 'worktree/agent-finish', 'worktree/cleanup'];
// 冻结契约的 describe 字段集：恰好这 8 个，Host 透传、不改名。
const describeFields = ['active', 'name', 'directory', 'originalDirectory', 'branch', 'dirty', 'uncommittedCount', 'uniqueCommits'];
const nap = (ms) => new Promise(r => setTimeout(r, ms));
// Windows 下规范目录写法与 Node 的 cwd 写法在盘符大小与分隔符上会分叉，比较前归一。
const norm = (p) => resolve(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim();
}
function client(cwd, extraEnv = {}) {
  const child = spawn(host, [], { cwd, env: { ...process.env,
    SACODE_USER_SETTINGS_DIR: join(cwd, 'settings'), SACODE_PROVIDER_BASE_URL: '',
    SACODE_PROVIDER_MODEL: '', SACODE_PROVIDER_KEY: '', STEPFUN_API_KEY: '', ...extraEnv }, stdio: ['pipe', 'pipe', 'pipe'] });
  let seq = 0, diagnostic = '';
  const pending = new Map();
  const notices = [];
  child.stderr.on('data', data => { diagnostic += data; });
  const fail = error => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); } pending.clear(); };
  child.on('error', fail);
  child.on('exit', code => fail(new Error(`宿主退出 ${code}: ${diagnostic}`)));
  createInterface({ input: child.stdout }).on('line', line => {
    try {
      const frame = JSON.parse(line);
      // 无 id 的是通知帧（模型侧审批工单就在这里出来），不能当协议噪声丢掉。
      if (!('id' in frame)) { notices.push(frame); return; }
      const entry = pending.get(frame.id);
      if (!entry) return;
      pending.delete(frame.id); clearTimeout(entry.timer);
      if (frame.error) entry.reject(Object.assign(new Error(frame.error.message), { code: frame.error.code }));
      else entry.resolve(frame.result);
    } catch (error) { fail(error); }
  });
  return {
    request(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++seq;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`协议超时 ${method}: ${diagnostic}`)); }, 10000);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      });
    },
    // 取走并清空已到达的 approval/asked 通知（模型侧发起的工单）。
    takeApprovals() {
      const hits = notices.filter(f => f.method === 'approval/asked');
      notices.splice(0, notices.length, ...notices.filter(f => f.method !== 'approval/asked'));
      return hits;
    },
    async stop() {
      if (child.exitCode !== null) return;
      await new Promise(resolve => {
        const timer = setTimeout(() => child.kill(), 3000);
        child.once('exit', () => { clearTimeout(timer); resolve(); }); child.stdin.end();
      });
    }
  };
}
async function fixture(t, extraEnv = {}) {
  assert.ok(existsSync(host), `需要本树新宿主，或 SACODE_HOST 显式指定红灯旧宿主：${host}`);
  const root = mkdtempSync(join(here, 'worktree-fixture-'));
  const repo = join(root, '中文 项目'), state = join(root, 'state');
  mkdirSync(repo); mkdirSync(state);
  git(repo, 'init', '-b', 'main');
  writeFileSync(join(repo, 'tracked.txt'), '原目录\n');
  // 工作树根就落在主检出的 .sacode/worktrees 下：不忽略它，「成员改动不污染主检出」
  // 这条断言会因为 .sacode/ 本身是未跟踪目录而永远为假。
  writeFileSync(join(repo, '.gitignore'), '.sacode/\n');
  git(repo, 'add', 'tracked.txt', '.gitignore');
  git(repo, '-c', 'user.name=协议夹具', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', '协议夹具初始提交');
  // 宿主以 state 为 cwd：Windows 下活着的进程会锁住那个目录，rmSync 直接失败并让
  // 整个 run 挂在退出阶段。所以所有客户端都由这里统一登记，收尾时先停全部再删根。
  const clients = [];
  const track = (c) => { clients.push(c); return c; };
  const rpc = track(client(state, extraEnv));
  t.after(async () => { for (const c of clients) { await c.stop(); } rmSync(root, { recursive: true, force: true }); });
  await rpc.request('initialize');
  await rpc.request('workspace/set-directory', { directory: repo });
  return { root, repo, state, rpc, track };
}
async function enter(rpc, params = { name: 'protocol' }) {
  const result = await rpc.request('worktree/enter', params);
  assert.equal(typeof result.directory, 'string');
  assert.ok(existsSync(result.directory));
  return result.directory;
}
// 本地 SSE 夹具：第一轮点名一个模型工具，第二轮把工具结果原样回声成正文。
// 断言权在夹具侧——请求体里看不见那条 tool 消息就是没执行。
async function startProvider(t, toolName, toolArgs) {
  const seen = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    seen.push(body);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const event = value => res.write('data: ' + JSON.stringify(value) + '\n\n');
    if (seen.length === 1) {
      event({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-worktree-cwd', function: { name: toolName, arguments: toolArgs } }] } }] });
      event({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
      res.end('data: [DONE]\n\n');
      return;
    }
    const echo = body.messages.filter(m => m.role === 'tool').map(m => String(m.content)).join('\n');
    event({ choices: [{ index: 0, delta: { content: echo } }] });
    event({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    res.end('data: [DONE]\n\n');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { port: server.address().port, seen };
}
// 跑一整轮并把模型侧发起的工单按 allowed-once 结算，返回 turn/poll 的终态。
async function runTurn(rpc) {
  await rpc.request('session/submit', { eventType: 'user/message', data: '报一下当前工作目录' });
  const start = await rpc.request('turn/start');
  assert.equal(start.provider, 'real', '配了本地 provider 就必须走真实模型路径');
  for (let i = 0; i < 400; i++) {
    for (const note of rpc.takeApprovals()) {
      await rpc.request('approval/answer', { approvalId: note.params.approvalId, decision: 'allowed-once' });
    }
    const result = await rpc.request('turn/poll');
    if (result.settled) {
      assert.equal(result.interrupted, false);
      return result;
    }
    await nap(10);
  }
  throw new Error('turn 未在期限内结算');
}
async function modelShellCwd(rpc, state) {
  const result = await runTurn(rpc);
  assert.ok(!result.text.includes('unregistered-tool'), `模型面未登记 run_code：${result.text}`);
  assert.ok(!result.text.includes('io-error'), `PTC 执行失败：${result.text}`);
  assert.ok(!norm(result.text).startsWith(norm(state)), `工具仍落在宿主状态目录：${result.text}`);
  return result.text;
}
// provider 必须在宿主起来之前就配好，所以这两个用例先开夹具服务再开 fixture：
// t.after 按登记顺序执行，服务器先关、宿主再停、最后才删根目录——反过来的话
// 宿主还占着 state 目录，rmSync 失败会让整个 run 挂在退出阶段。
async function providerFixture(t) {
  const provider = await startProvider(t, 'run_code', JSON.stringify({ code: 'process.stdout.write(process.cwd())' }));
  return fixture(t, {
    SACODE_PROVIDER_BASE_URL: `http://127.0.0.1:${provider.port}`,
    SACODE_PROVIDER_MODEL: 'cwd-fixture',
    SACODE_PROVIDER_KEY: 'fixture-only'
  });
}

test('initialize 登记全部 Worktree 产品方法', async t => {
  const { rpc } = await fixture(t);
  const response = await rpc.request('initialize');
  for (const method of methods) assert.ok(response.capabilities.includes(method), `缺少能力 ${method}`);
});
test('真实 Git worktree 创建及相对工具 cwd 不污染原项目和宿主状态目录', async t => {
  const { rpc, repo, state } = await fixture(t);
  const directory = await enter(rpc);
  assert.notEqual(resolve(directory), resolve(repo));
  assert.equal(resolve(git(directory, 'rev-parse', '--show-toplevel')), resolve(directory));
  assert.equal(resolve((await rpc.request('workspace/get')).directory), resolve(directory));
  const ticket = await rpc.request('approval/ask', { name: 'write' });
  await rpc.request('approval/answer', { approvalId: ticket.approvalId, decision: 'allowed-once' });
  await rpc.request('extension/call', { name: 'write', args: 'isolated.txt 隔离正文', approvalId: ticket.approvalId });
  assert.equal(readFileSync(join(directory, 'isolated.txt'), 'utf8'), '隔离正文');
  assert.equal(existsSync(join(repo, 'isolated.txt')), false);
  assert.equal(existsSync(join(state, 'isolated.txt')), false);
  assert.equal(git(repo, 'status', '--porcelain'), '');
});
test('keep 恢复原目录且保留隔离修改', async t => {
  const { rpc, repo } = await fixture(t);
  const directory = await enter(rpc);
  writeFileSync(join(directory, 'local.txt'), '保留');
  await rpc.request('worktree/exit', { action: 'keep', discardChanges: false });
  assert.equal(resolve((await rpc.request('workspace/get')).directory), resolve(repo));
  assert.equal(readFileSync(join(directory, 'local.txt'), 'utf8'), '保留');
});
test('remove 拒绝脏目录，显式 discard 后删除并恢复目录', async t => {
  const { rpc, repo } = await fixture(t);
  const directory = await enter(rpc);
  assert.equal((await rpc.request('worktree/describe')).dirty, false, '新工作树不该被报成脏');
  writeFileSync(join(directory, 'dirty.txt'), '未提交');
  const dirty = await rpc.request('worktree/describe');
  assert.equal(dirty.dirty, true);
  assert.ok(dirty.uncommittedCount >= 1, '未提交计数必须把脏文件算进去');
  // 拒绝的「为什么」由上面两条 describe 状态字段钉住；协议面这里只钉「是核心拒的」
  // 而不是「话没说对」——核心那句原话的用词归核心用例管。
  await assert.rejects(rpc.request('worktree/exit', { action: 'remove', discardChanges: false }), error => error.code === -32003);
  assert.ok(existsSync(directory));
  assert.equal(resolve((await rpc.request('workspace/get')).directory), resolve(directory));
  // 退出帧就是核心 describe() 原文：字段集与 describe 同一套，不另造返回形状。
  const removed = await rpc.request('worktree/exit', { action: 'remove', discardChanges: true });
  assert.deepEqual(Object.keys(removed).sort(), [...describeFields].sort(), 'exit 的返回必须仍是那 8 个字段的投影');
  assert.equal(removed.active, false);
  assert.equal(existsSync(directory), false);
  assert.equal(resolve((await rpc.request('workspace/get')).directory), resolve(repo));
  assert.equal((await rpc.request('worktree/describe')).active, false);
});
test('remove 即使 discard 也拒绝独有提交', async t => {
  const { rpc } = await fixture(t);
  const directory = await enter(rpc);
  writeFileSync(join(directory, 'unique.txt'), '独有提交');
  git(directory, 'add', 'unique.txt');
  git(directory, '-c', 'user.name=协议夹具', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', '隔离分支独有提交');
  assert.ok((await rpc.request('worktree/describe')).uniqueCommits >= 1, '独有提交必须被计数');
  await assert.rejects(rpc.request('worktree/exit', { action: 'remove', discardChanges: true }), error => error.code === -32003);
  assert.ok(existsSync(directory));
});
test('describe 字段集恰好是冻结契约那 8 个且逐字段与盘上一致', async t => {
  const { rpc, repo } = await fixture(t);
  const idle = await rpc.request('worktree/describe');
  assert.deepEqual(Object.keys(idle).sort(), [...describeFields].sort(), 'describe 字段集不得增删或改名');
  assert.equal(idle.active, false);
  // 名称只允许字母、数字、. _ -（Global Constraints），所以这里不能用中文 slug。
  const name = 'frozen-fields';
  const directory = await enter(rpc, { name });
  const bound = await rpc.request('worktree/describe');
  assert.deepEqual(Object.keys(bound).sort(), [...describeFields].sort(), 'describe 字段集不得增删或改名');
  assert.equal(bound.active, true);
  assert.equal(bound.name, name);
  assert.equal(norm(bound.directory), norm(directory));
  assert.equal(norm(bound.originalDirectory), norm(repo));
  assert.equal(bound.branch, `worktree-${name}`);
  assert.equal(typeof bound.dirty, 'boolean');
  assert.equal(typeof bound.uncommittedCount, 'number');
  assert.equal(typeof bound.uniqueCommits, 'number');
});
test('会话只绑普通目录时模型面 PTC 工具跟随会话工作目录而不是宿主状态目录', { timeout: 90000 }, async t => {
  const { rpc, repo, state } = await providerFixture(t);
  const cwd = await modelShellCwd(rpc, state);
  assert.equal(norm(cwd), norm(repo), `模型工具的工作目录必须等于会话有效目录，实际：${cwd}`);
});
test('进入 worktree 后模型面工具的工作目录跟着切进隔离目录', { timeout: 90000 }, async t => {
  const { rpc, repo, state } = await providerFixture(t);
  const directory = await enter(rpc);
  assert.notEqual(norm(directory), norm(repo));
  const cwd = await modelShellCwd(rpc, state);
  assert.equal(norm(cwd), norm(directory), `进入工作树后模型工具仍在旧目录，实际：${cwd}`);
});
test('重启从日志恢复 active worktree，禁止 workspace 另绑目录', async t => {
  const { rpc, repo, state, track } = await fixture(t);
  const directory = await enter(rpc);
  const before = await rpc.request('worktree/describe');
  await rpc.stop();
  const restarted = track(client(state));
  await restarted.request('initialize');
  assert.deepEqual(await restarted.request('worktree/describe'), before);
  assert.equal(resolve((await restarted.request('workspace/get')).directory), resolve(directory));
  await assert.rejects(restarted.request('workspace/set-directory', { directory: repo }), /worktree-active/);
});
test('活动 worktree 存在时 workspace/set-directory 一律被拒', async t => {
  const { rpc, repo, root } = await fixture(t);
  const directory = await enter(rpc);
  const other = join(root, '另一个目录');
  mkdirSync(other);
  await assert.rejects(rpc.request('workspace/set-directory', { directory: other }), /worktree-active/);
  // 绑定与实际目录只能有一个真源：被拒之后仍在原工作树里。
  assert.equal(resolve((await rpc.request('workspace/get')).directory), resolve(directory));
  await rpc.request('worktree/exit', { action: 'keep', discardChanges: false });
  assert.equal(resolve((await rpc.request('workspace/get')).directory), resolve(repo));
  await rpc.request('workspace/set-directory', { directory: other });
  assert.equal(resolve((await rpc.request('workspace/get')).directory), resolve(other));
});
test('enter 的 name 与 reference 二选一，reference 缺 origin 时不建目录也不留绑定', async t => {
  const { rpc, root } = await fixture(t);
  const directory = await enter(rpc, { name: '' });
  const slug = directory.split(/[\\/]/).pop();
  assert.match(slug, /^[a-z]+-[a-z]+-[0-9a-f]{6}$/, `自动生成的名称须形如 <形容词>-<名词>-<6hex>，实际：${slug}`);
  assert.ok(norm(directory).includes(norm(join(root, '中文 项目', '.sacode', 'worktrees'))), `目录必须固定在 .sacode/worktrees 下：${directory}`);
  await rpc.request('worktree/exit', { action: 'keep', discardChanges: false });
  await assert.rejects(rpc.request('worktree/enter', { reference: '17' }), error => error.code === -32003);
  assert.equal((await rpc.request('worktree/describe')).active, false, 'PR 入口失败不能留下活动绑定');
  assert.equal(existsSync(join(root, '.sacode', 'worktrees', '17')), false);
});
test('agent 生命周期：prepare 只登记目录不当执行器，finish 收束干净目录，cleanup 不动年轻目录', async t => {
  const { rpc, root } = await fixture(t);
  const prepared = await rpc.request('worktree/agent-prepare', { agentId: 'alpha' });
  assert.equal(prepared.executorStarted, false, '登记目录不等于子代理执行器已启动');
  assert.ok(existsSync(prepared.directory));
  const finished = await rpc.request('worktree/agent-finish', { agentId: 'alpha' });
  assert.equal(finished.agentId, 'alpha');
  assert.equal(finished.retained, false, '干净的代理目录不该被留住');
  assert.equal(finished.removed, true, '收束必须给出移除事实');
  assert.equal(existsSync(prepared.directory), false, '干净的代理目录必须被收束');
  const kept = await rpc.request('worktree/agent-prepare', { agentId: 'beta' });
  const cleaned = await rpc.request('worktree/cleanup');
  assert.equal(typeof cleaned.cleaned, 'number');
  assert.equal(cleaned.cleaned, 0, '未满 30 天的代理目录不得被过期清理带走');
  assert.ok(existsSync(kept.directory));
  assert.equal(resolve((await rpc.request('workspace/get')).directory), resolve(root, '中文 项目'));
});
test('参数二选一及布尔类型拒绝，待审批不允许切换或 agent 生命周期写入', async t => {
  const { rpc } = await fixture(t);
  for (const params of [{}, { name: 'a', reference: '1' }, { name: 1 }]) {
    await assert.rejects(rpc.request('worktree/enter', params), error => error.code === -32602);
  }
  await assert.rejects(rpc.request('worktree/exit', { action: 'remove', discardChanges: 'true' }), error => error.code === -32602);
  await assert.rejects(rpc.request('worktree/exit', { action: 'delete', discardChanges: false }), error => error.code === -32602);
  const ticket = await rpc.request('approval/ask', { name: 'write' });
  for (const method of methods.filter(method => method !== 'worktree/describe')) {
    await assert.rejects(rpc.request(method, { name: 'blocked', action: 'keep', agentId: 'child' }), /session-resources-in-flight/);
  }
  await rpc.request('approval/answer', { approvalId: ticket.approvalId, decision: 'denied' });
});
