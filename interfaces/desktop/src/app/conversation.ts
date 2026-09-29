/** Conversation — 会话流主区：进度条、消息流、输入
 * Phase 4: 支持 taskId 过滤（点击侧栏会话时只显示该会话消息）
 */
import { el } from '../dom.ts';
import type { DesktopApp, TimelineItem } from './service.ts';
import { buildProgressBar, type ProgressState } from '../components/progress-bar.ts';
import { buildMessage } from '../components/message-bubble.ts';
import { buildInputArea, createInputAreaState, type InputAreaState } from '../components/input-area.ts';
import { buildTimelineNavigation, collectTimelineAnchors } from '../components/timeline-rail.ts';
import { buildApprovalCard } from '../components/approval-card.ts';

export function conversationMessages(app: DesktopApp, taskFilter: string | null): TimelineItem[] {
  if (!taskFilter) return [];
  const detail = app.conversationTurns?.id === taskFilter
    ? app.conversationTurns : app.conversationDetails.get(taskFilter);
  if (!detail) return [];
  return detail.turns.flatMap((turn) => {
    const live = app.timeline.filter((item) => item.taskId === turn.task_id && item.kind !== 'user');
    const assistant = turn.output || [...live].reverse().find((item) => item.kind === 'assistant')?.text;
    const errors = turn.error ? [{ kind: 'error' as const, text: turn.error, taskId: turn.task_id }] : live.filter((item) => item.kind === 'error');
    return [
      { kind: 'user' as const, text: turn.prompt, taskId: turn.task_id },
      ...live.filter((item) => item.kind !== 'assistant' && item.kind !== 'error'),
      ...(assistant ? [{ kind: 'assistant' as const, text: assistant, taskId: turn.task_id }] : []),
      ...errors,
    ];
  });
}

export function buildConversation(
  app: DesktopApp,
  taskFilter: string | null = null,
  inputAreaState?: InputAreaState,
  onModeChange?: (mode: string) => void,
  onConfigureModels?: () => void,
  onCreated?: (taskId: string) => void,
  paneIndex = 0,
) {
  const detail = taskFilter
    ? (app.conversationTurns?.id === taskFilter ? app.conversationTurns : app.conversationDetails.get(taskFilter))
    : null;
  const currentTurn = detail?.turns.at(-1) ?? null;
  const status = currentTurn?.status ?? (taskFilter ? '' : app.timelineStatus);
  const running = ['running', 'queued', 'pending', 'ready', 'retrying'].includes(status);
  const waitingApproval = status === 'waiting_approval';

  const progressState: ProgressState = waitingApproval
    ? 'approval'
    : running
    ? 'running'
    : 'done';

  const filtered = taskFilter ? conversationMessages(app, taskFilter) : app.timeline;

  const messageNodes = filtered.map((item, index) => {
    const node = buildMessage(item) as HTMLElement;
    node.dataset.msgIndex = String(index);
    return node;
  });
  const taskIds = new Set(taskFilter
    ? detail?.turns.map((turn) => turn.task_id) ?? []
    : app.currentTaskId ? [app.currentTaskId] : []);
  const pendingApprovals = [...taskIds].flatMap((id) => app.approvalsByTask.get(id) ?? []);
  const approvalNodes = pendingApprovals.map((approval) => buildApprovalCard(app, approval));
  const timeline = el('div', { id: 'timeline', className: 'timeline', dataset: { pane: String(paneIndex), conversation: taskFilter ?? '' } },
    filtered.length === 0
      ? [el('div', { className: 'timeline-empty' }, [
          el('div', { className: 'timeline-empty-icon' }, ['💬']),
          el('strong', {}, [taskFilter ? '该会话暂无消息' : '开始一段新会话']),
          el('div', { className: 'muted' }, [
            taskFilter ? '在下方输入框发送后续消息' : '描述你要构建或修复的内容，Enter 发送',
          ]),
        ]), ...approvalNodes]
      : [...messageNodes, ...approvalNodes],
  );
  const anchors = collectTimelineAnchors(filtered);
  const navigation = anchors.length ? buildTimelineNavigation(timeline, anchors) : null;

  return el('main', { className: 'conversation-body' }, [
    // 过滤提示条
    ...(taskFilter
      ? [el('div', { className: 'conversation-filter-bar' }, [
          el('span', { className: 'muted' }, [`会话: ${app.desktopConversations.find((item) => item.id === taskFilter)?.title.slice(0, 60) || taskFilter.slice(0, 8)}`]),
        ])]
      : []),

    // 进度条
    buildProgressBar(progressState),

    // 消息流与会话边缘导航共用定位容器，两个分屏互不影响。
    el('div', { className: 'timeline-region' }, [
      timeline,
      ...(navigation ? [navigation.rail, navigation.jumpButton] : []),
    ]),

    // 输入坞
    el('div', { className: 'composer-wrap' }, [
      buildInputArea(app, inputAreaState ?? createInputAreaState(), onModeChange, onConfigureModels, taskFilter, onCreated),
    ]),
  ]);
}
