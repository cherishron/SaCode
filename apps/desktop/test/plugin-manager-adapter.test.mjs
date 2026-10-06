// 插件管理器适配器单测：字段校验、状态机、修订号透传、能力缺口 fail-loud。
// 这里只桩「通道边界」（window.sacode 的形状），不往仓库里塞任何 packages 快照；
// 所有清单事实都由桩按测试意图现算，产出代码里没有任何预制包列表。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const result = await build({
  entryPoints: [fileURLToPath(new URL('../renderer/pages/plugin-manager-adapter.ts', import.meta.url))],
  bundle: true, write: false, format: 'cjs', logLevel: 'warning',
});
const context = { module: { exports: {} }, setTimeout, clearTimeout, console };
vm.runInNewContext(result.outputFiles[0].text, context);
const { createPluginManagerAdapter, createSacodePluginManagerAdapter, normalizeInventory } = context.module.exports;

const clone = (v) => JSON.parse(JSON.stringify(v));
// vm 里造出的数组/对象带另一个 realm 的原型，严格比较要先转回本 realm
const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const packageFixture = () => ({
  name: '@sample/plugin', title: '示例插件', version: '1.2.0', description: '插件说明', descriptionZhCN: null,
  installed: true, optional: false, enabled: false, readOnlyReason: null, error: null,
  rows: [
    { rowId: 'row0', title: '组件0', moduleName: '@sample/mod-0', entryId: null, description: null, descriptionZhCN: null, enabled: false, phase: null, readOnlyReason: '只读组件' },
    { rowId: 'row1', title: '组件1', moduleName: '@sample/mod-1', entryId: 'entry-1', description: '组件说明', descriptionZhCN: null, enabled: true, phase: 'active', readOnlyReason: null },
  ],
});
const inventory = (patch = {}) => ({ available: true, revision: 7, packages: [packageFixture()], ...patch });
const progress = (patch = {}) => ({
  requestId: 'p1', phase: 'installing', subject: { name: '示例插件', host: null, version: '1.2.0', description: null },
  runs: [{ jobId: 'job1', command: 'pnpm add', cwd: 'D:/profile', output: 'line', exitCode: undefined }],
  registries: ['https://registry.npmjs.org/'], total: 1, failure: null, installed: null,
  restartRequired: false, approvedBuilds: [], ...patch,
});

function host(patch = {}) {
  const state = { inventory: inventory(), registries: { registry: null, fallbackRegistries: ['https://registry.npmmirror.com/'], resolved: null } };
  Object.assign(state, patch);
  const calls = [];
  const responses = { inspect: [], progress: [] };
  let lastProgress = progress();
  const applyBundle = (name, enabled) => {
    const pkg = state.inventory.packages.find((p) => p.name === name);
    if (pkg) pkg.enabled = enabled;
  };
  const faces = {
    describe: async () => { calls.push(['describe']); return clone(state.inventory); },
    registries: async () => { calls.push(['registries']); return clone(state.registries); },
    setEnabled: async (name, enabled, expectedRevision) => {
      calls.push(['setEnabled', name, enabled, expectedRevision]);
      if (expectedRevision !== state.inventory.revision) throw new Error('-32021 plugin-conflict');
      applyBundle(name, enabled); state.inventory.revision = expectedRevision + 1; return {};
    },
    setRowEnabled: async (entryId, enabled, expectedRevision) => {
      calls.push(['setRowEnabled', entryId, enabled, expectedRevision]);
      if (expectedRevision !== state.inventory.revision) throw new Error('-32021 plugin-conflict');
      const pkg = state.inventory.packages[0];
      const row = pkg.rows.find((r) => r.entryId === entryId);
      if (row) row.enabled = enabled;
      state.inventory.revision = expectedRevision + 1; return {};
    },
    remove: async (name, expectedRevision) => {
      calls.push(['remove', name, expectedRevision]);
      if (expectedRevision !== state.inventory.revision) throw new Error('-32021 plugin-conflict');
      state.inventory.packages = state.inventory.packages.filter((p) => p.name !== name);
      state.inventory.revision = expectedRevision + 1; return {};
    },
    inspect: async (spec, registry) => { calls.push(['inspect', spec, registry]); const next = responses.inspect.shift(); if (next instanceof Error) throw next; if (!next) throw new Error('-32020 plugin-rejected'); return clone(next); },
    installStart: async (request) => { calls.push(['installStart', clone(request)]); if (responses.installStart instanceof Error) throw responses.installStart; return {}; },
    installProgress: async (requestId) => {
      calls.push(['installProgress', requestId]);
      const next = responses.progress.shift();
      if (next instanceof Error) throw next;
      if (next) lastProgress = next;
      // 宿主回报的 requestId 必须与适配器发出去的一致，否则就是答非所问
      return clone({ ...lastProgress, requestId });
    },
    installCancel: async (requestId) => { calls.push(['installCancel', requestId]); if (responses.installCancel instanceof Error) throw responses.installCancel; return { cancelled: true }; },
  };
  return { faces, calls, responses, state, kind: (name) => calls.filter((c) => c[0] === name).length };
}

test('清单载荷逐字段校验，缺字段与重名都整份拒收', () => {
  assert.deepEqual(normalizeInventory(inventory()).packages[0].rows[1].entryId, 'entry-1');
  for (const bad of [null, {}, { available: true, revision: -1, packages: [] }, { available: 'yes', revision: 1, packages: [] },
    { available: true, revision: 1.5, packages: [] }, { available: true, revision: 1, packages: {} },
    inventory({ packages: [packageFixture(), packageFixture()] }),
    inventory({ packages: [{ ...packageFixture(), installed: 'yes' }] }),
    inventory({ packages: [{ ...packageFixture(), rows: 'none' }] }),
    inventory({ packages: [{ ...packageFixture(), rows: [{ ...packageFixture().rows[1], phase: 'ghost' }] }] }),
    inventory({ packages: [{ ...packageFixture(), rows: [packageFixture().rows[1], packageFixture().rows[1]] }] })]) {
    assert.throws(() => normalizeInventory(bad), /plugin-inventory-rejected/, JSON.stringify(bad));
  }
});

test('available=false 交出空清单，不伪造任何包', async () => {
  const h = host({ inventory: { available: false, revision: 0, packages: [] } });
  const adapter = createPluginManagerAdapter(h.faces);
  const view = await adapter.read();
  assert.equal(view.available, false);
  assert.deepEqual(plain(view.packages), []);
  assert.equal(view.install.phase, 'idle');
  assert.equal(h.kind('describe'), 1);
});

test('read 把宿主字段映射成页面形状，本地编辑不重复读宿主', async () => {
  const h = host();
  const adapter = createPluginManagerAdapter(h.faces);
  const first = await adapter.read();
  assert.equal(first.available, true);
  assert.equal(first.packages[0].name, '@sample/plugin');
  assert.equal(first.packages[0].version, '1.2.0');
  assert.equal(first.packages[0].rows[0].id, 'row0');
  assert.equal(first.packages[0].rows[0].name, '组件0');
  assert.equal(first.packages[0].rows[0].entryId, undefined);
  assert.equal(first.packages[0].rows[0].readOnlyReason, '只读组件');
  assert.equal(first.packages[0].rows[1].phase, 'active');
  assert.equal(h.kind('describe'), 1);
  await adapter.read();
  assert.equal(h.kind('describe'), 1, '没有新事实时不重复读宿主');
  await adapter.dispatch({ kind: 'edit-spec', text: '@sample/new' });
  const edited = await adapter.read();
  assert.equal(edited.install.spec, '@sample/new');
  assert.equal(h.kind('describe'), 1, '纯本地编辑不穿透到宿主');
  await adapter.dispatch({ kind: 'refresh' });
  assert.equal(h.kind('describe'), 2, '显式刷新必须重读');
});

test('启停与卸载带修订号，冲突后自愈重读再带新修订号', async () => {
  const h = host();
  const adapter = createPluginManagerAdapter(h.faces);
  await adapter.read();
  await adapter.dispatch({ kind: 'enable-package', name: '@sample/plugin', enabled: true });
  assert.deepEqual(plain(h.calls.find((c) => c[0] === 'setEnabled')), ['setEnabled', '@sample/plugin', true, 7]);
  const after = await adapter.read();
  assert.equal(after.packages[0].enabled, true);
  assert.equal(h.kind('describe'), 2);

  await adapter.dispatch({ kind: 'enable-row', entryId: 'entry-1', enabled: false });
  assert.deepEqual(plain(h.calls.find((c) => c[0] === 'setRowEnabled')), ['setRowEnabled', 'entry-1', false, 8]);

  // 别的入口先改过：宿主按修订号拒绝，适配器必须重读拿到新号，而不是拿旧号反复撞同一条错
  h.state.inventory.revision = 99;
  await assert.rejects(() => adapter.dispatch({ kind: 'enable-package', name: '@sample/plugin', enabled: false }), (e) => e.code === 'plugin-conflict');
  assert.equal(h.kind('describe'), 3, '冲突后必须重读');
  await adapter.dispatch({ kind: 'enable-package', name: '@sample/plugin', enabled: false });
  assert.deepEqual(plain(h.calls.filter((c) => c[0] === 'setEnabled').at(-1)), ['setEnabled', '@sample/plugin', false, 99]);
  adapter.dispose();
});

test('卸载先本地确认，确认后才穿透宿主并清掉高亮', async () => {
  const h = host();
  const adapter = createPluginManagerAdapter(h.faces);
  await adapter.read();
  await adapter.dispatch({ kind: 'uninstall', name: '@sample/plugin' });
  let view = await adapter.read();
  assert.equal(view.confirm, '@sample/plugin');
  assert.equal(h.kind('remove'), 0, '确认对话框本身不能移除任何东西');
  await adapter.dispatch({ kind: 'cancel-confirm' });
  view = await adapter.read();
  assert.equal(view.confirm, undefined);
  await adapter.dispatch({ kind: 'uninstall', name: '@sample/plugin' });
  await adapter.dispatch({ kind: 'confirm-uninstall' });
  assert.deepEqual(plain(h.calls.find(c => c[0] === 'remove')), ['remove', '@sample/plugin', 7]);
  view = await adapter.read();
  assert.equal(view.confirm, undefined);
  h.state.inventory.packages = [];
  await adapter.dispatch({ kind: 'refresh' });
  assert.deepEqual(plain((await adapter.read()).packages), []);
  adapter.dispose();
});

test('安装全流程：检查→启动→运行→完成，进度由宿主推进', async () => {
  const h = host();
  const adapter = createPluginManagerAdapter(h.faces);
  let notified = 0;
  adapter.subscribe(() => { notified += 1; });
  await adapter.read();
  await adapter.dispatch({ kind: 'open-install' });
  assert.deepEqual(plain(h.calls.find(c => c[0] === 'registries')), ['registries']);
  let view = await adapter.read();
  assert.equal(view.install.open, true);
  assert.deepEqual(plain(view.install.registries), [{ name: '默认安装源', url: '' }, { name: '来自 registry.npmmirror.com', url: 'https://registry.npmmirror.com/' }]);

  // 列表里已有的名字在问宿主之前就拒：不能先让 pnpm 跑一遍再告诉用户装过了
  await adapter.dispatch({ kind: 'edit-spec', text: ' @sample/plugin ' });
  await adapter.dispatch({ kind: 'run-install' });
  view = await adapter.read();
  assert.equal(view.install.phase, 'idle');
  assert.equal(view.install.inputError, '这个插件已经安装。');
  assert.equal(h.kind('inspect'), 0, '已安装的包不劳宿主');
  assert.equal(h.kind('installStart'), 0);

  h.responses.inspect = [{ status: 'refused', problem: 'no-matching-version', reason: '没有 9.x' }];
  await adapter.dispatch({ kind: 'edit-spec', text: '@sample/new-plugin' });
  await adapter.dispatch({ kind: 'run-install' });
  view = await adapter.read();
  assert.equal(view.install.phase, 'idle');
  assert.equal(view.install.inputError, '没有匹配的版本，请换个版本范围或安装源。');
  assert.equal(h.kind('installStart'), 0, '规格被拒就不启动安装');

  h.responses.inspect = [{ status: 'accepted', name: '新插件', host: null, version: '2.0.0', description: '新插件说明' }];
  await adapter.dispatch({ kind: 'run-install' });
  assert.deepEqual(plain(h.calls.find(c => c[0] === 'inspect')), ['inspect', '@sample/new-plugin', '']);
  const started = plain(h.calls.find(c => c[0] === 'installStart'));
  assert.equal(started[0], 'installStart');
  assert.equal(started[1].spec, '@sample/new-plugin');
  assert.equal(started[1].registry, '');
  assert.match(started[1].requestId, /^p[\w-]{8,}$/);
  assert.deepEqual(started[1].approvedBuilds, []);
  view = await adapter.read();
  assert.equal(view.install.phase, 'starting');
  assert.equal(view.install.subject.name, '新插件');
  assert.equal(view.install.subject.version, '2.0.0');
  assert.equal(notified, 0, '没有进度时不无病呻吟');

  await adapter.dispatch({ kind: 'reconcile-install' });
  view = await adapter.read();
  assert.equal(view.install.phase, 'running');
  assert.equal(view.install.runs[0].command, 'pnpm add');
  assert.deepEqual(plain(view.install.attempts), { registries: ['https://registry.npmjs.org/'], total: 1 });
  assert.equal(notified > 0, true, '进度推进必须通知订阅方');

  h.responses.progress = [progress({ phase: 'failed', failure: { code: 'pnpm-failed', reason: '安装脚本退出 1', kind: 'build-blocked', failedAt: 'registry', pendingBuilds: ['@sample/build'] }, runs: [{ jobId: 'job1', command: 'pnpm add', cwd: 'D:/profile', output: 'boom', exitCode: 1 }] })];
  await adapter.dispatch({ kind: 'reconcile-install' });
  view = await adapter.read();
  assert.equal(view.install.phase, 'failed');
  assert.deepEqual(plain(view.install.failure.pendingBuilds), ['@sample/build']);
  assert.equal(view.install.failure.failedAt, 'registry');
  assert.equal(view.install.failure.kind, 'build-blocked');
  assert.equal(view.install.runs[0].exitCode, 1);

  h.responses.progress = [progress({ phase: 'installing' })];
  await adapter.dispatch({ kind: 'approve-builds' });
  assert.deepEqual(plain(h.calls.filter(c => c[0] === 'installStart').at(-1)[1].approvedBuilds), ['@sample/build']);
  assert.equal((await adapter.read()).install.phase, 'starting');

  h.responses.progress = [progress({ phase: 'done', installed: '@sample/new-plugin', restartRequired: true, runs: [{ jobId: 'job1', command: 'pnpm add', cwd: 'D:/profile', output: 'ok', exitCode: 0 }] })];
  await adapter.dispatch({ kind: 'reconcile-install' });
  view = await adapter.read();
  assert.equal(view.install.phase, 'done');
  assert.equal(view.install.installed, '@sample/new-plugin');
  assert.equal(view.install.restartRequired, true);
  assert.equal(view.highlight, '@sample/new-plugin');
  assert.equal(h.kind('describe') > 2, true, '安装结算后必须重读清单');

  await adapter.dispatch({ kind: 'close-install' });
  await adapter.dispatch({ kind: 'open-install' });
  view = await adapter.read();
  assert.equal(view.install.phase, 'idle');
  assert.equal(view.install.open, true);
  adapter.dispose();
});

test('安装取消、结果丢失与未知任务都如实落到对应相位', async () => {
  const h = host();
  const adapter = createPluginManagerAdapter(h.faces);
  await adapter.read();
  await adapter.dispatch({ kind: 'open-install' });
  await adapter.dispatch({ kind: 'edit-spec', text: '@sample/cancel' });
  h.responses.inspect = [{ status: 'accepted', name: '取消示例' }];
  await adapter.dispatch({ kind: 'run-install' });
  h.responses.installCancel = new Error('-32025 plugin-install-lost');
  await adapter.dispatch({ kind: 'cancel-install' });
  let view = await adapter.read();
  assert.equal(view.install.phase, 'unconfirmed');
  assert.equal(view.install.failure.uncertainty, 'cancellation');
  assert.equal(view.install.spec, '@sample/cancel', '未确认的取消不能抹掉用户输入的规格');

  h.responses.progress = [progress({ phase: 'cancelled' })];
  await adapter.dispatch({ kind: 'reconcile-install' });
  view = await adapter.read();
  assert.equal(view.install.phase, 'idle');
  assert.equal(view.notice, '安装已取消。');
  assert.equal(view.install.spec, '@sample/cancel');

  h.responses.inspect = [{ status: 'accepted', name: '再试' }];
  await adapter.dispatch({ kind: 'open-install' });
  await adapter.dispatch({ kind: 'edit-spec', text: '@sample/lost' });
  await adapter.dispatch({ kind: 'run-install' });
  h.responses.progress = [new Error('-32025 plugin-install-lost')];
  await adapter.dispatch({ kind: 'reconcile-install' });
  view = await adapter.read();
  assert.equal(view.install.phase, 'unconfirmed');
  assert.equal(view.install.failure.uncertainty, 'result');

  // 关窗不撤请求：重开后仍在核对，宿主明说没有这个任务才落到 unknown
  await adapter.dispatch({ kind: 'close-install' });
  await adapter.dispatch({ kind: 'open-install' });
  view = await adapter.read();
  assert.equal(view.install.phase, 'unconfirmed');
  h.responses.progress = [progress({ phase: 'unknown' })];
  await adapter.dispatch({ kind: 'reconcile-install' });
  view = await adapter.read();
  assert.equal(view.install.phase, 'unknown');
  adapter.dispose();
});

test('关闭进行中的安装窗口即请求取消，且取消失败不影响关闭', async () => {
  const h = host();
  const adapter = createPluginManagerAdapter(h.faces);
  await adapter.read();
  await adapter.dispatch({ kind: 'open-install' });
  await adapter.dispatch({ kind: 'edit-spec', text: '@sample/close' });
  h.responses.inspect = [{ status: 'accepted', name: '关窗示例' }];
  await adapter.dispatch({ kind: 'run-install' });
  assert.equal((await adapter.read()).install.phase, 'starting');
  await adapter.dispatch({ kind: 'close-install' });
  let view = await adapter.read();
  assert.equal(view.install.open, false, '关窗必须立刻生效，不等取消应答');
  assert.equal(view.install.spec, '@sample/close', '关窗不抹掉规格，重开还能继续');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(h.kind('installCancel'), 1, 'pending 相位下关窗要请求取消');
  view = await adapter.read();
  assert.equal(view.install.phase, 'cancelling');
  adapter.dispose();
});

test('标签页关掉再打开：同一个实例要先停表、再能重新读', async () => {
  const h = host();
  const adapter = createPluginManagerAdapter(h.faces);
  await adapter.read();
  let notified = 0;
  const off = adapter.subscribe(() => { notified += 1; });
  await adapter.dispatch({ kind: 'open-install' });
  await adapter.dispatch({ kind: 'edit-spec', text: '@sample/remount' });
  h.responses.inspect = [{ status: 'accepted', name: '重开示例' }];
  await adapter.dispatch({ kind: 'run-install' });
  assert.equal((await adapter.read()).install.phase, 'starting');
  adapter.dispose();
  assert.equal(notified, 0, '没有进度推进时不该发通知');
  await new Promise((resolve) => setTimeout(resolve, 900));
  // 关掉标签页不等于报废这个实例：app 只建一次适配器，重开时还是它
  const reopened = await adapter.read();
  assert.equal(reopened.install.phase, 'starting', '重开后不能永远停在读取失败');
  assert.equal(reopened.install.spec, '@sample/remount', '重开不丢用户输过的规格');
  // 与上游 ensure() 一致：重 mount 不自动重读（没有新事实就不穿透），要新事实就显式刷新
  await adapter.dispatch({ kind: 'refresh' });
  assert.equal(h.kind('describe'), 2, '重开后显式刷新要重读宿主');
  adapter.dispose();
});

test('安装轮询推进时通知订阅方，卸载后停止', async () => {
  const h = host();
  const adapter = createPluginManagerAdapter(h.faces);
  await adapter.read();
  await adapter.dispatch({ kind: 'open-install' });
  await adapter.dispatch({ kind: 'edit-spec', text: '@sample/poll' });
  h.responses.inspect = [{ status: 'accepted', name: '轮询示例' }];
  let notified = 0;
  adapter.subscribe(() => { notified += 1; });
  await adapter.dispatch({ kind: 'run-install' });
  assert.equal((await adapter.read()).install.phase, 'starting');
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.equal(notified > 0, true, '定时轮询必须驱动订阅方重读');
  assert.equal((await adapter.read()).install.phase, 'running');
  adapter.dispose();
  const calls = h.kind('installProgress');
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(h.kind('installProgress'), calls, 'dispose 之后不能继续轮询');
});

test('通道不齐时整体不接线，缺哪条就拒哪条且不写本地状态', async () => {
  assert.equal(createSacodePluginManagerAdapter(undefined), null);
  assert.equal(createSacodePluginManagerAdapter({}), null);
  const bare = createSacodePluginManagerAdapter({ pluginsDescribe: async () => ({ available: false, revision: 0, packages: [] }) });
  assert.deepEqual(plain(bare.unwired), ['enable', 'uninstall', 'install']);
  const view = await bare.adapter.read();
  assert.equal(view.available, false);
  assert.deepEqual(plain(view.unwired), ['enable', 'uninstall', 'install']);
  await assert.rejects(() => bare.adapter.dispatch({ kind: 'enable-package', name: 'x', enabled: true }), (e) => e.code === 'plugin-channel-missing:enable');
  await assert.rejects(() => bare.adapter.dispatch({ kind: 'uninstall', name: 'x' }).then(() => bare.adapter.dispatch({ kind: 'confirm-uninstall' })), (e) => e.code === 'plugin-channel-missing:uninstall');
  await assert.rejects(() => bare.adapter.dispatch({ kind: 'run-install' }), (e) => e.code === 'plugin-channel-missing:install');
  // 拒绝之后页面读到的仍然只有宿主说过的话：没有任何一处本地 enabled 被写进去
  const after = await bare.adapter.read();
  assert.equal(after.available, false);
  assert.deepEqual(plain(after.packages), []);
  assert.equal(after.install.phase, 'idle');
  bare.adapter.dispose();
});

test('出厂绑定把 preload 顶层 key 逐一接到通道上', async () => {
  const seen = [];
  const api = {
    pluginsDescribe: async () => { seen.push('pluginsDescribe'); return inventory(); },
    pluginsSetEnabled: async (...a) => { seen.push(['pluginsSetEnabled', ...a]); return {}; },
    pluginsSetRowEnabled: async (...a) => { seen.push(['pluginsSetRowEnabled', ...a]); return {}; },
    pluginsUninstall: async (...a) => { seen.push(['pluginsUninstall', ...a]); return {}; },
    pluginsRegistries: async () => { seen.push('pluginsRegistries'); return { registry: null, fallbackRegistries: [], resolved: null }; },
    pluginsInspect: async (...a) => { seen.push(['pluginsInspect', ...a]); return { status: 'accepted', name: 'x' }; },
    pluginsInstall: async (...a) => { seen.push(['pluginsInstall', a[0].spec]); return {}; },
    pluginsInstallPoll: async (requestId) => { seen.push('pluginsInstallPoll'); return progress({ phase: 'done', installed: 'x', requestId }); },
    pluginsInstallCancel: async () => { seen.push('pluginsInstallCancel'); return { cancelled: true }; },
  };
  const bound = createSacodePluginManagerAdapter(api);
  assert.deepEqual(plain(bound.unwired), []);
  await bound.adapter.read();
  await bound.adapter.dispatch({ kind: 'enable-package', name: '@sample/plugin', enabled: true });
  await bound.adapter.dispatch({ kind: 'enable-row', entryId: 'entry-1', enabled: false });
  await bound.adapter.dispatch({ kind: 'uninstall', name: '@sample/plugin' });
  await bound.adapter.dispatch({ kind: 'confirm-uninstall' });
  await bound.adapter.dispatch({ kind: 'open-install' });
  await bound.adapter.dispatch({ kind: 'edit-spec', text: 'x' });
  await bound.adapter.dispatch({ kind: 'run-install' });
  await bound.adapter.dispatch({ kind: 'cancel-install' });
  await bound.adapter.dispatch({ kind: 'reconcile-install' });
  const kinds = seen.map((s) => (Array.isArray(s) ? s[0] : s));
  for (const key of ['pluginsDescribe', 'pluginsSetEnabled', 'pluginsSetRowEnabled', 'pluginsUninstall', 'pluginsRegistries', 'pluginsInspect', 'pluginsInstall', 'pluginsInstallPoll', 'pluginsInstallCancel']) {
    assert.equal(kinds.includes(key), true, `通道 ${key} 未被适配器使用`);
  }
  bound.adapter.dispose();
});

test('产出代码不落本地存储，页面挂载必须传入适配器', () => {
  const here = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const sources = {
    adapter: here('../renderer/pages/plugin-manager-adapter.ts'),
    page: here('../renderer/pages/plugin-manager.ts'),
    app: here('../renderer/app.js'),
  };
  for (const [name, code] of Object.entries(sources)) {
    assert.equal(/localStorage|sessionStorage|indexedDB/.test(code), false, `${name} 不能把插件状态存进浏览器本地存储`);
    assert.equal(/new Function\(|\beval\(/.test(code), false, `${name} 不能运行时求值`);
  }
  // 挂载点：没有 adapter 就是未接线，不能靠页面里的默认快照冒充
  assert.equal(/h\(window\.SaCodePluginManager\.Page,\{adapter:/.test(sources.app), true);
  assert.equal(/h\(window\.SaCodePluginManager\.Page\]/.test(sources.app), false);
  assert.equal(/h\(window\.SaCodePluginManager\.Page\)/.test(sources.app), false);
  // 适配器只从窗口拿通道，不自己拼 IPC 方法名
  assert.equal(/pluginsDescribe/.test(sources.adapter), true);
  assert.equal(/ipcRenderer/.test(sources.adapter), false);
});
