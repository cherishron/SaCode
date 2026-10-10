import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../renderer/settings-state.js';

function fixture(api = {}) {
  const ref = value => ({ value });
  const deps = Object.fromEntries(['globalAppearance','fontBusy','fontNote','appearanceBusy','appearanceNote','budgetDraft','budgetNote','budgetBusy','usage','generalPrefs','generalPrefsBusy','generalPrefsNote','busySendSaving','busySendNote','busySendError'].map(key => [key, ref('')]));
  deps.api = api;
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
