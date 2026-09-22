/** InputArea — 底部输入框 + 模式切换 + 运行/停止按钮 */
import { el } from '../dom.ts';
import type { DesktopApp } from '../app/service.ts';
import type { ExecutionModeInput } from '@cherishron/sacode-client-core';

export function buildInputArea(app: DesktopApp) {
  const running = app.timelineStatus === 'running' || app.timelineStatus === 'queued';

  return el('div', { className: 'input-area' }, [
    // 输入框
    el('textarea', {
      id: 'prompt',
      className: 'textarea input-prompt',
      rows: 3,
      placeholder: '输入编程任务…（Enter 运行，Shift+Enter 换行）',
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          triggerRun(app);
        }
      },
    }),

    // 底部操作栏
    el('div', { className: 'input-actions' }, [
      // 模式选择
      el('div', { className: 'input-mode-group' }, [
        el('label', { className: 'input-mode-label' }, ['模式']),
        el('select', { id: 'mode', className: 'select input-mode-select' }, [
          el('option', { value: 'plan' }, ['plan']),
          el('option', { value: 'build', selected: true }, ['build']),
          el('option', { value: 'auto' }, ['auto']),
        ]),
      ]),

      // Backend 选择
      el('div', { className: 'input-mode-group' }, [
        el('label', { className: 'input-mode-label' }, ['Backend']),
        el('select', { id: 'backend', className: 'select input-mode-select' },
          (app.agents.length
            ? app.agents.map((a) => a.id)
            : ['sacode', 'opencode']
          ).map((id) =>
            el('option', { value: id, ...(id === app.defaultBackend ? { selected: true } : {}) }, [
              id,
            ]),
          ),
        ),
      ]),

      // 右侧填充
      el('span', { className: 'input-spacer' }, []),

      // Task 状态
      el('span', { className: 'muted' }, [
        app.currentTaskId ? `task=${app.currentTaskId.slice(0, 8)}` : 'idle',
      ]),

      // 运行/停止按钮
      running
        ? el('button', {
            id: 'btn-stop',
            className: 'btn danger',
            onclick: () => void app.stopTask(),
          }, ['停止'])
        : '',

      el('button', {
        id: 'btn-run',
        className: 'btn',
        onclick: () => triggerRun(app),
      }, ['运行']),
    ].filter(Boolean) as Node[]),
  ]);
}

function triggerRun(app: DesktopApp) {
  const prompt = (document.getElementById('prompt') as HTMLTextAreaElement | null)?.value?.trim();
  const mode = (document.getElementById('mode') as HTMLSelectElement | null)?.value as ExecutionModeInput || 'build';
  const backendId = (document.getElementById('backend') as HTMLSelectElement | null)?.value || app.defaultBackend || 'sacode';
  if (!prompt) {
    app.error('prompt 为空');
    return;
  }
  void app.runTask({ prompt, mode, backendId });
}
