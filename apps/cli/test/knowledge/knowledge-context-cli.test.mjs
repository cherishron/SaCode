import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join, delimiter } from 'node:path';

const root = resolve(import.meta.dirname, '../../../..');

async function runCli(exe, args, cwd, env, expectedCode = 0) {
  const child = spawn(exe, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.on('data', data => { out += data; });
  child.stderr.on('data', data => { err += data; });
  const timer = setTimeout(() => child.kill(), 20000);
  try {
    const [code] = await once(child, 'close');
    assert.equal(code, expectedCode, `CLI退出码不符：${err.slice(0, 500)}`);
    return { out, err };
  } finally {
    clearTimeout(timer);
  }
}

function unescapeLogField(value) {
  let output = '';
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== '\\' || index + 1 >= value.length) {
      output += value[index];
      continue;
    }
    const next = value[++index];
    output += next === 'n' ? '\n' : next === 'r' ? '\r' : next === 't' ? '\t' : next;
  }
  return output;
}

function sessionEvents(path) {
  return readFileSync(path, 'utf8').trimEnd().split('\n').map(line => {
    const fields = line.split('\t');
    return { seq: Number(fields[0]), type: fields[1], data: unescapeLogField(fields.slice(2).join('\t')) };
  });
}

test('CLI goal 将有界用户与项目知识注入原始用户轮次，并在项目来源过期后停止注入', { timeout: 90000 }, async () => {
  assert.ok(process.env.SACODE_CLI, '必须显式指定本轮 CLI 产物');
  const requests = [];
  let sourceChanged = false;
  const sourcePath = 'source.md';
  let projectSource = '';
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    requests.push(JSON.parse(raw));
    if (!sourceChanged) {
      sourceChanged = true;
      writeFileSync(projectSource, '项目来源已更新，旧资料失效。', 'utf8');
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: '本地验证答复' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const base = join(root, 'target/tmp');
  mkdirSync(base, { recursive: true });
  const day = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const directory = mkdtempSync(join(base, `cli-knowledge-context-${day}-`));
  const settings = join(directory, 'settings');
  const workspace = join(directory, 'workspace');
  mkdirSync(settings, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  projectSource = join(workspace, sourcePath);
  const userSentinel = 'USER_KB_ONLY_7F31';
  const projectSentinel = 'PROJECT_KB_ONLY_9B24';
  writeFileSync(projectSource, `验收方案：${projectSentinel}`, 'utf8');

  // env 构造对齐 worktree/remote/team-command/tips-surface 四个 CLI 夹具：
  // 拷贝 process.env 继承 PATH/SystemRoot，再前置 stdx 与 SDK runtime 目录，
  // 否则剥掉 SDK 后 main.exe 入口缺 11 个 libstdx.*.dll → 0xC0000135（issue #725 同根因）。
  // SACODE_STDX_DLL_DIR / SACODE_RUNTIME_DLL_DIR 是项目运行期约定变量，
  // 兜底指向本机已装的 stdx 1.1.3.1 与 SDK runtime/lib，不另起路径、不污染系统 PATH。
  const env = { ...process.env };
  const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'PATH';
  env[pathKey] = [
    process.env.SACODE_STDX_DLL_DIR || 'C:/Users/jingg/stdx-work/stdx-1.1.3.1/windows_x86_64_cjnative/dynamic/stdx',
    process.env.SACODE_RUNTIME_DLL_DIR || 'D:/Program Files/HuaWei/Cangjie/runtime/lib/windows_x86_64_cjnative',
    env[pathKey],
  ].join(delimiter);
  Object.assign(env, {
    SACODE_PROVIDER_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`,
    SACODE_PROVIDER_MODEL: 'cli-knowledge-local',
    SACODE_PROVIDER_KEY: 'local-fixture-only',
    SACODE_USER_SETTINGS_DIR: settings,
  });

  try {
    const exe = resolve(process.env.SACODE_CLI);
    await runCli(exe, ['knowledge', 'save', 'user', '', 'cli-user-note', '个人验收资料', `验收方案：${userSentinel}`, '0'], workspace, env);
    await runCli(exe, ['knowledge', 'import', 'project', workspace, 'cli-project-note', '项目验收资料', sourcePath, '0'], workspace, env);

    // 不触发工具或外部服务；无机械推进时目标按既有停止规则结束。
    const result = await runCli(exe, ['goal', 'run', '请按验收方案检查项目'], workspace, env, 1);
    assert.match(result.err, /goal-result\t/);
    assert.ok(requests.length >= 2, `预期至少跨两轮请求，实际 ${requests.length}`);

    const firstUserMessage = requests[0].messages.find(message => message.role === 'user');
    assert.ok(firstUserMessage, '首轮请求应保留 user role');
    assert.match(firstUserMessage.content, new RegExp(userSentinel));
    assert.match(firstUserMessage.content, new RegExp(projectSentinel));
    assert.equal(requests[0].messages.some(message => message.role === 'developer' &&
      String(message.content).includes(userSentinel)), false, '知识正文不能升级为 developer role');

    const laterUserMessage = requests[1].messages.find(message => message.role === 'user');
    assert.ok(laterUserMessage);
    assert.match(laterUserMessage.content, new RegExp(userSentinel), '用户级资料仍然 current，应继续注入');
    assert.doesNotMatch(laterUserMessage.content, new RegExp(projectSentinel));

    const events = sessionEvents(join(workspace, 'session.log'));
    const originalUser = events.find(event => event.type === 'user/message' && event.data === '请按验收方案检查项目');
    assert.ok(originalUser, '会话日志应保留原始目标 user/message');
    const audits = events.filter(event => event.type === 'knowledge/retrieval').map(event => JSON.parse(event.data));
    assert.ok(audits.length >= 2);
    const firstAudit = audits.find(audit => audit.goalRound === 1);
    const laterAudit = audits.find(audit => audit.goalRound > 1);
    assert.ok(firstAudit && laterAudit, '审计应绑定首轮及后续轮次');
    assert.equal(firstAudit.targetUserSeq, originalUser.seq);
    assert.equal(laterAudit.targetUserSeq, originalUser.seq, '每轮都应引用同一原始用户消息');
    assert.equal(firstAudit.userStoreRevision, 1);
    assert.equal(firstAudit.projectStoreRevision, 1);
    assert.deepEqual(new Set(firstAudit.matches.map(match => match.scope)), new Set(['user', 'project']));
    assert.deepEqual(new Set(laterAudit.matches.map(match => match.scope)), new Set(['user']),
      '源文件变化后只保留仍 current 的用户级资料');
    for (const audit of audits) {
      const serialized = JSON.stringify(audit);
      assert.equal(serialized.includes(userSentinel), false, '审计不得包含用户知识正文');
      assert.equal(serialized.includes(projectSentinel), false, '审计不得包含项目知识正文');
      assert.equal(audit.targetUserSeq, originalUser.seq);
    }
  } finally {
    await new Promise(resolveServer => { server.closeAllConnections(); server.close(resolveServer); });
    assert.equal(resolve(directory, '..'), resolve(base));
    rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
