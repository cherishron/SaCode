<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import ComposerDock from './ComposerDock.vue';
import ChatCard from './ChatCard.vue';
import ApprovalCard from './ApprovalCard.vue';
import AskCard from './AskCard.vue';
import { useDesktopApp } from '../composables/useDesktopApp';
import {
  turnsToDisplayItems,
  type DisplayItem,
} from '../logic/turn-events.ts';

const props = defineProps<{
  conversationId: string | null;
}>();

const emit = defineEmits<{
  sent: [payload: { conversationId: string; taskId: string }];
  openTerminal: [];
}>();

const {
  chatItemsFor,
  refreshConversationDetail,
  refreshInteractionState,
  projectGroup,
  selectedId,
  detailForConversation,
  pendingQuestionsFor,
  answerQuestion,
  approvalGroupsForConversation,
  resolvingApprovalIds,
  approvalErrorMap,
  resolveApproval,
} = useDesktopApp();

const isRunning = computed(() => {
  const session = projectGroup.value.sessions.find((item) => item.id === props.conversationId);
  return session?.tone === 'running';
});

let refreshTimer: ReturnType<typeof setInterval> | null = null;
watch([() => props.conversationId, isRunning], ([id, running], previous) => {
  const [previousId, wasRunning] = previous ?? [null, false];
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
  if (!id) return;
  void refreshInteractionState(id);
  if (id !== previousId || (wasRunning && !running)) void refreshConversationDetail(id);
  if (running) {
    refreshTimer = setInterval(() => {
      if (selectedId.value !== id) void refreshConversationDetail(id);
      void refreshInteractionState(id);
    }, 2500);
  }
}, { immediate: true });
onUnmounted(() => { if (refreshTimer) clearInterval(refreshTimer); });

// ---- 事件流 → 展示条目 ----

const displayItems = computed<DisplayItem[]>(() => {
  const id = props.conversationId;
  if (!id) return [];
  const detail = detailForConversation(id);
  if (detail?.turns?.length) return turnsToDisplayItems(detail.turns);
  // 回退：旧 chatItemsFor（不支持 events 时的纯文字流）
  return chatItemsFor(id).map((item) => ({
    id: item.id,
    type: item.kind === 'user' ? 'user' as const
      : item.kind === 'error' ? 'error' as const
      : item.kind === 'system' ? 'system' as const
      : item.kind === 'tool' ? 'tool' as const
      : 'text' as const,
    taskId: item.taskId,
    text: item.text,
    tool: item.kind === 'tool' ? item.text : undefined,
    status: item.status,
  } as DisplayItem));
});

// ---- 长历史窗口化 ----

/** 可见窗口大小；向上滚动时逐步扩展 */
const WINDOW_SIZE = 60;
const WINDOW_STEP = 40;
const windowStart = ref(0);

// 会话切换时重置窗口
watch(() => props.conversationId, () => {
  windowStart.value = 0;
  scrollToBottomInstant();
});

const windowedItems = computed(() => {
  const all = displayItems.value;
  const start = Math.max(0, Math.min(windowStart.value, Math.max(0, all.length - WINDOW_SIZE)));
  return all.slice(start);
});

const hasOlder = computed(() => windowStart.value > 0 || displayItems.value.length > windowedItems.value.length && windowStart.value === 0 && displayItems.value.length > WINDOW_SIZE);

function loadOlder() {
  windowStart.value = Math.max(0, windowStart.value - WINDOW_STEP);
}

// ---- 滚动管理 ----

const scrollEl = ref<HTMLElement | null>(null);
const isNearBottom = ref(true);

function checkNearBottom() {
  const el = scrollEl.value;
  if (!el) return;
  const threshold = 80;
  isNearBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
}

function scrollToBottomInstant() {
  nextTick(() => {
    const el = scrollEl.value;
    if (el) el.scrollTop = el.scrollHeight;
    isNearBottom.value = true;
  });
}

function scrollToBottom() {
  nextTick(() => {
    const el = scrollEl.value;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    isNearBottom.value = true;
  });
}

function onScroll() {
  const el = scrollEl.value;
  if (!el) return;
  checkNearBottom();
  // 滚到顶部附近时自动加载更早
  if (el.scrollTop < 60 && hasOlder.value) loadOlder();
}

// 新内容到达时自动滚动到底部
watch(() => displayItems.value.length, () => {
  if (isNearBottom.value) scrollToBottom();
});

onMounted(() => {
  scrollToBottomInstant();
});

// ---- 交互状态（审批 / 提问）用于流内渲染 ----

const pendingApprovals = computed(() =>
  props.conversationId ? approvalGroupsForConversation(props.conversationId) : [],
);
const pendingAsks = computed(() =>
  props.conversationId ? pendingQuestionsFor(props.conversationId) : [],
);

function onResolveApproval(p: { taskId: string; approvalId: string; approved: boolean }) {
  void resolveApproval(p.taskId, p.approvalId, p.approved);
}
function onAnswerAsk(p: { taskId: string; answer: string; selected: string[] }) {
  void answerQuestion(p);
}
function onCancelAsk(taskId: string) {
  void answerQuestion({ taskId, answer: '', selected: [], cancelled: true });
}
</script>

<template>
  <div class="td-chat-shell chat-pane">
    <div
      ref="scrollEl"
      class="chat-stream scroll-y"
      @scroll.passive="onScroll"
    >
      <!-- 加载更早 -->
      <div v-if="hasOlder" class="chat-load-older">
        <button type="button" class="ghost-btn" @click="loadOlder">加载更早消息</button>
      </div>

      <!-- 事件卡片流 -->
      <template v-for="item in windowedItems" :key="item.id">
        <ChatCard :item="item as any" />
      </template>

      <!-- 流内 pending 审批 / 提问（与 App.vue 浮层并存，Agent4 events 就绪后可去重） -->
      <ApprovalCard
        v-for="group in pendingApprovals"
        :key="`ap-${group.taskId}`"
        :task-id="group.taskId"
        :approvals="group.approvals"
        :resolving-ids="resolvingApprovalIds(group.approvals)"
        :errors="approvalErrorMap(group.approvals)"
        @resolve="onResolveApproval"
      />
      <AskCard
        v-for="q in pendingAsks"
        :key="`ask-${q.taskId}`"
        :task-id="q.taskId"
        :question="q.question"
        :options="q.options"
        :allow-multiple="q.allowMultiple"
        @answered="onAnswerAsk"
        @cancelled="onCancelAsk"
      />
    </div>

    <!-- 跳到最新 -->
    <Transition name="fade">
      <button
        v-if="!isNearBottom"
        type="button"
        class="chat-jump-latest"
        @click="scrollToBottom"
      >
        ↓ 跳到最新
      </button>
    </Transition>

    <ComposerDock
      :conversation-id="conversationId"
      @sent="(p) => emit('sent', p)"
    />
  </div>
</template>

<style scoped>
.chat-pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  position: relative;
}

.chat-stream {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-3) var(--space-4);
  display: flex;
  flex-direction: column;
}

.chat-load-older {
  text-align: center;
  padding: var(--space-2) 0;
}

.chat-jump-latest {
  position: absolute;
  bottom: 140px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-full);
  background: var(--accent);
  color: var(--text-on-accent);
  border: none;
  cursor: pointer;
  font-size: var(--fs-list);
  box-shadow: var(--shadow-md);
}
.chat-jump-latest:hover {
  background: var(--accent-hover);
}

.fade-enter-active, .fade-leave-active {
  transition: opacity var(--dur-fast) var(--ease-out);
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
</style>
