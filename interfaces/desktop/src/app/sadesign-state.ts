import type {
  DesignProjectContext,
  DesignResourceCatalog,
  DesignResourceItem,
  DesignSession,
  DesignTemplateResource,
  ExecutionModeInput,
  ExtractionJob,
  ImageGenerationResult,
  ImplementationProfile,
  TargetSurface,
  UiCheckReport,
  UiDocument,
  UiNode,
  UiPatchProposal,
} from '@cherishron/sacode-client-core';
import { executeUiCommand, findUiPageId, type UICommand } from './ui-document-editor.ts';

export type DesignGoal = 'system' | 'page' | 'component' | 'design' | 'asset' | 'design-system';
export type DesignOutput = 'brief' | 'prompt' | 'design' | 'code' | 'images' | 'design-system';
export type DesignSection = 'task' | 'templates' | 'resources' | 'extraction' | 'history';
export type DesignStep = 'edit' | 'preview' | 'confirm';
export type TargetSurfacePlatform = 'desktop-app' | 'web-desktop' | 'responsive-web' | 'tablet' | 'mobile-app' | 'mini-program';

export interface SaDesignDraft {
  goal: DesignGoal;
  request: string;
  notes: string;
  primaryTemplateId: string | null;
  visualStyleId: string | null;
  designSystemId: string | null;
  baselineIds: string[];
  outputs: DesignOutput[];
  backendId: string;
  mode: ExecutionModeInput;
  targetPath: string;
  targetSurface: TargetSurfacePlatform;
  projectMode: 'existing' | 'new';
  language: string;
  framework: string;
  uiConfirmed: boolean;
  implementationConfirmed: boolean;
}

export interface SaDesignState {
  section: DesignSection;
  step: DesignStep;
  context: DesignProjectContext | null;
  catalog: DesignResourceCatalog;
  draft: SaDesignDraft;
  loading: boolean;
  error: string | null;
  lastTaskId: string | null;
  extractions: ExtractionJob[];
  extractionUrl: string;
  extractionConfirmed: boolean;
  extractionError: string | null;
  extractionTab: 'url' | 'image';
  imageDataUrl: string;
  imageFilename: string;
  imageContentType: string;
  imageSize: number;
  conflicts: DesignConflict[];
  currentSession: DesignSession | null;
  sessions: DesignSession[];
  historyFilter: 'all' | 'generation' | 'extraction';
  imageResults: ImageGenerationResult[];
  imagePrompt: string;
  imageLoading: boolean;
  templateDetailId: string | null;
  previewViewport: string;
  previewDocument: UiDocument | null;
  previewMode: 'draft' | 'session';
  selectedPageId: string | null;
  selectedNodeId: string | null;
  uiUndoStack: UICommand[];
  uiRedoStack: UICommand[];
  editorError: string | null;
  draggedNodeId: string | null;
  uiAiInstruction: string;
  uiPatchProposal: UiPatchProposal | null;
  uiCheckReport: UiCheckReport | null;
  uiPhaseLoading: boolean;
  sessionLineage: Array<{ id: string; status: string; createdAt: string; goal: string; request: string }>;
}

export const EMPTY_DESIGN_CATALOG: DesignResourceCatalog = {
  templates: [],
  visual_styles: [],
  design_systems: [],
  baselines: [],
};

export function createSaDesignState(defaultBackend = 'sacode'): SaDesignState {
  return {
    section: 'task',
    step: 'edit',
    context: null,
    catalog: EMPTY_DESIGN_CATALOG,
    draft: {
      goal: 'page',
      request: '',
      notes: '',
      primaryTemplateId: null,
      visualStyleId: null,
      designSystemId: null,
      baselineIds: ['accessible-ui'],
      outputs: ['brief', 'prompt', 'code'],
      backendId: defaultBackend,
      mode: 'build',
      targetPath: '',
      targetSurface: 'responsive-web',
      projectMode: 'existing',
      language: '',
      framework: '',
      uiConfirmed: false,
      implementationConfirmed: false,
    },
    loading: false,
    error: null,
    lastTaskId: null,
    extractions: [],
    extractionUrl: '',
    extractionConfirmed: false,
    extractionError: null,
    extractionTab: 'url',
    imageDataUrl: '',
    imageFilename: '',
    imageContentType: '',
    imageSize: 0,
    conflicts: [],
    currentSession: null,
    sessions: [],
    historyFilter: 'all',
    imageResults: [],
    imagePrompt: '',
    imageLoading: false,
    templateDetailId: null,
    previewViewport: 'desktop',
    previewDocument: null,
    previewMode: 'draft',
    selectedPageId: null,
    selectedNodeId: null,
    uiUndoStack: [],
    uiRedoStack: [],
    editorError: null,
    draggedNodeId: null,
    uiAiInstruction: '',
    uiPatchProposal: null,
    uiCheckReport: null,
    uiPhaseLoading: false,
    sessionLineage: [],
  };
}

export function buildSaDesignPrompt(state: SaDesignState): string {
  const { context, catalog, draft } = state;
  const template = findTemplate(catalog.templates, draft.primaryTemplateId);
  const visualStyle = findResource(catalog.visual_styles, draft.visualStyleId);
  const designSystem = findResource(catalog.design_systems, draft.designSystemId);
  const baselines = draft.baselineIds
    .map((id) => findResource(catalog.baselines, id))
    .filter((item): item is DesignResourceItem => item !== null);

  const outputLabels = draft.outputs.map(outputLabel).join('、');
  const technologies = context?.technologies.join('、') || '请自行分析项目';
  const sourceRoots = context?.source_roots.join('、') || '请先识别源码目录';
  const targetPath = draft.targetPath.trim() || '基于现有项目结构选择合理位置，并在写入前说明';

  return [
    '# SaDesign 项目设计任务',
    '',
    '请先分析当前工作区，再根据以下已确认的 Design Context 完成设计任务。',
    '',
    '## 项目事实',
    `- 项目：${context?.project_name || '当前项目'}`,
    `- 项目摘要：${context?.summary || '请从 README、项目清单、路由和组件中整理'}`,
    `- 技术栈：${technologies}`,
    `- 候选源码目录：${sourceRoots}`,
    '',
    '## 设计目标',
    `- 类型：${goalLabel(draft.goal)}`,
    `- 用户需求：${draft.request.trim() || '根据当前项目补充合理的页面设计'}`,
    `- 目标产物：${outputLabels || '设计简报、Prompt'}`,
    `- 目标路径：${targetPath}`,
    '',
    '## 设计依据',
    `- 主模板：${template ? `${template.title}（${template.id}）— ${template.summary}` : '未指定，先给出适合当前项目的方向'}`,
    `- 视觉风格：${visualStyle ? `${visualStyle.title} — ${visualStyle.summary}` : '沿用当前项目风格'}`,
    `- 设计系统：${designSystem ? `${designSystem.title} — ${designSystem.summary}` : '优先复用项目现有组件与 Token'}`,
    `- 方向基线：${baselines.length ? baselines.map((item) => item.title).join('、') : '无额外基线'}`,
    template?.components.length ? `- 建议组件：${template.components.join('、')}` : '',
    template?.layout_notes.length ? `- 布局要点：${template.layout_notes.join('；')}` : '',
    draft.notes.trim() ? `- 用户补充：${draft.notes.trim()}` : '',
    '',
    '## 执行约束',
    '1. 先输出简短的项目理解、设计计划和预计文件变更，再开始修改。',
    '2. 优先复用现有框架、组件、样式 Token 和目录结构，不引入无关依赖。',
    '3. 需要图片时，先整理可执行的生图 Prompt、比例、用途与目标路径；当前模型不能生图时保留 Prompt 和占位方案。',
    '4. 前端实现必须包含加载、空状态、错误和键盘可达等必要交互状态。',
    '5. 所有文件修改进入 SaCode Changes/Diff 与审批流程，不覆盖无关用户改动。',
    '6. 完成后运行最小相关检查，并总结设计选择、生成产物和验证结果。',
  ].filter(Boolean).join('\n');
}

export function buildTargetSurface(platform: TargetSurfacePlatform): TargetSurface {
  const presets: Record<TargetSurfacePlatform, TargetSurface> = {
    'desktop-app': {
      platform, input_modes: ['mouse', 'keyboard'], density: 'compact', orientation: 'landscape',
      capabilities: ['window-resize', 'shortcuts'],
      viewports: [{ id: 'desktop', name: 'Desktop', width: 1440, height: 900 }],
    },
    'web-desktop': {
      platform, input_modes: ['mouse', 'keyboard'], density: 'comfortable', orientation: 'landscape', capabilities: [],
      viewports: [{ id: 'desktop', name: 'Desktop', width: 1440, height: 900 }],
    },
    'responsive-web': {
      platform, input_modes: ['mouse', 'keyboard', 'touch'], density: 'comfortable', orientation: 'adaptive', capabilities: [],
      viewports: [
        { id: 'desktop', name: 'Desktop', width: 1440, height: 900 },
        { id: 'tablet', name: 'Tablet', width: 768, height: 1024 },
        { id: 'mobile', name: 'Mobile', width: 390, height: 844 },
      ],
    },
    tablet: {
      platform, input_modes: ['touch', 'keyboard'], density: 'comfortable', orientation: 'adaptive', capabilities: [],
      viewports: [{ id: 'tablet', name: 'Tablet', width: 1024, height: 768 }],
    },
    'mobile-app': {
      platform, input_modes: ['touch'], density: 'comfortable', orientation: 'portrait', capabilities: ['safe-area'],
      viewports: [{ id: 'mobile', name: 'Mobile', width: 390, height: 844 }],
    },
    'mini-program': {
      platform, input_modes: ['touch'], density: 'comfortable', orientation: 'portrait', capabilities: ['safe-area'],
      viewports: [{ id: 'mini-program', name: 'Mini Program', width: 375, height: 812 }],
    },
  };
  return presets[platform];
}

export function buildInitialUiDocument(state: SaDesignState, sessionId: string): UiDocument {
  const now = new Date().toISOString();
  const template = findTemplate(state.catalog.templates, state.draft.primaryTemplateId);
  const title = state.draft.request.trim().slice(0, 80) || template?.title || 'Untitled UI';
  return {
    schema_version: 'sacode-ui/v1',
    id: `ui-${sessionId}`,
    name: title,
    target: buildTargetSurface(state.draft.targetSurface),
    pages: [{
      id: 'page-main',
      name: template?.title || goalLabel(state.draft.goal),
      route_intent: '/',
      root: buildTemplateRoot(state, title),
    }],
    reusable_components: [],
    tokens: buildPreviewTokens(state.draft.visualStyleId),
    assets: [],
    flows: [],
    version: 0,
    status: 'draft',
    created_at: now,
    updated_at: now,
  };
}

function buildTemplateRoot(state: SaDesignState, title: string): UiNode {
  const templateId = state.draft.primaryTemplateId;
  const header = node('header', '页面标题', 'container', {}, {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '24px',
  }, {}, [
    node('title', '标题', 'heading', { text: title }, {}, { fontSize: '28px', fontWeight: '700', margin: '0' }),
    node('primary-action', '主操作', 'button', { text: primaryAction(templateId) }, { padding: '10px 16px' }, {
      backgroundColor: '#2f6bff', color: '#ffffff', border: '0', borderRadius: '8px', fontWeight: '600',
    }),
  ]);

  let content: UiNode[];
  if (templateId === 'td-list-table') content = listTemplateNodes();
  else if (templateId === 'td-form-settings') content = formTemplateNodes();
  else if (templateId === 'td-landing') content = landingTemplateNodes(title);
  else if (templateId === 'td-empty') content = emptyTemplateNodes();
  else content = dashboardTemplateNodes();

  return node('root', '页面根节点', 'container', {}, {
    display: 'block', minHeight: '100%', padding: '32px',
  }, { backgroundColor: '#f4f7fb', color: '#182230' }, [header, ...content], [{
    max_width: 600,
    layout: { padding: '18px' },
  }]);
}

function dashboardTemplateNodes(): UiNode[] {
  return [
    node('metrics', '指标卡片', 'container', {}, {
      display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '16px', marginBottom: '16px',
    }, {}, [
      statisticNode('metric-projects', '活跃项目', '24', '+12%'),
      statisticNode('metric-agents', '运行 Agent', '8', '稳定'),
      statisticNode('metric-tasks', '今日任务', '156', '+18'),
    ], [{ max_width: 700, layout: { gridTemplateColumns: '1fr' } }]),
    node('trend', '趋势区域', 'card', {}, { padding: '20px', minHeight: '180px', marginBottom: '16px' }, {}, [
      node('trend-title', '趋势标题', 'heading', { text: '任务趋势' }, {}, { fontSize: '18px', margin: '0 0 16px' }),
      node('trend-bars', '趋势条', 'container', {}, { display: 'flex', alignItems: 'flex-end', gap: '10px', height: '110px' }, {},
        [42, 68, 54, 88, 74, 96, 82].map((height, index) => node(`bar-${index}`, `趋势 ${index + 1}`, 'spacer', {}, {
          width: '100%', height: `${height}%`, borderRadius: '6px 6px 0 0',
        }, { backgroundColor: index === 5 ? '#2f6bff' : '#9cb7ff' }))),
    ]),
    tableNode('recent-table', '最近活动'),
  ];
}

function listTemplateNodes(): UiNode[] {
  return [
    node('filters', '搜索筛选', 'card', {}, { display: 'flex', gap: '12px', padding: '16px', marginBottom: '16px' }, {}, [
      node('search', '搜索', 'input', {}, { width: '100%', padding: '10px 12px' }, {}, [], [], { placeholder: '搜索名称或负责人', input_type: 'search', aria_label: '搜索资源' }),
      node('filter-button', '筛选', 'button', { text: '筛选' }, { padding: '10px 16px' }),
    ], [{ max_width: 600, layout: { flexDirection: 'column' } }]),
    tableNode('resource-table', '资源列表'),
  ];
}

function formTemplateNodes(): UiNode[] {
  return [node('settings-card', '设置表单', 'card', {}, { padding: '24px', maxWidth: '760px' }, {}, [
    node('section-title', '基础信息', 'heading', { text: '基础信息' }, {}, { fontSize: '18px', margin: '0 0 18px' }),
    formField('project-name', '项目名称', '例如 SaCode Workspace'),
    formField('notification-email', '通知邮箱', 'name@example.com'),
    node('save-row', '保存区域', 'container', {}, { display: 'flex', justifyContent: 'flex-end', marginTop: '24px' }, {}, [
      node('save', '保存', 'button', { text: '保存设置' }, { padding: '10px 18px' }, { backgroundColor: '#2f6bff', color: '#fff', border: '0', borderRadius: '8px' }),
    ]),
  ])];
}

function landingTemplateNodes(title: string): UiNode[] {
  return [
    node('hero', 'Hero', 'section', {}, { padding: '56px 28px', textAlign: 'center', marginBottom: '20px' }, {
      background: 'linear-gradient(135deg, #e9efff, #f7f9ff)', borderRadius: '16px',
    }, [
      node('hero-title', '价值主张', 'heading', { text: title }, {}, { fontSize: '36px', fontWeight: '750', margin: '0 auto 16px', maxWidth: '760px' }),
      node('hero-copy', '产品说明', 'text', { text: '把复杂工作流变成清晰、可执行且可验证的产品体验。' }, {}, { fontSize: '17px', color: '#526071', margin: '0 auto 24px', maxWidth: '680px' }),
      node('hero-action', '开始使用', 'button', { text: '立即开始' }, { padding: '12px 22px' }, { backgroundColor: '#2f6bff', color: '#fff', border: '0', borderRadius: '9px' }),
    ]),
    node('features', '能力卡片', 'container', {}, { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '16px' }, {},
      ['快速开始', '统一工作流', '可靠验证'].map((text, index) => node(`feature-${index}`, text, 'card', {}, { padding: '22px', minHeight: '120px' }, {}, [
        node(`feature-title-${index}`, text, 'heading', { text }, {}, { fontSize: '18px', margin: '0 0 8px' }),
        node(`feature-copy-${index}`, '说明', 'text', { text: '面向真实项目约束设计，并保持过程透明。' }, {}, { color: '#667085', margin: '0' }),
      ]))),
  ];
}

function emptyTemplateNodes(): UiNode[] {
  return [node('empty-card', '空状态', 'card', {}, { padding: '64px 24px', textAlign: 'center' }, {}, [
    node('empty-icon', '空状态图标', 'badge', { text: '＋' }, { display: 'inline-block', padding: '12px 17px', marginBottom: '16px' }, { backgroundColor: '#e8efff', color: '#2f6bff', borderRadius: '999px', fontSize: '24px' }),
    node('empty-title', '空状态标题', 'heading', { text: '暂无数据' }, {}, { fontSize: '22px', margin: '0 0 8px' }),
    node('empty-copy', '空状态说明', 'text', { text: '先创建一条内容，后续结果会显示在这里。' }, {}, { color: '#667085', margin: '0 0 20px' }),
    node('empty-action', '创建内容', 'button', { text: '创建第一条' }, { padding: '10px 16px' }, { backgroundColor: '#2f6bff', color: '#fff', border: '0', borderRadius: '8px' }),
  ])];
}

function statisticNode(id: string, label: string, value: string, trend: string): UiNode {
  return node(id, label, 'statistic', {}, { padding: '18px' }, {}, [
    node(`${id}-label`, '指标名称', 'text', { text: label }, {}, { color: '#667085', margin: '0 0 8px' }),
    node(`${id}-value`, '指标值', 'heading', { text: value }, {}, { fontSize: '28px', margin: '0 0 6px' }),
    node(`${id}-trend`, '指标趋势', 'badge', { text: trend }, { display: 'inline-block', padding: '3px 8px' }, { backgroundColor: '#e8f7ef', color: '#147a4b', borderRadius: '999px', fontSize: '12px' }),
  ]);
}

function tableNode(id: string, name: string): UiNode {
  return node(id, name, 'table', {}, { padding: '18px', overflow: 'hidden' }, {}, [], [], {
    columns: ['名称', '状态', '负责人', '更新时间'],
    rows: [
      ['设计工作台', '进行中', 'Alex', '2 分钟前'],
      ['客户端协议', '已完成', 'Sam', '1 小时前'],
      ['运行时验证', '待处理', 'Taylor', '昨天'],
    ],
  });
}

function formField(id: string, label: string, placeholder: string): UiNode {
  return node(`${id}-field`, label, 'container', {}, { marginBottom: '18px' }, {}, [
    node(`${id}-label`, '字段标签', 'text', { text: label }, {}, { fontWeight: '600', margin: '0 0 8px' }),
    node(id, label, 'input', {}, { width: '100%', padding: '10px 12px' }, {}, [], [], { placeholder, aria_label: label }),
  ]);
}

function node(
  id: string,
  name: string,
  type: string,
  content: Record<string, unknown> = {},
  layout: Record<string, unknown> = {},
  appearance: Record<string, unknown> = {},
  children: UiNode[] = [],
  responsive: unknown[] = [],
  props: Record<string, unknown> = {},
): UiNode {
  return { id, name, type, content, props, layout, appearance, responsive, states: {}, interactions: [], children, locked: false };
}

function buildPreviewTokens(visualStyleId: string | null): Record<string, unknown> {
  if (visualStyleId === 'soft-glass') {
    return { colors: { primary: '#7c5cff', surface: 'rgba(255,255,255,0.82)', text: '#202038' }, radius: { card: '16px' } };
  }
  if (visualStyleId === 'editorial-grid') {
    return { colors: { primary: '#111827', surface: '#ffffff', text: '#111827' }, radius: { card: '2px' } };
  }
  return { colors: { primary: '#2f6bff', surface: '#ffffff', text: '#182230' }, radius: { card: '12px' } };
}

function primaryAction(templateId: string | null): string {
  if (templateId === 'td-list-table') return '新建资源';
  if (templateId === 'td-form-settings') return '查看帮助';
  if (templateId === 'td-landing') return '登录';
  if (templateId === 'td-empty') return '导入';
  return '新建任务';
}

export function initializeUiEditor(state: SaDesignState, document: UiDocument) {
  state.previewDocument = document;
  state.selectedPageId = document.pages[0]?.id ?? null;
  state.selectedNodeId = document.pages[0]?.root.id ?? null;
  state.uiUndoStack = [];
  state.uiRedoStack = [];
  state.editorError = null;
  state.uiPatchProposal = null;
  state.uiCheckReport = null;
  state.draft.uiConfirmed = false;
}

export function applyUiCommand(state: SaDesignState, command: UICommand): boolean {
  if (!state.previewDocument) return false;
  try {
    const result = executeUiCommand(state.previewDocument, command);
    state.previewDocument = result.document;
    state.selectedNodeId = result.selectedNodeId ?? state.selectedNodeId;
    if (state.selectedNodeId) state.selectedPageId = findUiPageId(result.document, state.selectedNodeId);
    state.uiUndoStack.push(result.inverse);
    if (state.uiUndoStack.length > 100) state.uiUndoStack.shift();
    state.uiRedoStack = [];
    state.editorError = null;
    state.uiPatchProposal = null;
    state.uiCheckReport = null;
    state.draft.uiConfirmed = false;
    return true;
  } catch (error) {
    state.editorError = String(error instanceof Error ? error.message : error);
    return false;
  }
}

export function applyExternalUiDocument(state: SaDesignState, document: UiDocument) {
  const previous = state.previewDocument ? structuredClone(state.previewDocument) : null;
  state.previewDocument = document;
  if (previous) {
    state.uiUndoStack.push({ type: 'restore-document', document: previous });
    if (state.uiUndoStack.length > 100) state.uiUndoStack.shift();
  }
  state.uiRedoStack = [];
  const selectedPage = state.selectedNodeId ? findUiPageId(document, state.selectedNodeId) : null;
  state.selectedPageId = selectedPage ?? document.pages[0]?.id ?? null;
  if (!selectedPage) state.selectedNodeId = document.pages[0]?.root.id ?? null;
  state.editorError = null;
  state.uiPatchProposal = null;
  state.uiCheckReport = null;
  state.draft.uiConfirmed = false;
}

export function undoUiCommand(state: SaDesignState): boolean {
  if (!state.previewDocument) return false;
  const command = state.uiUndoStack.pop();
  if (!command) return false;
  try {
    const result = executeUiCommand(state.previewDocument, command);
    state.previewDocument = result.document;
    state.selectedNodeId = result.selectedNodeId;
    state.selectedPageId = result.selectedNodeId ? findUiPageId(result.document, result.selectedNodeId) : null;
    state.uiRedoStack.push(result.inverse);
    state.editorError = null;
    state.uiPatchProposal = null;
    state.uiCheckReport = null;
    state.draft.uiConfirmed = false;
    return true;
  } catch (error) {
    state.uiUndoStack.push(command);
    state.editorError = String(error instanceof Error ? error.message : error);
    return false;
  }
}

export function redoUiCommand(state: SaDesignState): boolean {
  if (!state.previewDocument) return false;
  const command = state.uiRedoStack.pop();
  if (!command) return false;
  try {
    const result = executeUiCommand(state.previewDocument, command);
    state.previewDocument = result.document;
    state.selectedNodeId = result.selectedNodeId;
    state.selectedPageId = result.selectedNodeId ? findUiPageId(result.document, result.selectedNodeId) : null;
    state.uiUndoStack.push(result.inverse);
    state.editorError = null;
    state.uiPatchProposal = null;
    state.uiCheckReport = null;
    state.draft.uiConfirmed = false;
    return true;
  } catch (error) {
    state.uiRedoStack.push(command);
    state.editorError = String(error instanceof Error ? error.message : error);
    return false;
  }
}

export function prepareUiDocumentForSession(document: UiDocument, sessionId: string): UiDocument {
  const now = new Date().toISOString();
  return {
    ...structuredClone(document),
    id: `ui-${sessionId}`,
    version: 0,
    status: 'draft',
    created_at: now,
    updated_at: now,
  };
}

export function buildImplementationProfile(state: SaDesignState): ImplementationProfile {
  return {
    schema_version: 'sacode-implementation/v1',
    project_mode: state.draft.projectMode,
    target_platform: state.draft.targetSurface,
    distribution: state.draft.targetSurface === 'desktop-app' ? 'installable' : 'browser',
    operating_systems: [],
    language: state.draft.language.trim(),
    framework: state.draft.framework.trim(),
    runtime: null,
    desktop_shell: null,
    build_tool: null,
    package_manager: null,
    ui_library: null,
    styling: null,
    router: null,
    state_management: null,
    network_layer: null,
    test_framework: null,
    source: 'user-selected',
    confidence: null,
    evidence: [],
    decisions: [],
    confirmed: state.draft.implementationConfirmed,
    confirmed_at: null,
  };
}

export function validateSaDesignDraft(state: SaDesignState): string[] {
  const errors: string[] = [];
  if (!state.draft.request.trim()) errors.push('请填写设计目标或页面需求');
  if (state.draft.outputs.length === 0) errors.push('请至少选择一种输出');
  if (!state.draft.backendId.trim()) errors.push('请选择生成 Backend');
  return errors;
}

export function validateImplementationDraft(state: SaDesignState): string[] {
  if (!state.draft.outputs.includes('code')) return [];
  const errors: string[] = [];
  if (!state.draft.targetPath.trim()) errors.push('生成项目实现时请确认目标目录');
  if (!state.draft.language.trim()) errors.push('生成项目实现前请确认编程语言');
  if (!state.draft.framework.trim()) errors.push('生成项目实现前请确认框架或实现方式');
  if (!state.draft.implementationConfirmed) errors.push('请确认 Implementation Profile');
  return errors;
}

export interface DesignConflict {
  field: string;
  sourceA: string;
  sourceB: string;
  message: string;
}

export function detectConflicts(state: SaDesignState): DesignConflict[] {
  const conflicts: DesignConflict[] = [];
  const { catalog, draft } = state;
  const template = findTemplate(catalog.templates, draft.primaryTemplateId);
  const visualStyle = findResource(catalog.visual_styles, draft.visualStyleId);

  if (template && visualStyle) {
    if (visualStyle.id === 'editorial-grid' && template.id === 'td-dashboard') {
      conflicts.push({
        field: 'density',
        sourceA: `模板: ${template.title}`,
        sourceB: `风格: ${visualStyle.title}`,
        message: '数据看板需要高密度信息展示，但 Editorial Grid 强调留白，可能导致指标区域不紧凑。',
      });
    }
    if (visualStyle.id === 'soft-glass' && template.id === 'td-list-table') {
      conflicts.push({
        field: 'contrast',
        sourceA: `模板: ${template.title}`,
        sourceB: `风格: ${visualStyle.title}`,
        message: '列表管理需要高对比操作区域，Soft Glass 的半透明层次可能影响行操作可读性。',
      });
    }
  }

  const baselineTitles = draft.baselineIds
    .map((id) => findResource(catalog.baselines, id)?.title)
    .filter((title): title is string => Boolean(title));
  if (baselineTitles.includes('Dense Workbench') && baselineTitles.includes('Accessible UI')) {
    conflicts.push({
      field: 'density',
      sourceA: '基线: Dense Workbench',
      sourceB: '基线: Accessible UI',
      message: '高密度工作台基线与可访问性基线的间距要求存在张力，建议以可访问性为优先。',
    });
  }

  return conflicts;
}

export interface ModelCapability {
  id: string;
  label: string;
  capabilities: string[];
  recommendedOutputs: DesignOutput[];
}

export const MODEL_CAPABILITIES: Record<string, ModelCapability> = {
  sacode: {
    id: 'sacode',
    label: 'SaCode Native',
    capabilities: ['text', 'code', 'tool-use'],
    recommendedOutputs: ['brief', 'prompt', 'code'],
  },
  opencode: {
    id: 'opencode',
    label: 'OpenCode ACP',
    capabilities: ['text', 'code', 'tool-use'],
    recommendedOutputs: ['brief', 'prompt', 'code'],
  },
  sensenova: {
    id: 'sensenova',
    label: 'SenseNova U1.5',
    capabilities: ['image-gen'],
    recommendedOutputs: ['images'],
  },
};

export function getModelCapability(backendId: string): ModelCapability {
  return MODEL_CAPABILITIES[backendId] ?? {
    id: backendId,
    label: backendId,
    capabilities: ['text', 'code'],
    recommendedOutputs: ['brief', 'prompt'],
  };
}

export function getUnavailableOutputs(
  backendId: string,
  outputs: DesignOutput[],
): DesignOutput[] {
  const cap = getModelCapability(backendId);
  const unsupported = outputs.filter((output) => !cap.recommendedOutputs.includes(output));
  if (!cap.capabilities.includes('image-gen')) {
    return unsupported.includes('images') ? unsupported : [...unsupported];
  }
  return unsupported;
}

export function toggleSelection<T extends string>(items: T[], value: T): T[] {
  return items.includes(value) ? items.filter((item) => item !== value) : [...items, value];
}

export function goalLabel(goal: DesignGoal): string {
  return {
    system: '整套系统',
    page: '单个页面',
    component: '组件',
    design: '设计稿',
    asset: '图片资产',
    'design-system': '设计系统',
  }[goal];
}

export function outputLabel(output: DesignOutput): string {
  return {
    brief: '设计简报',
    prompt: 'Prompt',
    design: '可视化设计稿',
    code: '前端代码',
    images: '图片文件',
    'design-system': '设计系统包',
  }[output];
}

function findTemplate(items: DesignTemplateResource[], id: string | null): DesignTemplateResource | null {
  return id ? items.find((item) => item.id === id) ?? null : null;
}

function findResource(items: DesignResourceItem[], id: string | null): DesignResourceItem | null {
  return id ? items.find((item) => item.id === id) ?? null : null;
}
