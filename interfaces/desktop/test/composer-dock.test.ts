import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import * as Vue from 'vue';
import * as preferences from '../src/ui/logic/preferences.ts';
import * as turnEvents from '../src/ui/logic/turn-events.ts';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../src/ui/components/ComposerDock.vue', import.meta.url), 'utf8');
const { descriptor } = parse(source);
const script = compileScript(descriptor, { id: 'composer-regression' });
const template = compileTemplate({
  source: descriptor.template!.content,
  filename: 'ComposerDock.vue',
  id: 'composer-regression',
  compilerOptions: { bindingMetadata: script.bindings },
});
assert.deepEqual(template.errors, []);

function evaluate(code: string, imports: Record<string, unknown>) {
  const output = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', output)(
    (id: string) => id in imports ? imports[id] : require(id), module, module.exports,
  );
  return module.exports;
}

type HostNode = { type: string; text?: string; props: Record<string, any>; children: HostNode[]; parent?: HostNode; addEventListener: () => void; removeEventListener: () => void };
const node = (type: string): HostNode => ({ type, props: {}, children: [], addEventListener() {}, removeEventListener() {} });
const renderer = Vue.createRenderer<HostNode, HostNode>({
  createElement: node,
  createText: text => ({ ...node('#text'), text }),
  createComment: text => ({ ...node('#comment'), text }),
  setText: (el, text) => { el.text = text; },
  setElementText: (el, text) => { el.text = text; el.children = []; },
  parentNode: el => el.parent ?? null,
  nextSibling: el => {
    const siblings = el.parent?.children ?? [];
    return siblings[siblings.indexOf(el) + 1] ?? null;
  },
  patchProp: (el, key, _prev, next) => { el.props[key] = next; },
  insert(el, parent, anchor) {
    if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1);
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    parent.children.splice(index < 0 ? parent.children.length : index, 0, el);
    el.parent = parent;
  },
  remove(el) { if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1); },
});

function mountComposer(saved: Partial<preferences.DesktopPreferences> = {}) {
  const store = new Map<string, string>();
  Object.assign(globalThis, {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    },
    document: {
      documentElement: { dataset: {}, classList: { toggle() {} }, setAttribute() {} },
      querySelectorAll: () => [], querySelector: () => null,
    },
    window: { matchMedia: () => ({ matches: true, addEventListener() {} }) },
  });
  preferences.saveDesktopPreferences({ ...preferences.loadDesktopPreferences(), ...saved });
  const calls: any[] = [];
  const desktop = {
    app: {
      defaultBackend: 'sacode',
      workspaceCapabilities: { models: [] as any[], skills: [] as any[], files: [] as any[] },
      refreshWorkspaceCapabilities: async () => {},
    },
    appVersion: Vue.ref(0), workspace: Vue.ref('/old'),
    sending: Vue.ref(false), sendError: Vue.ref(null), attachments: Vue.ref<any[]>([]),
    sendMessage: async (payload: any) => { calls.push(payload); return null; },
    contextUsageFor: () => null, setContextUsageFor() {}, detailForConversation: () => null,
    uploadAttachment() {}, removeAttachment() {},
    clearAttachments() { desktop.attachments.value = []; },
    enhancePromptText: (text: string) => text,
  };
  const stub = Vue.defineComponent({
    setup(_props, { slots, attrs }) {
      return () => Vue.h('stub', attrs, Object.values(slots).flatMap(slot => slot?.() ?? []));
    },
  });
  const component = evaluate(script.content, {
    vue: Vue,
    '../composables/useDesktopApp': { useDesktopApp: () => desktop },
    '../logic/preferences.ts': preferences,
    '../logic/preferences': preferences,
    '../logic/turn-events.ts': turnEvents,
    '@tdesign-vue-next/chat': { ChatSender: stub },
    'tdesign-icons-vue-next': { FileIcon: stub, FolderIcon: stub },
    './BotIcon.vue': { default: stub }, './MicIcon.vue': { default: stub },
    './OutboxPanel.vue': { default: stub },
  }).default;
  component.render = evaluate(template.code, { vue: Vue }).render;
  const props = Vue.reactive({ conversationId: 'first' as string | null });
  const root = node('root');
  let instance: Vue.ComponentInternalInstance;
  const app = renderer.createApp({ setup: () => () => Vue.h(component, { ...props, ref: (vm: any) => { if (vm) instance = vm.$; } }) });
  for (const name of ['t-chat-sender', 't-popup', 't-attachments', 't-tooltip', 't-progress']) app.component(name, stub);
  app.mount(root);
  const state = (instance! as Vue.ComponentInternalInstance & { setupState: Record<string, any> }).setupState;
  const find = (predicate: (el: HostNode) => boolean): HostNode => {
    const visit = (el: HostNode): HostNode | undefined => predicate(el) ? el : el.children.map(visit).find(Boolean);
    const result = visit(root);
    assert.ok(result, 'expected rendered binding');
    return result;
  };
  const send = (text = 'task') => find(el => typeof el.props.onSend === 'function').props.onSend(text);
  return { app, desktop, props, state, calls, find, send };
}

test('useDesktopApp exposes the version incremented by real onChange wiring', async () => {
  Object.assign(globalThis, { window: { setTimeout: () => 0, clearTimeout() {} } });
  class DesktopAppStub {
    workspace = '/workspace';
    desktopConversations = [];
    health = null;
    mode = 'vite';
    onChange = () => {};
    async init() {}
  }
  const composableSource = readFileSync(new URL('../src/ui/composables/useDesktopApp.ts', import.meta.url), 'utf8');
  const { useDesktopApp } = evaluate(composableSource, {
    vue: Vue, '../logic/services.ts': { DesktopApp: DesktopAppStub },
  });
  const desktop = useDesktopApp();
  assert.ok(Vue.isRef(desktop.appVersion), 'appVersion must be returned as a ref');
  await desktop.start();
  const before = desktop.appVersion.value;
  desktop.app.onChange();
  assert.equal(desktop.appVersion.value, before + 1);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function startAttachmentDesktop(upload: (payload: any) => Promise<{ path: string; size: number }>) {
  Object.assign(globalThis, { window: { setTimeout: () => 0, clearTimeout() {} } });
  class DesktopAppStub {
    workspace = '/old';
    desktopConversations = [];
    health = null;
    mode = 'vite';
    client = { uploadWorkspaceAttachment: upload };
    onChange = () => {};
    async init() {}
    async refreshDesktopConversations() {}
  }
  const composableSource = readFileSync(new URL('../src/ui/composables/useDesktopApp.ts', import.meta.url), 'utf8');
  const { useDesktopApp } = evaluate(composableSource, {
    vue: Vue, '../logic/services.ts': { DesktopApp: DesktopAppStub },
  });
  const desktop = useDesktopApp();
  await desktop.start();
  return desktop;
}

for (const outcome of ['resolve', 'reject'] as const) {
  test(`attachment arrayBuffer ${outcome} after workspace onChange does not upload or alter new workspace`, async () => {
    const uploads: any[] = [];
    const desktop = await startAttachmentDesktop(async payload => {
      uploads.push(payload);
      return { path: '.attachments/old.txt', size: 3 };
    });
    const buffer = deferred<ArrayBuffer>();
    const pending = desktop.uploadAttachment({ name: 'old.txt', type: 'text/plain', arrayBuffer: () => buffer.promise } as File);
    desktop.app.workspace = '/new';
    desktop.app.onChange();
    assert.equal(desktop.workspace.value, '/new');
    const current = [{ name: 'new.txt', path: '.attachments/new.txt', size: 1 }];
    desktop.attachments.value = current;
    desktop.sendError.value = 'current workspace error';
    if (outcome === 'resolve') buffer.resolve(new Uint8Array([97, 98, 99]).buffer);
    else buffer.reject(new Error('old file read failed'));
    assert.equal(await pending, null);
    assert.deepEqual(uploads, []);
    assert.deepEqual(desktop.attachments.value, current);
    assert.equal(desktop.sendError.value, 'current workspace error');
  });

  test(`attachment upload ${outcome} after workspace onChange does not refill old paths or overwrite sendError`, async () => {
    const response = deferred<{ path: string; size: number }>();
    const entered = deferred<void>();
    const desktop = await startAttachmentDesktop(async () => {
      entered.resolve();
      return response.promise;
    });
    const pending = desktop.uploadAttachment(new File(['abc'], 'old.txt', { type: 'text/plain' }));
    await entered.promise;
    desktop.app.workspace = '/new';
    desktop.app.onChange();
    assert.equal(desktop.workspace.value, '/new');
    const current = [{ name: 'new.txt', path: '.attachments/new.txt', size: 1 }];
    desktop.attachments.value = current;
    desktop.sendError.value = 'current workspace error';
    if (outcome === 'resolve') response.resolve({ path: '.attachments/old.txt', size: 3 });
    else response.reject(new Error('old upload failed'));
    assert.equal(await pending, null);
    assert.deepEqual(desktop.attachments.value, current);
    assert.equal(desktop.sendError.value, 'current workspace error');
  });
}

test('same workspace attachment upload uses captured client and appends the returned path', async () => {
  const uploads: any[] = [];
  const desktop = await startAttachmentDesktop(async payload => {
    uploads.push(payload);
    return { path: '.attachments/abc.txt', size: 3 };
  });
  const buffer = deferred<ArrayBuffer>();
  const pending = desktop.uploadAttachment({ name: 'abc.txt', type: 'text/plain', arrayBuffer: () => buffer.promise } as File);
  desktop.app.client = { uploadWorkspaceAttachment: async () => { throw new Error('replacement client must not upload'); } };
  desktop.app.onChange(); // Capability/client notifications alone do not change workspace generation.
  buffer.resolve(new Uint8Array([97, 98, 99]).buffer);
  const item = { name: 'abc.txt', path: '.attachments/abc.txt', size: 3 };
  assert.deepEqual(await pending, item);
  assert.deepEqual(uploads, [{ filename: 'abc.txt', contentBase64: 'YWJj', kind: 'text/plain' }]);
  assert.deepEqual(desktop.attachments.value, [item]);
  assert.equal(desktop.sendError.value, null);
});

test('same workspace attachment upload rejection still reports sendError', async () => {
  const desktop = await startAttachmentDesktop(async () => { throw new Error('upload failed'); });
  assert.equal(await desktop.uploadAttachment(new File(['abc'], 'abc.txt')), null);
  assert.deepEqual(desktop.attachments.value, []);
  assert.equal(desktop.sendError.value, 'Error: upload failed');
});

test('real Vue computed refresh all capability lists after asynchronous app notification', async () => {
  const h = mountComposer();
  try {
    assert.deepEqual(h.state.models, []);
    assert.deepEqual(h.state.skillList, []);
    assert.deepEqual(h.state.workspaceFiles, []);
    h.desktop.app.workspaceCapabilities = {
      models: [{ id: 'new-model', provider: 'provider', model: 'model' }],
      skills: [{ name: 'review' }], files: [{ path: 'src/new.rs' }],
    };
    h.desktop.appVersion.value++;
    await Vue.nextTick();
    assert.deepEqual(h.state.models, [{ value: 'new-model', label: 'provider/model' }]);
    assert.deepEqual(h.state.skillList, [{ name: 'review' }]);
    assert.deepEqual(h.state.workspaceFiles, ['src/new.rs']);
    h.state.openProjectPicker();
    await Vue.nextTick();
    h.find(el => el.text === 'provider/model');
    h.find(el => el.text === 'review');
    h.find(el => el.text === 'src/new.rs');
  } finally { h.app.unmount(); }
});

test('saved Plan/model/default skill bind to controls and actual sender payload', async () => {
  const h = mountComposer({ defaultMode: 'plan', defaultModel: 'saved-model', defaultSkill: 'review' });
  try {
    assert.equal(h.find(el => el.props.class?.includes('mode-cycle')).text, 'Plan');
    assert.equal(h.state.modelName, 'saved-model');
    assert.deepEqual(h.state.selectedSkills, ['review']);
    await h.send();
    assert.equal(h.calls[0].mode, 'plan');
    assert.equal(h.calls[0].modelName, 'saved-model');
    assert.deepEqual(h.calls[0].skills, ['review']);
  } finally { h.app.unmount(); }
});

test('settings save leaves manual choices intact; conversation switch reads latest defaults', async () => {
  const h = mountComposer();
  try {
    h.find(el => el.props.class?.includes('mode-cycle')).props.onClick();
    h.state.modelName = 'manual-model';
    h.state.toggleSkill('manual-skill');
    preferences.saveDesktopPreferences({ ...preferences.loadDesktopPreferences(), defaultMode: 'plan', defaultModel: 'latest', defaultSkill: 'latest-skill' });
    h.desktop.appVersion.value++;
    await Vue.nextTick();
    await h.send();
    assert.equal(h.calls[0].mode, 'yolo');
    assert.equal(h.calls[0].modelName, 'manual-model');
    assert.deepEqual(h.calls[0].skills, ['manual-skill']);
    h.props.conversationId = 'second';
    await Vue.nextTick();
    await h.send();
    assert.equal(h.calls[1].mode, 'plan');
    assert.equal(h.calls[1].modelName, 'latest');
    assert.deepEqual(h.calls[1].skills, ['latest-skill']);
    preferences.saveDesktopPreferences({ ...preferences.loadDesktopPreferences(), defaultSkill: '' });
    h.props.conversationId = null;
    await Vue.nextTick();
    await h.send();
    assert.equal(h.calls[2].skills, undefined);
  } finally { h.app.unmount(); }
});

test('workspace switch clears old project and attachment paths without capability refresh clearing selection', async () => {
  const h = mountComposer();
  try {
    h.state.addProjectFile('old.rs');
    h.desktop.attachments.value = [{ path: '.attachments/old.png', name: 'old.png', size: 1 }];
    h.desktop.appVersion.value++;
    await Vue.nextTick();
    await h.send();
    assert.deepEqual(h.calls[0].contextPaths, ['.attachments/old.png', 'old.rs']);
    h.desktop.workspace.value = '/new';
    await Vue.nextTick();
    await h.send();
    assert.deepEqual(h.calls[1].contextPaths, []);
  } finally { h.app.unmount(); }
});
