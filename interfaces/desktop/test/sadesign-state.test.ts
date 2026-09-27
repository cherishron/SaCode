import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyExternalUiDocument,
  applyUiCommand,
  buildImplementationProfile,
  buildInitialUiDocument,
  buildSaDesignPrompt,
  createSaDesignState,
  detectConflicts,
  getModelCapability,
  initializeUiEditor,
  prepareUiDocumentForSession,
  redoUiCommand,
  toggleSelection,
  undoUiCommand,
  validateImplementationDraft,
  validateSaDesignDraft,
} from '../src/app/sadesign-state.ts';
import { resolveNodePresentation } from '../src/app/ui-document-preview.ts';
import { findUiNode } from '../src/app/ui-document-editor.ts';

test('SaDesign prompt includes project context and selected resources', () => {
  const state = createSaDesignState('opencode');
  state.context = {
    workspace: 'C:/demo',
    project_name: 'Demo',
    summary: 'Agent dashboard',
    technologies: ['TypeScript', 'Vite'],
    source_roots: ['src'],
    manifests: ['package.json'],
  };
  state.catalog = {
    templates: [{
      id: 'td-dashboard',
      title: '数据看板',
      summary: '指标、趋势与明细',
      components: ['Card', 'Table'],
      layout_notes: ['顶部指标卡', '底部明细表格'],
    }],
    visual_styles: [{ id: 'clean-tech', title: 'Clean Tech', summary: '清晰数据表达', tags: [] }],
    design_systems: [{ id: 'tdesign-web', title: 'TDesign Web', summary: '企业组件基线', tags: [] }],
    baselines: [{ id: 'accessible-ui', title: 'Accessible UI', summary: '可访问性', tags: [] }],
  };
  state.draft.request = '生成项目概览页面';
  state.draft.targetPath = 'src/pages/dashboard';
  state.draft.primaryTemplateId = 'td-dashboard';
  state.draft.visualStyleId = 'clean-tech';
  state.draft.designSystemId = 'tdesign-web';

  const prompt = buildSaDesignPrompt(state);
  assert.match(prompt, /Demo/);
  assert.match(prompt, /数据看板/);
  assert.match(prompt, /Clean Tech/);
  assert.match(prompt, /TDesign Web/);
  assert.match(prompt, /src\/pages\/dashboard/);
});

test('SaDesign separates UI preview validation from implementation validation', () => {
  const state = createSaDesignState();
  assert.deepEqual(validateSaDesignDraft(state), ['请填写设计目标或页面需求']);
  assert.deepEqual(validateImplementationDraft(state), [
    '生成项目实现时请确认目标目录',
    '生成项目实现前请确认编程语言',
    '生成项目实现前请确认框架或实现方式',
    '请确认 Implementation Profile',
  ]);

  state.draft.request = '生成页面';
  state.draft.targetPath = 'src/pages';
  state.draft.uiConfirmed = true;
  state.draft.language = 'TypeScript';
  state.draft.framework = 'Vue 3';
  state.draft.implementationConfirmed = true;
  assert.deepEqual(validateSaDesignDraft(state), []);
  assert.deepEqual(validateImplementationDraft(state), []);

  state.draft.outputs = [];
  assert.deepEqual(validateSaDesignDraft(state), ['请至少选择一种输出']);
});

test('SaDesign builds framework-neutral UI and confirmed implementation profile', () => {
  const state = createSaDesignState();
  state.draft.request = '创建 PC 项目工作台';
  state.draft.targetSurface = 'desktop-app';
  state.draft.projectMode = 'new';
  state.draft.uiConfirmed = true;
  state.draft.language = 'TypeScript';
  state.draft.framework = 'Vue 3';
  state.draft.implementationConfirmed = true;

  const document = buildInitialUiDocument(state, 'session-1');
  assert.equal(document.schema_version, 'sacode-ui/v1');
  assert.equal(document.target.platform, 'desktop-app');
  assert.equal(document.pages[0].root.type, 'container');
  assert.ok(document.pages[0].root.children.length >= 2);
  assert.equal(document.target.viewports[0].width, 1440);

  const prepared = prepareUiDocumentForSession(document, 'session-2');
  assert.equal(prepared.id, 'ui-session-2');
  assert.equal(prepared.status, 'draft');
  assert.equal(prepared.version, 0);

  const profile = buildImplementationProfile(state);
  assert.equal(profile.schema_version, 'sacode-implementation/v1');
  assert.equal(profile.project_mode, 'new');
  assert.equal(profile.framework, 'Vue 3');
  assert.equal(profile.confirmed, true);
});

test('template selection creates distinct UIDocument structures', () => {
  const dashboard = createSaDesignState();
  dashboard.draft.request = '运营概览';
  dashboard.draft.primaryTemplateId = 'td-dashboard';
  const dashboardDocument = buildInitialUiDocument(dashboard, 'dashboard');
  assert.ok(dashboardDocument.pages[0].root.children.some((node) => node.id === 'metrics'));

  const list = createSaDesignState();
  list.draft.request = '资源管理';
  list.draft.primaryTemplateId = 'td-list-table';
  const listDocument = buildInitialUiDocument(list, 'list');
  assert.ok(listDocument.pages[0].root.children.some((node) => node.id === 'filters'));
  assert.ok(!listDocument.pages[0].root.children.some((node) => node.id === 'metrics'));
});

test('preview renderer resolves responsive rules for the active viewport', () => {
  const state = createSaDesignState();
  const document = buildInitialUiDocument(state, 'responsive');
  const metrics = document.pages[0].root.children.find((node) => node.id === 'metrics');
  assert.ok(metrics);
  const desktop = resolveNodePresentation(metrics, 1440);
  const mobile = resolveNodePresentation(metrics, 390);
  assert.equal(desktop.layout.gridTemplateColumns, 'repeat(3, minmax(0, 1fr))');
  assert.equal(mobile.layout.gridTemplateColumns, '1fr');
});

test('SaDesign editor state supports command undo and redo', () => {
  const state = createSaDesignState();
  state.draft.request = 'Original';
  initializeUiEditor(state, buildInitialUiDocument(state, 'editor'));
  assert.equal(state.selectedNodeId, 'root');

  assert.equal(applyUiCommand(state, {
    type: 'set-content', nodeId: 'title', patch: { text: 'Changed' },
  }), true);
  assert.equal(findUiNode(state.previewDocument!, 'title')?.content.text, 'Changed');
  assert.equal(state.uiUndoStack.length, 1);

  assert.equal(undoUiCommand(state), true);
  assert.equal(findUiNode(state.previewDocument!, 'title')?.content.text, 'Original');
  assert.equal(redoUiCommand(state), true);
  assert.equal(findUiNode(state.previewDocument!, 'title')?.content.text, 'Changed');
});

test('external AI document update participates in undo history', () => {
  const state = createSaDesignState();
  const original = buildInitialUiDocument(state, 'preview');
  initializeUiEditor(state, original);
  const updated = structuredClone(original);
  updated.version = 1;
  updated.name = 'AI updated';

  applyExternalUiDocument(state, updated);
  assert.equal(state.previewDocument?.name, 'AI updated');
  assert.equal(state.uiUndoStack.length, 1);
  assert.equal(undoUiCommand(state), true);
  assert.equal(state.previewDocument?.name, original.name);
});

test('toggleSelection preserves deterministic selection semantics', () => {
  assert.deepEqual(toggleSelection(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(toggleSelection(['a', 'b'], 'a'), ['b']);
});

test('detectConflicts surfaces density tension between dashboard template and editorial style', () => {
  const state = createSaDesignState();
  state.catalog = {
    templates: [{
      id: 'td-dashboard', title: '数据看板', summary: '',
      components: [], layout_notes: [],
    }],
    visual_styles: [{ id: 'editorial-grid', title: 'Editorial Grid', summary: '', tags: [] }],
    design_systems: [],
    baselines: [
      { id: 'dense-workbench', title: 'Dense Workbench', summary: '', tags: [] },
      { id: 'accessible-ui', title: 'Accessible UI', summary: '', tags: [] },
    ],
  };
  state.draft.primaryTemplateId = 'td-dashboard';
  state.draft.visualStyleId = 'editorial-grid';
  state.draft.baselineIds = ['dense-workbench', 'accessible-ui'];
  const conflicts = detectConflicts(state);
  assert.ok(conflicts.length >= 2);
  assert.ok(conflicts.some((c) => c.field === 'density' && c.sourceA.includes('模板')));
  assert.ok(conflicts.some((c) => c.field === 'density' && c.sourceA.includes('基线')));
});

test('getModelCapability returns defaults for unknown backend', () => {
  const cap = getModelCapability('sacode');
  assert.equal(cap.id, 'sacode');
  assert.ok(cap.capabilities.includes('text'));
  assert.ok(cap.recommendedOutputs.includes('code'));
  const unknown = getModelCapability('nonexistent');
  assert.equal(unknown.id, 'nonexistent');
  assert.ok(!unknown.capabilities.includes('image-gen'));
});
