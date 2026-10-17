import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../renderer/session-state.js';
const ref = value => ({value});
function makeDeps(overrides = {}) {
  const api = {
    sessionSelect: async () => {},
    sessionCreate: async () => ({ id: 'new' }),
    sessionCatalog: async () => ({ entries: [] }),
    promptCancel: async () => {},
  };
  return {
    api,
    ref,
    catalog: overrides.catalog ?? ref({ entries: [] }),
    catalogBusy: overrides.catalogBusy ?? ref(false),
    catalogNote: overrides.catalogNote ?? ref(''),
    catalogOpen: overrides.catalogOpen ?? ref(false),
    newSessionTitle: overrides.newSessionTitle ?? ref(''),
    draft: overrides.draft ?? ref(''),
    error: overrides.error ?? ref(''),
    selectedScrollId: overrides.selectedScrollId ?? ref('initial'),
    scrollSession: overrides.scrollSession ?? ref('initial'),
    turn: overrides.turn ?? ref({ running: false, settled: false, text: '', finishReason: '', cancelled: false, interrupted: false, delivered: 0 }),
    approval: overrides.approval ?? ref(null),
    sendBusy: overrides.sendBusy ?? ref(false),
    budgetBusy: overrides.budgetBusy ?? ref(false),
    appearanceBusy: overrides.appearanceBusy ?? ref(false),
    workspaceBusy: overrides.workspaceBusy ?? ref(false),
    sessionDrafts: overrides.sessionDrafts ?? new Map(),
    getSessionGeneration: overrides.getSessionGeneration ?? (() => 0),
    incrementSessionGeneration: overrides.incrementSessionGeneration ?? (() => {}),
    catalogError: overrides.catalogError ?? ((e) => String(e.message || e)),
    clearEnhance: overrides.clearEnhance ?? (() => {}),
    clearAttachments: overrides.clearAttachments ?? (() => {}),
    stopPolling: overrides.stopPolling ?? (() => {}),
    foldOpen: overrides.foldOpen ?? { ids: { clear: () => {} } },
    loadCustomModels: overrides.loadCustomModels ?? (async () => {}),
    fileEditor: overrides.fileEditor ?? { state: { busy: false }, dirty: () => false, reset: () => {} },
    worktreeController: overrides.worktreeController ?? { restore: async () => {} },
    resetWorktreePanel: overrides.resetWorktreePanel ?? (() => {}),
    refresh: overrides.refresh ?? (async () => {}),
    refreshTools: overrides.refreshTools ?? (async () => {}),
    refreshUsage: overrides.refreshUsage ?? (async () => {}),
    refreshWorkspace: overrides.refreshWorkspace ?? (async () => {}),
    refreshWorkspaceFiles: overrides.refreshWorkspaceFiles ?? (async () => {}),
    refreshQueue: overrides.refreshQueue ?? (async () => {}),
    refreshGlobalAppearance: overrides.refreshGlobalAppearance ?? (async () => {}),
    applySelection: overrides.applySelection,
    selectedCustomModel: overrides.selectedCustomModel ?? ref(''),
    previewFloating: overrides.previewFloating ?? ref(false),
    detailName: overrides.detailName ?? ref(''),
    budgetDraft: overrides.budgetDraft ?? ref(''),
    budgetNote: overrides.budgetNote ?? ref(''),
    appearanceNote: overrides.appearanceNote ?? ref(''),
    workspaceNote: overrides.workspaceNote ?? ref(''),
    queuePending: overrides.queuePending ?? ref([]),
    focusComposer: overrides.focusComposer ?? (() => {}),
  };
}


test('切换会话先清空上下文读数，再读取新会话', async () => {
  const deps = makeDeps();
  deps.tipsPressure = ref({ projectedTokens: 88, contextWindow: 100 });
  deps.tips = ref({ text: '旧提醒' });
  let read = 0;
  deps.refreshTips = async () => { read++; assert.equal(deps.tipsPressure.value, undefined); deps.tipsPressure.value = {projectedTokens: 12, contextWindow: 100}; };
  deps.refresh = async () => { assert.equal(deps.tipsPressure.value, undefined); assert.equal(deps.tips.value, null); };
  await globalThis.SaCodeSessionState.createSessionAssembly(deps).applySelection('s2');
  assert.equal(read, 1);
  assert.equal(deps.tipsPressure.value.projectedTokens, 12);
});
