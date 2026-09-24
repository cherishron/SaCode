import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSaDesignPrompt,
  createSaDesignState,
  detectConflicts,
  getModelCapability,
  toggleSelection,
  validateSaDesignDraft,
} from '../src/app/sadesign-state.ts';

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

test('SaDesign draft validates required request, output and code target', () => {
  const state = createSaDesignState();
  assert.deepEqual(validateSaDesignDraft(state), [
    '请填写设计目标或页面需求',
    '生成前端代码时请确认目标目录',
  ]);

  state.draft.request = '生成页面';
  state.draft.targetPath = 'src/pages';
  assert.deepEqual(validateSaDesignDraft(state), []);

  state.draft.outputs = [];
  assert.deepEqual(validateSaDesignDraft(state), ['请至少选择一种输出']);
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
