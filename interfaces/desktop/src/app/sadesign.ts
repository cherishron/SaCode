import { el } from '../dom.ts';
import type { DesktopApp } from './service.ts';
import {
  applyExternalUiDocument,
  applyUiCommand,
  buildSaDesignPrompt,
  detectConflicts,
  getModelCapability,
  goalLabel,
  initializeUiEditor,
  outputLabel,
  toggleSelection,
  validateSaDesignDraft,
  validateImplementationDraft,
  type DesignGoal,
  buildImplementationProfile,
  buildInitialUiDocument,
  buildTargetSurface,
  prepareUiDocumentForSession,
  redoUiCommand,
  undoUiCommand,
  type DesignOutput,
  type DesignSection,
  type SaDesignState,
  type TargetSurfacePlatform,
} from './sadesign-state.ts';
import type {
  DesignResourceItem,
  DesignSession,
  DesignTemplateResource,
  ExecutionModeInput,
  ExtractionJob,
  GeneratedImage,
  UiDocument,
} from '@cherishron/sacode-client-core';
import { renderUiDocumentPreview } from './ui-document-preview.ts';
import {
  canContainChildren,
  createUiNode,
  findUiNode,
  findUiNodeLocation,
  findUiPageId,
  nextNodeId,
  type UICommand,
} from './ui-document-editor.ts';

interface SaDesignCallbacks {
  rerender: () => void;
  onRun: () => void;
}

const SECTIONS: { id: DesignSection; label: string }[] = [
  { id: 'task', label: '设计任务' },
  { id: 'templates', label: '模板' },
  { id: 'resources', label: '设计资源' },
  { id: 'extraction', label: '设计系统提取' },
  { id: 'history', label: '任务记录' },
];

export { buildSaDesignPrompt };

export function buildSaDesignWorkspace(
  app: DesktopApp,
  state: SaDesignState,
  callbacks: SaDesignCallbacks,
) {
  const templateForDetail = state.templateDetailId
    ? state.catalog.templates.find((t) => t.id === state.templateDetailId)
    : null;
  return el('main', { className: 'sadesign-workspace' }, [
    buildDesignHeader(state, callbacks.rerender),
    el('div', { className: 'sadesign-body' }, [
      buildDesignNavigation(state, callbacks.rerender),
      buildSection(app, state, callbacks),
    ]),
    ...(templateForDetail
      ? [buildTemplateDetailModal(
          templateForDetail,
          state.draft.primaryTemplateId === templateForDetail.id,
          () => {
            state.draft.primaryTemplateId = templateForDetail.id;
            invalidateUiPreview(state);
            state.section = 'task';
            callbacks.rerender();
          },
          () => {
            state.templateDetailId = null;
            callbacks.rerender();
          },
        )]
      : []),
  ]);
}

function buildDesignHeader(state: SaDesignState, rerender: () => void) {
  return el('header', { className: 'sadesign-header' }, [
    el('div', {}, [
      el('div', { className: 'sadesign-eyebrow' }, ['PROJECT DESIGN WORKSPACE']),
      el('h1', {}, ['SaDesign']),
      el('p', { className: 'muted' }, [
        state.context
          ? `${state.context.project_name} · ${state.context.technologies.join(' / ') || '技术栈待识别'}`
          : '正在整理当前项目上下文',
      ]),
    ]),
    el('div', { className: 'sadesign-header-actions' }, [
      state.loading ? el('span', { className: 'badge warn' }, ['同步中']) : '',
      state.error ? el('span', { className: 'badge bad' }, ['上下文异常']) : '',
      el('button', {
        className: 'btn ghost',
        onclick: () => {
          state.section = 'history';
          rerender();
        },
      }, ['任务记录']),
    ].filter(Boolean) as Node[]),
  ]);
}

function buildDesignNavigation(state: SaDesignState, rerender: () => void) {
  return el('nav', { className: 'sadesign-nav' }, [
    ...SECTIONS.map((section) => el('button', {
      className: `sadesign-nav-item ${state.section === section.id ? 'active' : ''}`,
      onclick: () => {
        state.section = section.id;
        rerender();
      },
    }, [section.label])),
    el('div', { className: 'sadesign-nav-spacer' }),
    el('div', { className: 'sadesign-nav-summary' }, [
      el('span', { className: 'muted' }, ['Design Context']),
      el('strong', {}, [contextResourceCount(state).toString()]),
      el('span', { className: 'muted' }, ['项设计依据']),
    ]),
  ]);
}

function buildSection(app: DesktopApp, state: SaDesignState, callbacks: SaDesignCallbacks) {
  if (state.section === 'templates') return buildTemplateGallery(state, callbacks.rerender);
  if (state.section === 'resources') return buildResourceGallery(state, callbacks.rerender);
  if (state.section === 'extraction') return buildExtractionPage(app, state, callbacks);
  if (state.section === 'history') return buildUnifiedHistory(app, state, callbacks);
  return buildDesignTask(app, state, callbacks);
}

function buildDesignTask(app: DesktopApp, state: SaDesignState, callbacks: SaDesignCallbacks) {
  if (state.step === 'preview' || state.step === 'confirm') {
    return buildPreviewPanel(app, state, callbacks);
  }
  return buildEditPanel(app, state, callbacks);
}

function buildEditPanel(app: DesktopApp, state: SaDesignState, callbacks: SaDesignCallbacks) {
  const draft = state.draft;
  const conflicts = detectConflicts(state);
  const modelCap = getModelCapability(draft.backendId);
  const errors = validateSaDesignDraft(state);
  const selectedTemplate = state.catalog.templates.find((item) => item.id === draft.primaryTemplateId);
  const selectedStyle = state.catalog.visual_styles.find((item) => item.id === draft.visualStyleId);
  const selectedSystem = state.catalog.design_systems.find((item) => item.id === draft.designSystemId);
  const selectedBaselines = state.catalog.baselines.filter((item) => draft.baselineIds.includes(item.id));

  return el('div', { className: 'sadesign-task-grid' }, [
    el('section', { className: 'sadesign-column sadesign-input-column' }, [
      sectionTitle('设计输入', '定义当前项目要生成的内容'),
      field('目标端', el('select', {
        className: 'select',
        value: draft.targetSurface,
        onchange: (event: Event) => {
          draft.targetSurface = (event.target as HTMLSelectElement).value as TargetSurfacePlatform;
          invalidateUiPreview(state);
          draft.implementationConfirmed = false;
          callbacks.rerender();
        },
      }, (['desktop-app', 'web-desktop', 'responsive-web', 'tablet', 'mobile-app', 'mini-program'] as TargetSurfacePlatform[])
        .map((platform) => el('option', { value: platform, selected: platform === draft.targetSurface }, [platform])))),
      field('目标类型', el('select', {
        className: 'select',
        value: draft.goal,
        onchange: (event: Event) => {
          draft.goal = (event.target as HTMLSelectElement).value as DesignGoal;
          invalidateUiPreview(state);
          callbacks.rerender();
        },
      }, (['system', 'page', 'component', 'design', 'asset', 'design-system'] as DesignGoal[])
        .map((goal) => el('option', { value: goal, selected: goal === draft.goal }, [goalLabel(goal)])))),
      field('设计目标', el('textarea', {
        className: 'textarea sadesign-request',
        rows: 6,
        value: draft.request,
        placeholder: '例如：为当前项目生成一个包含项目概览、Agent 状态、任务趋势和最近活动的数据看板。',
        oninput: (event: Event) => {
          draft.request = (event.target as HTMLTextAreaElement).value;
          invalidateUiPreview(state);
        },
        onchange: callbacks.rerender,
      })),
      el('div', { className: 'sadesign-shortcuts' }, [
        actionLink('选择模板', () => { state.section = 'templates'; callbacks.rerender(); }),
        actionLink('设计资源', () => { state.section = 'resources'; callbacks.rerender(); }),
        actionLink('提取设计系统', () => { state.section = 'extraction'; callbacks.rerender(); }),
      ]),
      field('补充要求', el('textarea', {
        className: 'textarea',
        rows: 4,
        value: draft.notes,
        placeholder: '品牌语气、必须保留的组件、避免事项、图片方向等',
        oninput: (event: Event) => {
          draft.notes = (event.target as HTMLTextAreaElement).value;
          invalidateUiPreview(state);
        },
      })),
    ]),
    el('section', { className: 'sadesign-column sadesign-context-column' }, [
      sectionTitle('Design Context', '确认将提供给模型的项目与视觉依据'),
      buildProjectContext(state),
      selectedTemplate
        ? buildSelectedContextCard('主模板', selectedTemplate.title, selectedTemplate.summary, () => {
            state.section = 'templates';
            callbacks.rerender();
          })
        : buildEmptyContextCard('主模板', '还未选择模板', () => {
            state.section = 'templates';
            callbacks.rerender();
          }),
      selectedStyle
        ? buildSelectedContextCard('视觉风格', selectedStyle.title, selectedStyle.summary, () => {
            state.section = 'resources';
            callbacks.rerender();
          })
        : '',
      selectedSystem
        ? buildSelectedContextCard('设计系统', selectedSystem.title, selectedSystem.summary, () => {
            state.section = 'resources';
            callbacks.rerender();
          })
        : '',
      el('div', { className: 'sadesign-baseline-row' }, [
        el('span', { className: 'muted' }, ['方向基线']),
        ...selectedBaselines.map((item) => el('span', { className: 'badge accent' }, [item.title])),
        selectedBaselines.length === 0 ? el('span', { className: 'badge' }, ['未选择']) : '',
      ].filter(Boolean) as Node[]),
      el('details', { className: 'sadesign-prompt-preview' }, [
        el('summary', {}, ['预览生成 Prompt']),
        el('pre', {}, [buildSaDesignPrompt(state)]),
      ]),
    ].filter(Boolean) as Node[]),
    el('section', { className: 'sadesign-column sadesign-settings-column' }, [
      sectionTitle('生成设置', '选择模型、产物和写入位置'),
      field('项目模式', el('select', {
        className: 'select',
        value: draft.projectMode,
        onchange: (event: Event) => {
          draft.projectMode = (event.target as HTMLSelectElement).value as 'existing' | 'new';
          draft.implementationConfirmed = false;
          callbacks.rerender();
        },
      }, [
        el('option', { value: 'existing', selected: draft.projectMode === 'existing' }, ['已有项目']),
        el('option', { value: 'new', selected: draft.projectMode === 'new' }, ['新项目']),
      ])),
      field('编程语言', el('input', {
        className: 'input',
        value: draft.language,
        placeholder: '例如 TypeScript、Kotlin、Dart',
        oninput: (event: Event) => {
          draft.language = (event.target as HTMLInputElement).value;
          draft.implementationConfirmed = false;
        },
        onchange: callbacks.rerender,
      })),
      field('框架或实现方式', el('input', {
        className: 'input',
        value: draft.framework,
        placeholder: '例如 Vue 3、React、Flutter、Kuikly、原生 DOM',
        oninput: (event: Event) => {
          draft.framework = (event.target as HTMLInputElement).value;
          draft.implementationConfirmed = false;
        },
        onchange: callbacks.rerender,
      })),
      checkbox(
        '我已确认 Implementation Profile',
        draft.implementationConfirmed,
        () => {
          draft.implementationConfirmed = !draft.implementationConfirmed;
          callbacks.rerender();
        },
      ),
      field('Backend', el('select', {
        className: 'select',
        onchange: (event: Event) => { draft.backendId = (event.target as HTMLSelectElement).value; },
      }, (app.agents.length ? app.agents : [{ id: app.defaultBackend, display_name: app.defaultBackend }])
        .map((agent) => el('option', {
          value: agent.id,
          selected: agent.id === draft.backendId,
        }, [agent.display_name || agent.id])))),
      el('div', { className: 'sadesign-model-capability' }, [
        el('span', { className: 'muted' }, ['模型能力: ']),
        ...modelCap.capabilities.map((cap) => el('span', { className: 'badge accent' }, [cap])),
      ]),
      el('div', { className: 'sadesign-model-capability' }, [
        el('span', { className: 'muted' }, ['推荐输出: ']),
        ...modelCap.recommendedOutputs.map((out) => el('span', { className: 'badge' }, [outputLabel(out)])),
      ]),
      field('执行模式', el('select', {
        className: 'select',
        onchange: (event: Event) => { draft.mode = (event.target as HTMLSelectElement).value as ExecutionModeInput; },
      }, ['plan', 'build', 'auto'].map((mode) => el('option', {
        value: mode,
        selected: mode === draft.mode,
      }, [mode])))),
      el('div', { className: 'sadesign-field' }, [
        el('label', {}, ['输出']),
        el('div', { className: 'sadesign-check-grid' },
          (['brief', 'prompt', 'design', 'code', 'images', 'design-system'] as DesignOutput[])
            .map((output) => checkbox(
              outputLabel(output),
              draft.outputs.includes(output),
              () => {
                draft.outputs = toggleSelection(draft.outputs, output);
                callbacks.rerender();
              },
            )),
        ),
      ]),
      field('目标目录', el('input', {
        className: 'input mono',
        value: draft.targetPath,
        placeholder: '例如 interfaces/desktop/src/app',
        oninput: (event: Event) => { draft.targetPath = (event.target as HTMLInputElement).value; },
        onchange: callbacks.rerender,
      })),
      el('div', { className: 'sadesign-conflicts' }, conflicts.map((conflict) =>
        el('div', { className: 'sadesign-conflict-item' }, [
          el('div', { className: 'sadesign-conflict-field' }, [conflict.field]),
          el('p', {}, [conflict.message]),
          el('div', { className: 'sadesign-conflict-sources' }, [
            el('span', { className: 'badge' }, [conflict.sourceA]),
            el('span', { className: 'muted' }, [' vs ']),
            el('span', { className: 'badge' }, [conflict.sourceB]),
          ]),
        ]),
      )),
      errors.length
        ? el('div', { className: 'sadesign-validation' }, errors.map((error) => el('div', {}, [error])))
        : conflicts.length
          ? el('div', { className: 'sadesign-validation warn' }, ['存在设计冲突，建议解决后再生成。'])
          : el('div', { className: 'sadesign-ready' }, ['Design Context 已就绪，可以预览生成计划。']),
      el('button', {
        className: 'btn sadesign-generate',
        disabled: errors.length > 0,
        onclick: () => {
          if (state.previewMode === 'session' && state.previewDocument) {
            initializeUiEditor(state, prepareUiDocumentForSession(state.previewDocument, 'preview'));
            state.previewMode = 'draft';
          }
          if (!state.previewDocument) {
            const document = buildInitialUiDocument(state, 'preview');
            state.previewViewport = document.target.viewports[0]?.id ?? 'desktop';
            initializeUiEditor(state, document);
          }
          state.currentSession = null;
          state.previewMode = 'draft';
          state.step = 'preview';
          callbacks.rerender();
        },
      }, ['预览计划']),
      state.currentSession
        ? el('button', {
            className: 'btn ghost',
            onclick: () => { state.step = 'edit'; callbacks.rerender(); },
          }, ['恢复草稿'])
        : '',
      el('p', { className: 'muted' }, [
        '生成任务会进入现有 Task、Approval 与 Changes 流程；不会绕过项目文件审批。',
      ]),
    ]),
  ]);
}

function buildTemplateGallery(state: SaDesignState, rerender: () => void) {
  return el('section', { className: 'sadesign-gallery' }, [
    galleryHeader('模板', '从现有 AIDesign 示例选择项目主模板', state.catalog.templates.length),
    state.catalog.templates.length === 0
      ? emptyState('暂无模板', state.loading ? '正在从 daemon 加载模板目录。' : '模板目录暂不可用。')
      : el('div', { className: 'sadesign-card-grid template-grid' }, state.catalog.templates.map((item) =>
          buildTemplateCard(item, state.draft.primaryTemplateId === item.id, () => {
            state.draft.primaryTemplateId = item.id;
            invalidateUiPreview(state);
            state.section = 'task';
            rerender();
          }, () => {
            state.templateDetailId = item.id;
            rerender();
          }),
        )),
  ]);
}

function buildResourceGallery(state: SaDesignState, rerender: () => void) {
  return el('section', { className: 'sadesign-gallery' }, [
    galleryHeader('设计资源', '组合视觉风格、设计系统和方向基线',
      state.catalog.visual_styles.length + state.catalog.design_systems.length + state.catalog.baselines.length),
    buildResourceGroup('视觉风格', state.catalog.visual_styles, state.draft.visualStyleId ? [state.draft.visualStyleId] : [], false, (id) => {
      state.draft.visualStyleId = state.draft.visualStyleId === id ? null : id;
      invalidateUiPreview(state);
      rerender();
    }),
    buildResourceGroup('设计系统', state.catalog.design_systems, state.draft.designSystemId ? [state.draft.designSystemId] : [], false, (id) => {
      state.draft.designSystemId = state.draft.designSystemId === id ? null : id;
      rerender();
    }),
    buildResourceGroup('方向基线', state.catalog.baselines, state.draft.baselineIds, true, (id) => {
      state.draft.baselineIds = toggleSelection(state.draft.baselineIds, id);
      rerender();
    }),
    el('div', { className: 'sadesign-gallery-footer' }, [
      el('button', {
        className: 'btn',
        onclick: () => { state.section = 'task'; rerender(); },
      }, ['完成选择']),
    ]),
  ]);
}

function buildExtractionPage(app: DesktopApp, state: SaDesignState, callbacks: SaDesignCallbacks) {
  const activeJobs = state.extractions.filter(
    (job) =>
      job.status === 'queued' ||
      job.status === 'scanning' ||
      job.status === 'analyzing' ||
      job.status === 'packaging',
  );
  const completedJobs = state.extractions.filter(
    (job) =>
      job.status === 'succeeded' ||
      job.status === 'failed' ||
      job.status === 'cancelled' ||
      job.status === 'expired',
  );
  const canSubmit =
    state.extractionTab === 'url'
      ? state.extractionUrl.trim() !== '' && state.extractionConfirmed && !state.extractionError
      : state.imageDataUrl !== '' && state.extractionConfirmed;

  const inputSection = state.extractionTab === 'url'
    ? [
        field('在线网站 URL', el('input', {
          className: 'input',
          value: state.extractionUrl,
          placeholder: 'https://example.com',
          oninput: (event: Event) => {
            state.extractionUrl = (event.target as HTMLInputElement).value;
            state.extractionError = null;
            callbacks.rerender();
          },
        })),
      ]
    : [
        field('上传截图 / 设计图', el('input', {
          type: 'file',
          accept: 'image/png,image/jpeg,image/webp,image/gif',
          onchange: (event: Event) => {
            const input = event.target as HTMLInputElement;
            const file = input.files?.[0];
            if (!file) return;
            if (file.size > 10 * 1024 * 1024) {
              state.extractionError = '图片不能超过 10MB';
              callbacks.rerender();
              return;
            }
            const reader = new FileReader();
            reader.onload = () => {
              state.imageDataUrl = reader.result as string;
              state.imageFilename = file.name;
              state.imageContentType = file.type;
              state.imageSize = file.size;
              state.extractionError = null;
              callbacks.rerender();
            };
            reader.onerror = () => {
              state.extractionError = '读取文件失败';
              callbacks.rerender();
            };
            void reader.readAsDataURL(file);
          },
        })),
        ...(state.imageDataUrl
          ? [el('div', { className: 'sadesign-image-upload-preview' }, [
              el('img', { src: state.imageDataUrl, alt: state.imageFilename }),
              el('div', { className: 'sadesign-image-upload-meta' }, [
                el('span', { className: 'mono' }, [state.imageFilename]),
                el('span', { className: 'muted' }, [formatBytes(state.imageSize)]),
              ]),
              el('button', {
                className: 'btn ghost',
                onclick: () => {
                  state.imageDataUrl = '';
                  state.imageFilename = '';
                  state.imageContentType = '';
                  state.imageSize = 0;
                  callbacks.rerender();
                },
              }, ['移除']),
            ])]
          : []),
      ];

  return el('section', { className: 'sadesign-gallery' }, [
    galleryHeader('设计系统提取', '从网页、截图、代码或设计文件生成可复用设计系统包', state.extractions.length),
    el('div', { className: 'sadesign-extraction' }, [
      el('div', { className: 'sadesign-source-tabs' }, [
        el('button', {
          className: state.extractionTab === 'url' ? 'active' : '',
          onclick: () => { state.extractionTab = 'url'; callbacks.rerender(); },
        }, ['网页 URL']),
        el('button', {
          className: state.extractionTab === 'image' ? 'active' : '',
          onclick: () => { state.extractionTab = 'image'; callbacks.rerender(); },
        }, ['图片 / 截图']),
        el('button', { disabled: true }, ['代码目录']),
        el('button', { disabled: true }, ['设计文件']),
      ]),
      ...inputSection,
      el('label', { className: 'sadesign-confirm-row' }, [
        el('input', {
          type: 'checkbox',
          checked: state.extractionConfirmed,
          onchange: () => {
            state.extractionConfirmed = !state.extractionConfirmed;
            callbacks.rerender();
          },
        }),
        el('span', {}, ['我确认拥有分析和使用该来源的权利，且不会复制受版权保护的品牌标识、文案或图片。']),
      ]),
      el('div', { className: 'sadesign-extraction-actions' }, [
        el('button', {
          className: 'btn',
          disabled: !canSubmit,
          onclick: () => {
            if (!state.extractionConfirmed) return;
            if (state.extractionTab === 'url') {
              const url = state.extractionUrl.trim();
              if (!url) return;
              if (!/^https?:\/\//.test(url)) {
                state.extractionError = 'URL 必须以 http:// 或 https:// 开头';
                callbacks.rerender();
                return;
              }
              void app.createExtraction('url', url, true).then((job) => {
                if (job) {
                  state.extractionUrl = '';
                  state.extractionConfirmed = false;
                }
                callbacks.rerender();
              });
            } else if (state.extractionTab === 'image' && state.imageDataUrl) {
              void app.createExtraction(
                'image',
                state.imageDataUrl,
                true,
                state.imageFilename,
                state.imageContentType,
                state.imageSize,
              ).then((job) => {
                if (job) {
                  state.imageDataUrl = '';
                  state.imageFilename = '';
                  state.imageContentType = '';
                  state.imageSize = 0;
                  state.extractionConfirmed = false;
                }
                callbacks.rerender();
              });
            }
          },
        }, ['新建提取']),
        state.extractionError
          ? el('span', { className: 'badge bad' }, [state.extractionError])
          : '',
      ].filter(Boolean) as Node[]),
      el('div', { className: 'sadesign-extraction-divider' }, ['当前任务']),
      activeJobs.length === 0
        ? el('p', { className: 'muted' }, ['暂无进行中的提取任务。'])
        : el('div', { className: 'sadesign-extraction-list' }, activeJobs.map((job) =>
            buildExtractionCard(job, () => {
              void app.cancelExtraction(job.id);
              callbacks.rerender();
            }, () => {
              void app.downloadDesignSystem(job.result_id || job.id);
            }),
          )),
      completedJobs.length > 0
        ? el('div', {}, [
            el('div', { className: 'sadesign-extraction-divider' }, ['任务记录']),
            el('div', { className: 'sadesign-extraction-list' }, completedJobs.map((job) =>
              buildExtractionResultCard(job, state, () => {
                void app.downloadDesignSystem(job.result_id || job.id);
              }),
            )),
          ])
        : '',
    ]),
  ]);
}

function buildExtractionCard(job: ExtractionJob, onCancel: () => void, onDownload: () => void) {
  const stageLabels: Record<string, string> = {
    queued: '排队中',
    scanning: '扫描页面结构',
    analyzing: '分析视觉证据',
    packaging: '打包设计系统',
    succeeded: '已完成',
    failed: '失败',
    cancelled: '已取消',
    expired: '已过期',
  };
  const pct = Math.round((job.progress ?? 0) * 100);
  const isActive =
    job.status === 'queued' ||
    job.status === 'scanning' ||
    job.status === 'analyzing' ||
    job.status === 'packaging';
  return el('article', { className: `sadesign-extraction-card ${job.status}` }, [
    el('div', { className: 'sadesign-extraction-card-head' }, [
      el('span', { className: `badge ${isActive ? 'warn' : job.status === 'succeeded' ? 'ok' : 'bad'}` }, [
        stageLabels[job.status] ?? job.status,
      ]),
      el('span', { className: 'muted mono' }, [job.id.slice(0, 8)]),
    ]),
    el('div', { className: 'sadesign-extraction-source' }, [job.source_ref]),
    isActive
      ? el('div', { className: 'sadesign-progress-bar' }, [
          (() => {
            const bar = el('div', { className: 'sadesign-progress-fill' });
            bar.style.width = `${pct}%`;
            return bar;
          })(),
        ])
      : '',
    job.error
      ? el('p', { className: 'badge bad' }, [job.error])
      : '',
    isActive
      ? el('button', { className: 'btn ghost', onclick: onCancel }, ['取消'])
      : '',
  ].filter(Boolean) as Node[]);
}

function buildExtractionResultCard(job: ExtractionJob, state: SaDesignState, onDownload: () => void) {
  return el('article', { className: `sadesign-extraction-card ${job.status}` }, [
    el('div', { className: 'sadesign-extraction-card-head' }, [
      el('span', { className: `badge ${job.status === 'succeeded' ? 'ok' : 'bad'}` }, [
        job.status === 'succeeded' ? '已成功' : job.status,
      ]),
      el('span', { className: 'muted mono' }, [job.id.slice(0, 8)]),
    ]),
    el('div', { className: 'sadesign-extraction-source' }, [job.source_ref]),
    job.result_sha256
      ? el('div', { className: 'sadesign-extraction-result-meta' }, [
          el('div', {}, [el('span', { className: 'muted' }, ['SHA-256: ']), el('code', { className: 'mono' }, [job.result_sha256.slice(0, 16) + '...'])]),
          job.result_size
            ? el('div', {}, [el('span', { className: 'muted' }, ['包大小: ']), el('code', {}, [formatBytes(job.result_size)])])
            : '',
          job.result_expires_at
            ? el('div', {}, [el('span', { className: 'muted' }, ['到期: ']), el('code', {}, [job.result_expires_at.slice(0, 10)])])
            : '',
        ].filter(Boolean) as Node[])
      : '',
    job.manifest
      ? el('details', { className: 'sadesign-manifest-preview' }, [
          el('summary', {}, ['清单元数据']),
          el('pre', {}, [JSON.stringify(job.manifest, null, 2)]),
        ])
      : '',
    job.status === 'succeeded'
      ? el('div', { className: 'sadesign-extraction-result-actions' }, [
          el('button', { className: 'btn ghost', disabled: true }, ['预览设计系统']),
          el('button', {
            className: 'btn ghost',
            onclick: onDownload,
          }, ['下载 ZIP']),
          el('button', {
            className: 'btn',
            onclick: () => {
              if (job.manifest && state.context) {
                state.draft.notes = `参考提取设计系统: ${JSON.stringify(job.manifest, null, 0).slice(0, 200)}\n\n${state.draft.notes}`;
                state.section = 'task';
              }
            },
          }, ['保存到项目']),
        ])
      : '',
  ].filter(Boolean) as Node[]);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1048576).toFixed(1)} MiB`;
}


function buildDesignHistory(app: DesktopApp, state: SaDesignState, rerender: () => void) {
  // Legacy: redirected to unified history
  return buildUnifiedHistory(app, state, { rerender, onRun: () => {} });
}

function buildPreviewPanel(app: DesktopApp, state: SaDesignState, callbacks: SaDesignCallbacks) {
  const draft = state.draft;
  const modelCap = getModelCapability(draft.backendId);
  const prompt = buildSaDesignPrompt(state);
  const session = state.currentSession;
  const previewDocument = state.previewDocument ?? session?.ui_document ?? buildInitialUiDocument(state, 'preview');
  const editable = state.previewMode === 'draft' && session?.status !== 'planned';
  const implementationErrors = validateImplementationDraft(state);
  const checkPassed = state.uiCheckReport?.passed === true
    && state.uiCheckReport.checked_version === previewDocument.version;

  // If we have a planned session, show its plan; otherwise show a local preview
  const plan = session?.plan;
  const stages = plan?.stages ?? buildLocalStages(draft.outputs);
  const targetFiles = plan?.target_files ?? buildLocalTargetFiles(draft.targetPath, draft.outputs);

  return el('div', { className: 'sadesign-preview-panel' }, [
    el('div', { className: 'sadesign-preview-header' }, [
      el('div', {}, [
        el('div', { className: 'sadesign-eyebrow' }, ['GENERATION PLAN']),
        el('h2', {}, ['预览生成计划']),
        el('p', { className: 'muted' }, [
          session
            ? `Session ${session.id.slice(0, 8)} · ${session.status}`
            : '确认后将创建 Design Session 并生成 SaCode 任务',
        ]),
      ]),
      el('div', { className: 'sadesign-ui-editor-actions' }, [
        session?.ui_document?.status === 'confirmed'
          ? el('button', {
              className: 'btn',
              disabled: state.uiPhaseLoading,
              onclick: () => {
                state.uiPhaseLoading = true;
                callbacks.rerender();
                void ensureDraftSession(app, state, previewDocument).finally(() => {
                  state.uiPhaseLoading = false;
                  callbacks.rerender();
                });
              },
            }, ['基于已确认版本新建草稿'])
          : '',
        el('button', {
          className: 'btn ghost',
          onclick: () => { state.step = 'edit'; callbacks.rerender(); },
        }, ['返回修改']),
      ].filter(Boolean) as Node[]),
    ]),
    el('div', { className: 'sadesign-preview-grid' }, [
      el('section', { className: 'sadesign-preview-section' }, [
        el('h3', {}, ['生成阶段']),
        el('div', { className: 'sadesign-stages' }, stages.map((stage) =>
          el('div', { className: `sadesign-stage ${stage.required ? 'required' : ''}` }, [
            el('div', { className: 'sadesign-stage-head' }, [
              el('span', { className: `badge ${stage.required ? 'accent' : ''}` }, [stage.id]),
              el('span', { className: 'muted' }, [stage.label]),
            ]),
            stage.model_id
              ? el('span', { className: 'badge' }, [stage.model_id])
              : el('span', { className: 'badge' }, [draft.backendId]),
            el('span', { className: `sadesign-stage-status sadesign-stage-${stage.status}` }, [stage.status]),
          ]),
        )),
      ]),
      el('section', { className: 'sadesign-preview-section' }, [
        el('h3', {}, ['模型与能力']),
        el('div', { className: 'sadesign-model-capability' }, [
          el('span', { className: 'muted' }, ['Backend: ']),
          el('span', { className: 'badge accent' }, [draft.backendId]),
        ]),
        el('div', { className: 'sadesign-model-capability' }, [
          el('span', { className: 'muted' }, ['能力: ']),
          ...modelCap.capabilities.map((cap) => el('span', { className: 'badge' }, [cap])),
        ]),
        el('div', { className: 'sadesign-model-capability' }, [
          el('span', { className: 'muted' }, ['输出: ']),
          ...draft.outputs.map((out) => el('span', { className: 'badge' }, [outputLabel(out)])),
        ]),
      ]),
      el('section', { className: 'sadesign-preview-section' }, [
        el('h3', {}, ['预计写入文件']),
        targetFiles.length > 0
          ? el('ul', { className: 'sadesign-target-files' }, targetFiles.map((file) =>
              el('li', { className: 'mono' }, [file]),
            ))
          : el('p', { className: 'muted' }, ['目标目录为空，将由模型自行选择位置。']),
      ]),
      el('section', { className: 'sadesign-preview-section' }, [
        el('h3', {}, ['Prompt 快照']),
        el('details', { className: 'sadesign-prompt-preview', open: true }, [
          el('summary', {}, ['查看完整 Prompt']),
          el('pre', {}, [prompt]),
        ]),
      ]),
      buildUiEditorWorkspace(app, state, callbacks, previewDocument, editable),
      ...(state.sessions.length > 1
        ? [buildVariantCompare(state, callbacks)]
        : []),
      ...(state.sessionLineage.length > 0 || session
        ? [buildVersionLineage(state, session)]
        : []),
    ]),
    el('div', { className: 'sadesign-preview-actions' }, [
      session?.status !== 'planned'
        ? checkbox(
            '我已审阅检查报告并确认冻结当前 UIDocument 版本',
            draft.uiConfirmed,
            () => {
              draft.uiConfirmed = !draft.uiConfirmed;
              callbacks.rerender();
            },
            !checkPassed,
          )
        : '',
      session?.status === 'planned'
        ? el('button', {
            className: 'btn sadesign-generate',
            onclick: () => {
              void app.generateSession(session.id).then(() => {
                state.step = 'edit';
                callbacks.onRun();
              });
            },
          }, ['确认生成'])
        : el('button', {
            className: 'btn sadesign-generate',
            disabled: !draft.uiConfirmed || !checkPassed || state.uiPhaseLoading,
            onclick: () => {
              state.uiPhaseLoading = true;
              callbacks.rerender();
              void ensureDraftSession(app, state, previewDocument)
                .then((synced) => synced ? app.confirmUiDocument(synced.session.id, synced.document.version) : null)
                .then((confirmed) => {
                  if (!confirmed) return;
                  state.currentSession = confirmed;
                  state.previewDocument = confirmed.ui_document ?? state.previewDocument;
                  state.previewMode = 'session';
                  state.uiUndoStack = [];
                  state.uiRedoStack = [];
                })
                .finally(() => {
                  state.uiPhaseLoading = false;
                  callbacks.rerender();
                });
            },
          }, [!checkPassed ? '请先运行 UI 检查' : !draft.uiConfirmed ? '请确认冻结 UI' : '冻结 UI 版本']),
      draft.uiConfirmed && implementationErrors.length > 0
        ? el('div', { className: 'sadesign-ready' }, ['UI 可先独立冻结；Implementation Profile 将在下一阶段确认。'])
        : '',
      session?.prompt_snapshot
        ? el('div', { className: 'sadesign-context-hash' }, [
            el('span', { className: 'muted' }, ['Context Hash: ']),
            el('code', { className: 'mono' }, [session.context_hash ? session.context_hash.slice(0, 16) + '...' : '—']),
          ])
        : '',
    ].filter(Boolean) as Node[]),
    ...(draft.outputs.includes('images')
      ? [buildImageGenerationPanel(app, state, callbacks)]
      : []),
  ]);
}

function buildUiEditorWorkspace(app: DesktopApp, state: SaDesignState, callbacks: SaDesignCallbacks, document: UiDocument, editable: boolean) {
  return el('section', { className: 'sadesign-preview-section sadesign-viewport-section sadesign-ui-editor' }, [
    buildUiEditorToolbar(state, callbacks, document, editable),
    buildUiAiPatchPanel(app, state, callbacks, document, editable),
    buildUiCheckPanel(app, state, callbacks, document, editable),
    state.editorError ? el('div', { className: 'sadesign-validation' }, [state.editorError]) : '',
    el('div', { className: 'sadesign-ui-editor-grid' }, [
      buildUiStructureTree(state, callbacks, document, editable),
      buildViewportPreview(state, callbacks, document, editable),
      buildUiInspector(state, callbacks, document, editable),
    ]),
  ].filter(Boolean) as Node[]);
}

function sameUiDocumentContent(left: UiDocument, right: UiDocument): boolean {
  const normalize = (document: UiDocument) => {
    const copy = structuredClone(document);
    copy.version = 0;
    copy.status = 'draft';
    copy.updated_at = '';
    return copy;
  };
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

async function ensureDraftSession(
  app: DesktopApp,
  state: SaDesignState,
  document: UiDocument,
): Promise<{ session: DesignSession; document: UiDocument } | null> {
  let session = state.currentSession;
  if (!session || state.previewMode === 'session') {
    session = await app.createSession(
      state.draft.goal,
      state.draft.request,
      state.draft.backendId,
      buildTargetSurface(state.draft.targetSurface),
    );
    if (!session) {
      state.editorError = '无法创建 Design Session';
      return null;
    }
    await app.updateSession(session.id, {
      notes: state.draft.notes || undefined,
      primary_template_id: state.draft.primaryTemplateId,
      visual_style_id: state.draft.visualStyleId,
      design_system_id: state.draft.designSystemId,
      baseline_ids: state.draft.baselineIds,
      outputs: state.draft.outputs,
      mode: state.draft.mode,
      target_path: state.draft.targetPath,
    });
    const initial = prepareUiDocumentForSession(document, session.id);
    const saved = await app.updateUiDocument(session.id, initial);
    if (!saved) {
      state.editorError = '无法同步 UIDocument 草稿';
      return null;
    }
    state.currentSession = app.currentSession ?? { ...session, ui_document: saved };
    state.previewDocument = saved;
    state.previewMode = 'draft';
    state.uiUndoStack = [];
    state.uiRedoStack = [];
    return { session: state.currentSession, document: saved };
  }

  if (session.ui_document && sameUiDocumentContent(document, session.ui_document)) {
    state.previewDocument = session.ui_document;
    return { session, document: session.ui_document };
  }
  const serverVersion = session.ui_document?.version ?? 0;
  const toSave = { ...structuredClone(document), version: serverVersion, status: 'draft' };
  const saved = await app.updateUiDocument(session.id, toSave);
  if (!saved) {
    state.editorError = '无法同步 UIDocument 草稿，可能存在版本冲突';
    return null;
  }
  state.currentSession = app.currentSession ?? { ...session, ui_document: saved };
  state.previewDocument = saved;
  state.uiUndoStack = [];
  state.uiRedoStack = [];
  return { session: state.currentSession, document: saved };
}

function buildUiAiPatchPanel(
  app: DesktopApp,
  state: SaDesignState,
  callbacks: SaDesignCallbacks,
  document: UiDocument,
  editable: boolean,
) {
  const proposal = state.uiPatchProposal;
  return el('div', { className: 'sadesign-ui-ai-panel' }, [
    el('div', { className: 'sadesign-ui-ai-input' }, [
      el('input', {
        className: 'input',
        value: state.uiAiInstruction,
        disabled: !editable || state.uiPhaseLoading,
        placeholder: '例如：把页面改成紧凑深色风格，并将主按钮文案改为创建任务',
        oninput: (event: Event) => { state.uiAiInstruction = (event.target as HTMLInputElement).value; },
      }),
      el('button', {
        className: 'btn',
        disabled: !editable || state.uiPhaseLoading || state.uiAiInstruction.trim() === '',
        onclick: () => {
          state.uiPhaseLoading = true;
          state.editorError = null;
          callbacks.rerender();
          void ensureDraftSession(app, state, document).then((synced) => {
            if (!synced) return null;
            return app.proposeUiPatch(synced.session.id, state.uiAiInstruction.trim(), synced.document.version);
          }).then((next) => {
            state.uiPatchProposal = next;
            if (!next && !state.editorError) state.editorError = 'AI 未返回可用的 UIDocument Patch';
          }).finally(() => {
            state.uiPhaseLoading = false;
            callbacks.rerender();
          });
        },
      }, [state.uiPhaseLoading ? '生成中…' : 'AI 修改']),
    ]),
    proposal ? el('div', { className: 'sadesign-ui-patch-review' }, [
      el('div', { className: 'sadesign-ui-panel-header' }, [
        el('strong', {}, [proposal.patch.summary || 'AI 修改建议']),
        el('span', { className: 'badge accent' }, [`${proposal.patch.operations.length} 项修改`]),
      ]),
      el('ul', {}, proposal.changes.map((change) => el('li', {}, [change.description]))),
      el('details', {}, [
        el('summary', {}, ['查看 Patch JSON']),
        el('pre', { className: 'mono' }, [JSON.stringify(proposal.patch, null, 2)]),
      ]),
      el('div', { className: 'sadesign-ui-editor-actions' }, [
        el('button', {
          className: 'btn',
          disabled: state.uiPhaseLoading,
          onclick: () => {
            const sessionId = state.currentSession?.id;
            if (!sessionId) return;
            state.uiPhaseLoading = true;
            callbacks.rerender();
            void app.applyUiPatch(sessionId, proposal.patch).then((updated) => {
              if (!updated) return;
              applyExternalUiDocument(state, updated);
              state.currentSession = app.currentSession;
              state.previewMode = 'draft';
              state.uiAiInstruction = '';
            }).finally(() => {
              state.uiPhaseLoading = false;
              callbacks.rerender();
            });
          },
        }, ['应用 Patch']),
        el('button', {
          className: 'btn ghost',
          onclick: () => { state.uiPatchProposal = null; callbacks.rerender(); },
        }, ['拒绝']),
      ]),
    ]) : '',
  ].filter(Boolean) as Node[]);
}

function buildUiCheckPanel(
  app: DesktopApp,
  state: SaDesignState,
  callbacks: SaDesignCallbacks,
  document: UiDocument,
  editable: boolean,
) {
  const report = state.uiCheckReport;
  return el('div', { className: 'sadesign-ui-check-panel' }, [
    el('div', {}, [
      el('strong', {}, ['UI 确认检查']),
      el('p', { className: 'muted' }, ['检查页面、视口、节点引用、危险样式和关键 UI 状态。']),
    ]),
    el('button', {
      className: 'btn ghost',
      disabled: !editable || state.uiPhaseLoading,
      onclick: () => {
        state.uiPhaseLoading = true;
        state.editorError = null;
        callbacks.rerender();
        void ensureDraftSession(app, state, document).then((synced) => {
          if (!synced) return null;
          return app.checkUiDocument(synced.session.id);
        }).then((next) => {
          state.uiCheckReport = next;
          state.draft.uiConfirmed = false;
        }).finally(() => {
          state.uiPhaseLoading = false;
          callbacks.rerender();
        });
      },
    }, [state.uiPhaseLoading ? '检查中…' : '运行检查']),
    report ? el('div', { className: `sadesign-ui-check-result ${report.passed ? 'passed' : 'blocked'}` }, [
      el('div', { className: 'sadesign-ui-panel-header' }, [
        el('strong', {}, [report.passed ? '检查通过' : '存在阻断项']),
        el('span', { className: `badge ${report.passed ? 'good' : 'bad'}` }, [`v${report.checked_version}`]),
      ]),
      report.findings.length > 0
        ? el('ul', {}, report.findings.map((finding) => el('li', {}, [
            el('span', { className: `badge ${finding.severity === 'blocker' ? 'bad' : 'warn'}` }, [finding.severity]),
            ` ${finding.message}`,
          ])))
        : el('p', { className: 'muted' }, ['未发现问题。']),
    ]) : '',
  ].filter(Boolean) as Node[]);
}

function buildUiEditorToolbar(state: SaDesignState, callbacks: SaDesignCallbacks, document: UiDocument, editable: boolean) {
  const selected = state.selectedNodeId ? findUiNode(document, state.selectedNodeId) : null;
  const selectedPage = document.pages.find((page) => page.id === state.selectedPageId) ?? document.pages[0];
  return el('div', { className: 'sadesign-ui-editor-toolbar' }, [
    el('div', {}, [
      el('h3', {}, ['可视化 UI 编辑器']),
      el('p', { className: 'muted' }, [selected ? `已选择：${selected.name} · ${selected.type}` : '从结构树或画布选择节点']),
    ]),
    el('div', { className: 'sadesign-ui-editor-actions' }, [
      ...(document.pages.length > 1 ? [el('select', {
        className: 'select sadesign-ui-page-select',
        onchange: (event: Event) => {
          const page = document.pages.find((candidate) => candidate.id === (event.target as HTMLSelectElement).value);
          if (!page) return;
          state.selectedPageId = page.id;
          state.selectedNodeId = page.root.id;
          callbacks.rerender();
        },
      }, document.pages.map((page) => el('option', { value: page.id, selected: page.id === selectedPage?.id }, [page.name])))] : []),
      toolbarButton('撤销', !editable || state.uiUndoStack.length === 0, () => { undoUiCommand(state); callbacks.rerender(); }),
      toolbarButton('重做', !editable || state.uiRedoStack.length === 0, () => { redoUiCommand(state); callbacks.rerender(); }),
      toolbarButton('复制', !editable || !selected || selected.id === selectedPage?.root.id || selected.locked || !!findUiNodeLocation(document, selected.id)?.parent?.locked, () => {
        if (!selected) return;
        runUiCommand(state, callbacks, { type: 'duplicate-node', nodeId: selected.id, newNodeId: nextNodeId(document, selected.type) });
      }),
      toolbarButton('上移', !editable || !selected || !canMoveSelected(document, selected.id, -1), () => {
        if (selected) moveSelectedByOffset(state, callbacks, document, selected.id, -1);
      }),
      toolbarButton('下移', !editable || !selected || !canMoveSelected(document, selected.id, 1), () => {
        if (selected) moveSelectedByOffset(state, callbacks, document, selected.id, 1);
      }),
      toolbarButton('删除', !editable || !selected || selected.id === selectedPage?.root.id || selected.locked || !!findUiNodeLocation(document, selected.id)?.parent?.locked, () => {
        if (selected) runUiCommand(state, callbacks, { type: 'delete-node', nodeId: selected.id });
      }),
    ]),
  ]);
}

function buildUiStructureTree(state: SaDesignState, callbacks: SaDesignCallbacks, document: UiDocument, editable: boolean) {
  const page = document.pages.find((candidate) => candidate.id === state.selectedPageId) ?? document.pages[0];
  const root = page?.root;
  return el('aside', { className: 'sadesign-ui-tree-panel' }, [
    el('div', { className: 'sadesign-ui-panel-header' }, [
      el('strong', {}, ['结构树']),
      el('span', { className: 'badge' }, [`${countUiNodes(root)} 节点`]),
    ]),
    root ? buildUiTreeNode(state, callbacks, document, root, 0, editable) : el('p', { className: 'muted' }, ['暂无节点']),
    editable ? buildInsertNodePalette(state, callbacks, document) : el('p', { className: 'muted' }, ['已规划版本只读；返回修改后会创建新草稿。']),
  ]);
}

function buildUiTreeNode(
  state: SaDesignState,
  callbacks: SaDesignCallbacks,
  document: UiDocument,
  node: import('@cherishron/sacode-client-core').UiNode,
  depth: number,
  editable: boolean,
): HTMLElement {
  const item = el('div', {
    className: `sadesign-ui-tree-item ${state.selectedNodeId === node.id ? 'selected' : ''} ${node.locked ? 'locked' : ''}`,
    draggable: editable && node.id !== document.pages.find((page) => page.id === state.selectedPageId)?.root.id && !node.locked && !findUiNodeLocation(document, node.id)?.parent?.locked,
    title: `${node.name} (${node.id})`,
  }, [
    el('span', { className: 'sadesign-ui-tree-type' }, [node.type]),
    el('span', { className: 'sadesign-ui-tree-name' }, [node.name]),
    node.locked ? el('span', { className: 'sadesign-ui-tree-lock' }, ['锁定']) : '',
  ].filter(Boolean) as Node[]);
  item.style.paddingLeft = `${10 + depth * 14}px`;
  item.onclick = () => {
    state.selectedPageId = findUiPageId(document, node.id);
    state.selectedNodeId = node.id;
    callbacks.rerender();
  };
  item.ondragstart = editable ? (event) => {
    state.draggedNodeId = node.id;
    event.dataTransfer?.setData('text/plain', node.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  } : null;
  item.ondragend = editable ? () => { state.draggedNodeId = null; } : null;
  item.ondragover = editable ? (event) => {
    if (!state.draggedNodeId || state.draggedNodeId === node.id) return;
    event.preventDefault();
    item.classList.add('drag-over');
  } : null;
  item.ondragleave = editable ? () => item.classList.remove('drag-over') : null;
  item.ondrop = editable ? (event) => {
    event.preventDefault();
    item.classList.remove('drag-over');
    const sourceId = state.draggedNodeId || event.dataTransfer?.getData('text/plain');
    if (!sourceId || sourceId === node.id) return;
    const location = findUiNodeLocation(document, node.id);
    const parentId = canContainChildren(node) ? node.id : location?.parent?.id;
    const index = canContainChildren(node) ? node.children.length : location?.index ?? 0;
    if (parentId) runUiCommand(state, callbacks, { type: 'move-node', nodeId: sourceId, parentId, index });
    state.draggedNodeId = null;
  } : null;

  const wrapper = el('div', { className: 'sadesign-ui-tree-branch' }, [item]);
  node.children.forEach((child) => wrapper.append(buildUiTreeNode(state, callbacks, document, child, depth + 1, editable)));
  return wrapper;
}

function buildInsertNodePalette(state: SaDesignState, callbacks: SaDesignCallbacks, document: UiDocument) {
  const selected = state.selectedNodeId ? findUiNode(document, state.selectedNodeId) : null;
  const activeRoot = document.pages.find((page) => page.id === state.selectedPageId)?.root ?? document.pages[0]?.root;
  const parent = selected && canContainChildren(selected)
    ? selected
    : selected ? findUiNodeLocation(document, selected.id)?.parent : activeRoot;
  return el('div', { className: 'sadesign-ui-insert-palette' }, [
    el('span', { className: 'muted' }, ['添加到当前容器']),
    el('div', { className: 'sadesign-ui-insert-grid' }, ['container', 'card', 'heading', 'text', 'button', 'input', 'divider'].map((type) =>
      el('button', {
        className: 'btn ghost',
        disabled: !parent || parent.locked,
        onclick: () => {
          if (!parent) return;
          const id = nextNodeId(document, type);
          runUiCommand(state, callbacks, { type: 'insert-node', parentId: parent.id, index: parent.children.length, node: createUiNode(type, id) });
        },
      }, [type]),
    )),
  ]);
}

function buildUiInspector(state: SaDesignState, callbacks: SaDesignCallbacks, document: UiDocument, editable: boolean) {
  const selected = state.selectedNodeId ? findUiNode(document, state.selectedNodeId) : null;
  if (!selected) return el('aside', { className: 'sadesign-ui-inspector' }, [
    el('strong', {}, ['属性']),
    el('p', { className: 'muted' }, ['选择节点后编辑属性。']),
  ]);
  const disabled = !editable || selected.locked;
  return el('aside', { className: 'sadesign-ui-inspector' }, [
    el('div', { className: 'sadesign-ui-panel-header' }, [
      el('strong', {}, ['属性']),
      el('span', { className: 'badge accent' }, [selected.type]),
    ]),
    inspectorField('名称', selected.name, disabled, (value) => runUiCommand(state, callbacks, { type: 'set-node-meta', nodeId: selected.id, name: value })),
    inspectorField('文本', stringValue(selected.content.text), disabled, (value) => runUiCommand(state, callbacks, { type: 'set-content', nodeId: selected.id, patch: { text: value } })),
    el('div', { className: 'sadesign-ui-property-row two' }, [
      inspectorField('宽度', stringValue(selected.layout.width), disabled, (value) => runUiCommand(state, callbacks, { type: 'resize-node', nodeId: selected.id, width: value })),
      inspectorField('高度', stringValue(selected.layout.height), disabled, (value) => runUiCommand(state, callbacks, { type: 'resize-node', nodeId: selected.id, height: value })),
    ]),
    inspectorSelect('布局', stringValue(selected.layout.display) || 'block', ['block', 'flex', 'grid'], disabled,
      (value) => runUiCommand(state, callbacks, { type: 'set-layout', nodeId: selected.id, patch: { display: value } })),
    inspectorField('间距 gap', stringValue(selected.layout.gap), disabled, (value) => runUiCommand(state, callbacks, { type: 'set-layout', nodeId: selected.id, patch: { gap: value } })),
    inspectorField('内边距 padding', stringValue(selected.layout.padding), disabled, (value) => runUiCommand(state, callbacks, { type: 'set-layout', nodeId: selected.id, patch: { padding: value } })),
    inspectorField('文字颜色', stringValue(selected.appearance.color), disabled, (value) => runUiCommand(state, callbacks, { type: 'set-appearance', nodeId: selected.id, patch: { color: value } })),
    inspectorField('背景颜色', stringValue(selected.appearance.backgroundColor), disabled, (value) => runUiCommand(state, callbacks, { type: 'set-appearance', nodeId: selected.id, patch: { backgroundColor: value } })),
    inspectorField('圆角', stringValue(selected.appearance.borderRadius), disabled, (value) => runUiCommand(state, callbacks, { type: 'set-appearance', nodeId: selected.id, patch: { borderRadius: value } })),
    inspectorField('字号', stringValue(selected.appearance.fontSize), disabled, (value) => runUiCommand(state, callbacks, { type: 'set-appearance', nodeId: selected.id, patch: { fontSize: value } })),
    checkbox('锁定节点', selected.locked, () => { if (editable) runUiCommand(state, callbacks, { type: 'set-node-meta', nodeId: selected.id, locked: !selected.locked }); }, !editable),
  ]);
}

function buildViewportPreview(state: SaDesignState, callbacks: SaDesignCallbacks, document: UiDocument, editable: boolean) {
  const viewports = document.target.viewports.length > 0
    ? document.target.viewports
    : buildTargetSurface(state.draft.targetSurface).viewports;
  const current = viewports.find((viewport) => viewport.id === state.previewViewport) ?? viewports[0];
  state.previewViewport = current.id;
  return el('section', { className: 'sadesign-preview-section sadesign-viewport-section' }, [
    el('div', { className: 'sadesign-viewport-heading' }, [
      el('div', {}, [
        el('h3', {}, ['UIDocument 多视口预览']),
        el('p', { className: 'muted' }, [`${document.name} · ${document.pages.length} 个页面 · ${document.status}`]),
      ]),
      el('span', { className: 'badge accent' }, [document.schema_version]),
    ]),
    el('div', { className: 'sadesign-viewport-tabs' }, viewports.map((viewport) =>
      el('button', {
        className: `sadesign-viewport-tab ${current.id === viewport.id ? 'active' : ''}`,
        onclick: () => { state.previewViewport = viewport.id; callbacks.rerender(); },
      }, [`${viewport.name} ${viewport.width}×${viewport.height}`]),
    )),
    el('div', { className: 'sadesign-viewport-stage' }, [
      (() => {
        const scale = Math.min(1, 1100 / current.width);
        const frame = el('div', { className: 'sadesign-viewport-frame' }, [
          el('div', { className: 'sadesign-viewport-toolbar' }, [
            el('span', { className: 'sadesign-viewport-url-bar' }, [
              `${current.name} · ${current.width} × ${current.height} · ${(scale * 100).toFixed(0)}%`,
            ]),
          ]),
          el('div', { className: 'sadesign-viewport-canvas' }, [
            renderUiDocumentPreview(document, current, {
              selectedNodeId: state.selectedNodeId,
              onSelectNode: (nodeId) => {
                state.selectedPageId = findUiPageId(document, nodeId);
                state.selectedNodeId = nodeId;
                callbacks.rerender();
              },
              editable,
              pageId: state.selectedPageId,
            }),
          ]),
        ]);
        frame.style.width = `${Math.round(current.width * scale)}px`;
        frame.style.setProperty('--uidoc-preview-scale', String(scale));
        frame.style.setProperty('--uidoc-source-width', `${current.width}px`);
        return frame;
      })(),
    ]),
  ]);
}

function buildVariantCompare(state: SaDesignState, callbacks: SaDesignCallbacks) {
  const recentSessions = state.sessions.slice(0, 3);
  return el('section', { className: 'sadesign-preview-section sadesign-variant-section' }, [
    el('h3', {}, ['变体比较']),
    el('p', { className: 'muted' }, ['最近生成结果并排对比（最多 3 个）。']),
    el('div', { className: 'sadesign-variant-grid' }, recentSessions.map((session) =>
      el('div', {
        className: `sadesign-variant-card ${state.currentSession?.id === session.id ? 'selected' : ''}`,
      }, [
        el('div', { className: 'sadesign-variant-header' }, [
          el('span', { className: 'mono' }, [session.id.slice(0, 8)]),
          el('span', { className: `badge ${session.status === 'completed' ? 'ok' : session.status === 'failed' ? 'bad' : ''}` }, [session.status]),
        ]),
        el('div', { className: 'sadesign-variant-preview' }, [
          el('div', { className: `sadesign-template-preview ${templateAccent(session.id)}` }, [
            el('div', { className: 'preview-browser' }, [el('span'), el('span'), el('span')]),
            el('div', { className: 'preview-layout' }, [
              el('div', { className: 'preview-hero' }),
              el('div', { className: 'preview-metrics' }, [el('i'), el('i')]),
              el('div', { className: 'preview-content' }),
            ]),
          ]),
        ]),
        el('p', { className: 'muted' }, [session.goal || session.request.slice(0, 60)]),
        el('button', {
          className: 'btn ghost',
          onclick: () => {
            state.currentSession = session;
            if (session.ui_document) {
              initializeUiEditor(state, session.ui_document);
              state.previewMode = 'session';
              state.previewViewport = session.ui_document.target.viewports[0]?.id ?? state.previewViewport;
            } else {
              state.previewDocument = null;
              state.previewMode = 'session';
              state.selectedPageId = null;
              state.selectedNodeId = null;
            }
            state.step = 'preview';
            callbacks.rerender();
          },
        }, ['查看此变体']),
      ]),
    )),
  ]);
}

function buildVersionLineage(state: SaDesignState, currentSession: DesignSession | null) {
  const lineage = state.sessionLineage.length > 0
    ? state.sessionLineage
    : currentSession
      ? [{ id: currentSession.id, status: currentSession.status, createdAt: currentSession.created_at, goal: currentSession.goal, request: currentSession.request }]
      : [];
  if (lineage.length === 0) return el('section', { className: 'sadesign-preview-section' }, []);
  const uiVersions = currentSession?.ui_versions ?? [];
  return el('section', { className: 'sadesign-preview-section sadesign-lineage-section' }, [
    el('h3', {}, ['版本谱系']),
    el('div', { className: 'sadesign-lineage-timeline' }, lineage.map((item, index) =>
      el('div', { className: 'sadesign-lineage-node' }, [
        el('div', { className: 'sadesign-lineage-dot' }, []),
        index < lineage.length - 1
          ? el('div', { className: 'sadesign-lineage-connector' }, [])
          : '',
        el('div', { className: 'sadesign-lineage-info' }, [
          el('span', { className: 'mono' }, [item.id.slice(0, 8)]),
          el('span', { className: `badge ${item.status === 'completed' ? 'ok' : item.status === 'failed' ? 'bad' : ''}` }, [item.status]),
          el('span', { className: 'muted' }, [item.goal || item.request.slice(0, 50)]),
        ].filter(Boolean) as Node[]),
      ]),
    )),
    uiVersions.length > 0
      ? el('div', { className: 'sadesign-ui-version-list' }, [
          el('strong', {}, ['已冻结 UIDocument 版本']),
          ...uiVersions.map((version) => el('div', { className: 'sadesign-ui-version-item' }, [
            el('span', { className: 'badge accent' }, [`v${version.version}`]),
            el('span', {}, [version.summary]),
            el('span', { className: 'muted' }, [new Date(version.confirmed_at).toLocaleString()]),
          ])),
        ])
      : '',
  ].filter(Boolean) as Node[]);
}

function buildImageGenerationPanel(
  app: DesktopApp,
  state: SaDesignState,
  callbacks: SaDesignCallbacks,
) {
  const promptFromDraft = state.draft.request || state.draft.notes;
  return el('section', { className: 'sadesign-preview-section sadesign-image-panel' }, [
    el('h3', {}, ['图片生成']),
    el('p', { className: 'muted' }, [
      '使用 SenseNova U1.5 Fast 生成图片。生成完成后可以先查看候选结果，再选择写入项目。',
    ]),
    field('图片 Prompt', el('textarea', {
      className: 'textarea',
      rows: 3,
      value: state.imagePrompt || promptFromDraft,
      placeholder: '描述要生成的图片内容、风格和比例',
      oninput: (event: Event) => {
        state.imagePrompt = (event.target as HTMLTextAreaElement).value;
      },
    })),
    el('div', { className: 'sadesign-image-actions' }, [
      el('button', {
        className: 'btn',
        disabled: state.imageLoading || !state.imagePrompt.trim(),
        onclick: () => {
          const prompt = state.imagePrompt.trim() || promptFromDraft.trim();
          if (!prompt) return;
          void app.generateImages(prompt).then((result) => {
            if (result) callbacks.rerender();
          });
        },
      }, [state.imageLoading ? '生成中…' : '生成图片']),
    ]),
    state.imageResults.length > 0
      ? el('div', { className: 'sadesign-image-results' },
          state.imageResults.flatMap((result) =>
            result.images.map((img: GeneratedImage) =>
              el('figure', { className: 'sadesign-image-card' }, [
                el('img', {
                  src: img.url,
                  alt: `${result.provider}/${result.model}`,
                  loading: 'lazy',
                }),
                el('figcaption', {}, [
                  el('span', { className: 'muted' }, [`${result.model} · ${img.size}`]),
                  el('a', {
                    href: img.url,
                    target: '_blank',
                    rel: 'noopener noreferrer',
                  }, ['在新窗口打开']),
                ]),
              ]),
            ),
          ),
        )
      : '',
  ].filter(Boolean) as Node[]);
}

function canMoveSelected(document: UiDocument, nodeId: string, offset: number): boolean {
  const location = findUiNodeLocation(document, nodeId);
  if (!location?.parent || location.node.locked || location.parent.locked) return false;
  const targetIndex = location.index + offset;
  return targetIndex >= 0 && targetIndex < location.parent.children.length;
}

function moveSelectedByOffset(
  state: SaDesignState,
  callbacks: SaDesignCallbacks,
  document: UiDocument,
  nodeId: string,
  offset: number,
) {
  const location = findUiNodeLocation(document, nodeId);
  if (!location?.parent) return;
  runUiCommand(state, callbacks, {
    type: 'move-node',
    nodeId,
    parentId: location.parent.id,
    index: location.index + offset + (offset > 0 ? 1 : 0),
  });
}

function runUiCommand(state: SaDesignState, callbacks: SaDesignCallbacks, command: UICommand) {
  applyUiCommand(state, command);
  callbacks.rerender();
}

function toolbarButton(label: string, disabled: boolean, onclick: () => void) {
  return el('button', { className: 'btn ghost', disabled, onclick }, [label]);
}

function inspectorField(label: string, value: string, disabled: boolean, onchange: (value: string) => void) {
  return field(label, el('input', {
    className: 'input', value, disabled,
    onchange: (event: Event) => onchange((event.target as HTMLInputElement).value),
  }));
}

function inspectorSelect(label: string, value: string, options: string[], disabled: boolean, onchange: (value: string) => void) {
  return field(label, el('select', {
    className: 'select', value, disabled,
    onchange: (event: Event) => onchange((event.target as HTMLSelectElement).value),
  }, options.map((option) => el('option', { value: option, selected: option === value }, [option]))));
}

function countUiNodes(node: import('@cherishron/sacode-client-core').UiNode | undefined): number {
  return node ? 1 + node.children.reduce((total, child) => total + countUiNodes(child), 0) : 0;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function invalidateUiPreview(state: SaDesignState) {
  state.previewDocument = null;
  state.previewMode = 'draft';
  state.selectedPageId = null;
  state.selectedNodeId = null;
  state.uiUndoStack = [];
  state.uiRedoStack = [];
  state.editorError = null;
  state.draft.uiConfirmed = false;
}

function buildLocalStages(outputs: string[]): Array<{ id: string; label: string; status: string; required: boolean; model_id: string | null }> {
  const stages = [
    { id: 'context', label: '项目上下文分析', status: 'pending', required: true, model_id: null },
  ];
  if (outputs.includes('brief') || outputs.includes('prompt')) {
    stages.push({ id: 'brief', label: '设计简报与 Prompt', status: 'pending', required: true, model_id: null });
  }
  if (outputs.includes('design') || outputs.includes('design-system')) {
    stages.push({ id: 'design', label: '可视化设计稿', status: 'pending', required: true, model_id: null });
  }
  if (outputs.includes('images')) {
    stages.push({ id: 'assets', label: '图片资产生成', status: 'pending', required: true, model_id: null });
  }
  if (outputs.includes('code')) {
    stages.push({ id: 'code', label: '前端代码生成', status: 'pending', required: true, model_id: null });
  }
  stages.push({ id: 'verify', label: '验证与检查', status: 'pending', required: true, model_id: null });
  return stages;
}

function buildLocalTargetFiles(targetPath: string, outputs: string[]): string[] {
  const base = targetPath.trim() || 'src/generated';
  const files: string[] = [];
  if (outputs.includes('brief')) files.push('DESIGN.md');
  if (outputs.includes('prompt')) files.push('PROMPT.md');
  if (outputs.includes('design')) files.push('[UIDocument 可视化设计版本]');
  if (outputs.includes('code')) files.push('[由模型根据已确认 ImplementationProfile 生成]');
  if (outputs.includes('images')) files.push(`${base}/assets/preview.png`);
  if (outputs.includes('design-system')) files.push(`${base}/tokens.css`);
  return files;
}

function buildUnifiedHistory(
  app: DesktopApp,
  state: SaDesignState,
  callbacks: SaDesignCallbacks,
) {
  const generationTasks = app.tasks.filter(
    (task) => task.prompt.includes('# SaDesign') || task.prompt.includes('SaDesign'),
  );
  const extractionJobs = state.extractions;
  const sessions = state.sessions;

  let items: Array<{ type: 'generation' | 'extraction' | 'session'; id: string; title: string; status: string; detail: string; data: unknown }>;
  if (state.historyFilter === 'generation') {
    items = [
      ...generationTasks.map((task) => ({
        type: 'generation' as const, id: task.task_id, title: firstDesignRequest(task.prompt),
        status: task.status, detail: task.task_id.slice(0, 8), data: task,
      })),
      ...sessions.map((session) => ({
        type: 'session' as const, id: session.id, title: session.request.slice(0, 60),
        status: session.status, detail: session.id.slice(0, 8), data: session,
      })),
    ];
  } else if (state.historyFilter === 'extraction') {
    items = extractionJobs.map((job) => ({
      type: 'extraction' as const, id: job.id, title: job.source_ref,
      status: job.status, detail: job.id.slice(0, 8), data: job,
    }));
  } else {
    items = [
      ...sessions.map((session) => ({
        type: 'session' as const, id: session.id, title: session.request.slice(0, 60),
        status: session.status, detail: session.id.slice(0, 8), data: session,
      })),
      ...generationTasks.map((task) => ({
        type: 'generation' as const, id: task.task_id, title: firstDesignRequest(task.prompt),
        status: task.status, detail: task.task_id.slice(0, 8), data: task,
      })),
      ...extractionJobs.map((job) => ({
        type: 'extraction' as const, id: job.id, title: job.source_ref,
        status: job.status, detail: job.id.slice(0, 8), data: job,
      })),
    ];
  }

  const typeBadge: Record<string, string> = {
    generation: '生成',
    extraction: '提取',
    session: '草稿',
  };

  return el('section', { className: 'sadesign-gallery' }, [
    galleryHeader('任务记录', '统一查看生成任务、提取任务和设计草稿', items.length),
    el('div', { className: 'sadesign-history-filters' }, [
      el('button', {
        className: `badge ${state.historyFilter === 'all' ? 'accent' : ''}`,
        onclick: () => { state.historyFilter = 'all'; callbacks.rerender(); },
      }, ['全部']),
      el('button', {
        className: `badge ${state.historyFilter === 'generation' ? 'accent' : ''}`,
        onclick: () => { state.historyFilter = 'generation'; callbacks.rerender(); },
      }, ['生成任务']),
      el('button', {
        className: `badge ${state.historyFilter === 'extraction' ? 'accent' : ''}`,
        onclick: () => { state.historyFilter = 'extraction'; callbacks.rerender(); },
      }, ['提取任务']),
    ]),
    items.length === 0
      ? emptyState('暂无任务记录', '完成一次生成或提取后，记录会在这里显示。')
      : el('div', { className: 'sadesign-history-list' }, items.map((item) =>
          el('button', {
            className: `sadesign-history-item ${item.type}`,
            onclick: () => {
              if (item.type === 'generation') {
                state.lastTaskId = item.id;
                void app.selectTask(item.id);
              } else if (item.type === 'session') {
                state.currentSession = item.data as DesignSession;
                state.step = 'preview';
              } else if (item.type === 'extraction') {
                const job = item.data as ExtractionJob;
                if (job.status === 'succeeded') {
                  void app.downloadDesignSystem(job.result_id || job.id);
                }
              }
              callbacks.rerender();
            },
          }, [
            el('div', { className: 'sadesign-history-item-head' }, [
              el('span', { className: 'badge accent' }, [typeBadge[item.type]]),
              el('strong', {}, [item.title || '(无标题)']),
            ]),
            el('div', { className: 'sadesign-history-item-meta' }, [
              el('span', { className: 'muted mono' }, [item.detail]),
              el('span', { className: `badge ${item.status === 'failed' ? 'bad' : item.status === 'completed' || item.status === 'succeeded' ? 'ok' : 'warn'}` }, [item.status]),
            ]),
          ]),
        )),
  ]);
}

function buildProjectContext(state: SaDesignState) {
  const context = state.context;
  if (!context) return buildEmptyContextCard('项目摘要', state.error || '正在从 daemon 读取项目上下文', () => {});
  return el('article', { className: 'sadesign-context-card project-context-card' }, [
    el('div', { className: 'sadesign-context-card-head' }, [
      el('span', { className: 'muted' }, ['项目摘要']),
      el('span', { className: 'badge ok' }, ['已扫描']),
    ]),
    el('h2', {}, [context.project_name]),
    el('p', {}, [context.summary]),
    el('div', { className: 'sadesign-tags' }, [
      ...context.technologies.map((item) => el('span', { className: 'badge accent' }, [item])),
      ...context.manifests.map((item) => el('span', { className: 'badge mono' }, [item])),
    ]),
    context.source_roots.length
      ? el('p', { className: 'muted mono' }, [`扫描目录：${context.source_roots.join(' · ')}`])
      : '',
  ].filter(Boolean) as Node[]);
}

function buildTemplateDetailModal(
  template: DesignTemplateResource,
  selected: boolean,
  onSelect: () => void,
  onClose: () => void,
) {
  const accent = templateAccent(template.id);
  return el('div', {
    className: 'sadesign-modal-overlay',
    onclick: (event: Event) => {
      if (event.target === event.currentTarget) onClose();
    },
  }, [
    el('div', { className: 'sadesign-modal' }, [
      el('div', { className: 'sadesign-modal-header' }, [
        el('h2', {}, [template.title]),
        el('button', {
          className: 'sadesign-modal-close',
          onclick: onClose,
          title: '关闭',
        }, ['×']),
      ]),
      el('div', { className: 'sadesign-modal-body' }, [
        el('div', { className: `sadesign-template-preview ${accent} large` }, [
          el('div', { className: 'preview-browser' }, [
            el('span'), el('span'), el('span'),
          ]),
          el('div', { className: 'preview-layout' }, [
            el('div', { className: 'preview-hero' }),
            el('div', { className: 'preview-metrics' }, [el('i'), el('i'), el('i')]),
            el('div', { className: 'preview-content' }),
          ]),
        ]),
        el('p', { className: 'muted' }, [template.summary]),
        el('div', { className: 'sadesign-detail-section' }, [
          el('h3', {}, ['页面结构']),
          template.layout_notes.length > 0
            ? el('ul', { className: 'sadesign-detail-list' },
                template.layout_notes.map((note) =>
                  el('li', {}, [note]),
                ),
              )
            : el('p', { className: 'muted' }, ['暂无页面结构信息。']),
        ]),
        el('div', { className: 'sadesign-detail-section' }, [
          el('h3', {}, ['组件清单']),
          el('div', { className: 'sadesign-tags' },
            template.components.map((component) =>
              el('span', { className: 'badge accent' }, [component]),
            ),
          ),
        ]),
        el('div', { className: 'sadesign-detail-section' }, [
          el('h3', {}, ['Token 摘要']),
          el('div', { className: 'sadesign-token-grid' }, [
            el('div', { className: 'sadesign-token-chip' }, [
              el('span', { className: 'sadesign-token-swatch color-brand' }),
              el('span', {}, ['--color-brand']),
            ]),
            el('div', { className: 'sadesign-token-chip' }, [
              el('span', { className: 'sadesign-token-swatch color-text' }),
              el('span', {}, ['--color-text']),
            ]),
            el('div', { className: 'sadesign-token-chip' }, [
              el('span', { className: 'sadesign-token-swatch color-bg' }),
              el('span', {}, ['--color-bg']),
            ]),
            el('div', { className: 'sadesign-token-chip' }, [
              el('span', { className: 'sadesign-token-swatch radius-md' }),
              el('span', {}, ['--radius-md']),
            ]),
          ]),
        ]),
      ]),
      el('div', { className: 'sadesign-modal-footer' }, [
        el('button', { className: 'btn ghost', onclick: onClose }, ['关闭']),
        el('button', { className: 'btn', onclick: () => { onSelect(); onClose(); } }, [
          selected ? '继续使用此模板' : '使用此模板',
        ]),
      ]),
    ]),
  ]);
}

function buildTemplateCard(item: DesignTemplateResource, selected: boolean, onSelect: () => void, onDetail: () => void) {
  const accent = templateAccent(item.id);
  return el('article', { className: `sadesign-template-card ${selected ? 'selected' : ''}` }, [
    el('button', {
      className: 'sadesign-template-preview-wrapper',
      onclick: onDetail,
      title: '点击查看详情',
    }, [
      el('div', { className: `sadesign-template-preview ${accent}` }, [
        el('div', { className: 'preview-browser' }, [
          el('span'), el('span'), el('span'),
        ]),
        el('div', { className: 'preview-layout' }, [
          el('div', { className: 'preview-hero' }),
          el('div', { className: 'preview-metrics' }, [el('i'), el('i'), el('i')]),
          el('div', { className: 'preview-content' }),
        ]),
      ]),
    ]),
    el('div', { className: 'sadesign-template-content' }, [
      el('div', { className: 'sadesign-template-title' }, [
        el('h2', {}, [item.title]),
        selected ? el('span', { className: 'badge ok' }, ['当前']) : '',
      ].filter(Boolean) as Node[]),
      el('p', { className: 'muted' }, [item.summary]),
      el('div', { className: 'sadesign-tags' }, item.components.slice(0, 4)
        .map((component) => el('span', { className: 'badge' }, [component]))),
      el('div', { className: 'sadesign-template-actions' }, [
        el('button', { className: 'btn ghost', onclick: onDetail }, ['详情']),
        el('button', { className: 'btn', onclick: onSelect }, [selected ? '继续使用' : '使用此模板']),
      ]),
    ]),
  ]);
}

function buildResourceGroup(
  title: string,
  items: DesignResourceItem[],
  selectedIds: string[],
  multiple: boolean,
  onToggle: (id: string) => void,
) {
  return el('div', { className: 'sadesign-resource-group' }, [
    el('div', { className: 'sadesign-resource-heading' }, [
      el('h2', {}, [title]),
      el('span', { className: 'badge' }, [String(items.length)]),
      multiple ? el('span', { className: 'muted' }, ['可多选']) : '',
    ].filter(Boolean) as Node[]),
    el('div', { className: 'sadesign-card-grid resource-grid' }, items.map((item) => {
      const selected = selectedIds.includes(item.id);
      return el('button', {
        className: `sadesign-resource-card ${selected ? 'selected' : ''}`,
        onclick: () => onToggle(item.id),
      }, [
        el('div', { className: `resource-swatch resource-${item.id}` }),
        el('div', { className: 'resource-copy' }, [
          el('strong', {}, [item.title]),
          el('p', { className: 'muted' }, [item.summary]),
          el('div', { className: 'sadesign-tags' }, item.tags.map((tag) => el('span', { className: 'badge' }, [tag]))),
        ]),
        el('span', { className: `resource-select ${selected ? 'selected' : ''}` }, [selected ? '✓' : '+']),
      ]);
    })),
  ]);
}

function buildSelectedContextCard(label: string, title: string, summary: string, onEdit: () => void) {
  return el('article', { className: 'sadesign-context-card' }, [
    el('div', { className: 'sadesign-context-card-head' }, [
      el('span', { className: 'muted' }, [label]),
      el('button', { className: 'sadesign-text-button', onclick: onEdit }, ['更换']),
    ]),
    el('h2', {}, [title]),
    el('p', { className: 'muted' }, [summary]),
  ]);
}

function buildEmptyContextCard(label: string, summary: string, onEdit: () => void) {
  return el('article', { className: 'sadesign-context-card empty' }, [
    el('span', { className: 'muted' }, [label]),
    el('p', {}, [summary]),
    el('button', { className: 'btn ghost', onclick: onEdit }, ['选择']),
  ]);
}

function sectionTitle(title: string, subtitle: string) {
  return el('div', { className: 'sadesign-section-title' }, [
    el('h2', {}, [title]),
    el('p', { className: 'muted' }, [subtitle]),
  ]);
}

function galleryHeader(title: string, subtitle: string, count: number) {
  return el('div', { className: 'sadesign-gallery-header' }, [
    el('div', {}, [el('h2', {}, [title]), el('p', { className: 'muted' }, [subtitle])]),
    el('span', { className: 'badge accent' }, [String(count)]),
  ]);
}

function field(label: string, control: Node) {
  return el('label', { className: 'sadesign-field' }, [el('span', {}, [label]), control]);
}

function checkbox(label: string, checked: boolean, onChange: () => void, disabled = false) {
  return el('label', { className: `sadesign-check ${checked ? 'checked' : ''}` }, [
    el('input', { type: 'checkbox', checked, disabled, onchange: onChange }),
    el('span', {}, [label]),
  ]);
}

function actionLink(label: string, action: () => void) {
  return el('button', { className: 'sadesign-action-link', onclick: action }, [label, ' →']);
}

function emptyState(title: string, detail: string) {
  return el('div', { className: 'sadesign-empty-state' }, [
    el('div', { className: 'sadesign-empty-mark' }, ['◇']),
    el('h2', {}, [title]),
    el('p', { className: 'muted' }, [detail]),
  ]);
}

function contextResourceCount(state: SaDesignState): number {
  return Number(Boolean(state.draft.primaryTemplateId))
    + Number(Boolean(state.draft.visualStyleId))
    + Number(Boolean(state.draft.designSystemId))
    + state.draft.baselineIds.length;
}

function templateAccent(id: string): string {
  if (id.includes('dashboard')) return 'preview-blue';
  if (id.includes('list')) return 'preview-teal';
  if (id.includes('form')) return 'preview-violet';
  if (id.includes('landing')) return 'preview-amber';
  return 'preview-slate';
}

function firstDesignRequest(prompt: string): string {
  const line = prompt.split('\n').find((item) => item.startsWith('- 用户需求：'));
  return line?.replace('- 用户需求：', '').trim() || 'SaDesign 设计任务';
}
