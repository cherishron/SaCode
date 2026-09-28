<script setup lang="ts">
import { ref } from 'vue';

/** 任务清单：composer 上方（契约 D5），可折叠 */
const props = defineProps<{
  items: { id: string; text: string }[];
}>();

const open = ref(true);
</script>

<template>
  <div v-if="props.items.length" class="plan-panel">
    <button class="plan-panel-head" type="button" @click="open = !open">
      <span class="plan-panel-title">任务清单</span>
      <span class="muted">{{ props.items.length }}</span>
      <span style="flex: 1" />
      <span class="plan-panel-toggle">{{ open ? '收起' : '展开' }}</span>
    </button>
    <ul v-if="open" class="plan-panel-list">
      <li v-for="item in props.items" :key="item.id" class="plan-panel-item">
        {{ item.text }}
      </li>
    </ul>
  </div>
</template>
