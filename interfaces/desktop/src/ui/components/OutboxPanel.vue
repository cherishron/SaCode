<script setup lang="ts">
import { computed } from 'vue';
import { useDesktopApp } from '../composables/useDesktopApp';

const { queuedMessages, retryQueuedMessage, removeQueuedMessage, moveQueuedMessageBy } = useDesktopApp();

/**
 * P2-8：待发送队列浮条。
 * 队列条目在应用关闭时若正处于发送中，恢复后会带 error 标记
 * 「上次发送状态不确定」——此时绝不自动重发，必须由用户显式点「重试」。
 */
const uncertainCount = computed(() => queuedMessages.value.filter((item) => !!item.error).length);

function stateLabel(item: { error?: string; sending?: boolean }): string {
  if (item.error) return '待确认';
  if (item.sending) return '发送中';
  return '排队中';
}

function stateClass(item: { error?: string; sending?: boolean }): string {
  if (item.error) return 'is-uncertain';
  if (item.sending) return 'is-sending';
  return 'is-queued';
}

function preview(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > 120 ? `${oneLine.slice(0, 120)}…` : oneLine;
}

function moveUp(id: string) {
  moveQueuedMessageBy(id, -1);
}

function moveDown(id: string) {
  moveQueuedMessageBy(id, 1);
}
</script>

<template>
  <section v-if="queuedMessages.length" class="outbox" aria-label="待发送队列">
    <header class="outbox-head">
      <span class="outbox-title">待发送 {{ queuedMessages.length }}</span>
      <span v-if="uncertainCount" class="outbox-alert" role="status">
        其中 {{ uncertainCount }} 条发送状态不确定，请确认会话中是否已提交后再重试
      </span>
    </header>

    <ul class="outbox-list">
      <li
        v-for="(item, index) in queuedMessages"
        :key="item.id"
        class="outbox-item"
        :class="stateClass(item)"
      >
        <span class="outbox-index" aria-hidden="true">{{ index + 1 }}</span>

        <div class="outbox-body">
          <p class="outbox-prompt" :title="item.prompt">{{ preview(item.prompt) }}</p>
          <p v-if="item.error" class="outbox-reason">{{ item.error }}</p>
        </div>

        <span class="outbox-state">{{ stateLabel(item) }}</span>

        <div class="outbox-actions">
          <button
            v-if="item.error"
            type="button"
            class="outbox-btn outbox-btn--primary"
            :disabled="item.sending"
            @click="retryQueuedMessage(item.id)"
          >
            重试
          </button>
          <button
            type="button"
            class="outbox-btn"
            :disabled="item.sending || index === 0"
            title="上移"
            aria-label="上移"
            @click="moveUp(item.id)"
          >
            ↑
          </button>
          <button
            type="button"
            class="outbox-btn"
            :disabled="item.sending || index === queuedMessages.length - 1"
            title="下移"
            aria-label="下移"
            @click="moveDown(item.id)"
          >
            ↓
          </button>
          <button
            type="button"
            class="outbox-btn"
            :disabled="item.sending"
            title="移除"
            aria-label="移除"
            @click="removeQueuedMessage(item.id)"
          >
            ×
          </button>
        </div>
      </li>
    </ul>
  </section>
</template>
