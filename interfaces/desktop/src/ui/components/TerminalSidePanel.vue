<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { CloseIcon, TerminalIcon } from 'tdesign-icons-vue-next';
import {
  isNativeTerminalAvailable,
  listenTerminalExit,
  listenTerminalOutput,
  resizeTerminal,
  startTerminal,
  writeTerminal,
  closeTerminal,
} from '../../tauri-bridge.ts';
import { useDesktopApp } from '../composables/useDesktopApp';

/**
 * TerminalSidePanel — 格内 absolute scrim + 侧板（与 FilesSidePanel 同形态）。
 * 接 Tauri PTY；Web 预览下提示需要桌面会话。
 */
const props = defineProps<{
  open: boolean;
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

function push(text: string, tone: 'out' | 'ok' | 'err' | 'muted' = 'out') {
  lines.value = [...lines.value, { text, tone }].slice(-500);
  void nextTick(() => {
    if (historyEl.value) historyEl.value.scrollTop = historyEl.value.scrollHeight;
  });
}

async function ensureTerminal() {
  if (terminalId.value || !available) return;
  status.value = '启动中…';
  const started = await startTerminal(24, 80);
  if (!started) {
    status.value = '终端不可用';
    return;
  }
  terminalId.value = started.terminal_id;
  status.value = `${started.shell} · ${workspace.value || 'workspace'}`;
  offOutput = await listenTerminalOutput((payload) => {
    if (payload.terminal_id !== terminalId.value) return;
    // 简单可读转录：剥离常见 ANSI CSI
    const text = payload.data.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
    if (text) push(text);
  });
  offExit = await listenTerminalExit((payload) => {
    if (payload.terminal_id !== terminalId.value) return;
    push(`[进程退出 ${payload.code ?? ''} ${payload.reason}]`, 'muted');
    terminalId.value = null;
    status.value = '已退出';
  });
  push(`已连接 ${started.shell}`, 'ok');
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
  };
  const up = () => {
    dragging.value = false;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

watch(
  () => props.open,
  (open) => {
    if (open) void ensureTerminal();
    if (!open && terminalId.value) {
      void resizeTerminal(terminalId.value, 24, 80).catch(() => {});
    }
  },
);

onBeforeUnmount(() => {
  offOutput?.();
  offExit?.();
  if (terminalId.value) void closeTerminal(terminalId.value).catch(() => {});
});
</script>

<template>
  <template v-if="open">
    <div class="files-scrim" @click="emit('update:open', false)" />
    <aside
      class="files-side-panel terminal-panel"
      :class="{ dragging }"
      :style="{ width: `${panelWidth}px` }"
    >
      <div class="files-resizer" @pointerdown.prevent="onResizeStart" />
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
        <button class="ghost-btn" type="button" title="关闭" @click="emit('update:open', false)">
          <CloseIcon size="13" />
        </button>
      </header>

      <div ref="historyEl" class="scroll-y terminal-history">
        <div
          v-for="(line, i) in lines"
          :key="i"
          class="terminal-line"
          :class="line.tone"
        >
          {{ line.text }}
        </div>
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
