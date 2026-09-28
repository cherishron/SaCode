<script setup lang="ts">
import { ref } from 'vue';

export interface AskOption {
  label?: string;
  value?: string;
  description?: string;
}

const props = defineProps<{
  taskId: string;
  question: string;
  options?: AskOption[];
  allowMultiple?: boolean;
}>();

const emit = defineEmits<{
  answered: [payload: { taskId: string; answer: string; selected: string[] }];
  cancelled: [taskId: string];
}>();

const freeText = ref('');
const selected = ref<string[]>([]);

function toggle(value: string) {
  if (props.allowMultiple) {
    selected.value = selected.value.includes(value)
      ? selected.value.filter((v) => v !== value)
      : [...selected.value, value];
  } else {
    selected.value = [value];
    void submit();
  }
}

async function submit() {
  const answer = freeText.value.trim();
  const sel = [...selected.value];
  if (!answer && sel.length === 0) return;
  emit('answered', { taskId: props.taskId, answer, selected: sel });
}
</script>

<template>
  <article class="msg-card msg-ask">
    <header class="msg-card-head">
      <span class="msg-card-label">提问</span>
      <span class="msg-card-id mono">{{ taskId.slice(0, 8) }}</span>
    </header>
    <div class="msg-card-body">{{ question }}</div>

    <div v-if="options?.length" class="ask-options">
      <button
        v-for="(opt, i) in options"
        :key="opt.value ?? i"
        type="button"
        class="ask-option"
        :class="{ selected: selected.includes(opt.value || opt.label || String(i)) }"
        @click="toggle(opt.value || opt.label || String(i))"
      >
        <span>{{ opt.label || opt.value || `选项 ${i + 1}` }}</span>
        <span v-if="opt.description" class="muted">{{ opt.description }}</span>
      </button>
    </div>

    <div class="ask-actions">
      <t-textarea
        v-model="freeText"
        size="small"
        :autosize="{ minRows: 1, maxRows: 4 }"
        placeholder="补充说明…"
      />
      <div class="ask-actions-row">
        <t-button size="small" variant="outline" @click="emit('cancelled', taskId)">
          取消
        </t-button>
        <t-button
          size="small"
          theme="primary"
          :disabled="!freeText.trim() && selected.length === 0"
          @click="submit"
        >
          提交
        </t-button>
      </div>
    </div>
  </article>
</template>
