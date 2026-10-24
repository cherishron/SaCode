import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../renderer/settings-state.js';

function fixture(api = {}) {
  const ref = value => ({ value });
  const deps = Object.fromEntries(['globalAppearance','fontBusy','fontNote','appearanceBusy','appearanceNote','budgetDraft','budgetNote','budgetBusy','usage','generalPrefs','generalPrefsBusy','generalPrefsNote','busySendSaving','busySendNote','busySendError'].map(key => [key, ref('')]));
  deps.api = api;
  // 开机自启三态：null 表示还没读到，界面据此显示「读取中」而不是猜一个开关位置。
  deps.autoLaunch = ref(null); deps.autoLaunchBusy = ref(false); deps.autoLaunchNote = ref('');
  for (const key of ['tips','tipsHidden','tipsPressure','tipsBusy','tipsNote','tipsError']) deps[key] = ref(null);
  deps.catalogError = e => e.message;
  deps.getSessionGeneration = () => 0;
  deps.cleanErr = e => e.message;
  return { deps, assembly: globalThis.SaCodeSettings.createSettingsAssembly(deps) };
}

test('设置视图保留九个分类和方向键切换行为', () => {
  const self = { settingsOpen: true, settingsTab: 'general', globalAppearance: { theme: 'light', fontSize: 14 }, generalSettings: {}, generalPrefs: {}, tools: [] };
  const h = (tag, props, children) => ({ tag, props, children });
  const el = (tag, cls, children, props = {}) => h(tag, { class: cls, ...props }, children);
  globalThis.window = { SaCodeDialog: 'dialog', SaCodePlugins: { Page: 'plugins' }, SaCodeTooltip: { wrap: node => node }, Vue: { nextTick: fn => fn() } };
  let focused;
  globalThis.document = { getElementById: id => ({ focus: () => { focused = id; } }) };
  try {
    const view = globalThis.SaCodeSettings.renderSettings(self, { h, el, navIcon: path => h('svg', {}, path) });
    const body = view.children();
    const tabs = body[0].children[1].children;
    assert.equal(tabs.length, 9);
    tabs[0].props.onKeydown({ key: 'End', preventDefault() {} });
    assert.equal(self.settingsTab, 'about');
    assert.equal(focused, 'settings-tab-about');
    view.props.onClose();
    assert.equal(self.settingsOpen, false);
  } finally { delete globalThis.window; delete globalThis.document; }
});

// 关于页的版本读数：有读数就照实列版本与运行时，没有就写"正在读取"——
// 两种情况都不许退回到"版本信息暂不可用"的空话，也不许把更新检查说成能用。
function aboutTexts(self) {
  const h = (tag, props, children) => ({ tag, props, children });
  const el = (tag, cls, children, props = {}) => h(tag, { class: cls, ...props }, children);
  globalThis.window = { SaCodeDialog: 'dialog', SaCodePlugins: { Page: 'plugins' }, SaCodeTooltip: { wrap: node => node }, Vue: { nextTick: fn => fn() } };
  globalThis.document = { getElementById: () => ({ focus() {} }) };
  try {
    const view = globalThis.SaCodeSettings.renderSettings(self, { h, el, navIcon: path => h('svg', {}, path) });
    const texts = [];
    (function walk(node) {
      if (!node) return;
      if (typeof node === 'string') { texts.push(node); return; }
      const kids = typeof node.children === 'function' ? node.children() : node.children;
      if (Array.isArray(kids)) kids.forEach(walk);
      else if (kids) walk(kids);
    })(view);
    return texts.join('|');
  } finally { delete globalThis.window; delete globalThis.document; }
}

test('关于页呈现真实版本读数，不再用「暂不可用」顶替', () => {
  const about = aboutTexts({
    settingsOpen: true, settingsTab: 'about', globalAppearance: { theme: 'light', fontSize: 14 },
    generalSettings: {}, generalPrefs: {}, tools: [],
    aboutVersion: { app: '0.1.0', electron: '33.4.11', chrome: '130.0.0.0', node: '20.18.3', platform: 'win32', arch: 'x64', packaged: false },
  });
  assert.match(about, /版本 0\.1\.0（win32-x64 · 开发目录）/);
  assert.match(about, /Electron 33\.4\.11 · Chromium 130\.0\.0\.0 · Node 20\.18\.3/);
  assert.match(about, /更新检查尚未开放/);
  assert.doesNotMatch(about, /当前版本信息暂不可用/);
});

test('关于页版本读数未到位时只写「正在读取」，不伪造数字也不伪造更新入口', () => {
  const about = aboutTexts({
    settingsOpen: true, settingsTab: 'about', globalAppearance: { theme: 'light', fontSize: 14 },
    generalSettings: {}, generalPrefs: {}, tools: [], aboutVersion: null,
  });
  assert.match(about, /版本信息正在读取…/);
  assert.doesNotMatch(about, /当前版本信息暂不可用/);
  assert.doesNotMatch(about, /版本 \d/);
});

test('设置快捷键尊重模态边界，绑定可卸载', () => {
  let listener, removed, modal = false, prevented = 0;
  const settingsOpen = { value: false };
  const events = {
    addEventListener: (_name, fn) => { listener = fn; },
    removeEventListener: (_name, fn) => { removed = fn; },
  };
  const dispose = globalThis.SaCodeSettings.bindDesktopKeys({
    target: events, document: { querySelector: () => modal, getElementById: () => ({ focus() {} }) },
    settingsOpen, enhance: { value: {} }, undoEnhance() {}, openSide() {},
  });
  const press = () => listener({ key: ',', ctrlKey: true, preventDefault: () => prevented++ });
  press(); assert.equal(settingsOpen.value, true);
  modal = true; press(); assert.equal(settingsOpen.value, true);
  assert.equal(prevented, 2);
  dispose(); assert.equal(removed, listener);
});

test('提醒偏好保存回执才撤去提醒并释放繁忙状态', async () => {
  let resolve;
  const { deps, assembly } = fixture({ tipsSetHidden: () => new Promise(done => { resolve = done; }) });
  deps.tips.value = { text: '提醒' };
  const pending = assembly.setTipsHidden(true);
  assert.equal(deps.tipsBusy.value, true);
  assert.equal(deps.tips.value.text, '提醒');
  resolve({ hidden: true });
  await pending;
  assert.equal(deps.tips.value, null);
  assert.equal(deps.tipsHidden.value, true);
  assert.equal(deps.tipsBusy.value, false);
});

test('外观回读保留宿主全部字段，不自行默认字号或丢掉发送偏好', async () => {
  const view = { theme: 'dark', fontSize: 22, busySend: 'queue' };
  const { deps, assembly } = fixture({ globalAppearanceGet: async () => view });
  await assembly.refreshGlobalAppearance();
  assert.deepEqual(deps.globalAppearance.value, view);
});
test('字体与主题保存互斥', async () => {
  let calls = 0;
  const { deps, assembly } = fixture({ globalAppearanceSetFontSize: async () => { calls++; return {}; } });
  deps.appearanceBusy.value = true;
  await assembly.setFontSize(16);
  assert.equal(calls, 0);
});
test('发送偏好保存以宿主回执替换外观并释放繁忙标记', async () => {
  const view = { theme: 'light', fontSize: 16, busySend: 'queue' };
  const { deps, assembly } = fixture({ globalAppearanceSetBusySend: async () => view });
  await assembly.setBusySend('queue');
  assert.deepEqual(deps.globalAppearance.value, view);
  assert.equal(deps.busySendSaving.value, false);
});
test('预算拒绝无效输入，不发宿主请求', async () => {
  let calls = 0;
  const { deps, assembly } = fixture({ usageSetBudget: async () => { calls++; } });
  deps.budgetDraft.value = '-1';
  await assembly.setBudget();
  assert.equal(calls, 0);
  assert.equal(deps.budgetNote.value, '预算要填非负整数');
});
test('用量回读跨会话时不覆盖当前读数', async () => {
  let generation = 0;
  const { deps, assembly } = fixture({ usageStatus: async () => { generation++; return { used: 9, budget: 10 }; } });
  deps.getSessionGeneration = () => generation;
  const current = fixture(deps.api);
  current.deps.getSessionGeneration = () => generation;
  const controller = globalThis.SaCodeSettings.createSettingsAssembly(current.deps);
  await controller.refreshUsage();
  assert.equal(current.deps.usage.value, '');
});

test('上下文压力无可靠读数时清除旧值', async () => {
  const { deps, assembly } = fixture({ tipsGet: async () => ({ reliable: false, used: -1, window: 128000 }) });
  deps.tipsPressure.value = { projectedTokens: 99, contextWindow: 128000 };
  await assembly.refreshTips();
  assert.equal(deps.tipsPressure.value, undefined);
});

// 分母缺失只影响比例，不影响分子：真实用量照样要留下来给容量条显示。
test('容量未知时仍保留真实用量，不因换算不出比例而清空', async () => {
  const { deps, assembly } = fixture({ tipsGet: async () => ({ reliable: false, used: 12659, window: -1, percent: -1 }) });
  deps.tipsPressure.value = undefined;
  await assembly.refreshTips();
  assert.equal(deps.tipsPressure.value.projectedTokens, 12659);
});

// 新会话默认权限：只认核心 PermissionPolicy 的四档（plan/build/auto/yolo），
// 宿主返回未预期的值一律回落最保守的 build，不把未知串当设置生效。
test('新会话默认权限只接受四档，未知值回落最保守的 build', async () => {
  const sent = [];
  const { deps, assembly } = fixture({
    globalSettingsGet: async () => ({ transcriptView: 'default', composerEnter: 'send', sessionLog: 'off', defaultPermissionMode: 'nonsense' }),
    globalSettingsSet: async (key, value) => { sent.push([key, value]); return { transcriptView: 'default', composerEnter: 'send', sessionLog: 'off', defaultPermissionMode: value }; },
  });
  await assembly.refreshGeneralPrefs();
  assert.equal(deps.generalPrefs.value.defaultPermissionMode, 'build');
  await assembly.setGeneralPref('default-permission', 'yolo');
  assert.deepEqual(sent, [['default-permission', 'yolo']]);
  assert.equal(deps.generalPrefs.value.defaultPermissionMode, 'yolo');
});

// 只取通用页子树的文本：其他分类仍有自己的待接入说明，不能用它们的文案判定通用页。
function generalPageTexts(self) {
  const h = (tag, props, children) => ({ tag, props, children });
  const el = (tag, cls, children, props = {}) => h(tag, { class: cls, ...props }, children);
  globalThis.window = { SaCodeDialog: 'dialog', SaCodePlugins: { Page: 'plugins' }, SaCodeTooltip: { wrap: node => node }, Vue: { nextTick: fn => fn() } };
  globalThis.document = { getElementById: () => ({ focus() {} }) };
  try {
    const view = globalThis.SaCodeSettings.renderSettings(self, { h, el, navIcon: path => h('svg', {}, path) });
    const find = node => {
      if (!node || typeof node === 'string') return null;
      if (node.props && node.props.id === 'settings-page-general') return node;
      const kids = typeof node.children === 'function' ? node.children() : node.children;
      if (Array.isArray(kids)) { for (const kid of kids) { const hit = find(kid); if (hit) return hit; } }
      return null;
    };
    const texts = [];
    (function walk(node) {
      if (!node) return;
      if (typeof node === 'string') { texts.push(node); return; }
      const kids = typeof node.children === 'function' ? node.children() : node.children;
      if (Array.isArray(kids)) kids.forEach(walk);
      else if (kids) walk(kids);
    })(find(view));
    return texts.join('|');
  } finally { delete globalThis.window; delete globalThis.document; }
}

test('新会话默认权限渲染四档并说明只作用于新会话，不再留待接入占位', () => {
  const texts = generalPageTexts({
    settingsOpen: true, settingsTab: 'general', globalAppearance: { theme: 'light', fontSize: 14 },
    generalSettings: {}, generalPrefs: { defaultPermissionMode: 'build' }, tools: [], autoLaunch: null,
  });
  for (const label of ['Plan', 'Build', 'YOLO', 'Auto Review']) assert.ok(texts.includes(label), `缺少档位 ${label}`);
  assert.ok(texts.includes('只作用于之后新建的会话'), '必须说明只作用于新会话');
  assert.ok(!texts.includes('尚未接入'), '不能再留尚未接入的占位说明');
  assert.ok(!texts.includes('尚无系统启动项接口'), '不能再留无接口的占位说明');
});

// 开机自启：界面显示的是壳层回读的真实状态，不是刚提交的那一次请求。
test('开机自启读不到时不伪报开关状态', async () => {
  const { deps, assembly } = fixture({ autoLaunchGet: async () => { throw Error('boom'); } });
  await assembly.refreshAutoLaunch();
  assert.equal(deps.autoLaunch.value, null);
});

test('开机自启写入以壳层回读为准，系统未生效就不算已开启', async () => {
  const { deps, assembly } = fixture({
    autoLaunchGet: async () => ({ openAtLogin: false, openAsHidden: false, packaged: false, note: '开发目录下注册的是开发壳，安装版需在安装后另行设置。' }),
    autoLaunchSet: async () => ({ openAtLogin: false, openAsHidden: false, packaged: false, note: '' }),
  });
  await assembly.refreshAutoLaunch();
  assert.equal(deps.autoLaunch.value.openAtLogin, false);
  await assembly.setAutoLaunch(true);
  assert.equal(deps.autoLaunch.value.openAtLogin, false, '回读未生效时不能显示成已开启');
  assert.equal(deps.autoLaunchNote.value, '');
});

test('开机自启写入失败给出提示，保留原状态并释放繁忙', async () => {
  const { deps, assembly } = fixture({
    autoLaunchGet: async () => ({ openAtLogin: false, openAsHidden: false, packaged: false }),
    autoLaunchSet: async () => { throw Error('autolaunch-write-failed: 拒绝访问'); },
  });
  await assembly.refreshAutoLaunch();
  await assembly.setAutoLaunch(true);
  assert.ok(deps.autoLaunchNote.value.includes('开机自启设置失败'));
  assert.equal(deps.autoLaunch.value.openAtLogin, false);
  assert.equal(deps.autoLaunchBusy.value, false);
});

test('开机自启渲染真实开关状态，不再写不会修改系统设置', () => {
  const texts = generalPageTexts({
    settingsOpen: true, settingsTab: 'general', globalAppearance: { theme: 'light', fontSize: 14 },
    generalSettings: {}, generalPrefs: { defaultPermissionMode: 'build' }, tools: [],
    autoLaunch: { openAtLogin: true, packaged: false, note: '' },
  });
  assert.ok(texts.includes('已开启'), '有读数时应显示真实开关状态');
  assert.ok(!texts.includes('待接入'), '不能再有待接入按钮');
});

test('上下文读取跨会话与同会话乱序均不能覆盖最新读数', async () => {
  const pending = []; let generation = 0;
  const { deps } = fixture({ tipsGet: () => new Promise(resolve => pending.push(resolve)) });
  deps.getSessionGeneration = () => generation;
  const assembly = globalThis.SaCodeSettings.createSettingsAssembly(deps);
  const old = assembly.refreshTips(); generation++;
  const first = assembly.refreshTips(); const last = assembly.refreshTips();
  pending[2]({ reliable: true, used: 30, window: 100 }); await last;
  pending[1]({ reliable: true, used: 20, window: 100 }); await first;
  pending[0]({ reliable: true, used: 10, window: 100 }); await old;
  assert.equal(deps.tipsPressure.value.projectedTokens, 30);
});
