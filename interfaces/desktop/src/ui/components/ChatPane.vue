<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ChatList, type ChatMessagesData } from '@tdesign-vue-next/chat';
import ComposerDock from './ComposerDock.vue';
import { useDesktopApp } from '../composables/useDesktopApp';

const props = defineProps<{
  conversationId: string | null;
}>();

const emit = defineEmits<{
  sent: [payload: { conversationId: string; taskId: string }];
  openTerminal: [];
}>();

const { chatItems, selectedId, sending } = useDesktopApp();

const messages = computed(() => {
  const id = props.conversationId;
  return chatItems.value
    .filter((item) => !id || item.taskId === id || !item.taskId)
    .map((item, index) => {
      const isUser = item.kind === 'user';
      const role = isUser ? 'user' : item.kind === 'system' ? 'system' : 'assistant';
      const text = item.kind === 'error' ? `⚠ ${item.text}` : item.text;
      return {
        id: item.id || `m-${index}`,
        role,
        avatar: isUser
          ? 'https://tdesign.gtimg.com/site/avatar.jpg'
          : 'https://tdesign.gtimg.com/site/chat-avatar.png',
        name: isUser ? '你' : item.kind === 'tool' ? '工具' : 'SaCode',
        status: item.kind === 'error' ? 'error' : 'complete',
        content: [{ type: 'text', status: 'complete', data: text }],
      } as unknown as ChatMessagesData;
    });
});

watch(
  () => props.conversationId,
  () => {
    /* keep dock state; dock resets on send */
  },
);
</script>

<template>
  <div class="td-chat-shell">
    <t-chat-list :clear-history="false" class="td-chat-stream" style="flex: 1">
      <t-chat-message
        v-for="message in messages"
        :key="message.id"
        :message="message"
        :placement="message.role === 'user' ? 'right' : 'left'"
        :variant="message.role === 'user' ? 'base' : 'text'"
        :avatar="message.role === 'user' ? 'https://tdesign.gtimg.com/site/avatar.jpg' : 'https://tdesign.gtimg.com/site/chat-avatar.png'"
        allow-content-segment-custom
      />
    </t-chat-list>

    <ComposerDock
      :conversation-id="conversationId ?? selectedId"
      @sent="(p) => emit('sent', p)"
    />
  </div>
</template>
