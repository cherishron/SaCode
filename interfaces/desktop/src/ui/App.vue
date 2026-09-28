<script setup lang="ts">
import { computed, ref } from 'vue';
import TaskColumn from './components/TaskColumn.vue';
import PaneFrame from './components/PaneFrame.vue';
import ChatPane from './components/ChatPane.vue';
import NewTaskForm from './components/NewTaskForm.vue';
import FilesSidePanel from './components/FilesSidePanel.vue';
import TerminalSidePanel from './components/TerminalSidePanel.vue';
import PreviewSidePanel from './components/PreviewSidePanel.vue';
import PlanPanel from './components/PlanPanel.vue';
import SettingsView from './components/SettingsView.vue';
import AskCard from './components/AskCard.vue';
import { ChatIcon, TerminalIcon, BrowseIcon } from 'tdesign-icons-vue-next';
import FolderOpenIcon from './components/FolderOpenIcon.vue';
import { useDesktopApp } from './composables/useDesktopApp';
import { assign as assignSlot } from '../app/split-slots.ts';

const {
  selectedId,
  chatItems,
  planItems,
  pendingQuestions,
  refreshPendingQuestions,
  answerQuestion,
  projectGroup,
  connection,
  bootError,
  sending,
  selectConversation,
  workspace,
} = useDesktopApp();

const settingsOpen = ref(false);
const focusPane = ref(0);
const panes = ref([
  { id: 1, title: '会话', conversationId: null as string | null, filesOpen: false, termOpen: false, previewOpen: false, mode: 'empty' as 'empty' | 'create' | 'chat' },
  { id: 2, title: '空格', conversationId: null as string | null, filesOpen: false, termOpen: false, previewOpen: false, mode: 'empty' as 'empty' | 'create' | 'chat' },
]);

const activeConversationId = computed(
  () => panes.value[focusPane.value]?.conversationId ?? selectedId.value,
);

const activeStatus = computed(() => {
  const id = activeConversationId.value;
  if (!id) return '';
  return projectGroup.value.sessions.find((s) => s.id === id)?.status ?? '';
});

const activeRunning = computed(() => {
  const id = activeConversationId.value;
  return projectGroup.value.sessions.find((s) => s.id === id)?.tone === 'running';
});

function onOpenConversation(id: string) {
  const index = focusPane.value;
  // 契约 C6：同一会话禁双格 — assign 为 move 语义
  const slots = assignSlot(
    panes.value.map((p) => p.conversationId),
    index,
    id,
  );
  panes.value = panes.value.map((pane, i) => ({
    ...pane,
    conversationId: slots[i] ?? null,
    mode: (slots[i] ? 'chat' : pane.mode === 'create' ? 'create' : 'empty') as 'empty' | 'create' | 'chat',
    title: slots[i]
      ? (projectGroup.value.sessions.find((s) => s.id === slots[i])?.title || '会话')
      : (pane.mode === 'create' ? '新建任务' : '空格'),
    filesOpen: pane.filesOpen,
  }));
  void selectConversation(id).then(() => {
    const detail = useDesktopApp().detail.value;
    void refreshPendingQuestions((detail?.turns ?? []).map((t) => t.task_id));
  });
}

function paneHasConversation(id: string): boolean {
  return panes.value.some((p) => p.conversationId === id);
}

function paneTitle(index: number): string {
  const pane = panes.value[index];
  if (!pane) return '空格';
  if (pane.conversationId) {
    return (
      projectGroup.value.sessions.find((s) => s.id === pane.conversationId)?.title || pane.title
    );
  }
  return pane.title;
}

function paneConversationId(index: number): string | null {
  return panes.value[index]?.conversationId ?? null;
}

function hasConversation(index: number): boolean {
  return !!paneConversationId(index);
}

function onSent(index: number, payload: { conversationId: string; taskId: string }) {
  const slots = assignSlot(
    panes.value.map((p) => p.conversationId),
    index,
    payload.conversationId,
  );
  panes.value = panes.value.map((pane, i) => ({
    ...pane,
    conversationId: slots[i] ?? null,
    mode: (slots[i] ? 'chat' : pane.mode === 'create' ? 'create' : 'empty') as 'empty' | 'create' | 'chat',
    title: slots[i]
      ? (projectGroup.value.sessions.find((s) => s.id === slots[i])?.title || '会话')
      : (pane.mode === 'create' ? '新建任务' : '空格'),
    filesOpen: pane.filesOpen,
  }));
}

function setFilesOpen(index: number, open: boolean) {
  panes.value[index] = { ...panes.value[index], filesOpen: open, termOpen: panes.value[index]?.termOpen ?? false };
}

function setTermOpen(index: number, open: boolean) {
  panes.value[index] = {
    ...panes.value[index],
    termOpen: open,
    filesOpen: panes.value[index]?.filesOpen ?? false,
    previewOpen: panes.value[index]?.previewOpen ?? false,
  };
}

function setPreviewOpen(index: number, open: boolean) {
  panes.value[index] = {
    ...panes.value[index],
    previewOpen: open,
    filesOpen: panes.value[index]?.filesOpen ?? false,
    termOpen: panes.value[index]?.termOpen ?? false,
  };
}

function closePane(index: number) {
  if (panes.value.length <= 1) return;
  panes.value.splice(index, 1);
  ratios.value.splice(Math.max(0, index - 1), 1);
  normalizeRatios();
  if (focusPane.value >= panes.value.length) focusPane.value = panes.value.length - 1;
}

/** 相邻分格之间的比例（第 i 项 = 第 i 与 i+1 格的分界） */
const ratios = ref<number[]>([0.5]);
const splitAxis = ref<'row' | 'column'>('row');

function normalizeRatios() {
  const need = Math.max(0, panes.value.length - 1);
  while (ratios.value.length < need) ratios.value.push(0.5);
  while (ratios.value.length > need) ratios.value.pop();
  ratios.value = ratios.value.map((r) => Math.min(0.85, Math.max(0.15, r)));
}

function splitPane(axis: 'row' | 'column') {
  const id = Math.max(0, ...panes.value.map((p) => p.id)) + 1;
  panes.value.splice(focusPane.value + 1, 0, {
    id,
    title: '空格',
    conversationId: null as string | null,
    filesOpen: false,
    termOpen: false,
    previewOpen: false,
    mode: 'empty' as const,
  });
  splitAxis.value = axis;
  ratios.value.splice(focusPane.value, 0, 0.5);
  normalizeRatios();
  focusPane.value = focusPane.value + 1;
}

function onDividerDown(index: number, event: PointerEvent) {
  if (event.button !== 0) return;
  const axis = splitAxis.value;
  const startPos = axis === 'row' ? event.clientX : event.clientY;
  const startRatio = ratios.value[index] ?? 0.5;
  const grid = (event.currentTarget as HTMLElement).parentElement;
  const total = axis === 'row' ? grid?.clientWidth || 1 : grid?.clientHeight || 1;
  const move = (ev: PointerEvent) => {
    const now = axis === 'row' ? ev.clientX : ev.clientY;
    // ratios[i] = 右侧叶的份额：分隔线右移时左侧变宽 → 右侧份额应减小
    const delta = (now - startPos) / Math.max(1, total);
    const next = Math.min(0.85, Math.max(0.15, startRatio - delta));
    ratios.value[index] = next;
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function leafStyle(index: number) {
  if (maximizedPane.value !== null) return { flex: '1 1 0' };
  if (panes.value.length === 1) return { flex: '1 1 0' };
  let share = 1;
  if (index > 0) share *= ratios.value[index - 1] ?? 0.5;
  if (index < panes.value.length - 1) share *= 1 - (ratios.value[index] ?? 0.5);
  return { flex: `${Math.max(0.15, share)} 1 0` };
}

function itemsFor(index: number) {
  const id = paneConversationId(index);
  if (!id || id !== activeConversationId.value) return [];
  return chatItems.value;
}

function focusEmptyOrSplit() {
  // 新建即创建页：优先空格，否则当前格切入 create
  const empty = panes.value.findIndex((pane) => !pane.conversationId && pane.mode !== 'create');
  const index = empty >= 0 ? empty : focusPane.value;
  focusPane.value = index;
  panes.value[index] = {
    ...panes.value[index],
    conversationId: null,
    mode: 'create',
    title: '新建任务',
    filesOpen: panes.value[index]?.filesOpen ?? false,
  };
}

function paneMode(index: number) {
  return panes.value[index]?.mode ?? 'empty';
}

const maximizedPane = ref<number | null>(null);

function onMaximize(index: number) {
  maximizedPane.value = maximizedPane.value === index ? null : index;
}

function onReplace(index: number) {
  panes.value[index] = {
    ...panes.value[index],
    conversationId: null,
    mode: 'empty',
    title: '空格',
    filesOpen: panes.value[index]?.filesOpen ?? false,
  };
}

function onRename(index: number, title: string) {
  panes.value[index] = {
    ...panes.value[index],
    title,
    conversationId: panes.value[index]?.conversationId ?? null,
    mode: panes.value[index]?.mode ?? 'empty',
    filesOpen: panes.value[index]?.filesOpen ?? false,
  };
  const id = paneConversationId(index);
  if (id) {
    try {
      localStorage.setItem(`sacode.session.title.${id}`, title);
    } catch {
      /* ignore */
    }
  }
}

function onNewInProject() {
  focusEmptyOrSplit();
}
</script>

<template>
  <div class="app-shell">
    <TaskColumn
      :loaded-ids="panes.map((p) => p.conversationId).filter((id): id is string => !!id)"
      @open-settings="settingsOpen = true"
      @new-task="focusEmptyOrSplit"
      @new-in-project="onNewInProject"
      @select="onOpenConversation"
    />
    <div class="shell-divider" aria-hidden="true" />
    <main class="work-area">
      <div class="split-grid" :class="`axis-${splitAxis}`">
        <template v-for="(pane, index) in panes" :key="pane.id">
          <div
            v-if="index > 0 && maximizedPane === null"
            class="split-divider"
            :class="splitAxis === 'column' ? 'row' : 'column'"
            @pointerdown.prevent="onDividerDown(index - 1, $event)"
          />
          <div
            v-if="maximizedPane === null || maximizedPane === index"
            class="split-leaf pane-anchor"
            :style="leafStyle(index)"
            @pointerdown="focusPane = index"
          >
            <PaneFrame
              :title="paneTitle(index)"
              :focus="focusPane === index"
              :closable="panes.length > 1"
              @close="closePane(index)"
              @split="(axis) => { maximizedPane = null; splitPane(axis) }"
              @rename="(t) => onRename(index, t)"
              @maximize="onMaximize(index)"
              @replace="onReplace(index)"
            >
              <template #status>
                <ChatIcon size="12" style="opacity: 0.45" />
              </template>
              <template #actions>
                <button
                  class="ghost-btn"
                  type="button"
                  title="文件"
                  @click="setFilesOpen(index, true)"
                >
                  <FolderOpenIcon size="13" />
                </button>
                <button
                  class="ghost-btn"
                  type="button"
                  title="终端"
                  @click="setTermOpen(index, true)"
                >
                  <TerminalIcon size="13" />
                </button>
                <button
                  class="ghost-btn"
                  type="button"
                  title="预览"
                  @click="setPreviewOpen(index, true)"
                >
                  <BrowseIcon size="13" />
                </button>
              </template>

              <!-- 空格 = 装载卡（契约：横向 tab + 任务列表） -->
              <div v-if="!hasConversation(index) && paneMode(index) !== 'create'" class="load-card">
                <div class="load-card-tabs">
                  <span class="task-col-tab-label">本地项目</span>
                </div>
                <div class="load-card-list">
                  <div
                    v-if="projectGroup.sessions.length === 0"
                    class="list-row"
                    style="cursor: default; opacity: 0.55"
                  >
                    <span class="list-row-label">
                      {{ connection === 'error' ? '守护进程未连接' : '暂无会话' }}
                    </span>
                  </div>
                  <div
                    v-for="session in projectGroup.sessions"
                    :key="session.id"
                    class="list-row"
                    :class="{ loaded: paneHasConversation(session.id) }"
                    @click="onOpenConversation(session.id)"
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
                v-else-if="!hasConversation(index) && paneMode(index) === 'create'"
                @created="(payload) => onSent(index, payload)"
              />

              <div v-else class="chat-column">
                <PlanPanel
                  v-if="index === focusPane && planItems.length"
                  :items="planItems"
                />
                <div v-if="activeRunning && index === focusPane" class="chat-running">
                  <span class="status-dot running" />
                  执行中 · {{ activeStatus }}
                </div>
                <ChatPane
                  :conversation-id="paneConversationId(index)"
                  @sent="(p) => onSent(index, p)"
                  @open-terminal="setTermOpen(index, true)"
                />
                <AskCard
                  v-for="q in pendingQuestions"
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
            <FilesSidePanel
              :open="!!pane.filesOpen"
              @update:open="(v) => setFilesOpen(index, v)"
            />
            <TerminalSidePanel
              :open="!!pane.termOpen"
              @update:open="(v) => setTermOpen(index, v)"
            />
            <PreviewSidePanel
              :open="!!pane.previewOpen"
              :workspace-key="workspace"
              @update:open="(v) => setPreviewOpen(index, v)"
            />
          </div>
        </template>
      </div>
    </main>
    <SettingsView v-model:open="settingsOpen" />
  </div>
</template>
