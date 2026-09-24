import type {
  DesignProjectContext,
  DesignResourceCatalog,
  DesignResourceItem,
  DesignSession,
  DesignTemplateResource,
  ExecutionModeInput,
  ExtractionJob,
  ImageGenerationResult,
} from '@cherishron/sacode-client-core';

export type DesignGoal = 'system' | 'page' | 'component' | 'design' | 'asset' | 'design-system';
export type DesignOutput = 'brief' | 'prompt' | 'design' | 'code' | 'images' | 'design-system';
export type DesignSection = 'task' | 'templates' | 'resources' | 'extraction' | 'history';
export type DesignStep = 'edit' | 'preview' | 'confirm';

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
  previewViewport: 'desktop' | 'tablet' | 'mobile';
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

export function validateSaDesignDraft(state: SaDesignState): string[] {
  const errors: string[] = [];
  if (!state.draft.request.trim()) errors.push('请填写设计目标或页面需求');
  if (state.draft.outputs.length === 0) errors.push('请至少选择一种输出');
  if (state.draft.outputs.includes('code') && !state.draft.targetPath.trim()) {
    errors.push('生成前端代码时请确认目标目录');
  }
  if (!state.draft.backendId.trim()) errors.push('请选择生成 Backend');
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
