<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { CloseIcon, RefreshIcon, SearchIcon } from 'tdesign-icons-vue-next';
import type { WorkspaceFilePreview } from '@cherishron/sacode-client-core';
import { marked } from 'marked';
import { useDesktopApp } from '../composables/useDesktopApp';
import FileGlyph from './FileGlyph.vue';
import { highlightLanguage, previewMode, sortTreeEntries } from '../utils/file-kind';

/**
 * FilesSidePanel — 格内 absolute scrim + 侧板（非整页抽屉）。
 * 优先 /workspace/list 懒加载；404 时回退 capabilities 一次性索引。
 * 排序：文件夹优先 → 名称。预览：Markdown 渲染 / 代码高亮。
 */
const props = defineProps<{
  open: boolean;
  embedded?: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
}>();

const { app, workspace } = useDesktopApp();

type TreeRow = {
  path: string;
  name: string;
  isDir: boolean;
  depth: number;
  size: number;
};

const filter = ref('');
const rows = ref<TreeRow[]>([]);
const expanded = ref(new Set<string>());
const childrenCache = ref(new Map<string, TreeRow[]>());
const selectedPath = ref<string | null>(null);
const preview = ref<WorkspaceFilePreview | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const panelWidth = ref(520);
const treeWidth = ref(220);
const dragging = ref(false);
const resizingTree = ref(false);

function sortRows(list: TreeRow[]): TreeRow[] {
  return sortTreeEntries(list) as TreeRow[];
}

function buildTreeFromIndex(files: { path: string; size: number; is_dir: boolean }[]): TreeRow[] {
  const entries = new Map<string, TreeRow>();
  for (const file of files) {
    const path = file.path.replace(/\\/g, '/');
    const parts = path.split('/').filter(Boolean);
    let acc = '';
    for (let i = 0; i < parts.length; i++) {
      acc = i === 0 ? parts[0]! : `${acc}/${parts[i]}`;
      const isLast = i === parts.length - 1;
      if (!entries.has(acc)) {
        entries.set(acc, {
          path: acc,
          name: parts[i]!,
          isDir: isLast ? file.is_dir : true,
          depth: i,
          size: isLast ? file.size : 0,
        });
      }
    }
  }
  return [...entries.values()];
}

async function loadChildren(parent: string, depth: number): Promise<TreeRow[]> {
  if (!app.client) return [];
  try {
    const data = await app.client.listWorkspaceDir(parent);
    return sortRows(
      data.entries.map((e) => ({
        path: e.path,
        name: e.name,
        isDir: e.is_dir,
        depth,
        size: e.size,
      })),
    );
  } catch {
    // 旧 daemon 无 /workspace/list → 用 capabilities 索引建树
    const caps = await app.client.getWorkspaceCapabilities();
    app.workspaceCapabilities = caps;
    const tree = buildTreeFromIndex(caps.files ?? []);
    const want = tree.filter((r) => r.depth === depth);
    if (!parent) return sortRows(want);
    return sortRows(
      want.filter(
        (r) =>
          r.path.startsWith(`${parent}/`) &&
          !r.path.slice(parent.length + 1).includes('/'),
      ),
    );
  }
}

function rebuild() {
  const out: TreeRow[] = [];
  const q = filter.value.trim().toLowerCase();
  const walk = (parent: string, depth: number) => {
    for (const row of childrenCache.value.get(parent) ?? []) {
      if (q && !row.isDir && !row.name.toLowerCase().includes(q)) continue;
      out.push(row);
      if (row.isDir && expanded.value.has(row.path)) walk(row.path, depth + 1);
    }
  };
  walk('', 0);
  rows.value = out;
}

async function loadRoot() {
  if (!app.client) return;
  loading.value = true;
  error.value = null;
  try {
    let root = await loadChildren('', 0);
    if (root.length === 0) {
      const caps = await app.client.getWorkspaceCapabilities();
      app.workspaceCapabilities = caps;
      const tree = buildTreeFromIndex(caps.files ?? []);
      root = sortRows(tree.filter((r) => r.depth === 0));
      for (const node of tree) {
        if (node.depth === 0) continue;
        const parent = node.path.includes('/')
          ? node.path.slice(0, node.path.lastIndexOf('/'))
          : '';
        const list = childrenCache.value.get(parent) ?? [];
        if (!list.some((x) => x.path === node.path)) list.push(node);
        childrenCache.value.set(parent, sortRows(list));
      }
    }
    childrenCache.value.set('', root);
    rebuild();
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) void loadRoot();
  },
  { immediate: true },
);

watch(filter, () => rebuild());

async function toggle(row: TreeRow) {
  if (!row.isDir) {
    void openFile(row.path);
    return;
  }
  const next = new Set(expanded.value);
  if (next.has(row.path)) {
    next.delete(row.path);
  } else {
    next.add(row.path);
    if (!childrenCache.value.has(row.path)) {
      loading.value = true;
      try {
        childrenCache.value.set(row.path, await loadChildren(row.path, row.depth + 1));
      } catch (e) {
        error.value = String(e);
      } finally {
        loading.value = false;
      }
    }
  }
  expanded.value = next;
  rebuild();
}

async function openFile(path: string) {
  if (!app.client) return;
  selectedPath.value = path;
  preview.value = null;
  error.value = null;
  loading.value = true;
  try {
    preview.value = await app.client.getWorkspaceFile(path);
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
  return `${(size / 1024 / 1024).toFixed(1)} MiB`;
}

function onResizeStart(e: PointerEvent) {
  if (e.button !== 0) return;
  dragging.value = true;
  const startX = e.clientX;
  const startW = panelWidth.value;
  const move = (ev: PointerEvent) => {
    panelWidth.value = Math.min(880, Math.max(320, startW + (startX - ev.clientX)));
  };
  const up = () => {
    dragging.value = false;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

/** 文件树 ↔ 预览 内部分隔（拖宽；嵌套在工具栏里也一样） */
function onTreeResizeStart(e: PointerEvent) {
  if (e.button !== 0) return;
  resizingTree.value = true;
  const startX = e.clientX;
  const startW = treeWidth.value;
  const move = (ev: PointerEvent) => {
    treeWidth.value = Math.min(480, Math.max(140, startW + (ev.clientX - startX)));
  };
  const up = () => {
    resizingTree.value = false;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

const previewLang = computed(() => {
  if (!preview.value) return null;
  return highlightLanguage(preview.value.path);
});

const previewKind = computed(() => {
  if (!preview.value) return 'text' as const;
  return previewMode(preview.value.path);
});

/** 渲染器懒加载完成后置 1，驱动 previewHtml 重算 */
const renderersReady = ref(0);

type HljsApi = {
  highlight: (code: string, opts: { language: string; ignoreIllegals?: boolean }) => { value: string };
  getLanguage: (name: string) => unknown;
  registerLanguage: (name: string, def: (hljs: unknown) => unknown) => void;
};

let markedParse: ((src: string) => string) | null = null;
let purifySanitize: ((html: string) => string) | null = null;
let hljsApi: HljsApi | null = null;
let renderersPromise: Promise<void> | null = null;

const LANG_LOADERS: Array<[string, () => Promise<unknown>]> = [
  ['rust', () => import('highlight.js/lib/languages/rust')],
  ['typescript', () => import('highlight.js/lib/languages/typescript')],
  ['javascript', () => import('highlight.js/lib/languages/javascript')],
  ['json', () => import('highlight.js/lib/languages/json')],
  ['css', () => import('highlight.js/lib/languages/css')],
  ['scss', () => import('highlight.js/lib/languages/scss')],
  ['less', () => import('highlight.js/lib/languages/less')],
  ['xml', () => import('highlight.js/lib/languages/xml')],
  ['markdown', () => import('highlight.js/lib/languages/markdown')],
  ['python', () => import('highlight.js/lib/languages/python')],
  ['go', () => import('highlight.js/lib/languages/go')],
  ['java', () => import('highlight.js/lib/languages/java')],
  ['kotlin', () => import('highlight.js/lib/languages/kotlin')],
  ['c', () => import('highlight.js/lib/languages/c')],
  ['cpp', () => import('highlight.js/lib/languages/cpp')],
  ['csharp', () => import('highlight.js/lib/languages/csharp')],
  ['php', () => import('highlight.js/lib/languages/php')],
  ['ruby', () => import('highlight.js/lib/languages/ruby')],
  ['bash', () => import('highlight.js/lib/languages/bash')],
  ['powershell', () => import('highlight.js/lib/languages/powershell')],
  ['sql', () => import('highlight.js/lib/languages/sql')],
  ['yaml', () => import('highlight.js/lib/languages/yaml')],
  ['ini', () => import('highlight.js/lib/languages/ini')],
  ['dockerfile', () => import('highlight.js/lib/languages/dockerfile')],
];

function ensureRenderers(): Promise<void> {
  if (renderersPromise) return renderersPromise;
  renderersPromise = (async () => {
    const [purifyMod, hljsMod] = await Promise.all([
      import('dompurify'),
      import('highlight.js/lib/core'),
    ]);
    const hljs = ((hljsMod as { default?: HljsApi }).default ?? hljsMod) as HljsApi;
    for (const [name, load] of LANG_LOADERS) {
      const mod = (await load()) as { default?: unknown };
      const def = mod.default ?? mod;
      try {
        hljs.registerLanguage(name, def as (h: unknown) => unknown);
      } catch {
        /* ignore duplicate / invalid language */
      }
    }
    hljsApi = hljs;
    markedParse = (src) =>
      String(marked.parse(src, { async: false, gfm: true, breaks: true }));
    const purify = (purifyMod as { default?: { sanitize: (h: string) => string } }).default;
    purifySanitize = (html) => (purify ? purify.sanitize(html) : html);
    renderersReady.value = 1;
  })();
  return renderersPromise;
}

function highlightCode(code: string, language: string | null): string {
  if (!hljsApi || !language || !hljsApi.getLanguage(language)) {
    return escapeHtml(code);
  }
  try {
    return hljsApi.highlight(code, { language, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(code);
  }
}

function renderMarkdown(src: string): string {
  if (!markedParse || !purifySanitize) return escapeHtml(src);
  return purifySanitize(markedParse(src));
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

const previewHtml = computed(() => {
  void renderersReady.value;
  if (!preview.value || !preview.value.content) return '';
  if (previewKind.value === 'markdown') return renderMarkdown(preview.value.content);
  if (previewKind.value === 'code') return highlightCode(preview.value.content, previewLang.value);
  return '';
});

watch(
  [preview, previewKind],
  () => {
    if (preview.value) void ensureRenderers();
  },
  { immediate: true },
);
</script>

<template>
  <!-- embedded 时由工具栏 v-show 控制可见，保持文件树状态 -->
  <template v-if="embedded || open">
    <div v-if="!embedded" class="files-scrim" @click="emit('update:open', false)" />
    <aside
      class="files-side-panel files-panel--pretty"
      :class="{ dragging, 'tools-embedded': embedded }"
      :style="embedded ? {} : { width: `${panelWidth}px` }"
    >
      <div v-if="!embedded" class="files-resizer" @pointerdown.prevent="onResizeStart" />
      <header class="files-head">
        <FileGlyph name="工作区" is-dir :size="15" />
        <span class="files-title">文件</span>
        <span class="files-path muted" :title="workspace">{{ workspace || '工作区' }}</span>
        <span style="flex: 1" />
        <button class="ghost-btn" type="button" title="刷新" @click="loadRoot">
          <RefreshIcon size="13" />
        </button>
        <button v-if="!embedded" class="ghost-btn" type="button" title="关闭" @click="emit('update:open', false)">
          <CloseIcon size="13" />
        </button>
      </header>

      <div class="files-body">
        <aside class="files-tree-pane" :style="{ width: `${treeWidth}px`, flex: '0 0 auto' }">
          <div class="files-search-wrap">
            <SearchIcon size="13" />
            <input
              v-model="filter"
              class="files-search-input"
              placeholder="搜索文件"
              spellcheck="false"
            />
          </div>
          <div class="scroll-y files-tree">
            <div v-if="loading && !rows.length" class="files-empty">加载中…</div>
            <div v-else-if="error" class="files-error">{{ error }}</div>
            <div v-else-if="!rows.length" class="files-empty">无文件</div>
            <div
              v-for="row in rows"
              :key="row.path"
              class="file-row list-row"
              :class="{ selected: row.path === selectedPath, dir: row.isDir }"
              :style="{ paddingLeft: `${10 + row.depth * 16}px` }"
              @click="toggle(row)"
            >
              <span class="list-row-icon">
                <FileGlyph
                  :name="row.name"
                  :is-dir="row.isDir"
                  :expanded="row.isDir && expanded.has(row.path)"
                  :size="14"
                />
              </span>
              <span class="list-row-label">{{ row.name }}</span>
              <span v-if="!row.isDir && row.size" class="file-size muted">{{ formatBytes(row.size) }}</span>
            </div>
          </div>
        </aside>

        <div
          class="tools-inner-resizer files-split-resizer"
          :class="{ dragging: resizingTree }"
          role="separator"
          aria-label="调整文件树宽度"
          aria-orientation="vertical"
          tabindex="0"
          @pointerdown.prevent="onTreeResizeStart"
          @keydown.left.prevent="treeWidth = Math.max(140, treeWidth - 12)"
          @keydown.right.prevent="treeWidth = Math.min(480, treeWidth + 12)"
        />

        <section class="files-preview-pane">
          <template v-if="preview">
            <header class="files-preview-head">
              <FileGlyph :name="preview.path" :size="13" />
              <span class="mono" :title="preview.path">{{ preview.path }}</span>
              <span v-if="previewLang" class="preview-lang">{{ previewLang }}</span>
              <span class="muted">{{ formatBytes(preview.size) }}</span>
            </header>

            <!-- Markdown 富预览 -->
            <div
              v-if="previewKind === 'markdown' && preview.content"
              class="files-preview-body files-preview-md scroll-y md-body"
              v-html="previewHtml"
            />

            <!-- 代码语法高亮 -->
            <pre
              v-else-if="previewKind === 'code' && previewLang && preview.content"
              class="files-preview-body scroll-y"
            ><code class="hljs" v-html="previewHtml" /></pre>

            <!-- 纯文本 / 未知后缀 -->
            <pre
              v-else-if="preview.content"
              class="files-preview-body scroll-y"
            >{{ preview.content }}</pre>

            <div v-else class="files-empty">二进制或无文本内容</div>
          </template>
          <div v-else class="files-empty files-empty--preview">
            <FileGlyph name="file" :size="28" />
            <p>选择左侧文件以只读预览</p>
          </div>
        </section>
      </div>
    </aside>
  </template>
</template>
