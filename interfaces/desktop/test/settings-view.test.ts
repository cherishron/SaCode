import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import * as Vue from 'vue';

const require = createRequire(new URL('../src/ui/components/SettingsView.vue', import.meta.url));
const { descriptor } = parse(readFileSync(new URL('../src/ui/components/SettingsView.vue', import.meta.url), 'utf8'));
const script = compileScript(descriptor, { id: 'settings-regression' });
const template = compileTemplate({ source: descriptor.template!.content, filename: 'SettingsView.vue', id: 'settings-regression', compilerOptions: { bindingMetadata: script.bindings } });
assert.deepEqual(template.errors, []);
function evaluate(code: string, imports: Record<string, unknown>) {
  const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', output)((id: string) => id in imports ? imports[id] : require(id), module, module.exports);
  return module.exports;
}
type Host = { type: string; text?: string; props: Record<string, any>; children: Host[]; parent?: Host; open: boolean; showCount: number; closeCount: number; focus(): void; showModal(): void; close(): void; querySelector(): Host | null };
let active: any;
function node(type: string): Host {
  return { type, props: {}, children: [], open: false, showCount: 0, closeCount: 0,
    focus() { active = this; },
    showModal() { this.open = true; this.showCount++; this.focus(); },
    close() { this.open = false; this.closeCount++; },
    querySelector() { return findIn(this, el => el.type === 'button') ?? null; },
  };
}
function findIn(el: Host, predicate: (el: Host) => boolean): Host | undefined {
  return predicate(el) ? el : el.children.map(child => findIn(child, predicate)).find(Boolean);
}
const renderer = Vue.createRenderer<Host, Host>({
  createElement: node, createText: text => ({ ...node('#text'), text }), createComment: text => ({ ...node('#comment'), text }),
  setText: (el, text) => { el.text = text; }, setElementText: (el, text) => { el.text = text; el.children = []; },
  parentNode: el => el.parent ?? null, nextSibling: el => { const siblings = el.parent?.children ?? []; return siblings[siblings.indexOf(el) + 1] ?? null; },
  patchProp: (el, key, _prev, next) => { el.props[key] = next; },
  insert(el, parent, anchor) { if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1); const index = anchor ? parent.children.indexOf(anchor) : -1; parent.children.splice(index < 0 ? parent.children.length : index, 0, el); el.parent = parent; },
  remove(el) { if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1); },
});
async function mountSettings(initialOpen = false) {
  const opener = { focusCount: 0, isConnected: true, focus() { active = this; this.focusCount++; } };
  active = opener;
  Object.assign(globalThis, { document: { get activeElement() { return active; } } });
  const calls: any[] = [];
  const focusEvents: string[] = [];
  const stub = Vue.defineComponent({ setup(_props, { slots, attrs }) { return () => Vue.h('stub', attrs, Object.values(slots).flatMap(slot => slot?.() ?? [])); } });
  const component = evaluate(script.content, {
    vue: Vue, 'tdesign-icons-vue-next': { CloseIcon: stub }, './AboutView.vue': { default: stub },
    '../logic/settings-focus.ts': { activateSettingsFocus: () => { focusEvents.push('activate'); return () => { focusEvents.push('release'); }; } },
    '../composables/useDesktopApp': { useDesktopApp: () => ({ app: { client: { upsertMcpServer: async (...args: any[]) => calls.push(args), listMcpServers: async () => ({ servers: [] }) } }, workspace: Vue.ref('') }) },
    '../logic/preferences.ts': { loadDesktopPreferences: () => ({ nickname: 'test' }), applyInterfacePreferences() {}, saveDesktopPreferences() {}, syncSystemIntegrations: async () => ({ errors: [] }) },
    '../platform/tauri-bridge.ts': { isTauri: () => false },
  }).default;
  component.render = evaluate(template.code, { vue: Vue }).render;
  const props = Vue.reactive({ open: initialOpen });
  const root = node('root');
  let instance: Vue.ComponentInternalInstance;
  const app = renderer.createApp({ setup: () => () => Vue.h(component, { ...props, 'onUpdate:open': (open: boolean) => { props.open = open; }, ref: (vm: any) => { if (vm) instance = vm.$; } }) });
  for (const name of ['t-config-provider', 't-input', 't-button', 't-switch', 't-radio-group', 't-radio-button', 't-textarea']) app.component(name, stub);
  app.mount(root);
  await Vue.nextTick();
  await Vue.nextTick();
  const find = (predicate: (el: Host) => boolean) => { const found = findIn(root, predicate); assert.ok(found, 'expected rendered settings control'); return found; };
  return { app, props, state: (instance! as any).setupState, calls, focusEvents, opener, find };
}

test('MCP edit/save preserves spaces, empty arguments, quotes and Windows paths', async () => {
  const h = await mountSettings();
  try {
    const args = ['--path', 'C:\\Program Files\\MCP', '', 'a "quoted" value', '中文\t参数'];
    h.state.editMcp({ name: 'server', type: 'stdio', args, enabled: true, source: 'project' });
    assert.equal(h.state.mcpArgsText, JSON.stringify(args));
    await h.state.saveMcp();
    assert.deepEqual(h.calls[0][1].args, args);
  } finally { h.app.unmount(); }
});

test('MCP rejects invalid JSON and non-string arrays without submitting or closing form', async () => {
  const h = await mountSettings();
  try {
    for (const text of ['', '--flag value', '{}', 'null', '[1]', '["ok",null]', '[[]]']) {
      h.state.editMcp({ name: 'server', type: 'stdio', enabled: true, source: 'project' });
      h.state.mcpArgsText = text;
      await h.state.saveMcp();
      assert.equal(h.calls.length, 0, text);
      assert.match(h.state.mcpError, /JSON.*字符串数组/);
      assert.equal(h.state.mcpFormOpen, true);
    }
    h.state.mcpArgsText = '[]';
    await h.state.saveMcp();
    assert.deepEqual(h.calls[0][1].args, []);
    assert.equal(h.state.mcpError, '');
  } finally { h.app.unmount(); }
});

test('remote MCP does not validate hidden stdio arguments', async () => {
  const h = await mountSettings();
  try {
    h.state.editMcp({ name: 'remote', type: 'remote', enabled: true, source: 'project' });
    h.state.mcpArgsText = 'invalid';
    await h.state.saveMcp();
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0][1].args, undefined);
  } finally { h.app.unmount(); }
});

test('settings is named and binds modal lifecycle for opening, closing and unmount', () => {
  assert.equal(script.bindings?.settingsWindow, 'setup-ref');
  assert.match(script.content, /activateSettingsFocus\(/);
  assert.match(script.content, /onBeforeUnmount\(/);
  assert.match(script.content, /immediate: true/);
  assert.match(descriptor.template!.content, /ref="settingsWindow"[^>]*aria-labelledby="settings-title"/);
  assert.match(descriptor.template!.content, /id="settings-title"[^>]*>偏好设置/);
});

test('real open watcher releases focus on close, reopen and unmount', async () => {
  const h = await mountSettings(true);
  assert.deepEqual(h.focusEvents, ['activate']);
  h.props.open = false;
  await Vue.nextTick();
  assert.deepEqual(h.focusEvents, ['activate', 'release']);
  h.props.open = true;
  await Vue.nextTick(); await Vue.nextTick();
  assert.deepEqual(h.focusEvents, ['activate', 'release', 'activate']);
  h.app.unmount();
  assert.deepEqual(h.focusEvents, ['activate', 'release', 'activate', 'release']);
});
