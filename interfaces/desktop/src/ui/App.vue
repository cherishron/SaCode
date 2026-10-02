<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import TaskColumn from './components/TaskColumn.vue';
import PaneFrame from './components/PaneFrame.vue';
import SplitNode from './components/SplitNode.vue';
import ChatPane from './components/ChatPane.vue';
import NewTaskForm from './components/NewTaskForm.vue';
import WorkspaceTools from './components/WorkspaceTools.vue';
import PlanPanel from './components/PlanPanel.vue';
import SettingsView from './components/SettingsView.vue';
import KnowledgeView from './components/KnowledgeView.vue';
import AutomationView from './components/AutomationView.vue';
import AskCard from './components/AskCard.vue';
import ApprovalCard from './components/ApprovalCard.vue';
import ContextMenu from './components/ContextMenu.vue';
import { ChatIcon, TerminalIcon, BrowseIcon, FileEditIcon } from 'tdesign-icons-vue-next';
import FolderOpenIcon from './components/FolderOpenIcon.vue';
import { useDesktopApp } from './composables/useDesktopApp';
import { useContextMenu, copySelection, hasSelection } from './composables/useContextMenu.ts';
import { assign as assignSlot, LOAD_MIME, SWAP_MIME } from './logic/split-slots.ts';
import {
  PRESETS,
  leaves as treeLeaves,
  paneCount,
  removeLeaf,
  setRatio,
  splitLeaf,
  swapLeaves,
  equalizeAt,
  type SplitDir,
  type SplitNode as SplitNodeModel,
} from './logic/split-tree.ts';
import {
  loadWorkbench,
  saveWorkbench,
  TASK_COL_WIDTH_DEFAULT,
  TOOLS_TREE_DEFAULT,
  TOOLS_WIDTH_DEFAULT,
  type PaneMode,
  type SavedWorkbench,
  type ToolsTabId,
} from './logic/split-persist.ts';

const {
  selectedId,
  planItems,
  pendingQuestions,
  pendingQuestionsFor,
  refreshPendingQuestions,
  answerQuestion,
  approvalGroupsForConversation,
  resolvingApprovalIds,
  approvalErrorMap,
  resolveApproval,
  projectGroup,
  connection,
  bootError,
  loading,
  selectConversation,
  workspace,
  detail,
  refreshConversationDetail,
} = useDesktopApp();

const settingsOpen = ref(false);
/** 知识库 / 自动化 = 覆盖式主视图（像设置一样从左栏底部打开），不再整页切换中间工作区 */
const overlayView = ref<'knowledge' | 'automation' | null>(null);
const workspaceView = computed(() => overlayView.value ?? 'sessions');

/* ── 分格树：叶 = 槽位，内部节点 = 一次切分（上下/左右可嵌套） ── */
interface PaneToolsState {
  open: boolean;
  tab: ToolsTabId;
  width: number;
  treeWidth: number;
}
interface PaneState {
  conversationId: string | null;
  title: string;
  mode: PaneMode;
  tools: PaneToolsState;
}

function emptyTools(): PaneToolsState {
  return { open: false, tab: 'files', width: TOOLS_WIDTH_DEFAULT, treeWidth: TOOLS_TREE_DEFAULT };
}
function emptyPane(title = '空格', mode: PaneMode = 'empty'): PaneState {
  return { conversationId: null, title, mode, tools: emptyTools() };
}

const tree = ref<SplitNodeModel>(PRESETS['2col']);
const panes = ref<PaneState[]>([emptyPane('会话'), emptyPane()]);
const focusSlot = ref(0);
const maximizedSlot = ref<number | null>(null);

function ensureSlot(slot: number): PaneState {
  while (panes.value.length <= slot) panes.value.push(emptyPane());
  const existing = panes.value[slot];
  if (!existing) panes.value[slot] = emptyPane();
  return panes.value[slot]!;
}

function paneOf(slot: number): PaneState {
  return panes.value[slot] ?? emptyPane();
}

const visibleSlots = computed(() => treeLeaves(tree.value));
const taskColEpoch = ref(0);

const activeConversationId = computed(() => paneOf(focusSlot.value).conversationId);

function resetWorkbench() {
  tree.value = PRESETS['2col'];
  panes.value = [emptyPane('会话'), emptyPane()];
  focusSlot.value = 0;
  maximizedSlot.value = null;
}

/* ── 布局存档：sacode.layout.<workspace>（契约 §6） ── */
const TASK_COL_KEY = 'sacode.workbench.listWidth';

function readTaskColWidth(): number {
  try {
    const raw = Number(localStorage.getItem(TASK_COL_KEY));
    return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : TASK_COL_WIDTH_DEFAULT;
  } catch {
    return TASK_COL_WIDTH_DEFAULT;
  }
}

function snapshot(): SavedWorkbench {
  return {
    version: 1,
    tree: tree.value,
    slots: panes.value.map((pane) => pane
      ? {
          conversationId: pane.conversationId,
          title: pane.title,
          mode: pane.mode,
          tools: { ...pane.tools },
        }
      : null),
    focusSlot: focusSlot.value,
    taskColWidth: readTaskColWidth(),
  };
}

function persistLayout() {
  if (!workspace.value) return;
  saveWorkbench(workspace.value, snapshot());
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistLayout();
  }, 200);
}

function applySavedLayout(saved: SavedWorkbench) {
  tree.value = saved.tree;
  panes.value = saved.slots.map((slot) => slot
    ? {
        conversationId: slot.conversationId,
        title: slot.title,
        mode: slot.mode,
        tools: { ...slot.tools },
      }
    : emptyPane());
  for (const slot of treeLeaves(saved.tree)) ensureSlot(slot);
  focusSlot.value = saved.focusSlot;
  maximizedSlot.value = null;
  if (typeof saved.taskColWidth === 'number') {
    try {
      if (localStorage.getItem(TASK_COL_KEY) !== String(saved.taskColWidth)) {
        localStorage.setItem(TASK_COL_KEY, String(saved.taskColWidth));
        taskColEpoch.value += 1;
      }
    } catch {
      /* ignore */
    }
  }
}

let restoredWorkspace = '';

watch(
  workspace,
  (next, previous) => {
    if (!next || next === restoredWorkspace) return;
    if (previous && previous !== next) {
      // 切走前先落盘上一个工作区
      saveWorkbench(previous, snapshot());
    }
    restoredWorkspace = next;
    const saved = loadWorkbench(next);
    if (saved) {
      applySavedLayout(saved);
    } else {
      resetWorkbench();
    }
    pendingQuestions.value = [];
  },
  { immediate: true },
);

watch([tree, panes, focusSlot], () => schedulePersist(), { deep: true });

function onBeforeUnload() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (workspace.value) saveWorkbench(workspace.value, snapshot());
}
/* ── 全局右键菜单 + 文本复制 ── */
const { register: registerCtx, unregister: unregisterCtx, trigger: triggerCtx, disableBrowserContextMenu } = useContextMenu();

let cleanupBrowserCtx: (() => void) | null = null;

onMounted(() => {
  // 全局屏蔽浏览器默认右键菜单
  cleanupBrowserCtx = disableBrowserContextMenu();

  // 会话工作区右键菜单（在会话消息区域：复制选中文本 + 关闭格位）
  registerCtx('workspace', () => {
    const items = [
      {
        label: '复制选中文本',
        shortcut: 'Ctrl+C',
        action: () => { void copySelection(); },
        disabled: !hasSelection(),
      },
      { separator: true, label: '', action: () => {} },
      {
        label: '关闭当前格',
        action: () => {
          if (paneCount(tree.value) > 1) closePane(focusSlot.value);
        },
        disabled: paneCount(tree.value) <= 1,
      },
      {
        label: '分屏（左右）',
        action: () => splitPane(focusSlot.value, 'row'),
      },
      {
        label: '分屏（上下）',
        action: () => splitPane(focusSlot.value, 'column'),
      },
    ];
    return items;
  });

  // 设置页右键菜单
  registerCtx('settings', () => [
    {
      label: '复制选中文本',
      shortcut: 'Ctrl+C',
      action: () => { void copySelection(); },
      disabled: !hasSelection(),
    },
  ]);

  // 知识库 / 自动化页
  registerCtx('overlay', () => [
    {
      label: '复制选中文本',
      shortcut: 'Ctrl+C',
      action: () => { void copySelection(); },
      disabled: !hasSelection(),
    },
  ]);
});

onBeforeUnmount(() => {
  unregisterCtx('workspace');
  unregisterCtx('settings');
  unregisterCtx('overlay');
  if (cleanupBrowserCtx) cleanupBrowserCtx();
});

onMounted(() => window.addEventListener('beforeunload', onBeforeUnload));
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload);
  if (persistTimer) clearTimeout(persistTimer);
});

const activeStatus = computed(() => {
  const id = activeConversationId.value;
  if (!id) return '';
  return projectGroup.value.sessions.find((s) => s.id === id)?.status ?? '';
});

const activeRunning = computed(() => {
  const id = activeConversationId.value;
  return projectGroup.value.sessions.find((s) => s.id === id)?.tone === 'running';
});

const connectionMessage = computed(() => {
  if (connection.value === 'error') return '守护进程未连接，请检查服务状态后重试。';
  if (connection.value === 'starting') return '正在连接守护进程…';
  return '';
});

function onSessionKeydown(event: KeyboardEvent, slot: number, id: string) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  focusSlot.value = slot;
  openConversationInPane(slot, id);
}

function openConversationInPane(slot: number, id: string) {
  // 契约 C6：同一会话禁双格 — assign 为 move 语义
  const slots = assignSlot(
    panes.value.map((p) => p?.conversationId ?? null),
    slot,
    id,
  );
  applyConversations(slots, slot);
  void selectConversation(id).then(() => {
    if (selectedId.value !== id || detail.value?.id !== id) return;
    void refreshPendingQuestions(id, detail.value.turns.map((t) => t.task_id));
  });
}

function applyConversations(slots: readonly (string | null)[], focus: number) {
  for (let i = 0; i < slots.length; i++) {
    const pane = ensureSlot(i);
    pane.conversationId = slots[i] ?? null;
    pane.mode = pane.conversationId
      ? 'chat'
      : pane.mode === 'create'
        ? 'create'
        : 'empty';
    pane.title = pane.conversationId
      ? (projectGroup.value.sessions.find((s) => s.id === pane.conversationId)?.title || '会话')
      : (pane.mode === 'create' ? '新建任务' : '空格');
  }
  focusSlot.value = focus;
}

function onOpenConversation(id: string) {
  overlayView.value = null;
  openConversationInPane(focusSlot.value, id);
}

/* === 拖拽换位：SWAP_MIME 交换格位 / LOAD_MIME 装载会话 === */
function onPaneDragStart(slot: number, ev: DragEvent) {
  ev.dataTransfer?.setData(SWAP_MIME, String(slot));
  if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
}

/** 会话行 → 格位（左侧列表与格内装载卡共用） */
function onSessionDragStart(id: string, ev: DragEvent) {
  ev.dataTransfer?.setData(LOAD_MIME, id);
  if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
}

function onSplitSwap(from: number, to: number) {
  tree.value = swapLeaves(tree.value, from, to);
  focusSlot.value = to;
}

function onSplitLoad(slot: number, id: string) {
  focusSlot.value = slot;
  openConversationInPane(slot, id);
}

function paneHasConversation(id: string): boolean {
  return panes.value.some((p) => p?.conversationId === id);
}

function paneTitle(slot: number): string {
  const pane = paneOf(slot);
  if (pane.conversationId) {
    return (
      projectGroup.value.sessions.find((s) => s.id === pane.conversationId)?.title || pane.title
    );
  }
  return pane.title;
}

function paneConversationId(slot: number): string | null {
  return paneOf(slot).conversationId;
}

function hasConversation(slot: number): boolean {
  return !!paneConversationId(slot);
}

function paneMode(slot: number): PaneMode {
  return paneOf(slot).mode;
}

function leafOrdinal(slot: number): number {
  const index = visibleSlots.value.indexOf(slot);
  return index >= 0 ? index + 1 : slot + 1;
}

function onSent(slot: number, payload: { conversationId: string; taskId: string }) {
  const slots = assignSlot(
    panes.value.map((p) => p?.conversationId ?? null),
    slot,
    payload.conversationId,
  );
  applyConversations(slots, slot);
  void refreshConversationDetail(payload.conversationId);
}

/* ── 右侧工具栏：每格独立 open / tab / width ── */
function openToolsTab(slot: number, tab: ToolsTabId) {
  const pane = ensureSlot(slot);
  pane.tools.tab = tab;
  pane.tools.open = true;
  focusSlot.value = slot;
}

function setToolsOpen(slot: number, open: boolean) {
  ensureSlot(slot).tools.open = open;
}

function setToolsTab(slot: number, tab: ToolsTabId) {
  ensureSlot(slot).tools.tab = tab;
}

function setToolsWidth(slot: number, width: number) {
  ensureSlot(slot).tools.width = width;
}

function setToolsTreeWidth(slot: number, width: number) {
  ensureSlot(slot).tools.treeWidth = width;
}

/* ── 分格操作 ── */
function closePane(slot: number) {
  if (paneCount(tree.value) <= 1) return;
  tree.value = removeLeaf(tree.value, slot);
  panes.value[slot] = emptyPane();
  if (maximizedSlot.value === slot) maximizedSlot.value = null;
  const next = treeLeaves(tree.value)[0]!;
  if (focusSlot.value === slot || !treeLeaves(tree.value).includes(focusSlot.value)) {
    focusSlot.value = next;
  }
}

/** PaneFrame：'row' = 向右 / 'column' = 向下 → split-tree：col / row */
function splitPane(slot: number, axis: 'row' | 'column') {
  const dir: SplitDir = axis === 'row' ? 'col' : 'row';
  const result = splitLeaf(tree.value, slot, dir);
  if (!result) return;
  tree.value = result.tree;
  ensureSlot(result.newSlot);
  maximizedSlot.value = null;
  focusSlot.value = result.newSlot;
}

function onSplitResize(path: string, ratio: number) {
  tree.value = setRatio(tree.value, path, ratio);
}

function onSplitEqualize(path: string) {
  tree.value = equalizeAt(tree.value, path);
}

function onMaximize(slot: number) {
  maximizedSlot.value = maximizedSlot.value === slot ? null : slot;
}

function onReplace(slot: number) {
  const pane = ensureSlot(slot);
  pane.conversationId = null;
  pane.mode = 'empty';
  pane.title = '空格';
}

function onRename(slot: number, title: string) {
  const pane = ensureSlot(slot);
  pane.title = title;
  const id = pane.conversationId;
  if (id) {
    try {
      localStorage.setItem(`sacode.session.title.${id}`, title);
    } catch {
      /* ignore */
    }
  }
}

function focusEmptyOrSplit() {
  overlayView.value = null;
  // 新建即创建页：优先空格，否则当前格切入 create
  const empty = visibleSlots.value.find((slot) => {
    const pane = paneOf(slot);
    return !pane.conversationId && pane.mode !== 'create';
  });
  const slot = empty ?? focusSlot.value;
  focusSlot.value = slot;
  const pane = ensureSlot(slot);
  pane.conversationId = null;
  pane.mode = 'create';
  pane.title = '新建任务';
}

function onNewInProject() {
  focusEmptyOrSplit();
}
</script>

<template>
  <div class="app-shell">
    <TaskColumn
      :key="taskColEpoch"
      :loaded-ids="panes.map((p) => p?.conversationId).filter((id): id is string => !!id)"
      :active-view="workspaceView"
      @change-view="(v) => { overlayView = v === 'sessions' ? null : v; }"
      @open-settings="settingsOpen = true"
      @new-task="focusEmptyOrSplit"
      @new-in-project="onNewInProject"
      @select="onOpenConversation"
    />
    <div class="shell-divider" aria-hidden="true" />
    <main class="work-area" id="main-workspace" aria-label="会话工作区" @contextmenu="triggerCtx('workspace', $event)">
      <div
        v-if="connectionMessage"
        class="workspace-notice"
        :class="{ 'is-error': connection === 'error' }"
        :role="connection === 'error' ? 'alert' : 'status'"
      >
        <span class="status-dot" :class="{ failed: connection === 'error', running: connection === 'starting' }" aria-hidden="true" />
        <span>{{ connectionMessage }}</span>
        <span v-if="connection === 'error' && bootError" class="workspace-notice-detail" :title="bootError">{{ bootError }}</span>
      </div>
      <KnowledgeView v-if="overlayView === 'knowledge'" :active="true" @close="overlayView = null" @contextmenu="triggerCtx('overlay', $event)" />
      <AutomationView v-if="overlayView === 'automation'" :active="true" @close="overlayView = null" @contextmenu="triggerCtx('overlay', $event)" />
      <div class="split-grid" aria-label="会话分格">
        <SplitNode
          :node="tree"
          path=""
          :maximized="maximizedSlot"
          @focus="focusSlot = $event"
          @resize="onSplitResize"
          @equalize="onSplitEqualize"
          @swap="onSplitSwap"
          @load="onSplitLoad"
        >
          <template #leaf="{ slot }">
            <PaneFrame
              :title="paneTitle(slot)"
              :focus="focusSlot === slot"
              :closable="paneCount(tree) > 1"
              @close="closePane(slot)"
              @split="(axis) => splitPane(slot, axis)"
              @rename="(t) => onRename(slot, t)"
              @maximize="onMaximize(slot)"
              @replace="onReplace(slot)"
              @dragstart="(e) => onPaneDragStart(slot, e)"
            >
              <template #status>
                <ChatIcon size="12" aria-hidden="true" />
              </template>
              <template #actions>
                <button
                  class="ghost-btn"
                  type="button"
                  title="文件"
                  aria-label="打开文件工具栏"
                  @click="openToolsTab(slot, 'files')"
                >
                  <FolderOpenIcon size="13" />
                </button>
                <button
                  class="ghost-btn"
                  type="button"
                  title="变更"
                  aria-label="打开变更工具栏"
                  @click="openToolsTab(slot, 'changes')"
                >
                  <FileEditIcon size="13" />
                </button>
                <button
                  class="ghost-btn"
                  type="button"
                  title="终端"
                  aria-label="打开终端工具栏"
                  @click="openToolsTab(slot, 'terminal')"
                >
                  <TerminalIcon size="13" />
                </button>
                <button
                  class="ghost-btn"
                  type="button"
                  title="预览"
                  aria-label="打开预览工具栏"
                  @click="openToolsTab(slot, 'preview')"
                >
                  <BrowseIcon size="13" />
                </button>
              </template>

              <!-- 空格 = 装载卡（契约：横向 tab + 任务列表） -->
              <div v-if="!hasConversation(slot) && paneMode(slot) !== 'create'" class="load-card">
                <div class="load-card-intro">
                  <span class="load-card-kicker">工作区 / {{ leafOrdinal(slot) }}</span>
                  <h2 class="load-card-title">从已有会话继续</h2>
                  <p>选择一条会话装入当前分格，或创建新任务开始工作。</p>
                  <button type="button" class="load-card-create" @click="focusSlot = slot; focusEmptyOrSplit()">新建任务</button>
                </div>
                <div class="load-card-tabs">
                  <span class="task-col-tab-label">本地项目 · {{ projectGroup.sessions.length }} 个会话</span>
                </div>
                <div class="load-card-list">
                  <div
                    v-if="projectGroup.sessions.length === 0"
                    class="load-card-empty"
                    :role="connection === 'error' ? 'alert' : 'status'"
                  >
                    {{ connection === 'error' ? '守护进程未连接，暂时无法载入会话。' : loading || connection === 'starting' ? '正在加载会话…' : '还没有会话。可以从新建任务开始。' }}
                  </div>
                  <div
                    v-for="session in projectGroup.sessions"
                    :key="session.id"
                    class="list-row"
                    :class="{ loaded: paneHasConversation(session.id) }"
                    role="button"
                    tabindex="0"
                    :aria-label="`在当前分格打开会话：${session.title}${session.tone === 'running' ? '，执行中' : session.tone === 'failed' ? '，执行失败' : ''}`"
                    draggable="true"
                    @dragstart="(e) => onSessionDragStart(session.id, e)"
                    @keydown="onSessionKeydown($event, slot, session.id)"
                    @click="focusSlot = slot; onOpenConversation(session.id)"
                  >
                    <span class="list-row-label">{{ session.title }}</span>
                    <span class="list-row-status">
                      <span
                        v-if="paneHasConversation(session.id)"
                        class="list-loaded-mark"
                        title="已入格"
                      />
                      <span
                        class="status-dot"
                        :class="{
                          running: session.tone === 'running',
                          failed: session.tone === 'failed',
                        }"
                      />
                    </span>
                  </div>
                </div>
              </div>

              <!-- 创建页：格内 h-40 页头 + 表单 -->
              <NewTaskForm
                v-else-if="!hasConversation(slot) && paneMode(slot) === 'create'"
                @created="(payload) => onSent(slot, payload)"
              />

              <div v-else class="chat-column">
                <PlanPanel
                  v-if="slot === focusSlot && planItems.length"
                  :items="planItems"
                />
                <div v-if="activeRunning && slot === focusSlot" class="chat-running" role="status" aria-live="polite">
                  <span class="status-dot running" aria-hidden="true" />
                  执行中 · {{ activeStatus }}
                </div>
                <ChatPane
                  :conversation-id="paneConversationId(slot)"
                  @sent="(p) => onSent(slot, p)"
                  @open-terminal="openToolsTab(slot, 'terminal')"
                />
                <ApprovalCard
                  v-for="group in approvalGroupsForConversation(paneConversationId(slot) || '')"
                  :key="group.taskId"
                  :task-id="group.taskId"
                  :approvals="group.approvals"
                  :resolving-ids="resolvingApprovalIds(group.approvals)"
                  :errors="approvalErrorMap(group.approvals)"
                  class="ask-float"
                  @resolve="(p) => resolveApproval(p.taskId, p.approvalId, p.approved)"
                />
                <AskCard
                  v-for="q in pendingQuestionsFor(paneConversationId(slot) || '')"
                  :key="q.taskId"
                  :task-id="q.taskId"
                  :question="q.question"
                  :options="q.options"
                  :allow-multiple="q.allowMultiple"
                  class="ask-float"
                  @answered="(p) => answerQuestion(p)"
                  @cancelled="(taskId) => answerQuestion({ taskId, answer: '', selected: [], cancelled: true })"
                />
              </div>
            </PaneFrame>

            <!-- 统一右侧工具栏（每格独立；非模态） -->
            <WorkspaceTools
              :open="paneOf(slot).tools.open"
              :tab="paneOf(slot).tools.tab"
              :width="paneOf(slot).tools.width"
              :tree-width="paneOf(slot).tools.treeWidth"
              :conversation-id="paneConversationId(slot)"
              :workspace-key="workspace"
              @close="setToolsOpen(slot, false)"
              @update:tab="(t) => setToolsTab(slot, t)"
              @update:width="(w) => setToolsWidth(slot, w)"
              @update:treeWidth="(w) => setToolsTreeWidth(slot, w)"
            />
          </template>
        </SplitNode>
      </div>
    </main>
    <SettingsView v-model:open="settingsOpen" @contextmenu="triggerCtx('settings', $event)" />
    <ContextMenu />
  </div>
</template>
