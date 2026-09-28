import { computed, ref, shallowRef } from 'vue';
import type {
  DesktopConversation,
  DesktopConversationDetail,
  DaemonHealth,
} from '@cherishron/sacode-client-core';
import type { ExecutionModeInput } from '@cherishron/sacode-client-core';
import { DesktopApp } from '../../app/service.ts';

export type ConnectionState = 'starting' | 'healthy' | 'error';

const app = new DesktopApp();
const conversations = ref<DesktopConversation[]>([]);
const detail = shallowRef<DesktopConversationDetail | null>(null);
const selectedId = ref<string | null>(null);
const workspace = ref('');
const health = shallowRef<DaemonHealth | null>(null);
const connection = ref<ConnectionState>('starting');
const bootError = ref<string | null>(null);
const loading = ref(false);

let started = false;

function syncFromApp() {
  conversations.value = app.desktopConversations.map((item) => ({ ...item }));
  workspace.value = app.workspace;
  health.value = app.health;
  if (app.handle || app.health?.status === 'healthy') {
    connection.value = 'healthy';
    bootError.value = null;
  } else if (app.mode === 'vite') {
    connection.value = app.health?.status === 'healthy' ? 'healthy' : 'starting';
  }
}

function titleOf(session: DesktopConversation): string {
  try {
    return (
      localStorage.getItem(`sacode.session.title.${session.id}`) || session.title
    ).slice(0, 60) || session.id.slice(0, 8);
  } catch {
    return session.title || session.id.slice(0, 8);
  }
}

function statusTone(status: string): 'running' | 'failed' | 'done' {
  if (['running', 'pending', 'ready', 'retrying', 'queued', 'waiting_approval'].includes(status)) {
    return 'running';
  }
  if (['failed', 'cancelled', 'error'].includes(status)) return 'failed';
  return 'done';
}

export function useDesktopApp() {
  async function start(workspacePath?: string) {
    if (started) {
      await refreshConversations();
      return;
    }
    started = true;
    loading.value = true;
    app.onChange = () => {
      syncFromApp();
    };
    try {
      await app.init(workspacePath);
      syncFromApp();
      await refreshConversations();
    } catch (error) {
      bootError.value = String(error);
      connection.value = 'error';
    } finally {
      loading.value = false;
      // Sidecar health may land after init returns.
      window.setTimeout(() => {
        syncFromApp();
        void refreshConversations();
      }, 800);
    }
  }

  async function refreshConversations() {
    if (!app.client) return;
    try {
      await app.refreshDesktopConversations();
      syncFromApp();
      if (selectedId.value && !conversations.value.some((c) => c.id === selectedId.value)) {
        selectedId.value = null;
        detail.value = null;
      }
    } catch (error) {
      bootError.value = String(error);
    }
  }

  async function selectConversation(id: string) {
    selectedId.value = id;
    loading.value = true;
    try {
      await app.selectDesktopConversation(id);
      detail.value = app.conversationTurns;
      syncFromApp();
    } catch (error) {
      bootError.value = String(error);
    } finally {
      loading.value = false;
    }
  }

  const sending = ref(false);
  const sendError = ref<string | null>(null);

  /** P2-1：已上传附件（相对工作区路径） */
  const attachments = ref<Array<{ name: string; path: string; size: number }>>([]);

  async function uploadAttachment(file: File): Promise<{ name: string; path: string; size: number } | null> {
    if (!app.client) return null;
    try {
      const buf = await file.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
      const contentBase64 = btoa(binary);
      const result = await app.client.uploadWorkspaceAttachment({
        filename: file.name,
        contentBase64,
        kind: file.type,
      });
      const item = { name: file.name, path: result.path, size: result.size };
      attachments.value = [...attachments.value, item];
      return item;
    } catch (error) {
      sendError.value = String(error);
      return null;
    }
  }

  function removeAttachment(path: string) {
    attachments.value = attachments.value.filter((a) => a.path !== path);
  }

  function clearAttachments() {
    attachments.value = [];
  }

  /** 本地提示词增强：结构化目标/工作区/要求 */
  function enhancePromptText(raw: string, ws?: string): string {
    const text = raw.trim();
    if (!text) return text;
    const workspacePath = ws || workspace.value || app.workspace;
    const files = attachments.value.map((a) => a.path);
    return [
      `【目标】${text}`,
      workspacePath ? `【工作区】${workspacePath}` : '',
      `【要求】先给出简要方案再实施；改动保持最小；完成后总结验证结果。`,
      files.length ? `【附件】${files.join('、')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  async function sendMessage(options: {
    prompt: string;
    mode?: ExecutionModeInput;
    conversationId?: string | null;
    modelProvider?: string;
    modelName?: string;
    skill?: string;
    contextPaths?: string[];
  }): Promise<{ conversationId: string; taskId: string } | null> {
    const prompt = options.prompt.trim();
    if (!prompt || sending.value) return null;
    sending.value = true;
    sendError.value = null;
    try {
      const paths = [
        ...(options.contextPaths ?? []),
        ...attachments.value.map((a) => a.path),
      ];
      const ok = await app.runTask({
        prompt,
        mode: options.mode ?? 'build',
        backendId: app.defaultBackend,
        conversationId: options.conversationId ?? selectedId.value,
        modelProvider: options.modelProvider,
        modelName: options.modelName,
        skill: options.skill,
        contextPaths: paths,
      });
      if (!ok) {
        sendError.value = app.lastTaskCreateError || '发送失败';
        return null;
      }
      const conversationId = app.currentConversationId!;
      selectedId.value = conversationId;
      detail.value = app.conversationTurns;
      syncFromApp();
      await refreshConversations();
      clearAttachments();
      void refreshTurnsSoon();
      return { conversationId, taskId: app.currentTaskId! };
    } catch (error) {
      sendError.value = String(error);
      return null;
    } finally {
      sending.value = false;
    }
  }

  let turnTimer: number | null = null;
  function refreshTurnsSoon(delay = 1500) {
    if (turnTimer) window.clearTimeout(turnTimer);
    turnTimer = window.setTimeout(() => {
      void refreshSelectedDetail();
      const status = conversations.value.find((c) => c.id === selectedId.value)?.status;
      if (status && statusTone(status) === 'running') refreshTurnsSoon(2500);
    }, delay);
  }

  async function refreshSelectedDetail() {
    const id = selectedId.value;
    if (!id || !app.client) return;
    try {
      const next = await app.client.getDesktopConversation(id);
      detail.value = next;
      app.conversationDetails.set(id, next);
      if (app.currentConversationId === id) app.conversationTurns = next;
    } catch {
      /* transient */
    }
  }

  function workspaceLabel(): string {
    const path = workspace.value || app.workspace;
    if (!path) return '未命名项目';
    return path.replace(/\\/g, '/').split('/').pop() || path;
  }

  const projectGroup = computed(() => ({
    name: workspaceLabel(),
    path: workspace.value || app.workspace || '',
    sessions: conversations.value.map((session) => ({
      id: session.id,
      title: titleOf(session),
      status: session.status,
      tone: statusTone(session.status),
      createdAt: session.created_at,
      latestTaskId: session.latest_task_id,
    })),
  }));

  const selectedTurns = computed(() => detail.value?.turns ?? []);

  /**
   * 任务清单（plan）：composer 上方面板。
   * 当前从会话助手输出解析条目；后续可改吃 plan 事件帧。
   */
  const planItems = computed(() => {
    const turns = detail.value?.turns ?? [];
    const latest = [...turns].reverse().find((t) => t.output);
    if (!latest?.output) return [] as { id: string; text: string }[];
    return latest.output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^([-*•]|\d+[.)])\s+/.test(line))
      .slice(0, 24)
      .map((line, i) => ({
        id: `${latest.task_id}-plan-${i}`,
        text: line.replace(/^([-*•]|\d+[.)])\s+/, ''),
      }));
  });

  /** 上下文用量：契约 D3，composer 底部集群右端。daemon 有 usage 事件后写入。 */
  const contextUsage = ref<number | null>(null);
  function setContextUsage(percent: number | null) {
    contextUsage.value = percent == null ? null : Math.max(0, Math.min(100, percent));
  }

  /** P0-1：按 task 拉取 pending_question */
  const pendingQuestions = ref<
    Array<{
      taskId: string;
      question: string;
      options: Array<{ label?: string; value?: string; description?: string }>;
      allowMultiple: boolean;
    }>
  >([]);

  async function refreshPendingQuestions(taskIds: string[]) {
    if (!app.client) return;
    const next: typeof pendingQuestions.value = [];
    for (const taskId of taskIds) {
      try {
        const st = await app.client.getTaskStatus(taskId);
        const q = st.pending_question;
        if (q?.question) {
          next.push({
            taskId,
            question: q.question,
            options: q.options ?? [],
            allowMultiple: q.allow_multiple === true,
          });
        }
        // D3：最近一轮 token 用量 → 上下文百分比（按 200k 窗口估算）
        if (st.usage?.total_tokens) {
          const windowSize = 200_000;
          setContextUsage((st.usage.total_tokens / windowSize) * 100);
        }
      } catch {
        /* skip */
      }
    }
    pendingQuestions.value = next;
  }

  async function answerQuestion(payload: {
    taskId: string;
    answer: string;
    selected: string[];
    cancelled?: boolean;
  }) {
    if (!app.client) return null;
    try {
      const result = await app.client.answerTaskQuestion(payload.taskId, {
        answer: payload.answer,
        selected: payload.selected,
        cancelled: payload.cancelled === true,
      });
      pendingQuestions.value = pendingQuestions.value.filter((q) => q.taskId !== payload.taskId);
      await refreshConversations();
      if (result.task_id || payload.taskId) {
        await refreshSelectedDetail();
      }
      return result;
    } catch (error) {
      bootError.value = String(error);
      return null;
    }
  }

  /** 当前会话的展示流：历史 turns + 进程内 live timeline（工具/助手增量） */
  const chatItems = computed(() => {
    const turns = detail.value?.turns ?? [];
    const items: {
      id: string;
      kind: 'user' | 'assistant' | 'tool' | 'error' | 'system';
      text: string;
      detail?: string;
      status?: string;
      taskId?: string;
    }[] = [];

    for (const turn of turns) {
      items.push({
        id: `${turn.task_id}-user`,
        kind: 'user',
        text: turn.prompt,
        status: turn.status,
        taskId: turn.task_id,
      });
      // P0-3：优先回放落盘帧；再叠加进程内 live timeline
      for (const frame of turn.frames ?? []) {
        items.push({
          id: `${turn.task_id}-frame-${frame.seq}`,
          kind: frame.kind === 'assistant' ? 'assistant' : frame.kind === 'error' ? 'error' : 'tool',
          text: frame.text,
          detail: frame.detail ?? undefined,
          taskId: turn.task_id,
        });
      }
      const live = app.timeline.filter((item) => item.taskId === turn.task_id && item.kind !== 'user');
      for (const item of live) {
        if (item.kind === 'assistant' && turn.output && item.text === turn.output) continue;
        if (item.kind === 'error' && turn.error && item.text === turn.error) continue;
        // 已有同文本帧则跳过
        if (turn.frames?.some((f) => f.text === item.text)) continue;
        items.push({
          id: `${turn.task_id}-live-${items.length}`,
          kind: item.kind === 'change' || item.kind === 'approval' ? 'tool' : item.kind,
          text: item.text,
          detail: item.detail,
          taskId: turn.task_id,
        });
      }
      if (turn.output && !turn.frames?.some((f) => f.kind === 'assistant' && f.text === turn.output)) {
        items.push({
          id: `${turn.task_id}-out`,
          kind: 'assistant',
          text: turn.output,
          taskId: turn.task_id,
        });
      }
      if (turn.error && !turn.frames?.some((f) => f.kind === 'error' && f.text === turn.error)) {
        items.push({
          id: `${turn.task_id}-err`,
          kind: 'error',
          text: turn.error,
          taskId: turn.task_id,
        });
      }
    }
    return items;
  });

  return {
    app,
    start,
    refreshConversations,
    selectConversation,
    sendMessage,
    refreshSelectedDetail,
    conversations,
    projectGroup,
    selectedId,
    selectedTurns,
    chatItems,
    planItems,
    contextUsage,
    setContextUsage,
    pendingQuestions,
    refreshPendingQuestions,
    answerQuestion,
    detail,
    workspace,
    health,
    connection,
    bootError,
    loading,
    sending,
    sendError,
    attachments,
    uploadAttachment,
    removeAttachment,
    clearAttachments,
    enhancePromptText,
    titleOf,
    statusTone,
  };
}
