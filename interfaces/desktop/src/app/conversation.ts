/** Conversation — 会话流主区：进度条、消息流、输入
 * Phase 4: 支持 taskId 过滤（点击侧栏会话时只显示该会话消息）
 */
import { el } from '../dom.ts';
import type { DesktopApp } from './service.ts';
import { buildProgressBar, type ProgressState } from '../components/progress-bar.ts';
import { buildMessage } from '../components/message-bubble.ts';
import { buildInputArea } from '../components/input-area.ts';

export function buildConversation(app: DesktopApp, taskFilter: string | null = null) {
  const running = app.timelineStatus === 'running' || app.timelineStatus === 'queued';
  const waitingApproval = app.timelineStatus === 'waiting_approval';

  const progressState: ProgressState = waitingApproval
    ? 'approval'
    : running
    ? 'running'
    : 'done';

  // 按 taskId 过滤 timeline
  const filtered = taskFilter
    ? app.timeline.filter((t) => t.taskId === taskFilter)
    : app.timeline;

  return el('main', { className: 'conversation' }, [
    // 过滤提示条
    ...(taskFilter
      ? [el('div', { className: 'conversation-filter-bar' }, [
          el('span', { className: 'muted' }, [`会话过滤: ${taskFilter.slice(0, 8)}`]),
          el('button', { className: 'btn ghost btn-sm' }, ['×']),
        ])]
      : []),

    // 进度条
    buildProgressBar(progressState),

    // 消息流
    el('div', { id: 'timeline', className: 'timeline' },
      filtered.length === 0
        ? [el('div', { className: 'timeline-empty' }, [
            el('div', { className: 'timeline-empty-icon' }, ['💬']),
            el('div', { className: 'muted' }, [
              taskFilter ? '该会话暂无消息' : '输入任务开始会话',
            ]),
          ])]
        : filtered.map((item) => buildMessage(item)),
    ),

    // 输入区
    buildInputArea(app),
  ]);
}
