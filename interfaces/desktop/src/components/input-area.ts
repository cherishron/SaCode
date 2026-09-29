/** InputArea — 对话输入坞：模式、模型、技能与文件上下文 */
import { el } from '../dom.ts';
import type { DesktopApp } from '../app/service.ts';
import type { ExecutionModeInput } from '@cherishron/sacode-client-core';
import { buildModeButton, type ConversationMode } from '../app/top-bar.ts';

export interface InputAreaState {
  draft: string;
  sending: boolean;
  moreMenuOpen: boolean;
  voiceActive: boolean;
  enhancePreviewOpen: boolean;
  enhancePreview: string;
  executionMode: ExecutionModeInput;
  backend: string;
  model: string;
  skill: string;
  selectedPaths: string[];
  editingQueueId: string | null;
  queueEditDraft: string;
}

export function createInputAreaState(): InputAreaState {
  return {
    draft: '',
    sending: false,
    moreMenuOpen: false,
    voiceActive: false,
    enhancePreviewOpen: false,
    enhancePreview: '',
    executionMode: 'build',
    backend: '',
    model: '',
    skill: '',
    selectedPaths: [],
    editingQueueId: null,
    queueEditDraft: '',
  };
}

const SLASH_COMMANDS = [
  { cmd: '/review', desc: '代码审查当前变更' },
  { cmd: '/test', desc: '生成单元测试' },
  { cmd: '/docs', desc: '更新相关文档' },
  { cmd: '/fix', desc: '定位并修复问题' },
  { cmd: '/explain', desc: '解释选定代码' },
];

export function buildInputArea(app: DesktopApp, state: InputAreaState, onModeChange?: (mode: string) => void, onConfigureModels?: () => void, conversationId?: string | null, onCreated?: (taskId: string) => void) {
  let container: HTMLDivElement;
  const field = <T extends HTMLElement>(selector: string) => container.querySelector<T>(selector);
  const detail = conversationId
    ? app.conversationTurns?.id === conversationId ? app.conversationTurns : app.conversationDetails.get(conversationId)
    : null;
  const selected = detail?.turns.at(-1);
  const conversation = conversationId ? app.desktopConversations.find((item) => item.id === conversationId) : null;
  const conversationStatus = conversation?.status;
  const running = ['running', 'queued', 'pending', 'ready', 'retrying', 'waiting_approval'].includes(conversationStatus || selected?.status || '');
  const queued = conversationId ? app.queuedMessages.get(conversationId) || [] : [];
  const models = app.workspaceCapabilities.models;
  const skills = app.workspaceCapabilities.skills;
  if (models.length > 0 && !models.some((model) => model.id === state.model)) state.model = models[0]?.id || '';
  const backends = app.agents.length ? app.agents.map((agent) => agent.id) : ['sacode'];
  if (!state.backend || !backends.includes(state.backend)) state.backend = backends.includes(app.defaultBackend) ? app.defaultBackend : backends[0];

  const promptValue = () => state.draft.trim();
  const sendDisabled = state.sending || (!running && promptValue().length === 0);

  container = el('div', { className: 'input-area' }, [
    queued.length && conversationId ? buildQueuePanel(app, state, conversationId) : '',
    state.enhancePreviewOpen
      ? el('div', { className: 'input-enhance-preview' }, [
          el('span', { className: 'muted' }, ['增强后']),
          el('div', { className: 'input-enhance-text' }, [state.enhancePreview]),
          el('button', {
            className: 'btn btn-sm ghost',
            onclick: () => {
              const ta = field<HTMLTextAreaElement>('.input-prompt');
              state.draft = state.enhancePreview;
              if (ta) ta.value = state.draft;
              state.enhancePreviewOpen = false;
              app.onChange?.();
            },
          }, ['应用']),
        ])
      : '',
    el('div', { className: 'input-context-tags' }, state.selectedPaths.map((path) =>
      el('span', { className: 'context-tag' }, [
        el('span', {}, [path]),
        el('span', {
          className: 'context-tag-remove',
          onclick: () => {
            state.selectedPaths = state.selectedPaths.filter((item) => item !== path);
            app.onChange?.();
          },
        }, ['×']),
      ]),
    )),
    el('textarea', {
      className: 'textarea input-prompt',
      value: state.draft,
      disabled: state.sending,
      rows: 2,
      placeholder: '描述要构建或修复的任务…',
      onkeydown: (event: KeyboardEvent) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          triggerRun(app, state, container, conversationId, onCreated, running);
        }
      },
      oninput: (event: Event) => {
        const ta = event.target as HTMLTextAreaElement;
        state.draft = ta.value;
        const btn = field<HTMLButtonElement>('.input-send-btn:not(.stop)');
        if (btn) btn.disabled = ta.value.trim().length === 0;
        handleInputTrigger(ta, app, state);
      },
    }),
    el('div', { className: 'input-toolbar' }, [
      el('div', { className: 'input-toolbar-left' }, [
        el('button', {
          className: 'input-tool-btn',
          title: '选择当前项目文件 (@)',
          onclick: () => openFilePicker(container, app, state),
        }, ['@']),
        el('button', {
          className: 'input-tool-btn',
          title: '快捷命令 (/)',
          onclick: () => openSlashMenu(container, app, state),
        }, ['/']),
        el('button', {
          className: 'input-tool-btn',
          title: '增强提示词',
          innerHTML: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9L18 15z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
          onclick: () => {
            const original = state.draft.trim();
            state.enhancePreview = enhancePrompt(original);
            state.enhancePreviewOpen = true;
            app.onChange?.();
          },
        }),
        el('button', {
          className: `input-tool-btn ${state.voiceActive ? 'active' : ''}`,
          title: state.voiceActive ? '停止语音输入' : '语音输入',
          innerHTML: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" stroke-width="1.6"/><path d="M5 11a7 7 0 0014 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M12 18v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
          onclick: () => toggleVoice(container, state, app),
        }),
      ]),
      el('div', { className: 'input-toolbar-right' }, [
        buildModeButton(state.executionMode as ConversationMode, (mode) => {
          state.executionMode = mode;
          onModeChange?.(mode);
          app.onChange?.();
        }),
        models.length > 0
          ? el('select', {
              className: 'input-chip-select',
              title: '模型',
              onchange: (event: Event) => { state.model = (event.target as HTMLSelectElement).value; },
            }, models.map((model) => el('option', {
              value: model.id,
              selected: model.id === state.model,
            }, [model.model])))
          : el('button', { className: 'input-chip muted', title: '打开设置，登录或添加自己的模型', onclick: onConfigureModels }, ['配置模型 →']),
        skills.length > 0 || state.skill
          ? el('select', {
              className: 'input-chip-select',
              title: '技能',
              onchange: (event: Event) => { state.skill = (event.target as HTMLSelectElement).value; },
            }, [
              el('option', { value: '', selected: !state.skill }, ['技能']),
              ...(state.skill && !skills.some((item) => item.name === state.skill)
                ? [el('option', { value: state.skill, selected: true }, [`${state.skill}（已不可用）`])] : []),
              ...skills.map((skill) => el('option', {
                value: skill.name,
                title: skill.description || skill.name,
                selected: skill.name === state.skill,
              }, [skill.name])),
            ])
          : '',
        el('select', {
          className: 'input-chip-select input-backend',
          title: 'Backend',
          onchange: (event: Event) => { state.backend = (event.target as HTMLSelectElement).value; },
        }, backends.map((id) =>
          el('option', { value: id, selected: id === state.backend }, [id]),
        )),
        ...(running
          ? [el('button', {
              className: 'input-send-btn stop',
              onclick: () => { void app.stopTask(conversation?.latest_task_id || selected?.task_id); },
            }, ['停止']),
            el('button', {
              className: 'input-send-btn queue',
              disabled: state.sending || !promptValue(),
              title: '上一轮结束后自动发送',
              onclick: () => triggerRun(app, state, container, conversationId, onCreated, true),
            }, ['排队'])]
          : [el('button', {
              className: 'input-send-btn',
              disabled: sendDisabled,
              title: sendDisabled ? '先输入任务内容' : '发送',
              innerHTML: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M21 3L10.5 13.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 3L14 21l-3.5-7.5L3 10 21 3z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
              onclick: () => triggerRun(app, state, container, conversationId, onCreated),
            })]),
      ]),
    ]),
  ]);
  return container;
}

function buildQueuePanel(app: DesktopApp, state: InputAreaState, conversationId: string): HTMLElement {
  const queue = app.queuedMessages.get(conversationId) || [];
  return el('div', { className: 'input-queue' }, [
    el('div', { className: 'input-queue-heading' }, [`待发送 · ${queue.length}（本窗口）`]),
    ...queue.map((item, index) => el('div', { className: 'input-queue-item' }, [
      state.editingQueueId === item.id
        ? el('textarea', {
            className: 'input-queue-edit',
            rows: 2,
            value: state.queueEditDraft,
            oninput: (event: Event) => { state.queueEditDraft = (event.target as HTMLTextAreaElement).value; },
          })
        : el('span', { className: 'input-queue-text', title: item.prompt }, [item.prompt]),
      ...(item.error ? [el('span', { className: 'input-queue-error', title: item.error }, ['发送失败'])] : []),
      ...(state.editingQueueId === item.id ? [
        el('button', {
          className: 'input-queue-action',
          disabled: !state.queueEditDraft.trim(),
          onclick: () => {
            app.editQueuedMessage(conversationId, item.id, state.queueEditDraft);
            state.editingQueueId = null;
            app.onChange?.();
          },
        }, ['保存']),
        el('button', {
          className: 'input-queue-action',
          onclick: () => { state.editingQueueId = null; app.onChange?.(); },
        }, ['取消']),
      ] : [
        ...(item.error ? [el('button', {
          className: 'input-queue-action',
          onclick: () => app.retryQueuedMessage(conversationId, item.id),
        }, ['重试'])] : []),
        el('button', {
          className: 'input-queue-action', disabled: item.sending,
          onclick: () => { state.editingQueueId = item.id; state.queueEditDraft = item.prompt; app.onChange?.(); },
        }, ['编辑']),
        el('button', {
          className: 'input-queue-action', disabled: item.sending || index === 0,
          title: '上移', onclick: () => app.moveQueuedMessage(conversationId, item.id, -1),
        }, ['↑']),
        el('button', {
          className: 'input-queue-action', disabled: item.sending || index === queue.length - 1,
          title: '下移', onclick: () => app.moveQueuedMessage(conversationId, item.id, 1),
        }, ['↓']),
        el('button', {
          className: 'input-queue-action', disabled: item.sending,
          title: '移除', onclick: () => app.removeQueuedMessage(conversationId, item.id),
        }, ['×']),
      ]),
    ])),
  ]);
}

function triggerRun(app: DesktopApp, state: InputAreaState, container: HTMLElement, conversationId?: string | null, onCreated?: (taskId: string) => void, running = false) {
  if (state.sending) return;
  const prompt = state.draft.trim();
  const backendId = state.backend || app.defaultBackend || 'sacode';
  if (!prompt) {
    app.error('prompt 为空');
    return;
  }
  const modelId = state.model;
  const [modelProvider, ...modelParts] = modelId.split('/');
  const skill = state.skill;
  if (running && conversationId) {
    app.queueDesktopMessage(conversationId, {
      prompt,
      mode: state.executionMode || 'build',
      backendId,
      ...(modelProvider && modelParts.length ? { modelProvider, modelName: modelParts.join('/') } : {}),
      ...(skill ? { skill } : {}),
      contextPaths: state.selectedPaths,
    });
    state.draft = '';
    app.onChange?.();
    return;
  }
  const ta = container.querySelector<HTMLTextAreaElement>('.input-prompt');
  state.sending = true;
  if (ta) ta.disabled = true;
  app.onChange?.();
  void app.runTask({
    prompt,
    mode: state.executionMode || 'build',
    backendId,
    ...(modelProvider && modelParts.length ? { modelProvider, modelName: modelParts.join('/') } : {}),
    ...(skill ? { skill } : {}),
    contextPaths: state.selectedPaths,
    conversationId,
  }).then((created) => {
    if (!created) return;
    if (state.draft.trim() === prompt) {
      state.draft = '';
      if (ta) ta.value = '';
    }
    if (app.currentTaskId) onCreated?.(app.currentTaskId);
  }).catch((error: unknown) => {
    app.error(`发送失败：${String(error)}`);
  }).finally(() => {
    state.sending = false;
    app.onChange?.();
  });
}

function insertAtCursor(container: HTMLElement, state: InputAreaState, text: string) {
  const ta = container.querySelector<HTMLTextAreaElement>('.input-prompt');
  if (!ta) return;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const before = ta.value.slice(0, start);
  const trigger = text.startsWith('@') ? before.match(/@[^\s@]*$/) : text.startsWith('/') ? before.match(/\/[a-z-]*$/) : null;
  const replaceStart = trigger ? start - trigger[0].length : start;
  ta.value = ta.value.slice(0, replaceStart) + text + ta.value.slice(end);
  state.draft = ta.value;
  const send = container.querySelector<HTMLButtonElement>('.input-send-btn:not(.stop)');
  if (send) send.disabled = state.draft.trim().length === 0;
  ta.focus();
  ta.selectionStart = ta.selectionEnd = replaceStart + text.length;
}

function handleInputTrigger(ta: HTMLTextAreaElement, app: DesktopApp, state: InputAreaState) {
  const container = ta.closest<HTMLElement>('.input-area');
  if (!container) return;
  const text = ta.value.slice(0, ta.selectionStart);
  const atMatch = text.match(/@([^\s@]*)$/);
  if (atMatch) {
    openFilePicker(container, app, state, atMatch[1]);
    return;
  }
  const slashMatch = text.match(/\/([a-z-]*)$/);
  if (slashMatch) openSlashMenu(container, app, state, slashMatch[1]);
}

function openFilePicker(container: HTMLElement, app: DesktopApp, state: InputAreaState, filter = '') {
  container.querySelector('.input-picker')?.remove();
  const files = app.workspaceCapabilities.files.map((file) => file.path).filter((file) =>
    !filter || file.toLowerCase().includes(filter.toLowerCase()),
  );
  const picker = el('div', { className: 'input-picker' },
    files.length === 0
      ? [el('div', { className: 'input-picker-empty' }, ['无匹配项目文件'])]
      : files.slice(0, 100).map((file) => el('div', {
          className: 'input-picker-item',
          onclick: () => {
            insertAtCursor(container, state, `@${file} `);
            if (!state.selectedPaths.includes(file)) state.selectedPaths.push(file);
            picker.remove();
          },
        }, [
          el('span', { className: 'input-picker-icon' }, ['·']),
          el('span', { className: 'input-picker-name' }, [file]),
        ])),
  );
  container.appendChild(picker);
}

function openSlashMenu(container: HTMLElement, app: DesktopApp, state: InputAreaState, filter = '') {
  container.querySelector('.input-picker')?.remove();
  const cmds = SLASH_COMMANDS.filter((command) => !filter || command.cmd.includes(filter) || command.desc.includes(filter));
  const menu = el('div', { className: 'input-picker' },
    cmds.length === 0
      ? [el('div', { className: 'input-picker-empty' }, ['无匹配命令'])]
      : cmds.map((command) => el('div', {
          className: 'input-picker-item',
          onclick: () => {
            insertAtCursor(container, state, `${command.cmd} `);
            menu.remove();
          },
        }, [
          el('span', { className: 'input-picker-cmd' }, [command.cmd]),
          el('span', { className: 'input-picker-desc' }, [command.desc]),
        ])),
  );
  container.appendChild(menu);
  void app;
}

function toggleVoice(container: HTMLElement, state: InputAreaState, app: DesktopApp) {
  interface SpeechRecognitionLike {
    start: () => void;
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onresult: (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
    onerror: () => void;
    onend: () => void;
  }
  const browser = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  const Constructor = browser.SpeechRecognition || browser.webkitSpeechRecognition;
  if (!Constructor) {
    app.log('当前环境不支持语音输入');
    app.onChange?.();
    return;
  }
  if (state.voiceActive) {
    state.voiceActive = false;
    app.onChange?.();
    return;
  }
  const recognition = new Constructor();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = 'zh-CN';
  recognition.onresult = (event) => {
    let transcript = '';
    for (let index = 0; index < event.results.length; index++) transcript += event.results[index][0].transcript;
    const ta = container.querySelector<HTMLTextAreaElement>('.input-prompt');
    state.draft = transcript;
    if (ta) ta.value = transcript;
  };
  recognition.onerror = recognition.onend = () => {
    state.voiceActive = false;
    app.onChange?.();
  };
  recognition.start();
  state.voiceActive = true;
  app.onChange?.();
}

function enhancePrompt(original: string): string {
  if (!original) return '请补充：\n1. 目标是什么\n2. 涉及哪些文件/模块\n3. 验收标准\n';
  return [
    `【任务】${original}`,
    '【背景】在当前项目中完成上述任务。',
    '【要求】',
    '1. 保持与现有代码风格一致',
    '2. 如涉及公共接口，注明向后兼容性',
    '3. 完成后总结改动点',
  ].join('\n');
}

export { SLASH_COMMANDS };
