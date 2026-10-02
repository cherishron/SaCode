import { computed, ref, shallowRef } from 'vue';
import type {
  DesktopConversation,
  DesktopConversationDetail,
  DaemonHealth,
  PendingApproval,
} from '@cherishron/sacode-client-core';
import type { ExecutionModeInput } from '@cherishron/sacode-client-core';
import { DesktopApp } from '../logic/services.ts';
import type { QueuedMessage } from '../logic/conversation-queue.ts';

export type ConnectionState = 'starting' | 'healthy' | 'error';

/** P0-1：待答问题（带会话归属，支持多分格会话隔离）。 */
export interface PendingQuestion {
  taskId: string;
  conversationId: string;
  question: string;
  options: Array<{ label?: string; value?: string; description?: string }>;
  allowMultiple: boolean;
}

const app = new DesktopApp();
const conversations = ref<DesktopConversation[]>([]);
const detail = shallowRef<DesktopConversationDetail | null>(null);
const conversationDetails = shallowRef(new Map<string, DesktopConversationDetail>());
const pendingDetails = new Map<string, number>();
let workspaceGeneration = 0;
let selectionVersion = 0;
let detailRequestVersion = 0;
let turnTimer: number | null = null;
let turnsRefreshing = false;
const selectedId = ref<string | null>(null);
const workspace = ref('');
const health = shallowRef<DaemonHealth | null>(null);
const connection = ref<ConnectionState>('starting');
const bootError = ref<string | null>(null);
const loading = ref(false);
/** 每次 app.emit 自增，用于让依赖非响应式 app 状态的 computed 重新求值。 */
const appVersion = ref(0);

let started = false;

function syncFromApp() {
  appVersion.value += 1;
  if (workspace.value !== app.workspace) {
    workspaceGeneration += 1;
    selectionVersion += 1;
    detailRequestVersion += 1;
    selectedId.value = null;
    detail.value = null;
    conversationDetails.value = new Map();
    pendingDetails.clear();
    if (turnTimer !== null) window.clearTimeout(turnTimer);
    turnTimer = null;
  }
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
    const generation = workspaceGeneration;
    const client = app.client;
    try {
      await app.refreshDesktopConversations();
      if (generation !== workspaceGeneration || client !== app.client) return;
      syncFromApp();
      if (selectedId.value && conversations.value.some((item) => item.id === selectedId.value && statusTone(item.status) === 'running') && turnTimer === null && !turnsRefreshing) refreshTurnsSoon();
      if (selectedId.value && !conversations.value.some((c) => c.id === selectedId.value)) {
        selectionVersion += 1;
        selectedId.value = null;
        detail.value = null;
        if (turnTimer !== null) window.clearTimeout(turnTimer);
        turnTimer = null;
      }
    } catch (error) {
      bootError.value = String(error);
    }
  }

  async function selectConversation(id: string) {
    const selection = ++selectionVersion;
    const generation = workspaceGeneration;
    selectedId.value = id;
    detail.value = null;
    loading.value = true;
    try {
      await app.selectDesktopConversation(id);
      if (selection !== selectionVersion || generation !== workspaceGeneration || selectedId.value !== id || app.currentConversationId !== id) return;
      detail.value = app.conversationTurns;
      if (detail.value) conversationDetails.value = new Map(conversationDetails.value).set(id, detail.value);
      syncFromApp();
      refreshTurnsSoon();
    } catch (error) {
      if (selection === selectionVersion && generation === workspaceGeneration) bootError.value = String(error);
    } finally {
      if (selection === selectionVersion && generation === workspaceGeneration) loading.value = false;
    }
  }

  const sending = ref(false);
  const sendError = ref<string | null>(null);

  /** P2-1：已上传附件（相对工作区路径） */
  const attachments = ref<Array<{ name: string; path: string; size: number }>>([]);

  async function uploadAttachment(file: File): Promise<{ name: string; path: string; size: number } | null> {
    if (!app.client) return null;
    const generation = workspaceGeneration;
    const client = app.client;
    try {
      const buf = await file.arrayBuffer();
      if (generation !== workspaceGeneration) return null;
      let binary = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
      const contentBase64 = btoa(binary);
      const result = await client.uploadWorkspaceAttachment({
        filename: file.name,
        contentBase64,
        kind: file.type,
      });
      if (generation !== workspaceGeneration) return null;
      const item = { name: file.name, path: result.path, size: result.size };
      attachments.value = [...attachments.value, item];
      return item;
    } catch (error) {
      if (generation === workspaceGeneration) sendError.value = String(error);
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
    /** 契约 §1.2：技能多选 */
    skills?: string[];
    /** 契约 §1.2：思考深度；null=跟随 provider 默认 */
    reasoningEffort?: 'low' | 'medium' | 'high' | null;
    contextPaths?: string[];
  }): Promise<{ conversationId: string; taskId: string } | null> {
    const prompt = options.prompt.trim();
    if (!prompt || sending.value) return null;
    sending.value = true;
    sendError.value = null;
    const generation = workspaceGeneration;
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
        skills: options.skills,
        reasoningEffort: options.reasoningEffort,
        contextPaths: paths,
      });
      if (!ok) {
        sendError.value = app.lastTaskCreateError || '发送失败';
        return null;
      }
      if (generation !== workspaceGeneration) return null;
      const conversationId = app.currentConversationId!;
      selectedId.value = conversationId;
      detail.value = app.conversationTurns;
      if (detail.value) conversationDetails.value = new Map(conversationDetails.value).set(conversationId, detail.value);
      syncFromApp();
      await refreshConversations();
      clearAttachments();
      void refreshTurnsSoon();
      void refreshConversationDetail(conversationId);
      return { conversationId, taskId: app.currentTaskId! };
    } catch (error) {
      sendError.value = String(error);
      return null;
    } finally {
      sending.value = false;
    }
  }

  function refreshTurnsSoon(delay = 1500) {
    if (turnTimer !== null) window.clearTimeout(turnTimer);
    turnTimer = null;
    const id = selectedId.value;
    if (!id) return;
    const status = conversations.value.find((item) => item.id === id)?.status;
    if (status && statusTone(status) !== 'running') return;
    turnTimer = window.setTimeout(() => {
      turnTimer = null;
      if (selectedId.value !== id) return;
      void (async () => {
        turnsRefreshing = true;
        try {
          await refreshSelectedDetail();
          if (selectedId.value !== id) return;
          await refreshConversations();
          if (selectedId.value !== id) return;
          const latestStatus = conversations.value.find((item) => item.id === id)?.status;
          if (!latestStatus || statusTone(latestStatus) === 'running') refreshTurnsSoon(2500);
          else await refreshSelectedDetail(); // Retrieve the final output after status becomes terminal.
        } finally {
          turnsRefreshing = false;
        }
      })();
    }, delay);
  }

  async function refreshConversationDetail(id: string) {
    const client = app.client;
    if (!client || !id || pendingDetails.has(id)) return;
    const generation = workspaceGeneration;
    pendingDetails.set(id, generation);
    try {
      const next = await client.getDesktopConversation(id);
      if (client !== app.client || generation !== workspaceGeneration) return;
      conversationDetails.value = new Map(conversationDetails.value).set(id, next);
      app.conversationDetails.set(id, next);
      if (selectedId.value === id) {
        detail.value = next;
        if (app.currentConversationId === id) app.conversationTurns = next;
      }
    } catch (error) {
      if (selectedId.value === id && generation === workspaceGeneration) bootError.value = String(error);
    } finally {
      if (pendingDetails.get(id) === generation) pendingDetails.delete(id);
    }
  }

  async function refreshSelectedDetail() {
    const id = selectedId.value;
    const client = app.client;
    if (!id || !client) return;
    const selection = selectionVersion;
    const request = ++detailRequestVersion;
    const generation = workspaceGeneration;
    try {
      const next = await client.getDesktopConversation(id);
      if (selection !== selectionVersion || request !== detailRequestVersion || selectedId.value !== id || app.client !== client || generation !== workspaceGeneration) return;
      detail.value = next;
      conversationDetails.value = new Map(conversationDetails.value).set(id, next);
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

  /** 上下文用量：契约 D3 + §1.3，按会话隔离，优先真实 context_window。 */
  const contextUsageMap = ref<Map<string, number>>(new Map());
  /** 兼容旧调用方：返回当前选中会话的百分比 */
  const contextUsage = computed(() => {
    const id = selectedId.value;
    return id ? (contextUsageMap.value.get(id) ?? null) : null;
  });
  function setContextUsage(percent: number | null) {
    const id = selectedId.value;
    if (!id) return;
    setContextUsageFor(id, percent);
  }
  /** 按会话读取上下文百分比 */
  function contextUsageFor(conversationId: string | null | undefined): number | null {
    if (!conversationId) return null;
    return contextUsageMap.value.get(conversationId) ?? null;
  }
  /** 按会话写入上下文百分比 */
  function setContextUsageFor(conversationId: string | null | undefined, percent: number | null) {
    if (!conversationId) return;
    const next = new Map(contextUsageMap.value);
    if (percent == null) next.delete(conversationId);
    else next.set(conversationId, Math.max(0, Math.min(100, percent)));
    contextUsageMap.value = next;
  }

  /** P0-1：按 task 拉取 pending_question（带会话归属，便于按分格过滤）。 */
  const pendingQuestions = ref<PendingQuestion[]>([]);

  async function refreshPendingQuestions(conversationId: string, taskIds: string[]) {
    if (!app.client) return;
    const next: PendingQuestion[] = [];
    for (const taskId of taskIds) {
      try {
        const st = await app.client.getTaskStatus(taskId);
        const q = st.pending_question;
        if (q?.question) {
          next.push({
            taskId,
            conversationId,
            question: q.question,
            options: q.options ?? [],
            allowMultiple: q.allow_multiple === true,
          });
        }
        // D3：最近一轮 token 用量 → 上下文百分比（按会话真实 context_window，兜底 200k）
        if (st.usage?.total_tokens) {
          // 契约 §1.3：优先读响应 context_window；TaskStatusBody 尚未声明时本地扩展
          const usageExt = st.usage as { total_tokens?: number; context_window?: number };
          const windowSize = typeof usageExt.context_window === 'number' && usageExt.context_window > 0
            ? usageExt.context_window
            : 200_000;
          setContextUsageFor(conversationId, (st.usage.total_tokens / windowSize) * 100);
        }
      } catch {
        /* skip */
      }
    }
    // 仅替换该会话的条目，保留其他分格会话的待答问题
    pendingQuestions.value = [
      ...pendingQuestions.value.filter((q) => q.conversationId !== conversationId),
      ...next,
    ];
  }

  /** 按会话过滤待答问题（多分格会话隔离）。 */
  function pendingQuestionsFor(conversationId: string): PendingQuestion[] {
    void appVersion.value;
    return pendingQuestions.value.filter((q) => q.conversationId === conversationId);
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
      const conversationId = result.conversation_id ?? selectedId.value;
      const resumedTaskId = result.task_id;
      if (resumedTaskId && conversationId && selectedId.value === conversationId) {
        app.currentConversationId = conversationId;
        app.currentTaskId = resumedTaskId;
        app.timelineStatus = result.status ?? 'pending';
        app.startPoll(resumedTaskId);
        void app.startTaskEventBridge(resumedTaskId);
      }
      await refreshConversations();
      if (conversationId && selectedId.value === conversationId) {
        await refreshSelectedDetail();
        refreshTurnsSoon();
      }
      return result;
    } catch (error) {
      bootError.value = String(error);
      return null;
    }
  }

  /** 当前会话的展示流：历史 turns + 进程内 live timeline（工具/助手增量） */
  function itemsFromDetail(conversation: DesktopConversationDetail | null) {
    const turns = conversation?.turns ?? [];
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
      // 连续同 kind 的可合并帧（assistant / thinking / error）合并为一条消息；
      // 工具帧（tool_call_started / tool_call_finished 等，detail 非 "thinking"）保留独立卡片。
      let lastMerged: { index: number; kind: string; isThinking: boolean } | null = null;
      const isMergeableKind = (kind: string, isThinking: boolean) =>
        kind === 'assistant' || kind === 'error' || (kind === 'tool' && isThinking);
      const tryMerge = (
        kind: string,
        text: string,
        detail: string | undefined,
        isThinking: boolean,
      ): boolean => {
        if (!isMergeableKind(kind, isThinking)) return false;
        if (lastMerged && lastMerged.kind === kind && lastMerged.isThinking === isThinking) {
          const item = items[lastMerged.index];
          item.text = item.text + '\n' + text;
          if (detail) item.detail = detail;
          return true;
        }
        return false;
      };
      const pushFrame = (
        id: string,
        kind: 'user' | 'assistant' | 'tool' | 'error' | 'system',
        text: string,
        detail: string | undefined,
      ) => {
        const isThinking = detail === 'thinking';
        if (tryMerge(kind, text, detail, isThinking)) return;
        items.push({ id, kind, text, detail, taskId: turn.task_id });
        lastMerged = isMergeableKind(kind, isThinking)
          ? { index: items.length - 1, kind, isThinking }
          : null;
      };
      for (const frame of turn.frames ?? []) {
        const kind = frame.kind === 'assistant'
          ? 'assistant'
          : frame.kind === 'error'
            ? 'error'
            : 'tool';
        pushFrame(`${turn.task_id}-frame-${frame.seq}`, kind, frame.text, frame.detail ?? undefined);
      }
      const live = app.timeline.filter((item) => item.taskId === turn.task_id && item.kind !== 'user');
      live.forEach((item, liveIndex) => {
        if (item.kind === 'assistant' && turn.output && item.text === turn.output) return;
        if (item.kind === 'error' && turn.error && item.text === turn.error) return;
        // 已有同文本帧则跳过，避免增量帧与落盘回放帧重复
        if (turn.frames?.some((f) => f.text === item.text)) return;
        const kind = item.kind === 'change' || item.kind === 'approval' ? 'tool' : item.kind;
        pushFrame(`${turn.task_id}-live-${liveIndex}`, kind, item.text, item.detail);
      });
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
  }

  const chatItems = computed(() => {
    void appVersion.value;
    return itemsFromDetail(detail.value);
  });
  function chatItemsFor(id: string) {
    void appVersion.value;
    return itemsFromDetail(conversationDetails.value.get(id) ?? (detail.value?.id === id ? detail.value : null));
  }

  /** 会话详情（优先响应式缓存，回退当前选中详情）。 */
  function detailForConversation(conversationId: string): DesktopConversationDetail | null {
    if (!conversationId) return null;
    return (
      conversationDetails.value.get(conversationId) ??
      (detail.value?.id === conversationId ? detail.value : null)
    );
  }

  /** P0-2：按 taskId 分组暴露审批数据（供 ApprovalCard 消费）。 */
  function approvalGroupsForConversation(
    conversationId: string,
  ): Array<{ taskId: string; approvals: PendingApproval[] }> {
    void appVersion.value;
    const conversation = detailForConversation(conversationId);
    const groups: Array<{ taskId: string; approvals: PendingApproval[] }> = [];
    for (const turn of conversation?.turns ?? []) {
      const approvals = app.approvalsByTask.get(turn.task_id);
      if (approvals && approvals.length) groups.push({ taskId: turn.task_id, approvals });
    }
    return groups;
  }

  /** 提交中的审批 id 列表（命中时禁用按钮）。 */
  function resolvingApprovalIds(approvals: PendingApproval[]): string[] {
    void appVersion.value;
    return approvals.map((a) => a.approval_id).filter((id) => app.resolvingApprovals.has(id));
  }

  /** 审批错误：approval_id → 错误文案。 */
  function approvalErrorMap(approvals: PendingApproval[]): Record<string, string> {
    void appVersion.value;
    const out: Record<string, string> = {};
    for (const a of approvals) {
      const message = app.approvalErrors.get(a.approval_id);
      if (message) out[a.approval_id] = message;
    }
    return out;
  }

  async function resolveApproval(
    taskId: string,
    approvalId: string,
    approved: boolean,
    reason?: string,
  ): Promise<boolean> {
    return app.resolveApproval(taskId, approvalId, approved, reason);
  }

  /** 拉取指定会话下所有任务的审批 / 待答问题（轮询刷新用）。 */
  async function refreshInteractionState(conversationId: string) {
    const conversation = detailForConversation(conversationId);
    const taskIds = (conversation?.turns ?? []).map((turn) => turn.task_id).filter(Boolean);
    if (!taskIds.length) return;
    await refreshPendingQuestions(conversationId, taskIds);
    for (const taskId of taskIds) await app.refreshApprovals(taskId);
  }

  /**
   * P2-8：待发送队列。发送被应用关闭打断时，条目会带 error 标记
   * 「上次发送状态不确定」，必须由用户显式重试，绝不自动重发。
   */
  function currentQueueId(): string | null {
    return app.currentConversationId || selectedId.value;
  }

  const queuedMessages = computed<QueuedMessage[]>(() => {
    void appVersion.value;
    const id = currentQueueId();
    if (!id) return [];
    return (app.queuedMessages.get(id) || []).map((item) => ({ ...item }));
  });

  function retryQueuedMessage(id: string) {
    const conversationId = currentQueueId();
    if (!conversationId) return;
    app.retryQueuedMessage(conversationId, id);
  }

  function removeQueuedMessage(id: string) {
    const conversationId = currentQueueId();
    if (!conversationId) return;
    app.removeQueuedMessage(conversationId, id);
  }

  function moveQueuedMessageBy(id: string, direction: -1 | 1) {
    const conversationId = currentQueueId();
    if (!conversationId) return;
    app.moveQueuedMessage(conversationId, id, direction);
  }

  return {
    app,
    appVersion,
    start,
    refreshConversations,
    selectConversation,
    sendMessage,
    queuedMessages,
    retryQueuedMessage,
    removeQueuedMessage,
    moveQueuedMessageBy,
    refreshSelectedDetail,
    refreshConversationDetail,
    chatItemsFor,
    detailForConversation,
    conversations,
    projectGroup,
    selectedId,
    selectedTurns,
    chatItems,
    planItems,
    contextUsage,
    setContextUsage,
    contextUsageFor,
    setContextUsageFor,
    pendingQuestions,
    pendingQuestionsFor,
    refreshPendingQuestions,
    answerQuestion,
    approvalGroupsForConversation,
    resolvingApprovalIds,
    approvalErrorMap,
    resolveApproval,
    refreshInteractionState,
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
