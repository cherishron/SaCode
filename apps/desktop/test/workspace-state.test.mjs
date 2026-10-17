import { test } from 'node:test';
import assert from 'node:assert/strict';

function ref(val) { return { value: val }; }

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '..', 'renderer', 'workspace-state.js'), 'utf8');
eval(src);

const { createWorkspaceAssembly } = globalThis.SaCodeWorkspace;

test('refreshWorkspaceFiles 从 API 读取文件列表', async () => {
  const workspaceFiles = ref([]), workspaceFilesBusy = ref(false);
  const deps = makeDeps({ workspaceFiles, workspaceFilesBusy });
  deps.api.workspaceFiles = async () => ({ files: [{ name: 'a.txt', size: 10, isDir: false }] });
  const asm = createWorkspaceAssembly(deps);
  await asm.refreshWorkspaceFiles();
  assert.equal(workspaceFiles.value.length, 1);
  assert.equal(workspaceFilesBusy.value, false);
});

test('toggleTreeDir 展开目录并加载子项', async () => {
  const fileTreeOpen = ref(new Set()), fileTreeChildren = ref({}), fileTreeBusy = ref('');
  const deps = makeDeps({ fileTreeOpen, fileTreeChildren, fileTreeBusy });
  deps.api.workspaceFiles = async () => ({ files: [{ name: 'sub', size: 0, isDir: true }] });
  const asm = createWorkspaceAssembly(deps);
  await asm.toggleTreeDir('root');
  assert.ok(fileTreeOpen.value.has('root'), '应展开目录');
  assert.ok(fileTreeChildren.value['root'], '应加载子项');
});

test('toggleTreeDir 再次点击收起目录', async () => {
  const fileTreeOpen = ref(new Set(['root']));
  const deps = makeDeps({ fileTreeOpen });
  const asm = createWorkspaceAssembly(deps);
  await asm.toggleTreeDir('root');
  assert.ok(!fileTreeOpen.value.has('root'), '应收起目录');
});

test('refreshTrace 无会话时清空', async () => {
  const traceEvents = ref([{ type: 'old' }]), traceCursor = ref(10);
  const scrollSession = ref(0);
  const deps = makeDeps({ traceEvents, traceCursor, scrollSession });
  const asm = createWorkspaceAssembly(deps);
  await asm.refreshTrace(true);
  assert.equal(traceEvents.value.length, 0, '应清空事件');
});

test('chooseWorkspace 在繁忙时跳过', async () => {
  const sendBusy = ref(true);
  const deps = makeDeps({ sendBusy });
  let called = false;
  deps.api.workspaceChoose = async () => { called = true; return { cancelled: false }; };
  const asm = createWorkspaceAssembly(deps);
  await asm.chooseWorkspace();
  assert.equal(called, false, '繁忙时不应选择目录');
});

test('chooseWorkspace 取消时给出提示', async () => {
  const workspaceNote = ref('');
  const deps = makeDeps({ workspaceNote });
  deps.api.workspaceChoose = async () => ({ cancelled: true });
  deps.refresh = async () => {};
  deps.refreshTools = async () => {};
  deps.refreshCatalog = async () => {};
  deps.refreshWorkspace = async () => {};
  const asm = createWorkspaceAssembly(deps);
  await asm.chooseWorkspace();
  assert.ok(workspaceNote.value.length > 0, '应给出取消提示');
});

function makeDeps(overrides = {}) {
  const api = {
    workspaceGet: async () => ({}),
    workspaceFiles: async () => ({ files: [] }),
    workspaceChoose: async () => ({ cancelled: false }),
    sessionEvents: async () => ({ events: [], nextCursor: 0, more: false }),
  };
  return {
    api, ref,
    workspaceOpen: overrides.workspaceOpen ?? ref(false),
    workspace: overrides.workspace ?? ref(null),
    workspaceBusy: overrides.workspaceBusy ?? ref(false),
    workspaceNote: overrides.workspaceNote ?? ref(''),
    workspaceFiles: overrides.workspaceFiles ?? ref([]),
    workspaceFilesBusy: overrides.workspaceFilesBusy ?? ref(false),
    fileTreeOpen: overrides.fileTreeOpen ?? ref(new Set()),
    fileTreeChildren: overrides.fileTreeChildren ?? ref({}),
    fileTreeBusy: overrides.fileTreeBusy ?? ref(''),
    traceEvents: overrides.traceEvents ?? ref([]),
    traceCursor: overrides.traceCursor ?? ref(0),
    traceMore: overrides.traceMore ?? ref(false),
    traceBusy: overrides.traceBusy ?? ref(false),
    traceError: overrides.traceError ?? ref(''),
    scrollSession: overrides.scrollSession ?? ref('s1'),
    getSessionGeneration: overrides.getSessionGeneration ?? (() => 0),
    incrementTraceGeneration: overrides.incrementTraceGeneration ?? (() => 0),
    getTraceGeneration: overrides.getTraceGeneration ?? (() => 0),
    catalogError: overrides.catalogError ?? ((e) => String(e.message || e)),
    fileEditor: overrides.fileEditor ?? { state: { busy: false }, dirty: () => false },
    turn: overrides.turn ?? ref({ running: false }),
    approval: overrides.approval ?? ref(null),
    sendBusy: overrides.sendBusy ?? ref(false),
    budgetBusy: overrides.budgetBusy ?? ref(false),
    appearanceBusy: overrides.appearanceBusy ?? ref(false),
    refresh: overrides.refresh ?? (async () => {}),
    refreshTools: overrides.refreshTools ?? (async () => {}),
    refreshCatalog: overrides.refreshCatalog ?? (async () => {}),
    refreshWorkspace: overrides.refreshWorkspace ?? (async () => {}),
  };
}
