/** Conversation — 会话流主区：进度条、消息流、输入
 * Phase 4: 支持 taskId 过滤（点击侧栏会话时只显示该会话消息）
 */
import { el } from '../dom.ts';
import type { DesktopApp } from './service.ts';
import { buildProgressBar, type ProgressState } from '../components/progress-bar.ts';
import { buildMessage } from '../components/message-bubble.ts';
import { buildInputArea, createInputAreaState, type InputAreaState } from '../components/input-area.ts';

export function buildConversation(
  app: DesktopApp,
  taskFilter: string | null = null,
  inputAreaState?: InputAreaState,
  onModeChange?: (mode: string) => void,
  onConfigureModels?: () => void,
  onCreated?: (taskId: string) => void,
) {
  const currentTurn = taskFilter && app.conversationTurns?.id === taskFilter ? app.conversationTurns.turns.at(-1) : null;
  const status = currentTurn?.status ?? (taskFilter ? '' : app.timelineStatus);
  const running = ['running', 'queued', 'pending', 'ready', 'retrying'].includes(status);
  const waitingApproval = status === 'waiting_approval';

  const progressState: ProgressState = waitingApproval
    ? 'approval'
    : running
    ? 'running'
    : 'done';

  const detail = taskFilter && app.conversationTurns?.id === taskFilter ? app.conversationTurns : null;
  const filtered = detail
    ? detail.turns.flatMap((turn) => {
        const live = app.timeline.filter((item) => item.taskId === turn.task_id && item.kind !== 'user');
        const assistant = turn.output || [...live].reverse().find((item) => item.kind === 'assistant')?.text;
        const errors = turn.error ? [{ kind: 'error' as const, text: turn.error, taskId: turn.task_id }] : live.filter((item) => item.kind === 'error');
        return [
          { kind: 'user' as const, text: turn.prompt, taskId: turn.task_id },
          ...live.filter((item) => item.kind !== 'assistant' && item.kind !== 'error'),
          ...(assistant ? [{ kind: 'assistant' as const, text: assistant, taskId: turn.task_id }] : []),
          ...errors,
        ];
      })
    : taskFilter ? [] : app.timeline;

  return el('main', { className: 'conversation-body' }, [
    // 过滤提示条
    ...(taskFilter
      ? [el('div', { className: 'conversation-filter-bar' }, [
          el('span', { className: 'muted' }, [`会话: ${app.desktopConversations.find((item) => item.id === taskFilter)?.title.slice(0, 60) || taskFilter.slice(0, 8)}`]),
        ])]
      : []),

    // 进度条
    buildProgressBar(progressState),

    // 消息流
    el('div', { id: 'timeline', className: 'timeline' },
      filtered.length === 0
        ? [el('div', { className: 'timeline-empty' }, [
            el('div', { className: 'timeline-empty-icon' }, ['💬']),
            el('strong', {}, [taskFilter ? '该会话暂无消息' : '开始一段新会话']),
            el('div', { className: 'muted' }, [
              taskFilter ? '在下方输入框发送后续消息' : '描述你要构建或修复的内容，Enter 发送',
            ]),
          ])]
        : filtered.map((item) => buildMessage(item)),
    ),

    // 输入坞
    el('div', { className: 'composer-wrap' }, [
      buildInputArea(app, inputAreaState ?? createInputAreaState(), onModeChange, onConfigureModels, taskFilter, onCreated),
    ]),
  ]);
}
