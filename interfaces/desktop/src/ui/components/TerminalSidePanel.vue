<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { CloseIcon, TerminalIcon } from 'tdesign-icons-vue-next';
import {
  isNativeTerminalAvailable,
  listenTerminalExit,
  listenTerminalOutput,
  startTerminal,
  syncTerminalSize,
  writeTerminal,
  closeTerminal,
} from '../platform/tauri-bridge.ts';
import { useDesktopApp } from '../composables/useDesktopApp';

/**
 * TerminalSidePanel — 格内 absolute scrim + 侧板（与 FilesSidePanel 同形态）。
 * 接 Tauri PTY；Web 预览下提示需要桌面会话。
 * 输出保持原始字节流（含 ANSI），渲染层不预剥离。
 */
const props = defineProps<{
  open: boolean;
  embedded?: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
}>();

const { workspace } = useDesktopApp();

const available = isNativeTerminalAvailable();
const lines = ref<{ text: string; tone: 'out' | 'ok' | 'err' | 'muted' }[]>([]);
const command = ref('');
const terminalId = ref<string | null>(null);
const status = ref(available ? '未启动' : '需要桌面会话（Tauri）');
const historyEl = ref<HTMLElement | null>(null);
const panelWidth = ref(560);
const dragging = ref(false);

let offOutput: (() => void) | null = null;
let offExit: (() => void) | null = null;
let sizeObserver: ResizeObserver | null = null;
/** 字符宽/行高（CSS px），用于像素盒 → cols/rows */
const CHAR_W = 8;
const LINE_H = 16;

function push(text: string, tone: 'out' | 'ok' | 'err' | 'muted' = 'out') {
  lines.value = [...lines.value, { text, tone }].slice(-500);
  void nextTick(() => {
    if (historyEl.value) historyEl.value.scrollTop = historyEl.value.scrollHeight;
  });
}

function syncSize() {
  const el = historyEl.value;
  const id = terminalId.value;
  if (!el || !id) return;
  void syncTerminalSize(id, el.clientWidth, el.clientHeight, CHAR_W, LINE_H).catch(() => {});
}

function attachSizeObserver() {
  sizeObserver?.disconnect();
  const el = historyEl.value;
  if (!el || typeof ResizeObserver === 'undefined') return;
  sizeObserver = new ResizeObserver(() => syncSize());
  sizeObserver.observe(el);
}

async function ensureTerminal() {
  if (terminalId.value || !available) return;
  status.value = '启动中…';
  // 用当前面板实测尺寸启动，而非硬编码 24×80
  const el = historyEl.value;
  const started = await startTerminal(
    el ? Math.max(2, Math.floor(el.clientHeight / LINE_H)) : 24,
    el ? Math.max(2, Math.floor(el.clientWidth / CHAR_W)) : 80,
  );
  if (!started) {
    status.value = '终端不可用';
    return;
  }
  const id = started.terminal_id;
  terminalId.value = id;
  status.value = `${started.shell} · ${workspace.value || 'workspace'}`;
  offOutput = await listenTerminalOutput((payload) => {
    if (payload.terminal_id !== id) return;
    // 原始输出（含 ANSI）；渲染层不剥离
    if (payload.data) push(payload.data);
  }, id);
  offExit = await listenTerminalExit((payload) => {
    if (payload.terminal_id !== id) return;
    push(`[进程退出 ${payload.code ?? ''} ${payload.reason}]`, 'muted');
    terminalId.value = null;
    status.value = '已退出';
  }, id);
  push(`已连接 ${started.shell}`, 'ok');
  void nextTick(() => {
    attachSizeObserver();
    syncSize();
  });
}

async function submit() {
  const cmd = command.value;
  command.value = '';
  if (!terminalId.value) {
    await ensureTerminal();
    if (!terminalId.value) return;
  }
  push(`$ ${cmd}`, 'ok');
  const ok = await writeTerminal(terminalId.value, `${cmd}\n`);
  if (!ok) push('写入失败', 'err');
}

async function sendControl(data: string) {
  if (!terminalId.value) return;
  await writeTerminal(terminalId.value, data);
}

function onResizeStart(e: PointerEvent) {
  if (e.button !== 0) return;
  dragging.value = true;
  const startX = e.clientX;
  const startW = panelWidth.value;
  const move = (ev: PointerEvent) => {
    panelWidth.value = Math.min(920, Math.max(320, startW + (startX - ev.clientX)));
    syncSize();
  };
  const up = () => {
    dragging.value = false;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    syncSize();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

watch(
  () => props.open,
  (open) => {
    if (open) void ensureTerminal();
  },
);

onMounted(() => {
  if (props.open || props.embedded) attachSizeObserver();
});

onBeforeUnmount(() => {
  sizeObserver?.disconnect();
  offOutput?.();
  offExit?.();
  if (terminalId.value) void closeTerminal(terminalId.value).catch(() => {});
});
</script>

<template>
  <!-- embedded 时由工具栏 v-show 控制可见，切标签不拆终端 -->
  <template v-if="embedded || open">
    <div v-if="!embedded" class="files-scrim" @click="emit('update:open', false)" />
    <aside
      class="files-side-panel terminal-panel"
      :class="{ dragging, 'tools-embedded': embedded }"
      :style="embedded ? {} : { width: `${panelWidth}px` }"
    >
      <div v-if="!embedded" class="files-resizer" @pointerdown.prevent="onResizeStart" />
      <header class="files-head">
        <TerminalIcon size="13" />
        <span class="files-title">终端</span>
        <span class="muted">{{ status }}</span>
        <span style="flex: 1" />
        <button
          class="ghost-btn"
          type="button"
          title="Ctrl+C"
          @click="sendControl('\x03')"
        >
          ^C
        </button>
        <button v-if="!embedded" class="ghost-btn" type="button" title="关闭" @click="emit('update:open', false)">
          <CloseIcon size="13" />
        </button>
      </header>

      <div ref="historyEl" class="scroll-y terminal-history">
        <pre
          v-for="(line, i) in lines"
          :key="i"
          class="terminal-line"
          :class="line.tone"
        >{{ line.text }}</pre>
        <div v-if="!available" class="files-empty">
          Web 预览无 PTY。请在 Tauri 桌面会话中使用终端。
        </div>
      </div>

      <div class="terminal-input-row">
        <span class="mono">$</span>
        <t-input
          v-model="command"
          size="small"
          placeholder="输入命令，Enter 执行"
          :disabled="!available"
          @keydown.enter="submit"
        />
      </div>
    </aside>
  </template>
</template>
