/** NewTaskDialog — 基于当前项目真实能力的本地任务创建器 */
import { el } from '../dom.ts';
import type { DesktopApp } from './service.ts';
import { selectWorkspaceFolder } from '../tauri-bridge.ts';
import type { ConversationMode } from './top-bar.ts';
import { brandLogo } from '../brand.ts';

export interface NewTaskDialogState {
  open: boolean;
  workspace: string;
  prompt: string;
  model: string;
  skill: string;
  selectedPaths: string[];
  projectMenuOpen: boolean;
  fileMenuOpen: boolean;
  fileFilter: string;
  creating: boolean;
  error: string | null;
}

export function createNewTaskDialogState(): NewTaskDialogState {
  return {
    open: false,
    workspace: '',
    prompt: '',
    model: '',
    skill: '',
    selectedPaths: [],
    projectMenuOpen: false,
    fileMenuOpen: false,
    fileFilter: '',
    creating: false,
    error: null,
  };
}

export interface NewTaskDialogActions {
  mode: ConversationMode;
  layout?: 'dialog' | 'page';
  onClose: () => void;
  onConfigureModels: () => void;
  onSwitchWorkspace: (workspace: string) => Promise<void>;
  onCreateEmpty: (workspace: string) => Promise<void>;
  onCreateTask: (options: {
    workspace: string;
    prompt: string;
    modelProvider?: string;
    modelName?: string;
    skill?: string;
    contextPaths: string[];
  }) => Promise<void>;
  rerender: () => void;
}

export function openNewTaskDialog(state: NewTaskDialogState, app: DesktopApp, workspace?: string) {
  state.open = true;
  state.workspace = workspace || app.workspace;
  state.prompt = '';
  state.selectedPaths = [];
  state.projectMenuOpen = false;
  state.fileMenuOpen = false;
  state.fileFilter = '';
  state.creating = false;
  state.error = null;
  const models = app.workspaceCapabilities.models;
  if (models.length > 0 && !models.some((model) => model.id === state.model)) state.model = models[0]?.id || '';
  void app.refreshWorkspaceCapabilities();
}

export function buildNewTaskDialog(
  app: DesktopApp,
  state: NewTaskDialogState,
  actions: NewTaskDialogActions,
): HTMLElement {
  const projectName = workspaceName(state.workspace) || '选择项目';
  const recentProjects = readRecentProjects(app.workspace);
  const capabilities = app.workspaceCapabilities;
  if (capabilities.models.length > 0 && !capabilities.models.some((model) => model.id === state.model)) {
    state.model = capabilities.models[0].id;
  }
  // 列表可能在用户选择后刷新；保留所选技能，由 daemon 拒绝已失效的选择。
  const selectedModel = capabilities.models.find((model) => model.id === state.model);

  return el('div', {
    className: actions.layout === 'page' ? 'task-creator-page' : 'task-creator-overlay',
    onclick: (event: Event) => {
      if (actions.layout !== 'page' && event.target === event.currentTarget && !state.creating) actions.onClose();
    },
  }, [
    el('div', { className: 'task-creator-dialog', role: 'dialog', ariaModal: 'true' }, [
      ...(actions.layout === 'page' ? [] : [el('button', {
        className: 'task-creator-close',
        title: '关闭',
        disabled: state.creating,
        onclick: actions.onClose,
      }, ['×'])]),
      el('div', { className: 'task-creator-heading' }, [
        brandLogo({ className: 'task-creator-logo rounded', size: 48 }),
        el('div', {}, [
          el('h2', {}, ['新建本地任务']),
          el('p', {}, ['使用当前项目已经配置的模型、技能和文件上下文']),
        ]),
      ]),
      ...(state.error ? [el('div', { className: 'task-creator-error', role: 'alert' }, [state.error])] : []),
      el('div', { className: 'task-compose-card' }, [
        el('div', { className: 'task-project-select-wrap' }, [
          el('button', {
            className: 'task-project-select',
            onclick: () => {
              state.projectMenuOpen = !state.projectMenuOpen;
              state.fileMenuOpen = false;
              actions.rerender();
            },
          }, [
            el('span', { className: 'task-project-folder' }, ['□']),
            el('span', { className: 'task-project-label' }, ['项目']),
            el('span', { className: 'task-project-divider' }, ['·']),
            el('span', { className: 'task-project-name' }, [projectName]),
            el('span', { className: 'task-project-chevron' }, ['⌄']),
          ]),
          state.projectMenuOpen ? buildProjectMenu(state, recentProjects, actions) : '',
        ]),
        state.selectedPaths.length > 0
          ? el('div', { className: 'task-context-chips' }, state.selectedPaths.map((path) =>
              el('span', { className: 'task-context-chip', title: path }, [
                path,
                el('button', {
                  title: '移除',
                  onclick: () => {
                    state.selectedPaths = state.selectedPaths.filter((item) => item !== path);
                    actions.rerender();
                  },
                }, ['×']),
              ]),
            ))
          : '',
        el('textarea', {
          id: 'new-task-prompt',
          className: 'task-compose-prompt',
          rows: 7,
          value: state.prompt,
          placeholder: '描述要在当前项目中完成的工作… 留空则先创建会话',
          autofocus: true,
          oninput: (event: Event) => { state.prompt = (event.target as HTMLTextAreaElement).value; },
          onkeydown: (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault();
              void createTask(state, actions);
            }
          },
        }),
        el('div', { className: 'task-compose-toolbar' }, [
          el('div', { className: 'task-compose-tools' }, [
            el('div', { className: 'task-file-picker-wrap' }, [
              el('button', {
                className: `task-tool-icon ${state.selectedPaths.length ? 'active' : ''}`,
                title: '选择当前项目中的文件或目录',
                onclick: () => {
                  state.fileMenuOpen = !state.fileMenuOpen;
                  state.projectMenuOpen = false;
                  actions.rerender();
                },
              }, ['@']),
              state.fileMenuOpen ? buildFileMenu(app, state, actions) : '',
            ]),
            capabilities.models.length > 0
              ? compactSelect('task-model', state.model, capabilities.models.map((model) => [model.id, `${model.provider} / ${model.model}`]), (value) => {
                  state.model = value;
                  actions.rerender();
                })
              : el('button', { className: 'task-capability-empty task-configure-models', onclick: actions.onConfigureModels }, ['配置模型 →']),
            selectedModel?.thinking
              ? el('span', { className: 'task-thinking-badge', title: '思考能力由项目模型配置决定' }, [
                  selectedModel.reasoning_effort ? `思考 · ${selectedModel.reasoning_effort}` : '思考已启用',
                ])
              : '',
            capabilities.skills.length > 0 || state.skill
              ? compactSelect('task-skill', state.skill, [
                  ['', '不使用技能'],
                  ...(state.skill && !capabilities.skills.some((skill) => skill.name === state.skill)
                    ? [[state.skill, `${state.skill} · 已不可用`, '此技能已不在当前列表中，保存任务时将由服务端校验'] as [string, string, string]] : []),
                  ...capabilities.skills.map((skill) => [skill.name, `${skill.name} · ${sourceLabel(skill.source)}`, skill.description] as [string, string, string]),
                ], (value) => { state.skill = value; actions.rerender(); })
              : el('span', { className: 'task-capability-empty' }, ['无已安装技能']),
            el('button', {
              id: 'btn-enhance-task',
              className: 'task-tool-icon',
              title: '增强提示词',
              innerHTML: enhanceIcon(),
              onclick: () => {
                const ta = document.getElementById('new-task-prompt') as HTMLTextAreaElement | null;
                if (!ta) return;
                const original = ta.value.trim();
                if (!original) return;
                ta.value = enhancePrompt(original);
                state.prompt = ta.value;
                actions.rerender();
              },
            }),
          ]),
          el('button', {
            className: 'task-create-button',
            disabled: state.creating || !state.workspace || (state.prompt.trim().length > 0 && capabilities.models.length === 0),
            onclick: () => void createTask(state, actions),
          }, [state.creating ? '创建中…' : '创建', el('span', { className: 'task-create-arrow' }, ['➤'])]),
        ]),
      ]),
      el('div', { className: 'task-creator-shortcut' }, [
        `本地执行 · 当前模式：${modeLabel(actions.mode)} · 点击底部模式按钮可循环切换`,
      ]),
    ]),
  ]);
}

function enhanceIcon(): string {
  return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9L18 15z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
}

function enhancePrompt(text: string): string {
  if (!text.trim()) return text;
  return [
    text.trim(),
    '',
    '补充要求：',
    '- 先给出简短方案再动手',
    '- 保持改动最小且可验证',
    '- 结束时说明验证方式',
  ].join('\n');
}

function buildProjectMenu(state: NewTaskDialogState, recentProjects: string[], actions: NewTaskDialogActions) {
  return el('div', { className: 'task-project-menu' }, [
    ...recentProjects.map((path) => el('button', {
      className: `task-project-option ${path === state.workspace ? 'selected' : ''}`,
      title: path,
      onclick: () => void switchWorkspace(state, path, actions),
    }, [
      el('span', { className: 'task-project-option-name' }, [workspaceName(path)]),
      el('span', { className: 'task-project-option-path' }, [path]),
    ])),
    el('button', {
      className: 'task-project-browse',
      onclick: () => void (async () => {
        const path = await selectWorkspaceFolder();
        if (!path) return;
        await switchWorkspace(state, path, actions);
      })(),
    }, ['＋ 选择其他文件夹…']),
  ]);
}

function buildFileMenu(app: DesktopApp, state: NewTaskDialogState, actions: NewTaskDialogActions) {
  const entries = projectEntries(app.workspaceCapabilities.files.map((file) => file.path));
  const keyword = state.fileFilter.trim().toLowerCase();
  const filtered = entries.filter((entry) => !keyword || entry.path.toLowerCase().includes(keyword)).slice(0, 150);
  return el('div', { className: 'task-file-menu' }, [
    el('input', {
      className: 'task-file-search',
      value: state.fileFilter,
      placeholder: '搜索当前项目文件…',
      oninput: (event: Event) => {
        state.fileFilter = (event.target as HTMLInputElement).value;
        actions.rerender();
      },
    }),
    el('div', { className: 'task-file-list' }, filtered.length > 0 ? filtered.map((entry) => {
      const selected = state.selectedPaths.includes(entry.path);
      return el('button', {
        className: `task-file-option ${selected ? 'selected' : ''}`,
        title: entry.path,
        onclick: () => {
          state.selectedPaths = selected
            ? state.selectedPaths.filter((item) => item !== entry.path)
            : [...state.selectedPaths, entry.path];
          actions.rerender();
        },
      }, [
        el('span', { className: 'task-file-icon' }, [entry.directory ? '▸' : '·']),
        el('span', { className: 'task-file-path' }, [entry.path]),
        el('span', { className: 'task-file-check' }, [selected ? '✓' : '']),
      ]);
    }) : [el('div', { className: 'task-file-empty' }, [
      app.workspaceCapabilities.files.length ? '没有匹配项' : '项目文件尚未加载',
    ])]),
  ]);
}

function projectEntries(files: string[]): Array<{ path: string; directory: boolean }> {
  const directories = new Set<string>();
  for (const file of files) {
    const parts = file.split('/');
    for (let index = 1; index < parts.length; index++) directories.add(parts.slice(0, index).join('/'));
  }
  return [
    ...[...directories].map((path) => ({ path, directory: true })),
    ...files.map((path) => ({ path, directory: false })),
  ].sort((left, right) => Number(right.directory) - Number(left.directory) || left.path.localeCompare(right.path));
}

function compactSelect(id: string, value: string, options: Array<[string, string, string?]>, onChange: (value: string) => void) {
  return el('select', {
    id,
    className: 'task-compact-select',
    value,
    title: options.find(([optionValue]) => optionValue === value)?.[2] || '',
    onchange: (event: Event) => onChange((event.target as HTMLSelectElement).value),
  }, options.map(([optionValue, label, description]) => el('option', {
    value: optionValue,
    selected: optionValue === value,
    ...(description ? { title: description } : {}),
  }, [label])));
}

async function switchWorkspace(state: NewTaskDialogState, path: string, actions: NewTaskDialogActions) {
  if (!path || path === state.workspace) {
    state.projectMenuOpen = false;
    actions.rerender();
    return;
  }
  state.creating = true;
  state.projectMenuOpen = false;
  state.workspace = path;
  state.model = '';
  state.skill = '';
  state.selectedPaths = [];
  rememberProject(path);
  actions.rerender();
  try {
    await actions.onSwitchWorkspace(path);
  } finally {
    state.creating = false;
    actions.rerender();
  }
}

async function createTask(state: NewTaskDialogState, actions: NewTaskDialogActions) {
  if (!state.workspace || state.creating) return;
  state.creating = true;
  state.error = null;
  actions.rerender();
  try {
    if (state.prompt.trim()) {
      const [modelProvider, ...modelParts] = state.model.split('/');
      await actions.onCreateTask({
        workspace: state.workspace,
        prompt: state.prompt.trim(),
        ...(modelProvider && modelParts.length ? { modelProvider, modelName: modelParts.join('/') } : {}),
        ...(state.skill ? { skill: state.skill } : {}),
        contextPaths: state.selectedPaths,
      });
    } else {
      await actions.onCreateEmpty(state.workspace);
    }
  } catch (error) {
    state.error = String(error);
    actions.rerender();
  } finally {
    state.creating = false;
    actions.rerender();
  }
}

function sourceLabel(source: string) {
  return source === 'project' ? '项目' : source === 'user' ? '用户' : source === 'workspace' ? '工作区' : source;
}

function workspaceName(path: string): string {
  return path.replace(/[\\/]+$/, '').replace(/\\/g, '/').split('/').pop() || path;
}

function readRecentProjects(current: string): string[] {
  let stored: string[] = [];
  try { stored = JSON.parse(localStorage.getItem('sacode.recentProjects') || '[]') as string[]; } catch { stored = []; }
  return [current, ...stored].map((item) => item?.trim()).filter((item, index, all): item is string => Boolean(item) && all.indexOf(item) === index).slice(0, 8);
}

function rememberProject(path: string) {
  const projects = readRecentProjects(path).filter((item) => item !== path);
  localStorage.setItem('sacode.recentProjects', JSON.stringify([path, ...projects].slice(0, 8)));
}

function modeLabel(mode: ConversationMode): string {
  return mode === 'plan' ? '规划' : mode === 'build' ? '构建' : 'YOLO';
}
