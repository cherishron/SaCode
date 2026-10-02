<script setup lang="ts">
import { ref, watch } from 'vue';
import { ArrowRightIcon, CloseIcon, LinkIcon, RefreshIcon } from 'tdesign-icons-vue-next';

/**
 * PreviewSidePanel — 格内 absolute scrim + 侧板（契约：预览 URL + reload）。
 * 与 FilesSidePanel / TerminalSidePanel 同形态。
 */
const props = defineProps<{
  open: boolean;
  embedded?: boolean;
  workspaceKey?: string;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
}>();

const storageKey = () => `sacode.preview.url.${props.workspaceKey ?? 'default'}`;

const url = ref('');
const active = ref('');
const frameKey = ref(0);
const panelWidth = ref(640);
const dragging = ref(false);
const error = ref('');

function loadSaved() {
  try {
    url.value = localStorage.getItem(storageKey()) || '';
    active.value = url.value;
  } catch {
    /* ignore */
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) loadSaved();
  },
  { immediate: true },
);

watch(
  () => props.workspaceKey,
  () => {
    if (props.open) loadSaved();
  },
);

function isSafeHttp(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function go() {
  error.value = '';
  const value = url.value.trim();
  if (!value) {
    error.value = '请输入 http(s) 地址';
    return;
  }
  const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  if (!isSafeHttp(normalized)) {
    error.value = '仅支持 http/https';
    return;
  }
  url.value = normalized;
  active.value = normalized;
  frameKey.value += 1;
  try {
    localStorage.setItem(storageKey(), normalized);
  } catch {
    /* ignore */
  }
}

function reload() {
  if (!active.value) return;
  frameKey.value += 1;
}

function onResizeStart(e: PointerEvent) {
  if (e.button !== 0) return;
  dragging.value = true;
  const startX = e.clientX;
  const startW = panelWidth.value;
  const move = (ev: PointerEvent) => {
    panelWidth.value = Math.min(1000, Math.max(360, startW + (startX - ev.clientX)));
  };
  const up = () => {
    dragging.value = false;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
</script>

<template>
  <!-- embedded 时由工具栏 v-show 控制可见，保留预览 iframe -->
  <template v-if="embedded || open">
    <div v-if="!embedded" class="files-scrim" @click="emit('update:open', false)" />
    <aside
      class="files-side-panel preview-panel"
      :class="{ dragging, 'tools-embedded': embedded }"
      :style="embedded ? {} : { width: `${panelWidth}px` }"
    >
      <div v-if="!embedded" class="files-resizer" @pointerdown.prevent="onResizeStart" />
      <header class="files-head">
        <LinkIcon size="13" />
        <span class="files-title">预览</span>
        <t-input
          v-model="url"
          size="small"
          class="preview-url"
          placeholder="http://localhost:5173"
          @keydown.enter="go"
        />
        <button class="ghost-btn" type="button" title="打开" @click="go">
          <ArrowRightIcon size="14" />
        </button>
        <button class="ghost-btn" type="button" title="刷新" @click="reload">
          <RefreshIcon size="13" />
        </button>
        <button v-if="!embedded" class="ghost-btn" type="button" title="关闭" @click="emit('update:open', false)">
          <CloseIcon size="13" />
        </button>
      </header>

      <div v-if="error" class="files-error">{{ error }}</div>
      <iframe
        v-if="active"
        :key="frameKey"
        class="preview-frame"
        :src="active"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        referrerpolicy="no-referrer"
      />
      <div v-else class="files-empty files-empty--preview">
        <LinkIcon size="36" />
        <p>输入 http(s) 地址后前往预览</p>
        <p class="muted" style="font-size: 11px">支持 localhost 开发服务与远程站点</p>
      </div>
    </aside>
  </template>
</template>
