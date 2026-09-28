<script setup lang="ts">
import { computed } from 'vue';

export interface ChatItem {
  id: string;
  kind: 'user' | 'assistant' | 'tool' | 'error' | 'system';
  text: string;
  detail?: string;
  status?: string;
  taskId?: string;
}

const props = defineProps<{
  item: ChatItem;
}>();

const label = computed(() => {
  switch (props.item.kind) {
    case 'user':
      return '你';
    case 'assistant':
      return 'SaCode';
    case 'tool':
      return '工具';
    case 'error':
      return '错误';
    default:
      return '系统';
  }
});
</script>

<template>
  <article class="msg-card" :class="`msg-${item.kind}`">
    <header class="msg-card-head">
      <span class="msg-card-label">{{ label }}</span>
      <span v-if="item.status" class="msg-card-status">{{ item.status }}</span>
      <span v-if="item.taskId" class="msg-card-id mono">{{ item.taskId.slice(0, 8) }}</span>
    </header>
    <div class="msg-card-body">{{ item.text }}</div>
    <pre v-if="item.detail" class="msg-card-detail">{{ item.detail }}</pre>
    <slot />
  </article>
</template>
