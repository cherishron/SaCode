// 网络搜索设置面（web/settings/*）：真实宿主端到端——默认快照、修订屏障、
// 独立凭证通道与「密钥不进设置文件」的边界都在这里核，不靠替身自证。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { HostBridge } = require('../host-bridge.cjs');
const host = process.env.SACODE_HOST || resolve('dist/host/bin/sacode-host.exe');

const WEB_METHODS = ['web/settings/describe', 'web/settings/apply', 'web/settings/set-credential'];
// 七家提供方的密钥引用名：测试一律从空环境起步，读面的「已配置」只反映本测试自己的写入。
const KEY_VARS = ['EXA_API_KEY', 'PERPLEXITY_API_KEY', 'TAVILY_API_KEY', 'FIRECRAWL_API_KEY', 'PARALLEL_API_KEY', 'TINYFISH_API_KEY', 'DEEPSEEK_API_KEY'];

function fixture(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sacode-web-settings-'));
  const home = join(root, '主目录');
  const settings = join(root, '用户配置');
  const env = { ...process.env, USERPROFILE: home, HOME: home, SACODE_USER_SETTINGS_DIR: settings, SACODE_PROVIDER_BASE_URL: '' };
  for (const name of KEY_VARS) env[name] = '';
  Object.assign(env, extra);
  return { root, home, settings, env };
}
async function start(root, name, env) {
  const session = join(root, name); mkdirSync(session);
  writeFileSync(join(session, 'session.log'), '0\tuser/message\t中文任务\n');
  const bridge = new HostBridge(host, env); await bridge.start(session);
  return { bridge, session };
}
const byId = (view, id) => view.providers.find((p) => p.id === id);
const webJsonPath = (f) => join(f.home, '.sacode', 'web.json');

test('网络搜索设置面：声明动词、文件缺席时的默认快照且读面不落盘', async () => {
  const f = fixture(), a = await start(f.root, '读面', f.env);
  try {
    const init = await a.bridge.request('initialize');
    for (const method of WEB_METHODS) assert.ok(init.capabilities.includes(method), `未声明 ${method}`);
    const view = await a.bridge.request('web/settings/describe');
    assert.equal(view.revision, 0);
    assert.equal(view.enabled, false, '默认关闭：没有显式启用就不给模型网络工具');
    assert.equal(view.selectedProvider, '');
    assert.equal(view.providers.length, 6, '文件缺席时快照是 6 家默认提供方');
    const exa = byId(view, 'exa');
    assert.equal(exa.endpoint, 'https://api.exa.ai');
    assert.equal(exa.defaults.endpoint, 'https://api.exa.ai', '默认值由核心构造器给出，读面如实回传');
    assert.equal(exa.defaults.maxUses, 5);
    assert.deepEqual(exa.credential, { configured: false, writable: true });
    assert.equal(existsSync(webJsonPath(f)), false, '读面不落盘');
    assert.equal(existsSync(join(f.settings, 'credentials.env')), false, '读面不落密钥文件');
  } finally { await a.bridge.stop(); }
});

test('修订屏障：写入必须点名修订号，冲突拒绝且不改写已落盘文档', async () => {
  const f = fixture(), a = await start(f.root, '写面', f.env);
  try {
    await assert.rejects(() => a.bridge.request('web/settings/apply', { patch: { enabled: true } }), /bad-web-settings-params/);
    await assert.rejects(() => a.bridge.request('web/settings/apply', { expectedRevision: -1, patch: { enabled: true } }), /bad-web-settings-params/);
    await assert.rejects(() => a.bridge.request('web/settings/apply', { expectedRevision: 0, patch: { revision: 0, enabled: true } }), /bad-web-settings-params/);
    await assert.rejects(() => a.bridge.request('web/settings/apply', { expectedRevision: 0, patch: { evil: 1 } }), /web-unknown-setting/);
    await assert.rejects(() => a.bridge.request('web/settings/apply', { expectedRevision: 0, patch: { providers: [{ id: 'nope' }] } }), /web-provider-unknown/);
    assert.equal(existsSync(webJsonPath(f)), false, '被拒的写入不落盘');
    const saved = await a.bridge.request('web/settings/apply', { expectedRevision: 0, patch: { enabled: true, selectedProvider: 'tavily', providers: [{ id: 'tavily', endpoint: 'https://search.example.com/v1', maxUses: 7 }] } });
    assert.equal(saved.revision, 1);
    assert.equal(saved.enabled, true);
    assert.equal(saved.selectedProvider, 'tavily');
    assert.equal(byId(saved, 'tavily').endpoint, 'https://search.example.com/v1');
    assert.equal(byId(saved, 'tavily').maxUses, 7);
    assert.equal(byId(saved, 'tavily').defaults.endpoint, 'https://api.tavily.com', '默认值不随覆盖漂移');
    assert.match(readFileSync(webJsonPath(f), 'utf8'), /https:\/\/search\.example\.com\/v1/);
    await assert.rejects(() => a.bridge.request('web/settings/apply', { expectedRevision: 0, patch: { enabled: false } }), /web-settings-conflict/);
    assert.equal(JSON.parse(readFileSync(webJsonPath(f), 'utf8')).revision, 1, '冲突不得改写文件');
  } finally { await a.bridge.stop(); }
});

test('密钥走独立凭证通道：进 credentials.env，不进设置文件也不回传', async () => {
  const f = fixture(), a = await start(f.root, '密钥', f.env), b = await start(f.root, '另一进程', f.env);
  try {
    await a.bridge.request('web/settings/apply', { expectedRevision: 0, patch: { enabled: true } });
    await assert.rejects(() => a.bridge.request('web/settings/set-credential', { providerId: 'nope', key: 'x' }), /bad-web-credential-params/);
    await assert.rejects(() => a.bridge.request('web/settings/set-credential', { providerId: 'exa', key: '' }), /bad-web-credential-params/);
    await assert.rejects(() => a.bridge.request('web/settings/set-credential', { providerId: 'exa', key: 'bad\nkey' }), /bad-credential-value/);
    const saved = await a.bridge.request('web/settings/set-credential', { providerId: 'exa', key: 'fixture-web-key' });
    assert.deepEqual(byId(saved, 'exa').credential, { configured: true, writable: true });
    assert.equal(saved.enabled, true, '写密钥不改动设置文档的其它字段');
    assert.equal(JSON.stringify(saved).includes('fixture-web-key'), false, '写回执不得包含密钥本体');
    assert.match(readFileSync(join(f.settings, 'credentials.env'), 'utf8'), /EXA_API_KEY=fixture-web-key/);
    const view = await b.bridge.request('web/settings/describe');
    assert.deepEqual(byId(view, 'exa').credential, { configured: true, writable: true }, '另一进程立即见到已配置');
    assert.equal(JSON.stringify(view).includes('fixture-web-key'), false, '读面不得回传密钥本体');
    assert.equal(readFileSync(webJsonPath(f), 'utf8').includes('fixture-web-key'), false, '设置文件不得出现密钥本体');
  } finally { await a.bridge.stop(); await b.bridge.stop(); }
});

test('环境变量提供的密钥只读：describe 如实标记，set 拒绝且不落盘', async () => {
  const f = fixture({ EXA_API_KEY: 'env-fixture-key' }), a = await start(f.root, '环境', f.env);
  try {
    const view = await a.bridge.request('web/settings/describe');
    assert.deepEqual(byId(view, 'exa').credential, { configured: true, writable: false });
    assert.deepEqual(byId(view, 'tavily').credential, { configured: false, writable: true });
    await assert.rejects(() => a.bridge.request('web/settings/set-credential', { providerId: 'exa', key: 'new-fixture-key' }), /web-credential-read-only/);
    assert.equal(existsSync(join(f.settings, 'credentials.env')), false, '拒绝后不得落盘');
  } finally { await a.bridge.stop(); }
});
