/** InputArea — 对话输入坞：模式、模型、技能与文件上下文 */
import { el } from '../dom.ts';
import type { DesktopApp } from '../app/service.ts';
import type { ExecutionModeInput } from '@cherishron/sacode-client-core';
import { buildModeButton, type ConversationMode } from '../app/top-bar.ts';

export interface InputAreaState {
  moreMenuOpen: boolean;
  voiceActive: boolean;
  enhancePreviewOpen: boolean;
  enhancePreview: string;
  executionMode: ExecutionModeInput;
  model: string;
  skill: string;
  selectedPaths: string[];
}

export function createInputAreaState(): InputAreaState {
  return {
    moreMenuOpen: false,
    voiceActive: false,
    enhancePreviewOpen: false,
    enhancePreview: '',
    executionMode: 'build',
    model: '',
    skill: '',
    selectedPaths: [],
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
  const selected = conversationId && app.conversationTurns?.id === conversationId ? app.conversationTurns.turns.at(-1) : null;
  const running = selected ? ['running', 'queued', 'pending', 'ready', 'retrying', 'waiting_approval'].includes(selected.status) : false;
  const models = app.workspaceCapabilities.models;
  const skills = app.workspaceCapabilities.skills;
  if (models.length > 0 && !models.some((model) => model.id === state.model)) state.model = models[0]?.id || '';

  const promptValue = () => (document.getElementById('prompt') as HTMLTextAreaElement | null)?.value?.trim() || '';
  const sendDisabled = !running && promptValue().length === 0;

  return el('div', { className: 'input-area' }, [
    state.enhancePreviewOpen
      ? el('div', { className: 'input-enhance-preview' }, [
          el('span', { className: 'muted' }, ['增强后']),
          el('div', { className: 'input-enhance-text' }, [state.enhancePreview]),
          el('button', {
            className: 'btn btn-sm ghost',
            onclick: () => {
              const ta = document.getElementById('prompt') as HTMLTextAreaElement | null;
              if (ta) ta.value = state.enhancePreview;
              state.enhancePreviewOpen = false;
              app.onChange?.();
            },
          }, ['应用']),
        ])
      : '',
    el('div', { id: 'input-context-tags', className: 'input-context-tags' }, state.selectedPaths.map((path) =>
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
      id: 'prompt',
      className: 'textarea input-prompt',
      rows: 2,
      placeholder: '描述要构建或修复的任务…',
      onkeydown: (event: KeyboardEvent) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          if (!running) triggerRun(app, state, conversationId, onCreated);
        }
      },
      oninput: (event: Event) => {
        const ta = event.target as HTMLTextAreaElement;
        const btn = document.getElementById('btn-send') as HTMLButtonElement | null;
        if (btn) btn.disabled = ta.value.trim().length === 0;
        handleInputTrigger(ta, app, state);
      },
    }),
    el('div', { className: 'input-toolbar' }, [
      el('div', { className: 'input-toolbar-left' }, [
        el('button', {
          id: 'btn-at',
          className: 'input-tool-btn',
          title: '选择当前项目文件 (@)',
          onclick: () => openFilePicker(app, state),
        }, ['@']),
        el('button', {
          id: 'btn-slash',
          className: 'input-tool-btn',
          title: '快捷命令 (/)',
          onclick: () => openSlashMenu(app),
        }, ['/']),
        el('button', {
          id: 'btn-enhance',
          className: 'input-tool-btn',
          title: '增强提示词',
          innerHTML: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9L18 15z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
          onclick: () => {
            const original = (document.getElementById('prompt') as HTMLTextAreaElement | null)?.value?.trim() || '';
            state.enhancePreview = enhancePrompt(original);
            state.enhancePreviewOpen = true;
            app.onChange?.();
          },
        }),
        el('button', {
          id: 'btn-voice',
          className: `input-tool-btn ${state.voiceActive ? 'active' : ''}`,
          title: state.voiceActive ? '停止语音输入' : '语音输入',
          innerHTML: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" stroke-width="1.6"/><path d="M5 11a7 7 0 0014 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M12 18v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
          onclick: () => toggleVoice(state, app),
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
              id: 'model',
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
              id: 'skill',
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
          id: 'backend',
          className: 'input-chip-select',
          title: 'Backend',
        }, (app.agents.length ? app.agents.map((agent) => agent.id) : ['sacode']).map((id) =>
          el('option', { value: id, selected: id === app.defaultBackend }, [id]),
        )),
        running
          ? el('button', {
              id: 'btn-stop',
              className: 'input-send-btn stop',
              onclick: () => { if (selected?.task_id === app.currentTaskId) void app.stopTask(); },
            }, ['停止'])
          : el('button', {
              id: 'btn-send',
              className: 'input-send-btn',
              disabled: sendDisabled,
              title: sendDisabled ? '先输入任务内容' : '发送',
              innerHTML: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M21 3L10.5 13.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 3L14 21l-3.5-7.5L3 10 21 3z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
              onclick: () => triggerRun(app, state, conversationId, onCreated),
            }),
      ]),
    ]),
  ]);
}

function triggerRun(app: DesktopApp, state: InputAreaState, conversationId?: string | null, onCreated?: (taskId: string) => void) {
  const prompt = (document.getElementById('prompt') as HTMLTextAreaElement | null)?.value?.trim();
  const backendId = (document.getElementById('backend') as HTMLSelectElement | null)?.value || app.defaultBackend || 'sacode';
  if (!prompt) {
    app.error('prompt 为空');
    return;
  }
  const modelId = (document.getElementById('model') as HTMLSelectElement | null)?.value || state.model;
  const [modelProvider, ...modelParts] = modelId.split('/');
  const skill = (document.getElementById('skill') as HTMLSelectElement | null)?.value || state.skill;
  const ta = document.getElementById('prompt') as HTMLTextAreaElement | null;
  if (ta) ta.disabled = true;
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
    if (ta?.value.trim() === prompt) ta.value = '';
    if (app.currentTaskId) onCreated?.(app.currentTaskId);
  }).finally(() => { if (ta?.isConnected) ta.disabled = false; });
}

function insertAtCursor(text: string) {
  const ta = document.getElementById('prompt') as HTMLTextAreaElement | null;
  if (!ta) return;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = start + text.length;
}

function handleInputTrigger(ta: HTMLTextAreaElement, app: DesktopApp, state: InputAreaState) {
  const text = ta.value.slice(0, ta.selectionStart);
  const atMatch = text.match(/@([^\s@]*)$/);
  if (atMatch) {
    openFilePicker(app, state, atMatch[1]);
    return;
  }
  const slashMatch = text.match(/\/([a-z-]*)$/);
  if (slashMatch) openSlashMenu(app, slashMatch[1]);
}

function openFilePicker(app: DesktopApp, state: InputAreaState, filter = '') {
  document.getElementById('file-picker')?.remove();
  const files = app.workspaceCapabilities.files.map((file) => file.path).filter((file) =>
    !filter || file.toLowerCase().includes(filter.toLowerCase()),
  );
  const picker = el('div', { id: 'file-picker', className: 'input-picker' },
    files.length === 0
      ? [el('div', { className: 'input-picker-empty' }, ['无匹配项目文件'])]
      : files.slice(0, 100).map((file) => el('div', {
          className: 'input-picker-item',
          onclick: () => {
            insertAtCursor(`@${file} `);
            if (!state.selectedPaths.includes(file)) state.selectedPaths.push(file);
            document.getElementById('file-picker')?.remove();
          },
        }, [
          el('span', { className: 'input-picker-icon' }, ['·']),
          el('span', { className: 'input-picker-name' }, [file]),
        ])),
  );
  document.querySelector('.input-area')?.appendChild(picker);
}

function openSlashMenu(app: DesktopApp, filter = '') {
  document.getElementById('slash-menu')?.remove();
  const cmds = SLASH_COMMANDS.filter((command) => !filter || command.cmd.includes(filter) || command.desc.includes(filter));
  const menu = el('div', { id: 'slash-menu', className: 'input-picker' },
    cmds.length === 0
      ? [el('div', { className: 'input-picker-empty' }, ['无匹配命令'])]
      : cmds.map((command) => el('div', {
          className: 'input-picker-item',
          onclick: () => {
            insertAtCursor(`${command.cmd} `);
            document.getElementById('slash-menu')?.remove();
          },
        }, [
          el('span', { className: 'input-picker-cmd' }, [command.cmd]),
          el('span', { className: 'input-picker-desc' }, [command.desc]),
        ])),
  );
  document.querySelector('.input-area')?.appendChild(menu);
  void app;
}

function toggleVoice(state: InputAreaState, app: DesktopApp) {
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
    const ta = document.getElementById('prompt') as HTMLTextAreaElement | null;
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
