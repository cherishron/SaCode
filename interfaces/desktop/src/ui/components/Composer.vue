<script setup lang="ts">
import { ref, watch } from 'vue';
import type { ExecutionModeInput } from '@cherishron/sacode-client-core';
import { useDesktopApp } from '../composables/useDesktopApp';

const props = defineProps<{
  disabled?: boolean;
  conversationId?: string | null;
}>();

const emit = defineEmits<{
  sent: [payload: { conversationId: string; taskId: string }];
}>();

const { sendMessage, sending, sendError, contextUsage, attachments, uploadAttachment, removeAttachment } =
  useDesktopApp();

const draftKey = () => `sacode.draft.${props.conversationId ?? 'new'}`;
function loadDraft(): string {
  try {
    return localStorage.getItem(draftKey()) || '';
  } catch {
    return '';
  }
}

const prompt = ref(loadDraft());
const mode = ref<ExecutionModeInput>('build');
const modelName = ref('');
const fileInput = ref<HTMLInputElement | null>(null);

// P2-2 草稿按会话持久化
watch(
  () => props.conversationId,
  () => {
    prompt.value = loadDraft();
  },
);
watch(prompt, (value) => {
  try {
    if (value) localStorage.setItem(draftKey(), value);
    else localStorage.removeItem(draftKey());
  } catch {
    /* ignore */
  }
});

async function onPickFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  for (const file of files) {
    void uploadAttachment(file);
  }
  input.value = '';
}

async function submit() {
  const text = prompt.value.trim();
  if (!text || props.disabled || sending.value) return;
  const result = await sendMessage({
    prompt: text,
    mode: mode.value,
    conversationId: props.conversationId,
    modelName: modelName.value || undefined,
  });
  if (result) {
    prompt.value = '';
    try {
      localStorage.removeItem(draftKey());
    } catch {
      /* ignore */
    }
    emit('sent', result);
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    void submit();
  }
}
</script>

<template>
  <div class="composer">
    <!-- P2-1 附件芯片 -->
    <div v-if="attachments.length" class="composer-attachments">
      <span v-for="a in attachments" :key="a.path" class="attachment-chip">
        <span class="attachment-name" :title="a.path">{{ a.name }}</span>
        <button type="button" class="attachment-remove" title="移除" @click="removeAttachment(a.path)">
          ×
        </button>
      </span>
    </div>
    <t-textarea
      v-model="prompt"
      class="composer-input"
      placeholder="描述你要构建或修复的内容，Enter 发送"
      :autosize="{ minRows: 2, maxRows: 6 }"
      :disabled="disabled || sending"
      @keydown="onKeydown"
    />
    <div class="composer-bar">
      <t-select v-model="mode" size="small" style="width: 96px" :disabled="sending">
        <t-option value="plan" label="Plan" />
        <t-option value="build" label="Build" />
        <t-option value="yolo" label="Yolo" />
      </t-select>
      <t-select v-model="modelName" size="small" style="width: 120px" placeholder="模型" :disabled="sending">
        <t-option value="" label="默认模型" />
      </t-select>
      <button class="ghost-btn" type="button" title="添加附件" @click="fileInput?.click()">
        📎
      </button>
      <input
        ref="fileInput"
        type="file"
        multiple
        hidden
        @change="onPickFiles"
      />
      <span style="flex: 1" />
      <!-- 契约 D3：上下文用量在集群右端 -->
      <span class="composer-usage">
        {{ sending ? '发送中…' : contextUsage != null ? `${Math.round(contextUsage)}%` : '—' }}
      </span>
      <t-button
        size="small"
        theme="primary"
        variant="base"
        :loading="sending"
        :disabled="disabled || !prompt.trim()"
        @click="submit"
      >
        发送
      </t-button>
    </div>
    <div v-if="sendError" class="composer-error">{{ sendError }}</div>
  </div>
</template>
