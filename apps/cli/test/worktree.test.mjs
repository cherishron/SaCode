import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// CLI 侧 worktree 交付面：--worktree 四种形态、worktree 子命令、remote 只透传、路径型参数按启动 cwd 冻结。
// 生命周期本身归 core（SessionWorktree），这里只证「入口这一层」的契约：形态、退出码、
// 目录归属、跨进程恢复与「绝不在本地建目录」的 remote 语义。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const cli = process.env.SACODE_CLI || path.join(root, 'apps/cli/target/release/bin/main.exe');
const env = { ...process.env };
const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'PATH';
env[pathKey] = [process.env.SACODE_STDX_DLL_DIR || 'C:/Users/jingg/stdx-work/stdx-1.1.3.1/windows_x86_64_cjnative/dynamic/stdx', process.env.SACODE_RUNTIME_DLL_DIR || 'D:/Program Files/HuaWei/Cangjie/runtime/lib/windows_x86_64_cjnative', env[pathKey]].join(path.delimiter);

function childRun(command, args, cwd, extra = {}) {
  const child = spawn(command, args, { cwd, env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', b => { stdout += b; });
  child.stderr.on('data', b => { stderr += b; });
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`进程超时：${args.join(' ')}\n${stderr}`)); }, 30000);
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
  return { child, done, output: () => ({ stdout, stderr }) };
}

async function temporary(body) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'sacode-worktree-'));
  try { return await body(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) { throw new Error(`git ${args.join(' ')} 失败：${r.stderr}`); }
  return (r.stdout || '').trim();
}

// 独立 Git 仓库夹具：与核心夹具同形（.sacode/ 进 .gitignore，工作树目录不污染父检出）。
async function gitRepo(body) {
  return temporary(async cwd => {
    git(cwd, 'init', '-b', 'main');
    git(cwd, 'config', 'user.name', '夹具');
    git(cwd, 'config', 'user.email', 'fixture@example.invalid');
    await writeFile(path.join(cwd, 'seed'), 'seed');
    await writeFile(path.join(cwd, '.gitignore'), '.sacode/\nignored\n');
    git(cwd, 'add', '.');
    git(cwd, 'commit', '-m', '初始夹具');
    return body(cwd);
  });
}

async function existsFile(p) {
  try { await stat(p); return true; } catch { return false; }
}
async function worktreeNames(repo) {
  const dir = path.join(repo, '.sacode', 'worktrees');
  if (!(await existsFile(dir))) { return []; }
  return (await readdir(dir)).sort();
}

// 远端 RPC 夹具：只记账收到的帧，供「只透传、不建本地目录」断言。
async function httpFixture(handler, body) {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    let text = ''; for await (const b of req) text += b;
    const request = JSON.parse(text); seen.push(request);
    const result = handler ? handler(request) : null;
    if (result && result.__error) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: result.__error }));
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      jsonrpc: '2.0', id: request.id,
      result: request.method === 'session/catalog'
        ? { entries: [{ id: 'current', current: true }] }
        : (result ?? { saved: true, sessionId: request.params.sessionId, directory: '远端目录' }),
    }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try { await body(String(server.address().port), seen); }
  finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
}

// —— 冻结契约的 worktree describe() 字段集，恰好这 8 个，任何一面不得增删或改名 ——
const DESCRIBE_FIELDS = ['active', 'branch', 'directory', 'dirty', 'name', 'originalDirectory', 'uncommittedCount', 'uniqueCommits'];

// ============ A. remote 通道：只透传，绝不在本地建目录 ============

const remoteForms = [
  [['worktree', 'enter'], 'worktree/enter', { name: '' }],
  [['worktree', 'enter', 'fix-branch'], 'worktree/enter', { name: 'fix-branch' }],
  [['worktree', 'enter', '4174'], 'worktree/enter', { reference: '4174' }],
  [['worktree', 'enter', '#4174'], 'worktree/enter', { reference: '4174' }],
  [['worktree', 'enter', 'https://github.com/org/repo/pull/7'], 'worktree/enter', { reference: 'https://github.com/org/repo/pull/7' }],
  [['worktree', 'describe'], 'worktree/describe', {}],
  [['worktree', 'exit', 'keep'], 'worktree/exit', { action: 'keep', discardChanges: false }],
  [['worktree', 'exit', 'remove', '--discard-changes'], 'worktree/exit', { action: 'remove', discardChanges: true }],
  [['worktree', 'agent-prepare', 'worker-1'], 'worktree/agent-prepare', { agentId: 'worker-1' }],
  [['worktree', 'agent-finish', 'worker-1'], 'worktree/agent-finish', { agentId: 'worker-1' }],
  [['worktree', 'cleanup'], 'worktree/cleanup', {}],
];
for (const [args, method, fields] of remoteForms) {
  test(`remote 只透传且不创建本地目录：${args.join(' ')}`, async () => {
    await temporary(async cwd => httpFixture(null, async (port, seen) => {
      const r = await childRun(cli, ['--remote', port, ...args, '--session', 's-1'], cwd).done;
      assert.equal(r.code, 0, r.stderr);
      assert.deepEqual(seen, [{ jsonrpc: '2.0', id: 1, method, params: { sessionId: 's-1', ...fields } }]);
      assert.deepEqual(await readdir(cwd), [], 'remote 入口不得写本地文件或建目录');
    }));
  });
}

test('remote 的 --worktree=名称 形态等价于 worktree enter 且先于其它请求', async () => {
  await temporary(async cwd => httpFixture(null, async (port, seen) => {
    const r = await childRun(cli, ['--remote', port, '--worktree=fix-1', 'worktree', 'describe', '--session', 's-1'], cwd).done;
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(seen.map(x => [x.id, x.method, x.params]), [
      [1, 'worktree/enter', { sessionId: 's-1', name: 'fix-1' }],
      [2, 'worktree/describe', { sessionId: 's-1' }],
    ]);
    assert.deepEqual(await readdir(cwd), []);
  }));
});

test('remote 裸 --worktree 走自动命名（name 传空串，由核心生成）', async () => {
  await temporary(async cwd => httpFixture(null, async (port, seen) => {
    const r = await childRun(cli, ['--remote', port, '--worktree', 'worktree', 'describe', '--session', 's-1'], cwd).done;
    assert.equal(r.code, 0, r.stderr);
    assert.equal(seen[0].method, 'worktree/enter');
    assert.deepEqual(seen[0].params, { sessionId: 's-1', name: '' });
    assert.deepEqual(await readdir(cwd), []);
  }));
});

test('remote 启动修饰符进入后在同一会话真实提交和起轮', async () => {
  await temporary(async cwd => httpFixture(null, async (port, seen) => {
    const r = await childRun(cli, ['--worktree=fix-2', '--remote', port, 'session', 'send', '检查目录', '--session', 's-1'], cwd).done;
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(seen.map(x => x.method), ['worktree/enter', 'session/submit', 'task/start']);
    assert.ok(seen.every(x => x.params.sessionId === 's-1'), JSON.stringify(seen));
    assert.equal(seen[1].params.data, '检查目录');
    assert.deepEqual(await readdir(cwd), []);
  }));
});

test('remote 保留调用方字符串 ID 且逐条输出信封', async () => {
  await temporary(async cwd => httpFixture(null, async (port, seen) => {
    const r = await childRun(cli, ['--remote', port, 'worktree', 'describe', '--session', 's-1'], cwd).done;
    assert.equal(r.code, 0, r.stderr);
    assert.equal(seen.length, 1);
    assert.deepEqual(JSON.parse(r.stdout.trim()), { jsonrpc: '2.0', id: 1, result: { saved: true, sessionId: 's-1', directory: '远端目录' } });
  }));
});

for (const [name, args] of [
  ['退出动作只认 keep/remove', ['worktree', 'exit', 'delete', '--discard-changes']],
  ['未知子命令', ['worktree', 'explode']],
  ['enter 不接受两个值', ['worktree', 'enter', 'a', 'b']],
  ['describe 不接受值', ['worktree', 'describe', '多余']],
  ['exit 缺动作', ['worktree', 'exit']],
  ['agent-prepare 缺代理 id', ['worktree', 'agent-prepare']],
  ['--discard-changes 只能配 exit', ['worktree', 'describe', '--discard-changes']],
  ['PR 编号为零', ['worktree', 'enter', '0']],
  ['PR 编号越界', ['worktree', 'enter', '99999999999999']],
  ['非 GitHub 的 pull URL', ['worktree', 'enter', 'https://gitlab.com/org/repo/pull/7']],
  ['URL 带尾斜杠', ['worktree', 'enter', 'https://github.com/org/repo/pull/7/']],
  ['名称含路径分隔', ['worktree', 'enter', '../escape']],
  ['名称带空格', ['worktree', 'enter', 'a b']],
  ['名称超 64 字符', ['worktree', 'enter', 'a'.repeat(65)]],
]) test(`remote 严格校验拒${name}：不发任何请求`, async () => {
  await temporary(async cwd => httpFixture(null, async (port, seen) => {
    const r = await childRun(cli, ['--remote', port, ...args, '--session', 's-1'], cwd).done;
    assert.equal(r.code, 64, `${name} 应当退 64：${r.stdout}|${r.stderr}`);
    assert.equal(seen.length, 0, '严格校验必须在发帧之前');
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /worktree/);
    assert.deepEqual(await readdir(cwd), []);
  }));
});

// 会话必填：worktree 通道没有「当前会话」这个概念，缺 --session 就在发帧前退。
for (const args of [['worktree', 'describe'], ['worktree', 'enter', 'fix-1'], ['session', 'send', '提示词']]) {
  test(`remote 缺 --session 拒发帧：${args.join(' ')}`, async () => {
    await temporary(async cwd => httpFixture(null, async (port, seen) => {
      const r = await childRun(cli, ['--remote', port, ...args], cwd).done;
      assert.equal(r.code, 64, r.stderr);
      assert.equal(seen.length, 0);
      assert.match(r.stderr, /worktree|session/);
    }));
  });
}

test('remote 的 worktree 通道不接受任意方法名', async () => {
  await temporary(async cwd => httpFixture(null, async (port, seen) => {
    const r = await childRun(cli, ['--remote', port, 'worktree', '../../rpc', '--session', 's-1'], cwd).done;
    assert.equal(r.code, 64);
    // 归因必须落在 worktree 这条通道上：旧产物靠「未知远程子命令」也能退 64，那是蒙的。
    assert.match(r.stderr, /worktree/, r.stderr);
    assert.equal(seen.length, 0);
  }));
});

test('remote 业务错误逐条回传并非零退出（不把 error 压成字符串）', async () => {
  const error = { code: -32001, message: '业务拒绝', data: { kept: true } };
  await temporary(async cwd => httpFixture(() => ({ __error: error }), async (port, seen) => {
    const r = await childRun(cli, ['--remote', port, 'worktree', 'exit', 'remove', '--session', 's-1'], cwd).done;
    assert.notEqual(r.code, 0);
    assert.equal(seen.length, 1);
    assert.deepEqual(JSON.parse(r.stdout.trim()), { jsonrpc: '2.0', id: 1, error });
    assert.match(r.stderr, /remote/);
  }));
});

// ============ B. 本地 worktree 子命令：接真目录 ============

test('本地 worktree enter 建真目录、建分支，describe 恰好八个契约字段', async () => {
  await gitRepo(async cwd => {
    const enter = await childRun(cli, ['worktree', 'enter', 'fix-1'], cwd).done;
    assert.equal(enter.code, 0, enter.stderr);
    const got = JSON.parse(enter.stdout.trim());
    const expected = path.join(cwd, '.sacode', 'worktrees', 'fix-1').replace(/\\/g, '/');
    assert.equal(got.directory.replace(/\\/g, '/'), expected);
    assert.ok(await existsFile(path.join(got.directory, 'seed')), '工作树必须检出内容');
    const listed = git(got.directory, 'rev-parse', '--abbrev-ref', 'HEAD');
    assert.equal(listed, 'worktree-fix-1');
    const desc = await childRun(cli, ['worktree', 'describe'], cwd).done;
    assert.equal(desc.code, 0, desc.stderr);
    const obj = JSON.parse(desc.stdout.trim());
    assert.deepEqual(Object.keys(obj).sort(), DESCRIBE_FIELDS, 'describe 字段集必须与冻结契约逐字一致');
    assert.equal(obj.active, true);
    assert.equal(obj.name, 'fix-1');
    assert.equal(obj.branch, 'worktree-fix-1');
    assert.equal(obj.originalDirectory.replace(/\\/g, '/'), cwd.replace(/\\/g, '/'));
    assert.equal(typeof obj.uncommittedCount, 'number');
    assert.equal(typeof obj.uniqueCommits, 'number');
  });
});

test('本地 worktree enter 不给名称时自动命名 <形容词>-<名词>-<6hex>', async () => {
  await gitRepo(async cwd => {
    const r = await childRun(cli, ['worktree', 'enter'], cwd).done;
    assert.equal(r.code, 0, r.stderr);
    const names = await worktreeNames(cwd);
    assert.equal(names.length, 1, JSON.stringify(names));
    assert.match(names[0], /^[a-z]+-[a-z]+-[0-9a-f]{6}$/);
    const desc = JSON.parse((await childRun(cli, ['worktree', 'describe'], cwd).done).stdout.trim());
    assert.equal(desc.name, names[0]);
  });
});

for (const [name, value] of [['逃逸路径', '../escape'], ['含斜杠', 'a/b'], ['保留设备名', 'CON'], ['带空格', 'a b'], ['65 字符', 'a'.repeat(65)]]) {
  test(`本地非法名称非零退出且不留半成品目录：${name}`, async () => {
    await gitRepo(async cwd => {
      const r = await childRun(cli, ['worktree', 'enter', value], cwd).done;
      assert.notEqual(r.code, 0, `${value} 本该被拒`);
      // 归因必须出自 worktree 这条线，不能是「未知子命令」蒙过去（旧产物就是这么红的）。
      assert.match(r.stderr, /^worktree: /m, r.stderr);
      assert.deepEqual(await worktreeNames(cwd), [], '非法名称不得留下任何工作树目录');
    });
  });
}

test('不在 Git 仓库内时拒绝进入且不建目录', async () => {
  await temporary(async cwd => {
    const r = await childRun(cli, ['worktree', 'enter', 'fix-1'], cwd).done;
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /^worktree: /m, `必须由 worktree 入口归因，不是「未知子命令」：${r.stderr}`);
    assert.deepEqual(await readdir(cwd), [], '非仓库里不得留下 .sacode 目录');
  });
});

test('exit keep 保留目录并把有效目录还原', async () => {
  await gitRepo(async cwd => {
    const directory = JSON.parse((await childRun(cli, ['worktree', 'enter', 'fix-1'], cwd).done).stdout.trim()).directory;
    const kept = await childRun(cli, ['worktree', 'exit', 'keep'], cwd).done;
    assert.equal(kept.code, 0, kept.stderr);
    assert.ok(await existsFile(directory), 'keep 不得删目录');
    const desc = JSON.parse((await childRun(cli, ['worktree', 'describe'], cwd).done).stdout.trim());
    assert.equal(desc.active, false);
    assert.equal(desc.originalDirectory.replace(/\\/g, '/'), cwd.replace(/\\/g, '/'));
  });
});

test('exit remove 才真删目录', async () => {
  await gitRepo(async cwd => {
    const directory = JSON.parse((await childRun(cli, ['worktree', 'enter', 'fix-1'], cwd).done).stdout.trim()).directory;
    const gone = await childRun(cli, ['worktree', 'exit', 'remove'], cwd).done;
    assert.equal(gone.code, 0, gone.stderr);
    assert.ok(!(await existsFile(directory)), 'remove 必须删掉目录');
  });
});

test('退出动作只认 keep/remove：delete 非零退出且不删目录', async () => {
  await gitRepo(async cwd => {
    const directory = JSON.parse((await childRun(cli, ['worktree', 'enter', 'fix-1'], cwd).done).stdout.trim()).directory;
    const r = await childRun(cli, ['worktree', 'exit', 'delete'], cwd).done;
    assert.notEqual(r.code, 0);
    assert.ok(await existsFile(directory), '非法动作不得产生删除副作用');
  });
});

test('PR 形态：--worktree=#7 从 origin 抓 pull/7/head', async () => {
  await gitRepo(async cwd => {
    const bare = path.join(path.dirname(cwd), `remote-${path.basename(cwd)}`);
    await rm(bare, { recursive: true, force: true });
    try {
      git(path.dirname(cwd), 'init', '--bare', bare);
      git(cwd, 'remote', 'add', 'origin', bare);
      git(cwd, 'push', 'origin', 'HEAD:refs/pull/7/head');
      const r = await childRun(cli, ['worktree', 'enter', '#7'], cwd).done;
      assert.equal(r.code, 0, r.stderr);
      const names = await worktreeNames(cwd);
      assert.equal(names.length, 1);
      assert.ok(await existsFile(path.join(cwd, '.sacode', 'worktrees', names[0], 'seed')));
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  });
});

// ============ C. --worktree 会话入口：真目录 + 真起轮 ============

function providerFixture(handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let text = ''; req.on('data', c => { text += c; });
    req.on('end', () => {
      seen.push({ url: req.url, body: text });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end('data: {"choices":[{"delta":{"content":"first"},"finish_reason":null}]}\n\n'
        + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"total_tokens":22}}\n\n'
        + 'data: [DONE]\n\n');
      if (handler) { handler(text); }
    });
  });
  return { seen, server, start: () => new Promise(r => server.listen(0, '127.0.0.1', r)), port: () => String(server.address().port), stop: async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); } };
}

async function withProvider(body) {
  const p = providerFixture();
  await p.start();
  try { return await body(p); } finally { await p.stop(); }
}

test('--worktree=名称 "提示词" 在工作树里真起一轮，日志留在启动目录', async () => {
  await gitRepo(async cwd => withProvider(async provider => {
    const r = await childRun(cli, ['--worktree=fix-1', '--json', '把按钮改成蓝色'], cwd, {
      SACODE_PROVIDER_BASE_URL: `http://127.0.0.1:${provider.port()}`,
      SACODE_PROVIDER_KEY: 'fixture-key',
      SACODE_PROVIDER_MODEL: 'fixture-model',
    }).done;
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout.trim());
    const expected = path.join(cwd, '.sacode', 'worktrees', 'fix-1').replace(/\\/g, '/');
    assert.equal(out.directory.replace(/\\/g, '/'), expected, '会话有效目录必须是工作树');
    assert.equal(out.cwd.replace(/\\/g, '/'), expected, '首次模型交互前必须已切进程 cwd');
    assert.equal(out.originalDirectory.replace(/\\/g, '/'), cwd.replace(/\\/g, '/'));
    assert.equal(out.branch, 'worktree-fix-1');
    assert.equal(out.reply, 'first');
    assert.equal(provider.seen.length, 1);
    assert.match(provider.seen[0].url, /\/chat\/completions$/);
    assert.ok(provider.seen[0].body.includes('把按钮改成蓝色'), '提示词必须真的进请求体');
    const log = await readFile(out.log, 'utf8');
    assert.ok(log.includes('workspace/directory'), '绑定必须写进会话日志');
    assert.ok(log.includes('user/message') && log.includes('把按钮改成蓝色'));
    assert.ok(log.includes('assistant/message') && log.includes('first'));
    assert.ok(!(await existsFile(path.join(expected, 'session.log'))), '会话日志不得落在工作树里');
    assert.equal(out.log.replace(/\\/g, '/').indexOf(expected), -1, '会话日志路径必须按启动目录解析');
  }));
});

test('裸 --worktree 后的提示词不被当名称', async () => {
  await gitRepo(async cwd => withProvider(async provider => {
    const r = await childRun(cli, ['--worktree', '--json', '把按钮改成蓝色'], cwd, {
      SACODE_PROVIDER_BASE_URL: `http://127.0.0.1:${provider.port()}`,
      SACODE_PROVIDER_KEY: 'fixture-key',
    }).done;
    assert.equal(r.code, 0, r.stderr);
    const names = await worktreeNames(cwd);
    assert.equal(names.length, 1);
    assert.match(names[0], /^[a-z]+-[a-z]+-[0-9a-f]{6}$/, '裸标志只能是自动命名');
    assert.notEqual(names[0], '把按钮改成蓝色');
    const out = JSON.parse(r.stdout.trim());
    assert.ok(out.log && (await readFile(out.log, 'utf8')).includes('把按钮改成蓝色'));
  }));
});

test('--resume 与 --worktree 同时给以后者为准并把覆盖信息打到 stderr', async () => {
  await gitRepo(async cwd => withProvider(async provider => {
    const extra = { SACODE_PROVIDER_BASE_URL: `http://127.0.0.1:${provider.port()}`, SACODE_PROVIDER_KEY: 'fixture-key' };
    const first = await childRun(cli, ['--worktree=fix-1', '--json', '第一条'], cwd, extra).done;
    assert.equal(first.code, 0, first.stderr);
    const session = JSON.parse(first.stdout.trim()).session;
    const second = await childRun(cli, ['--resume', session, '--worktree=fix-2', '--json', '第二条'], cwd, extra).done;
    assert.equal(second.code, 0, second.stderr);
    const out = JSON.parse(second.stdout.trim());
    assert.equal(out.session, session, '覆盖发生在同一份会话日志上');
    assert.equal(out.directory.replace(/\\/g, '/'), path.join(cwd, '.sacode', 'worktrees', 'fix-2').replace(/\\/g, '/'));
    assert.match(second.stderr, /覆盖/, '必须披露覆盖发生了');
    assert.match(second.stderr, /--resume/, '覆盖信息必须点名被覆盖的是 --resume');
    assert.match(second.stderr, /--worktree/, '覆盖信息必须点名生效的是 --worktree');
    // 计划要求覆盖信息「同时打到 stderr 与首条提示提醒」：日志里那条用户消息必须带提醒。
    const overrideLog = await readFile(JSON.parse(second.stdout.trim()).log, 'utf8');
    assert.ok(/user\/message[^\n]*覆盖/.test(overrideLog), `首条提示里要有覆盖提醒：${overrideLog}`);
    assert.ok((await worktreeNames(cwd)).includes('fix-2'));
    // 恢复绑定本身不自动 chdir：只给 --resume 时进程 cwd 仍在启动目录。
    const third = await childRun(cli, ['--resume', session, '--json', '第三条'], cwd, extra).done;
    assert.equal(third.code, 0, third.stderr);
    const restored = JSON.parse(third.stdout.trim());
    assert.equal(restored.cwd.replace(/\\/g, '/'), cwd.replace(/\\/g, '/'), '恢复绑定不得自动 chdir');
    assert.match(restored.directory.replace(/\\/g, '/'), /worktrees\/fix-2$/, '有效目录仍取恢复的绑定');
  }));
});

test('路径型参数在 chdir 前按启动 cwd 转绝对（--mcp-config 未接后端要 fail-loud）', async () => {
  await gitRepo(async cwd => {
    await writeFile(path.join(cwd, 'mcp.json'), '{}');
    const r = await childRun(cli, ['--worktree=fix-1', '--mcp-config', 'mcp.json'], cwd).done;
    assert.notEqual(r.code, 0);
    assert.equal(r.code, 69, `未接后端应退 69：${r.code}`);
    assert.match(r.stderr, /BLOCKED/);
    const absolutized = path.join(cwd, 'mcp.json').replace(/\\/g, '/');
    assert.ok(r.stderr.replace(/\\/g, '/').includes(absolutized), `stderr 必须回显按启动 cwd 解析出的绝对路径：${r.stderr}`);
    assert.deepEqual(await worktreeNames(cwd), [], '转换与校验必须发生在建目录之前');
  });
});

test('--json-file 同样按启动 cwd 冻结且未接后端时非零', async () => {
  await gitRepo(async cwd => {
    await writeFile(path.join(cwd, 'prompt.json'), '{}');
    const r = await childRun(cli, ['--worktree=fix-1', '--json-file', 'prompt.json'], cwd).done;
    assert.notEqual(r.code, 0);
    assert.ok(r.stderr.replace(/\\/g, '/').includes(path.join(cwd, 'prompt.json').replace(/\\/g, '/')), r.stderr);
    assert.deepEqual(await worktreeNames(cwd), []);
  });
});

test('没有模型配置时非零退出，绝不静默跑一轮假回复', async () => {
  await gitRepo(async cwd => {
    const clean = { ...env };
    delete clean.SACODE_PROVIDER_BASE_URL; delete clean.SACODE_PROVIDER_KEY; delete clean.STEPFUN_API_KEY;
    const child = spawn(cli, ['--worktree=fix-1', '你好'], { cwd, env: clean, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', b => { stdout += b; });
    child.stderr.on('data', b => { stderr += b; });
    const code = await new Promise(resolve => child.on('close', resolve));
    assert.notEqual(code, 0, `缺 provider 必须非零：${stdout}`);
    assert.match(stderr, /provider|模型/i);
    assert.ok(stdout.indexOf('你好') === -1);
  });
});

test('未知与重复选项退 64 且不留目录', async () => {
  await gitRepo(async cwd => {
    for (const args of [
      ['--worktree=fix-1', '--nope', 'x'],
      ['--worktree=fix-1', '--worktree=fix-2'],
      ['--worktree=fix-1', '--resume'],
      ['--worktree=fix-1', '--mcp-config'],
      ['--worktree=fix-1', '--session'],
      ['--worktree=fix-1', '提示词', '--resume', 'missing-session'],
    ]) {
      const r = await childRun(cli, args, cwd).done;
      assert.equal(r.code, 64, `${args.join(' ')} 应退 64：${r.stdout}|${r.stderr}`);
      assert.match(r.stderr, /worktree/, `${args.join(' ')} 的拒绝必须由 worktree 入口给出：${r.stderr}`);
      assert.deepEqual(await worktreeNames(cwd), [], `${args.join(' ')} 不得留下目录`);
    }
  });
});

// ACP 互斥：本仓 CLI 没有 ACP 启动标志（apps/cli、apps/daemon、apps/host、apps/desktop 全仓
// grep -- '--acp' 只在 test-support 的外部探针注释里命中，不是入口标志），
// 因此这条只能记 BLOCKED，不能写成「已拦住」。
test('--worktree 与 ACP 标志互斥', (t) => {
  t.skip('BLOCKED：本仓没有 ACP 启动标志，互斥无对手方；ACP 主机走 loadSession/newSession 的 cwd 指定目录（见计划「冻结契约」）');
});
