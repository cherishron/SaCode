# Page Design - Chat

> Chat page design specification

---

## 1. Page Overview

| Attribute | Value |
|-----------|-------|
| Route | `/dashboard/chat` |
| Layout | Two-column (sidebar + chat) |
| Auth Required | Yes |
| Mobile Responsive | Yes |

---

## 2. Layout Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                        Header (User info)                        │
├────────────────┬────────────────────────────────────────────────┤
│                │                                                │
│   Sessions     │                  Chat Area                     │
│   ──────────   │                                                │
│   [Session 1]  │   ┌─────────────────────────────────────────┐ │
│   [Session 2]  │   │  User: Hello!                           │ │
│   [Session 3]  │   │  AI: Hi! How can I help you today?      │ │
│   [Session 4]  │   │  User: Tell me about...                 │ │
│                │   │  AI: Let me explain...                  │ │
│                │   │  [Streaming...]█                        │ │
│                │   └─────────────────────────────────────────┘ │
│   [+ New Chat] │                                                │
│                │   ┌─────────────────────────────────────────┐ │
│                │   │ [Text input here...]          [Send] │ │
│                │   └─────────────────────────────────────────┘ │
│                │                                                │
└────────────────┴────────────────────────────────────────────────┘
```

---

## 3. Components

### 3.1 Chat Layout

```vue
<template>
  <div class="chat-layout">
    <!-- Session Sidebar -->
    <aside class="session-sidebar">
      <div class="sidebar-header">
        <h2>Chats</h2>
        <button @click="createNewSession" class="btn-new">
          <PlusIcon /> New Chat
        </button>
      </div>
      <div class="session-list">
        <SessionItem
          v-for="session in sessions"
          :key="session.id"
          :session="session"
          :active="session.id === activeSessionId"
          @select="selectSession(session.id)"
          @delete="deleteSession(session.id)"
        />
      </div>
    </aside>

    <!-- Chat Area -->
    <main class="chat-main">
      <!-- Messages -->
      <div class="messages-container" ref="messagesContainer">
        <MessageRenderer
          v-for="message in messages"
          :key="message.id"
          :message="message"
        />
        <div v-if="isStreaming" class="streaming-indicator">
          <span class="cursor">|</span>
        </div>
      </div>

      <!-- Input Area -->
      <div class="input-area">
        <ChatInput
          v-model="inputText"
          :disabled="isStreaming"
          @submit="sendMessage"
        />
        <button
          @click="sendMessage"
          class="btn-send"
          :disabled="!inputText.trim() || isStreaming"
        >
          <SendIcon />
        </button>
      </div>
    </main>
  </div>
</template>
```

### 3.2 Message Renderer

```vue
<template>
  <div :class="['message', message.role]">
    <div class="message-avatar">
      <img
        v-if="message.role === 'user'"
        :src="userAvatar"
        alt="User"
      />
      <AIIcon v-else />
    </div>
    <div class="message-content">
      <div class="message-header">
        <span class="role">{{ message.role === 'user' ? 'You' : 'AI' }}</span>
        <span class="time">{{ formatTime(message.timestamp) }}</span>
      </div>
      <div class="message-body" v-html="renderedContent" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { marked } from 'marked';
import hljs from 'highlight.js';

const props = defineProps<{
  message: ChatMessage;
}>();

const renderedContent = computed(() => {
  return marked(props.message.content, {
    highlight: (code, lang) => {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    },
  });
});
</script>
```

### 3.3 Chat Input

```vue
<template>
  <div class="chat-input-wrapper">
    <textarea
      ref="textareaRef"
      v-model="modelValue"
      placeholder="Type your message..."
      rows="1"
      @input="autoResize"
      @keydown="handleKeydown"
    />
    <div class="input-actions">
      <button @click="attachFile" title="Attach file">
        <AttachIcon />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
const textareaRef = ref<HTMLTextAreaElement | null>(null);

function autoResize() {
  if (textareaRef.value) {
    textareaRef.value.style.height = 'auto';
    textareaRef.value.style.height = Math.min(textareaRef.value.scrollHeight, 200) + 'px';
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    emit('submit');
  }
}
</script>
```

---

## 4. Styling

```css
.chat-layout {
  display: grid;
  grid-template-columns: 280px 1fr;
  height: 100vh;
  background: #f9fafb;
}

/* Sidebar */
.session-sidebar {
  background: white;
  border-right: 1px solid #e5e7eb;
  display: flex;
  flex-direction: column;
}

.sidebar-header {
  padding: 1rem;
  border-bottom: 1px solid #e5e7eb;
}

.session-list {
  flex: 1;
  overflow-y: auto;
}

/* Chat Area */
.chat-main {
  display: flex;
  flex-direction: column;
  background: #f9fafb;
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
}

.input-area {
  border-top: 1px solid #e5e7eb;
  padding: 1rem;
  background: white;
  display: flex;
  gap: 0.5rem;
}

/* Messages */
.message {
  display: flex;
  gap: 1rem;
  margin-bottom: 1.5rem;
  max-width: 800px;
  margin-left: auto;
  margin-right: auto;
}

.message.user {
  flex-direction: row-reverse;
}

.message-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
}

.message-content {
  flex: 1;
  min-width: 0;
}

.message-header {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.message-body {
  background: white;
  padding: 1rem;
  border-radius: 12px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.message.user .message-body {
  background: #3b82f6;
  color: white;
}

/* Code Blocks */
.message-body pre {
  background: #1f2937;
  color: #e5e7eb;
  padding: 1rem;
  border-radius: 8px;
  overflow-x: auto;
}

.message-body code {
  font-family: 'Fira Code', monospace;
  font-size: 0.875rem;
}

/* Streaming Indicator */
.streaming-indicator {
  display: flex;
  justify-content: center;
  padding: 1rem;
}

.cursor {
  animation: blink 1s infinite;
}

@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

/* Chat Input */
.chat-input-wrapper {
  flex: 1;
  position: relative;
  display: flex;
  align-items: flex-end;
  background: #f3f4f6;
  border-radius: 12px;
  padding: 0.75rem 1rem;
}

.chat-input-wrapper textarea {
  flex: 1;
  border: none;
  background: transparent;
  resize: none;
  font-size: 1rem;
  line-height: 1.5;
  max-height: 200px;
}

.chat-input-wrapper textarea:focus {
  outline: none;
}
```

---

## 5. Behavior

### 5.1 Streaming Chat

```typescript
async function sendMessage() {
  if (!inputText.value.trim() || isStreaming.value) return;

  const userMessage = {
    id: generateId(),
    role: 'user' as const,
    content: inputText.value,
    timestamp: new Date(),
  };

  messages.value.push(userMessage);
  inputText.value = '';

  isStreaming.value = true;

  const aiMessage = {
    id: generateId(),
    role: 'assistant' as const,
    content: '',
    timestamp: new Date(),
  };

  messages.value.push(aiMessage);

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        sessionId: activeSessionId.value,
        message: userMessage.content,
      }),
    });

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      aiMessage.content += chunk;

      // Auto-scroll to bottom
      scrollToBottom();
    }
  } catch (error) {
    console.error('Chat error:', error);
  } finally {
    isStreaming.value = false;
  }
}
```

### 5.2 WebSocket Alternative

```typescript
const ws = new WebSocket('ws://localhost:3000/ws');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  switch (data.type) {
    case 'stream':
      // Append chunk to current AI message
      currentAiMessage.content += data.text;
      break;
    case 'done':
      isStreaming.value = false;
      break;
    case 'error':
      console.error(data.error);
      break;
  }
};

function sendMessage() {
  ws.send(JSON.stringify({
    type: 'message',
    sessionId: activeSessionId.value,
    content: inputText.value,
  }));
}
```

---

## 6. Mobile Responsive

```css
@media (max-width: 768px) {
  .chat-layout {
    grid-template-columns: 1fr;
  }

  .session-sidebar {
    position: fixed;
    left: -100%;
    top: 0;
    bottom: 0;
    width: 280px;
    z-index: 100;
    transition: left 0.3s ease;
  }

  .session-sidebar.open {
    left: 0;
  }

  .mobile-overlay {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 99;
  }

  .session-sidebar.open + .mobile-overlay {
    display: block;
  }
}
```

---

*Document Version: 1.0.0*
*Last Updated: 2026-03-19*
