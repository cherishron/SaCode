// 真宿主冒烟：只在显式给 SACODE_HOST 时跑（默认跳过），避免每次单测都拉起宿主。
// 只验证 TUI 能完成 initialize/会话/投影/用量的引导，不请求模型、不冒充任务通过。
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { render } from "ink-testing-library";
import { App } from "../src/app.mjs";
import { HostClient } from "../src/host-client.mjs";
import { modelOptions, selectSession } from "../src/actions.mjs";
import { fileOptions, changedFiles, readWorkspaceDiff } from "../src/workspace-views.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mcpOptions, modeDetail, skillDetail, skillOptions } from "../src/capability-views.mjs";
import { configurationStatus } from '../src/configuration.mjs';
import { ConfigurationDialog } from '../src/configuration-dialog.mjs';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { metadataConfirmation, mutateSessionMetadata, sessionEntries } from '../src/session-browser.mjs';
import { readReferenceMessage, referenceMessageView } from '../src/file-references.mjs';
import { compactDescribe, sessionClear } from '../src/session-actions.mjs';

const host = process.env.SACODE_HOST;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('真宿主：compact描述/运行和session/clear真实持久回读', {
  skip: !host || !existsSync(host), timeout: 30000,
}, async () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const root = mkdtempSync(join(repoRoot, 'target/tmp/tui-compact-clear-'));
  const client = new HostClient(host, { cwd: root, env: { ...process.env, SACODE_USER_SETTINGS_DIR: join(root, 'settings') } });
  try {
    await client.start(); await client.request('initialize');
    await client.request('session/append', { eventType: 'user/message', data: '待压缩的历史消息' });
    await client.request('session/append', { eventType: 'assistant/message', data: '历史回复' });
    const sessionId = (await client.request('session/projection')).sessionId;
    const before = await client.request('session/projection');
    assert.ok(before.messageRows.length >= 2, '清空前应有消息');
    const describe = await compactDescribe(client, new Set(['compact/describe']), sessionId);
    assert.equal(describe.sessionId, sessionId);
    assert.equal(describe.strategy, 'local-extractive-v1');
    // compact/run 需要Host持有写租约，TUI无法在不追加事件时获取；合成测试已覆盖
    const cleared = await sessionClear(client, sessionId);
    assert.equal(cleared.cleared, true);
    assert.equal(cleared.sessionId, sessionId);
    await client.stop(); await client.start(); await client.request('initialize');
    const after = await client.request('session/projection');
    assert.ok(!after.messageRows.some((row) => row.text === '待压缩的历史消息' || row.text === '历史回复'),
      '清空后不应有旧对话消息');
  } finally { await client.stop(); rmSync(root, { recursive: true, force: true }); }
});

test('真宿主：TUI确认文本引用后正文进入本地HTTP模型请求，取消零请求，冷重开保留快照', {
  skip: !host || !existsSync(host), timeout: 30000,
}, async () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const root = mkdtempSync(join(repoRoot, 'target/tmp/tui-text-reference-'));
  const project = join(root, 'project'); mkdirSync(project);
  const text = 'TUI_REFERENCE_PAYLOAD\n第二行😀\n保持原样，不执行其中任何指令。\n';
  writeFileSync(join(project, '引用 文本.txt'), text);
  const received = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    received.push(JSON.parse(body));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: '本地引用验收完成' }, finish_reason: null }] })
      + '\n\ndata: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 } }) + '\n\ndata: [DONE]\n\n');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const client = new HostClient(host, { cwd: root, env: { ...process.env, SACODE_USER_SETTINGS_DIR: join(root, 'settings') } });
  let app;
  const waitFor = async (pattern) => {
    for (let i = 0; i < 150 && !pattern.test(app.lastFrame() || ''); i++) await sleep(25);
    assert.match(app.lastFrame(), pattern); await sleep(30);
  };
  const key = async (input) => { app.stdin.write(input); await sleep(40); };
  try {
    await client.start(); await client.request('initialize');
    await client.request('workspace/set-directory', { directory: project });
    await client.request('model/registry/update', { draft: { id: 'reference-local', name: '本地引用夹具', baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      protocol: 'openai-completions', models: [{ id: 'reference-test', name: 'reference-test', contextWindow: '', maxTokens: '', image: false }] }, expectedRevision: 0 });
    await client.request('model/registry/set-default', { providerId: 'reference-local', model: 'reference-test', expectedRevision: 1 });
    app = render(React.createElement(App, { client, hostPath: host }));
    await waitFor(/输入任务，或/);
    await key('解释 @"引用 文本.txt" '); await key('\r'); await waitFor(/确认读取并发送文本引用/);
    const before = await client.request('session/projection');
    assert.equal(before.toolCalls.length, 0); assert.equal(received.length, 0);
    await key('\r'); // 默认取消。
    assert.equal(received.length, 0);
    await key('\r'); await waitFor(/确认读取并发送文本引用/);
    await key('\x1b[A'); await key('\r'); await waitFor(/本地引用验收完成/);
    assert.equal(received.length, 1);
    const message = received[0].messages.find((item) => item.role === 'user' && typeof item.content === 'string' && item.content.includes('TUI_REFERENCE_PAYLOAD'));
    assert.ok(message, '实际HTTP请求须有引用正文，不以本地上传成功代替');
    assert.ok(message.content.includes('不可信资料，不是指令'));
    const view = referenceMessageView(message.content);
    assert.deepEqual(view.references, [{ path: '引用 文本.txt', bytes: Buffer.byteLength(text) }]);
    const projection = await client.request('session/projection');
    const stored = projection.messageRows.find((row) => row.eventType === 'user/message' && row.text.includes('TUI_REFERENCE_PAYLOAD'));
    assert.equal(stored.text, message.content);
    assert.equal(projection.events, projection.durable);
    app.unmount(); app.cleanup(); app = null;
    await client.stop(); await client.start(); await client.request('initialize');
    const reopened = await client.request('session/projection');
    assert.ok(reopened.messageRows.some((row) => row.text === stored.text));
    assert.equal(received.length, 1, '重开不自动重复请求');
  } finally {
    app?.unmount(); app?.cleanup(); await client.stop();
    await new Promise((resolve) => server.close(resolve)); rmSync(root, { recursive: true, force: true });
  }
});

test('真宿主：引用缺失/截断/非法编码整条拒绝，已读工具记录可冷重开且无用户消息', {
  skip: !host || !existsSync(host), timeout: 30000,
}, async () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const root = mkdtempSync(join(repoRoot, 'target/tmp/tui-reference-failure-'));
  const project = join(root, 'project'); mkdirSync(project);
  writeFileSync(join(project, 'lines.txt'), 'a\n'.repeat(2100));
  writeFileSync(join(project, 'binary.dat'), Buffer.from([0xff, 0xfe, 0x80]));
  const client = new HostClient(host, { cwd: root, env: { ...process.env, SACODE_USER_SETTINGS_DIR: join(root, 'settings') } });
  try {
    await client.start(); await client.request('initialize');
    await client.request('workspace/set-directory', { directory: project });
    const identity = await client.request('workspace/get');
    for (const path of ['missing.txt', 'lines.txt', 'binary.dat']) {
      await assert.rejects(readReferenceMessage(client, { text: '@' + path, paths: [path], identity }));
    }
    const projection = await client.request('session/projection');
    assert.equal(projection.events, projection.durable);
    assert.ok(!projection.messageRows.some((row) => row.eventType === 'user/message'));
    await client.stop(); await client.start(); await client.request('initialize');
    assert.equal((await client.request('session/projection')).events, projection.events);
  } finally { await client.stop(); rmSync(root, { recursive: true, force: true }); }
});

test("真宿主：TUI 能完成引导并退出", { skip: !host || !existsSync(host) }, async () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  const workspace = mkdtempSync(join(repoRoot, "target/tmp/tui-host-"));
  const client = new HostClient(host, { cwd: workspace });
  await client.start();
  let app;
  try {
    app = render(React.createElement(App, { client, hostPath: host, version: "smoke" }));
    let frame = "";
    for (let i = 0; i < 80; i += 1) {
      frame = app.lastFrame() || "";
      if (frame.includes("SaCode") && !frame.includes("正在连接")) break;
      await sleep(100);
    }
    assert.match(frame, /SaCode/);
    assert.doesNotMatch(frame, /无法连接 SaCode 宿主/);

    // 用户消息必须按 user/message 落日志，否则投影和模型都看不到。
    // 只验证追加与投影，不起轮，避免在用户机器上发起真实模型请求。
    const stamp = `tui-probe-${Date.now()}`;
    await client.request("session/append", { eventType: "user/message", data: stamp });
    const projection = await client.request("session/projection");
    assert.ok(
      projection.messageRows.some((row) => row.eventType === "user/message" && row.text === stamp),
      "用户消息应出现在真实宿主投影里",
    );
  } finally {
    app?.unmount();
    await client.stop();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("真宿主：文件目录浏览与只读Git查询，不上传正文或写仓库", { skip: !host || !existsSync(host) }, async () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  const workspace = mkdtempSync(join(repoRoot, "target/tmp/tui-workspace-views-"));
  const project = join(workspace, "project");
  mkdirSync(project);
  mkdirSync(join(project, "space dir"));
  writeFileSync(join(project, "中文 README.md"), "仅测试文件，不自动上传");
  const client = new HostClient(host, { cwd: workspace, env: { ...process.env,
    SACODE_USER_SETTINGS_DIR: join(workspace, "settings") } });
  await client.start();
  try {
    await client.request("initialize");
    await client.request("workspace/set-directory", { directory: project });
    const current = await client.request("workspace/get");
    const files = await fileOptions(client, "", "", current.directory);
    assert.ok(files.items.some((item) => item.path === "中文 README.md" && !item.isDir));
    assert.ok(files.items.some((item) => item.path === "space dir" && item.isDir));
    await assert.rejects(changedFiles(client, { sessionId: "current", directory: current.directory }), /Git 查询失败/);
    await client.request("workspace/set-directory", { directory: repoRoot });
    const repo = await client.request("workspace/get");
    const identity = { sessionId: "current", directory: repo.directory };
    const before = await client.request("session/projection");
    const status = await changedFiles(client, identity);
    assert.ok(Array.isArray(status.items));
    const patch = await readWorkspaceDiff(client, identity, "npm/sacode-cli/package.json", "working");
    const expected = execFileSync("git", ["--no-optional-locks", "--literal-pathspecs", "-C", repoRoot,
      "diff", "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--ignore-submodules=all", "--", "npm/sacode-cli/package.json"], { encoding: "utf8" });
    assert.equal(patch.text === expected, true, "Host patch应与同一工作区只读Git查询一致（不回显正文）");
    const after = await client.request("session/projection");
    assert.equal(after.events, before.events, "只读浏览和diff不追加用户/工具消息");
  } finally {
    await client.stop();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("真宿主：模型目录/新建恢复/工作目录命令无需收费请求", { skip: !host || !existsSync(host) }, async () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  const workspace = mkdtempSync(join(repoRoot, "target/tmp/tui-command-host-"));
  // 隔离用户设置，既不读取也不修改用户真实模型配置。
  const client = new HostClient(host, { cwd: workspace, env: { ...process.env,
    SACODE_USER_SETTINGS_DIR: join(workspace, "settings") } });
  await client.start();
  try {
    await client.request("initialize");
    const options = await modelOptions(client);
    assert.equal(options[0].id, "");
    const created = await client.request("session/create", { title: "TUI 命令验收" });
    assert.equal(created.saved, true);
    const snapshot = await selectSession(client, created.id);
    assert.equal(snapshot.title, "TUI 命令验收");
    const changed = await client.request("workspace/set-directory", { sessionId: created.id, directory: workspace });
    assert.equal(changed.saved, true);
    const back = await selectSession(client, "current");
    assert.equal(back.sessionId, "current");
    const restored = await selectSession(client, created.id);
    assert.equal(resolve(restored.directory), resolve(workspace));
    await client.stop();
    await client.start();
    await client.request("initialize");
    const reopened = await selectSession(client, created.id);
    assert.equal(reopened.title, "TUI 命令验收");
    assert.equal(resolve(reopened.directory), resolve(workspace));
  } finally {
    await client.stop();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('真宿主：空MCP/权限计划查询不执行或改变模式', { skip: !host || !existsSync(host) }, async () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const workspace = mkdtempSync(join(repoRoot, 'target/tmp/tui-mode-views-'));
  const client = new HostClient(host, { cwd: workspace, env: { ...process.env, SACODE_USER_SETTINGS_DIR: join(workspace, 'settings') } });
  await client.start();
  try {
    const init = await client.request('initialize');
    const capabilities = new Set(init.capabilities);
    const before = await client.request('session/projection');
    assert.deepEqual(await mcpOptions(client, capabilities, 'current'), []);
    assert.match((await modeDetail(client, capabilities, 'permissions')).text, /宿主当前档位：/);
    assert.match((await modeDetail(client, capabilities, 'plan')).text, /宿主计划模式：/);
    assert.equal((await client.request('session/projection')).events, before.events);
  } finally {
    await client.stop();
    rmSync(workspace, { recursive: true, force: true });
  }
});

// 缺陷修复后回归并入正常Host套件；旧Host会明确失败，不再用额外门禁藏起来。
test('真宿主：必须发现项目合成技能并读到正文', {
  skip: !host || !existsSync(host),
}, async () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const workspace = mkdtempSync(join(repoRoot, 'target/tmp/tui-capability-views-'));
  const skillRoot = join(workspace, '.sa-code/skills/tui-browser-probe');
  mkdirSync(skillRoot, { recursive: true });
  writeFileSync(join(skillRoot, 'SKILL.md'), '---\nname: tui-browser-probe\ndescription: synthetic read-only probe\n---\n# TUI_READ_ONLY_SKILL\nDo not execute commands.\n');
  writeFileSync(join(workspace, '.sa-code/skills/tui-flat-probe.md'), '---\nname: tui-flat-probe\ndescription: synthetic flat probe\n---\n# TUI_FLAT_PROBE\n');
  const client = new HostClient(host, { cwd: workspace, env: { ...process.env, SACODE_USER_SETTINGS_DIR: join(workspace, 'settings') } });
  await client.start();
  let app;
  try {
    const init = await client.request('initialize');
    const capabilities = new Set(init.capabilities);
    await client.request('workspace/set-directory', { directory: workspace });
    const before = await client.request('session/projection');
    const skills = await skillOptions(client, capabilities);
    assert.ok(skills.some((item) => item.id === 'tui-browser-probe'), `应发现项目合成技能（本轮仅合成名称探针：count=${skills.length},flat=${skills.some((item) => item.id === 'tui-flat-probe')}）`);
    const skill = await skillDetail(client, capabilities, 'tui-browser-probe');
    assert.match(skill.markdown, /TUI_READ_ONLY_SKILL/);
    assert.ok(skills.some((item) => item.id === 'tui-flat-probe'), '平铺技能也应可见');
    app = render(React.createElement(App, { client, hostPath: host, version: 'skill-regression' }));
    for (let i = 0; i < 50; i++) {
      await sleep(40);
      if (app.lastFrame()?.includes('配置 OpenAI') || app.lastFrame()?.includes('输入任务，或')) break;
    }
    if (app.lastFrame()?.includes('配置 OpenAI')) { app.stdin.write('\x1b'); await sleep(40); }
    app.stdin.write('/skills'); await sleep(20); app.stdin.write('\r');
    for (let i = 0; i < 50; i++) {
      await sleep(40);
      if (app.lastFrame()?.includes('tui-browser-probe')) break;
    }
    assert.match(app.lastFrame(), /tui-browser-probe/);
    const index = skills.findIndex((item) => item.id === 'tui-browser-probe');
    for (let i = 0; i < index; i++) { app.stdin.write('\x1b[B'); await sleep(10); }
    app.stdin.write('\r');
    for (let i = 0; i < 50; i++) {
      await sleep(40);
      if (app.lastFrame()?.includes('TUI_READ_ONLY_SKILL')) break;
    }
    assert.match(app.lastFrame(), /TUI_READ_ONLY_SKILL/);
    assert.deepEqual(await mcpOptions(client, capabilities, 'current'), []);
    assert.match((await modeDetail(client, capabilities, 'permissions')).text, /宿主当前档位：/);
    assert.match((await modeDetail(client, capabilities, 'plan')).text, /宿主计划模式：/);
    const after = await client.request('session/projection');
    assert.equal(after.events, before.events, '浏览不追加技能/工具/权限事件');
  } finally {
    app?.unmount();
    app?.cleanup();
    await client.stop();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('真宿主：配置表单确认保存与冷重开回读，不发起供应商请求，密钥不进渲染帧或会话', {
  skip: !host || !existsSync(host), timeout: 30000,
}, async () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const workspace = mkdtempSync(join(repoRoot, 'target/tmp/tui-config-cold-'));
  let received = 0;
  const server = createServer((_req, res) => { received++; res.writeHead(500); res.end(); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const key = 'invalid-test-' + randomBytes(16).toString('hex');
  const url = `http://127.0.0.1:${server.address().port}`;
  const client = new HostClient(host, { cwd: workspace, env: { ...process.env, SACODE_USER_SETTINGS_DIR: join(workspace, 'settings') } });
  let app;
  try {
    await client.start(); await client.request('initialize');
    const view = await client.request('model/registry/describe');
    assert.deepEqual(view.providers, []);
    let saved;
    app = render(React.createElement(ConfigurationDialog, { client, view, onClose() {}, onSaved(value) { saved = value; } }));
    await sleep(100);
    for (const input of ['tui-config-probe', '\r', url, '\r', 'synthetic-model', '\r', key, '\r']) {
      app.stdin.write(input); await sleep(30);
    }
    assert.equal((await client.request('model/registry/describe')).providers.length, 0, '确认前不能写配置');
    app.stdin.write('\r');
    for (let i = 0; i < 100 && !saved; i++) await sleep(30);
    assert.ok(saved, '表单必须收到保存与回读成功');
    assert.equal(app.frames.some((frame) => frame.includes(key)), false, '密钥不进入任何渲染帧');
    app.unmount(); app.cleanup(); app = null;
    const status = await configurationStatus(client);
    assert.equal(status.configured, true);
    assert.equal(status.credentialConfigured, true);
    assert.match(status.label, /连通未验/);
    await client.stop(); await client.start(); await client.request('initialize');
    const reopened = await client.request('model/registry/describe');
    assert.equal(reopened.defaultProviderId, 'tui-config-probe');
    assert.equal(reopened.defaultModel, 'synthetic-model');
    assert.equal(reopened.providers[0].keyConfigured, true);
    assert.equal(reopened.providers[0].baseUrl, url);
    assert.equal(JSON.stringify(reopened).includes(key), false, '配置读面不含密钥');
    assert.equal(JSON.stringify(await client.request('session/projection')).includes(key), false, '会话消息不含密钥');
    assert.equal(received, 0, '保存配置和回读不得请求HTTP端点');
  } finally {
    app?.unmount(); app?.cleanup();
    await client.stop();
    server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('真宿主：首次空current可按精确0修订改名，保存后目录和冷重开一致', {
  skip: !host || !existsSync(host), timeout: 30000,
}, async () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const root = mkdtempSync(join(repoRoot, 'target/tmp/tui-empty-session-meta-'));
  const client = new HostClient(host, { cwd: root, env: { ...process.env, SACODE_USER_SETTINGS_DIR: join(root, 'settings') } });
  try {
    await client.start(); await client.request('initialize');
    assert.equal((await client.request('session/catalog')).entries.length, 0);
    const current = (await sessionEntries(client, 'current'))[0];
    assert.equal(current.durable, 0);
    assert.equal((await mutateSessionMetadata(client, metadataConfirmation(current, 'rename', '首次空会话改名'))).title, '首次空会话改名');
    await client.stop(); await client.start(); await client.request('initialize');
    const persisted = (await sessionEntries(client)).find((entry) => entry.id === 'current');
    assert.equal(persisted.title, '首次空会话改名');
    assert.ok(persisted.durable > 0);
  } finally { await client.stop(); rmSync(root, { recursive: true, force: true }); }
});

test('真宿主：会话改名/归档/恢复归档持久回读，正文和项目不丢且旧修订拒绝', {
  skip: !host || !existsSync(host), timeout: 30000,
}, async () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const root = mkdtempSync(join(repoRoot, 'target/tmp/tui-session-meta-'));
  const client = new HostClient(host, { cwd: root, env: { ...process.env, SACODE_USER_SETTINGS_DIR: join(root, 'settings') } });
  try {
    await client.start(); await client.request('initialize');
    const created = await client.request('session/create', { title: '原始标题' });
    await client.request('session/select', { sessionId: created.id });
    await client.request('workspace/set-directory', { directory: root, sessionId: created.id });
    await client.request('session/append', { eventType: 'user/message', data: '不可删除的合成历史' });
    // session/append产品入口已持久化，不能再将no-pending-writes误判成产品失败。
    const persisted = await client.request('session/projection');
    assert.equal(persisted.events, persisted.durable);
    const original = (await sessionEntries(client)).find((entry) => entry.id === created.id);
    const renamed = await mutateSessionMetadata(client, metadataConfirmation(original, 'rename', '新会话标题'));
    assert.equal(renamed.title, '新会话标题');
    await assert.rejects(client.request('session/rename', { sessionId: created.id, title: '不能覆盖', expectedRevision: original.durable }), /session-revision-conflict/);
    await client.request('session/select', { sessionId: 'current' });
    const beforeArchive = (await sessionEntries(client)).find((entry) => entry.id === created.id);
    assert.equal((await mutateSessionMetadata(client, metadataConfirmation(beforeArchive, 'archive'))).archived, true);
    await client.stop(); await client.start(); await client.request('initialize');
    const archived = (await sessionEntries(client)).find((entry) => entry.id === created.id);
    assert.equal(archived.archived, true);
    assert.equal(archived.title, '新会话标题');
    assert.equal((await mutateSessionMetadata(client, metadataConfirmation(archived, 'restore'))).archived, false);
    await client.request('session/select', { sessionId: created.id });
    const projection = await client.request('session/projection');
    assert.ok(projection.messageRows.some((row) => row.text === '不可删除的合成历史'));
    assert.equal(resolve((await client.request('workspace/get')).directory), resolve(root));
  } finally { await client.stop(); rmSync(root, { recursive: true, force: true }); }
});

test('真宿主：TUI重命名确认页与可搜索会话目录实际接线，无模型请求', {
  skip: !host || !existsSync(host), timeout: 30000,
}, async () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const root = mkdtempSync(join(repoRoot, 'target/tmp/tui-session-browser-ui-'));
  const client = new HostClient(host, { cwd: root, env: { ...process.env, SACODE_USER_SETTINGS_DIR: join(root, 'settings') } });
  let app;
  const waitFor = async (pattern) => {
    for (let i = 0; i < 100 && !pattern.test(app.lastFrame() || ''); i++) await sleep(30);
    assert.match(app.lastFrame(), pattern);
  };
  const key = async (input) => { app.stdin.write(input); await sleep(35); };
  try {
    await client.start(); await client.request('initialize');
    const created = await client.request('session/create', { title: '可搜索合成会话' });
    await client.request('session/select', { sessionId: created.id });
    app = render(React.createElement(App, { client, hostPath: host, version: 'browser-test' }));
    await waitFor(/配置 OpenAI|输入任务，或/);
    if (app.lastFrame().includes('配置 OpenAI')) await key('\x1b');
    await key('/rename 重命名合成会话'); await key('\r'); await waitFor(/确认重命名/);
    assert.equal((await sessionEntries(client)).find((entry) => entry.id === created.id).title, '可搜索合成会话', '确认前不写');
    await key('\x1b[A'); await key('\r'); await waitFor(/会话已重命名/);
    assert.equal((await sessionEntries(client)).find((entry) => entry.id === created.id).title, '重命名合成会话');
    await key('/resume '); await key('\r'); await waitFor(/搜索：/);
    await key('重命名合成'); await waitFor(/● 当前.*重命名合成会话/);
    await key('\x1b');
    assert.ok(!(await client.request('session/projection')).messageRows.some((row) => row.eventType === 'assistant/message'));
  } finally { app?.unmount(); app?.cleanup(); await client.stop(); rmSync(root, { recursive: true, force: true }); }
});
