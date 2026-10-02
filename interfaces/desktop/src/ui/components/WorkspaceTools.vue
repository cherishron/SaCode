<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { CloseIcon, RefreshIcon } from 'tdesign-icons-vue-next';
import type { TaskFileChange } from '@cherishron/sacode-client-core';
import { useDesktopApp } from '../composables/useDesktopApp';
import FilesSidePanel from './FilesSidePanel.vue';
import TerminalSidePanel from './TerminalSidePanel.vue';
import PreviewSidePanel from './PreviewSidePanel.vue';
import { gitWorkspaceStatus, gitWorkspaceDiff, type GitWorkspaceStatus } from '../platform/tauri-bridge';
import { parseGitStatusPorcelainZ, gitEntryToRow, applyDiffToRow, type ChangeRow } from '../logic/git-changes';
import {
  TOOLS_TREE_DEFAULT,
  TOOLS_TREE_MIN,
  TOOLS_WIDTH_DEFAULT,
  TOOLS_WIDTH_MIN,
  type ToolsTabId,
} from '../logic/split-persist.ts';

/**
 * WorkspaceTools — 格内统一右侧工具栏（文件 / 变更 / 终端 / 预览）。
 * 形态：absolute 覆盖 + 单面板；非模态（scrim 不挡会话交互）。
 * 开关/标签/宽度由父级按分格独立持有，本组件只做呈现与拖宽。
 */
const props = defineProps<{
  open: boolean;
  tab: ToolsTabId;
  width: number;
  treeWidth: number;
  conversationId: string | null;
  workspaceKey?: string;
}>();

const emit = defineEmits<{
  close: [];
  'update:tab': [value: ToolsTabId];
  'update:width': [value: number];
  'update:treeWidth': [value: number];
}>();

const { app } = useDesktopApp();
const tabs: { id: ToolsTabId; label: string }[] = [
  { id: 'files', label: '文件' }, { id: 'changes', label: '变更' },
  { id: 'terminal', label: '终端' }, { id: 'preview', label: '预览' },
];
const panel = ref<HTMLElement | null>(null);
const changes = ref<TaskFileChange[]>([]);
const selectedPath = ref('');
const loading = ref(false);
const error = ref('');
const message = ref('');
const selected = computed(() => changes.value.find(c => c.path === selectedPath.value));
let request = 0;
let stopDrag: (() => void) | null = null;

async function refreshChanges() {
  const generation = ++request;
  const id = props.conversationId;
  const client = app.client;
  error.value = ''; message.value = ''; changes.value = [];
  if (!id || !client) { loading.value = false; return; }
  loading.value = true;
  try {
    const detail = await client.getDesktopConversation(id);
    const taskId = detail.turns.at(-1)?.task_id;
    if (!taskId) return;
    const result = await client.getTaskChanges(taskId);
    if (generation !== request || client !== app.client) return;
    changes.value = result.changes;
    message.value = result.message || '';
    if (!changes.value.some(c => c.path === selectedPath.value)) selectedPath.value = changes.value[0]?.path || '';
  } catch (e) {
    if (generation === request) error.value = String(e);
  } finally {
    if (generation === request) loading.value = false;
  }
}

watch([() => props.open, () => props.tab, () => props.conversationId], () => {
  ++request;
  if (props.open && props.tab === 'changes') {
    void refreshChanges();
    void refreshGitStatus();
  }
});

// —— Git 工作区状态（Tauri git_workspace_status/diff，不走 daemon HTTP）——
const gitBranch = ref<string | null>(null);
const gitRows = ref<ChangeRow[]>([]);
const gitLoading = ref(false);
const gitError = ref('');
const gitSelectedPath = ref('');
const gitDiffText = ref('');
const gitDiffLoading = ref(false);
let gitRequest = 0;

const gitSelected = computed(() => gitRows.value.find(r => r.path === gitSelectedPath.value));
const gitDiffStats = computed(() => {
  if (!gitDiffText.value) return { additions: 0, deletions: 0, binary: false };
  let additions = 0; let deletions = 0;
  for (const line of gitDiffText.value.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
  }
  return { additions, deletions, binary: gitSelected.value?.binary ?? false };
});

async function refreshGitStatus() {
  const generation = ++gitRequest;
  gitError.value = ''; gitRows.value = []; gitBranch.value = null;
  gitDiffText.value = ''; gitSelectedPath.value = '';
  gitLoading.value = true;
  try {
    const status: GitWorkspaceStatus | null = await gitWorkspaceStatus();
    if (generation !== gitRequest) return;
    if (!status) { gitError.value = '非 Tauri 环境，无法获取 git 状态'; return; }
    gitBranch.value = status.branch;
    gitRows.value = parseGitStatusPorcelainZ(status.porcelain).map(gitEntryToRow);
    gitSelectedPath.value = gitRows.value[0]?.path || '';
    if (gitSelectedPath.value) void loadGitDiff(gitSelectedPath.value);
  } catch (e) {
    if (generation === gitRequest) gitError.value = String(e);
  } finally {
    if (generation === gitRequest) gitLoading.value = false;
  }
}

async function loadGitDiff(path: string) {
  const generation = ++gitRequest;
  gitDiffText.value = ''; gitDiffLoading.value = true;
  try {
    const diff = await gitWorkspaceDiff(false, path);
    if (generation !== gitRequest) return;
    gitDiffText.value = diff ?? '';
    const row = gitRows.value.find(r => r.path === path);
    if (row && diff) {
      const updated = applyDiffToRow(row, diff, false);
      const idx = gitRows.value.findIndex(r => r.path === path);
      if (idx >= 0) gitRows.value[idx] = updated;
    }
  } catch (e) {
    if (generation === gitRequest) gitDiffText.value = `diff 加载失败: ${e}`;
  } finally {
    if (generation === gitRequest) gitDiffLoading.value = false;
  }
}

function selectGitRow(path: string) {
  gitSelectedPath.value = path;
  void loadGitDiff(path);
}

function resize(event: PointerEvent, inner = false) {
  if (event.button !== 0) return;
  stopDrag?.();
  const host = panel.value?.parentElement;
  const start = event.clientX;
  const original = inner ? props.treeWidth : panel.value?.getBoundingClientRect().width || props.width;
  const move = (next: PointerEvent) => {
    if (inner) {
      emit('update:treeWidth', Math.max(TOOLS_TREE_MIN, Math.min(320, original + next.clientX - start)));
    } else {
      const max = (host?.clientWidth || 1000) * .72;
      emit('update:width', Math.max(TOOLS_WIDTH_MIN, Math.min(max, original + start - next.clientX)));
    }
  };
  const stop = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', stop);
    window.removeEventListener('pointercancel', stop);
    stopDrag = null;
  };
  stopDrag = stop;
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', stop, { once: true });
  window.addEventListener('pointercancel', stop, { once: true });
}
onBeforeUnmount(() => { ++request; stopDrag?.(); });
</script>

<template>
  <template v-if="open">
    <!-- 非模态：视觉分层但不拦截会话交互（契约 §4.2） -->
    <div class="tools-scrim" aria-hidden="true" />
    <aside
      ref="panel"
      class="workspace-tools"
      :style="{ width: `${width || TOOLS_WIDTH_DEFAULT}px` }"
      aria-label="会话工具栏"
    >
      <div
        class="tools-resizer"
        role="separator"
        aria-label="调整工具栏宽度"
        aria-orientation="vertical"
        tabindex="0"
        @pointerdown.prevent="resize($event)"
        @keydown.left.prevent="emit('update:width', Math.max(TOOLS_WIDTH_MIN, width + 20))"
        @keydown.right.prevent="emit('update:width', Math.max(TOOLS_WIDTH_MIN, width - 20))"
      />
      <header class="tools-head">
        <div class="tools-tabs" role="tablist" aria-label="工具栏功能">
          <button
            v-for="item in tabs"
            :key="item.id"
            type="button"
            role="tab"
            :aria-selected="tab === item.id"
            :class="{ active: tab === item.id }"
            @click="emit('update:tab', item.id)"
          >
            {{ item.label }}<span v-if="item.id === 'changes' && changes.length" class="tools-count">{{ changes.length }}</span>
          </button>
        </div>
        <button type="button" class="ghost-btn" aria-label="关闭工具栏" title="关闭工具栏" @click="emit('close')"><CloseIcon size="14" /></button>
      </header>
      <div class="tools-content">
        <!-- 常驻挂载（v-show 切换），保留文件树/终端/预览内部状态 -->
        <div v-show="tab === 'files'" class="tools-tab-page">
          <FilesSidePanel :open="open && tab === 'files'" embedded />
        </div>
        <div v-show="tab === 'terminal'" class="tools-tab-page">
          <TerminalSidePanel :open="open && tab === 'terminal'" embedded />
        </div>
        <div v-show="tab === 'preview'" class="tools-tab-page">
          <PreviewSidePanel :open="open && tab === 'preview'" :workspace-key="workspaceKey" embedded />
        </div>
        <section v-show="tab === 'changes'" class="tools-changes" aria-label="当前会话变更">
          <header class="files-head"><span class="files-title">本轮变更</span><span style="flex: 1" /><button type="button" class="ghost-btn" aria-label="刷新变更" :disabled="loading" @click="refreshChanges"><RefreshIcon size="14" /></button></header>
          <p v-if="error" class="files-error" role="alert">{{ error }} <button type="button" @click="refreshChanges">重试</button></p>
          <div v-if="loading" class="files-empty" role="status">正在读取变更…</div>
          <div v-else-if="!changes.length" class="files-empty">{{ message || (conversationId ? '当前轮次暂无文件变更' : '选择会话后查看变更') }}</div>
          <div v-else class="tools-diff-body">
            <div class="tools-change-list scroll-y" :style="{ width: `${treeWidth || TOOLS_TREE_DEFAULT}px` }">
              <button v-for="change in changes" :key="change.path" type="button" class="tools-change-row" :class="{ selected: selectedPath === change.path }" @click="selectedPath = change.path">
                <span :title="change.path">{{ change.path }}</span><small>{{ change.kind }} · +{{ change.additions }} −{{ change.deletions }}</small>
              </button>
            </div>
            <div class="tools-inner-resizer" role="separator" aria-label="调整变更列表宽度" aria-orientation="vertical" @pointerdown.prevent="resize($event, true)" />
            <section class="tools-diff-preview scroll-y">
              <template v-if="selected"><header class="files-head"><span class="mono" :title="selected.path">{{ selected.path }}</span></header>
                <p v-if="selected.binary" class="files-empty">二进制文件无法显示文本 Diff</p>
                <pre v-else-if="selected.diff" class="tools-diff"><span v-for="(line, i) in selected.diff.split('\n')" :key="i" :class="{ added: line.startsWith('+') && !line.startsWith('+++'), removed: line.startsWith('-') && !line.startsWith('---'), hunk: line.startsWith('@@') }">{{ line }}{{ '\n' }}</span></pre>
                <p v-else class="files-empty">此文件没有可显示的文本 Diff</p>
              </template>
            </section>
          </div>
        </section>
        <!-- Git 工作区状态（Tauri git_workspace_status/diff，实时 git status） -->
        <section v-show="tab === 'changes'" class="tools-git-workspace" aria-label="工作区 Git 状态">
          <header class="files-head">
            <span class="files-title">Git 工作区</span>
            <span v-if="gitBranch" class="git-branch mono">{{ gitBranch }}</span>
            <span style="flex: 1" />
            <button type="button" class="ghost-btn" aria-label="刷新 Git 状态" :disabled="gitLoading" @click="refreshGitStatus"><RefreshIcon size="14" /></button>
          </header>
          <p v-if="gitError" class="files-error" role="alert">{{ gitError }}</p>
          <div v-if="gitLoading" class="files-empty" role="status">读取 Git 状态…</div>
          <div v-else-if="!gitRows.length" class="files-empty">工作区无未提交变更</div>
          <div v-else class="tools-diff-body">
            <div class="tools-change-list scroll-y" :style="{ width: `${treeWidth || TOOLS_TREE_DEFAULT}px` }">
              <button
                v-for="row in gitRows"
                :key="row.path"
                type="button"
                class="tools-change-row"
                :class="{ selected: gitSelectedPath === row.path }"
                @click="selectGitRow(row.path)"
              >
                <span :title="row.path">{{ row.path }}</span>
                <small>{{ row.kind }}<span v-if="row.additions || row.deletions"> · +{{ row.additions }} −{{ row.deletions }}</span></small>
              </button>
            </div>
            <div class="tools-inner-resizer" role="separator" aria-label="调整变更列表宽度" aria-orientation="vertical" @pointerdown.prevent="resize($event, true)" />
            <section class="tools-diff-preview scroll-y">
              <template v-if="gitSelected">
                <header class="files-head"><span class="mono" :title="gitSelected.path">{{ gitSelected.path }}</span></header>
                <div v-if="gitDiffLoading" class="files-empty">读取 diff…</div>
                <p v-else-if="gitDiffStats.binary" class="files-empty">二进制文件无法显示文本 Diff</p>
                <pre v-else-if="gitDiffText" class="tools-diff"><span v-for="(line, i) in gitDiffText.split('\n')" :key="i" :class="{ added: line.startsWith('+') && !line.startsWith('+++'), removed: line.startsWith('-') && !line.startsWith('---'), hunk: line.startsWith('@@') }">{{ line }}{{ '\n' }}</span></pre>
                <p v-else class="files-empty">无变更内容</p>
              </template>
            </section>
          </div>
        </section>
      </div>
    </aside>
  </template>
</template>
