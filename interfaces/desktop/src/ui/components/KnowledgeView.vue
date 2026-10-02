<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { KnowledgeHit, KnowledgeNote } from '@cherishron/sacode-client-core';
import { useDesktopApp } from '../composables/useDesktopApp';
import {
  ensureMarkdownRenderers,
  markdownRenderersReady,
  renderMarkdown,
} from '../logic/markdown.ts';

const props = defineProps<{ active: boolean }>();
const emit = defineEmits<{ close: [] }>();
const { app, connection } = useDesktopApp();
const scope = ref<'user' | 'project'>('project');
const query = ref('');
const entries = ref<KnowledgeNote[]>([]);
const hits = ref<KnowledgeHit[]>([]);
const selected = ref<KnowledgeNote | null>(null);
const title = ref('');
const content = ref('');
const editing = ref(false);
const loading = ref(false);
const busy = ref(false);
const error = ref('');
const notice = ref('');
let generation = 0;

// ── 可拖分隔线（左列表 / 右详情） ──────────────────────────
const LIST_WIDTH_KEY = 'sacode.knowledge.listWidth';
function loadListWidth(): number {
  try {
    const raw = Number(localStorage.getItem(LIST_WIDTH_KEY));
    return Number.isFinite(raw) ? Math.min(520, Math.max(200, raw)) : 300;
  } catch {
    return 300;
  }
}
const listWidth = ref(loadListWidth());
const draggingDivider = ref(false);

function persistListWidth() {
  try {
    localStorage.setItem(LIST_WIDTH_KEY, String(Math.round(listWidth.value)));
  } catch {
    /* ignore */
  }
}

function onDividerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  draggingDivider.value = true;
  const startX = e.clientX;
  const startW = listWidth.value;
  const move = (ev: PointerEvent) => {
    const next = startW + (ev.clientX - startX);
    listWidth.value = Math.min(520, Math.max(200, next));
  };
  const up = () => {
    draggingDivider.value = false;
    persistListWidth();
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function resetListWidth() {
  listWidth.value = 300;
  persistListWidth();
}

// ── Markdown 渲染（契约：正文渲染，不直接展示源文） ────────
const mdReady = ref(markdownRenderersReady());
const renderedContent = computed(() => {
  void mdReady.value;
  return renderMarkdown(selected.value?.content ?? '');
});

function message(e: unknown): string { return e instanceof Error ? e.message : String(e); }
async function refresh() {
  const current = ++generation;
  loading.value = true;
  error.value = '';
  try {
    const result = query.value.trim()
      ? await app.searchKnowledge(query.value.trim(), scope.value)
      : await app.refreshKnowledge(scope.value);
    if (current !== generation) return;
    if (query.value.trim()) hits.value = result as KnowledgeHit[];
    else entries.value = result as KnowledgeNote[];
  } catch (e) { if (current === generation) error.value = message(e); }
  finally { if (current === generation) loading.value = false; }
}
async function open(id: string) {
  const current = generation;
  error.value = '';
  try {
    const note = await app.getKnowledgeNote(id, scope.value);
    if (current !== generation) return;
    selected.value = note;
    title.value = note.title;
    content.value = note.content ?? '';
    editing.value = false;
    void ensureMarkdownRenderers().then(() => { mdReady.value = true; });
  } catch (e) { if (current === generation) error.value = message(e); }
}
function newNote() {
  selected.value = null;
  title.value = '';
  content.value = '';
  editing.value = true;
  notice.value = '';
}
async function save() {
  if (!title.value.trim()) { error.value = '请填写标题'; return; }
  busy.value = true;
  error.value = '';
  try {
    const note = await app.saveKnowledgeNote({ id: selected.value?.id, updated_at: selected.value?.updated_at, scope: scope.value, title: title.value.trim(), content: content.value });
    selected.value = note;
    editing.value = false;
    notice.value = '笔记已保存';
    await refresh();
    void ensureMarkdownRenderers().then(() => { mdReady.value = true; });
  } catch (e) { error.value = message(e); }
  finally { busy.value = false; }
}
async function remove() {
  if (!selected.value || selected.value.readonly || !window.confirm(`删除笔记“${selected.value.title}”？此操作无法撤销。`)) return;
  busy.value = true;
  error.value = '';
  try {
    await app.deleteKnowledgeNote(selected.value.id, scope.value);
    selected.value = null;
    editing.value = false;
    notice.value = '笔记已删除';
    await refresh();
  } catch (e) { error.value = message(e); }
  finally { busy.value = false; }
}
watch([scope, () => props.active], () => {
  generation++;
  selected.value = null;
  editing.value = false;
  notice.value = '';
  if (props.active) void refresh();
}, { immediate: true });
watch(query, () => { if (props.active) void refresh(); });
</script>

<template>
  <section class="feature-overlay" aria-label="知识库" @click.self="emit('close')">
    <div class="feature-panel">
      <header class="feature-panel-head">
        <div class="feature-panel-title">
          <span class="feature-eyebrow">WORKSPACE / KNOWLEDGE</span>
          <h1>知识库</h1>
        </div>
        <div class="feature-actions">
          <button class="feature-button primary" type="button" @click="newNote">新建笔记</button>
          <button class="ghost-btn" type="button" title="关闭" aria-label="关闭知识库" @click="emit('close')">×</button>
        </div>
      </header>
      <div class="feature-toolbar">
        <label>范围 <select v-model="scope"><option value="project">当前项目</option><option value="user">个人知识库</option></select></label>
        <label class="feature-search">搜索 <input v-model="query" type="search" placeholder="搜索标题与正文" /></label>
        <button class="feature-button" type="button" @click="refresh">刷新</button>
      </div>
      <p v-if="connection !== 'healthy'" class="feature-hint" role="status">守护进程尚未就绪；连接后可重试。</p>
      <p v-if="error" class="feature-error" role="alert">{{ error }} <button type="button" @click="refresh">重试</button></p>
      <p v-if="notice" class="feature-hint" role="status">{{ notice }}</p>

      <!-- 左列表 + 可拖分隔线 + 右详情（页壳不滚，内容区自身 .scroll-y） -->
      <div class="knowledge-split" :class="{ dragging: draggingDivider }">
        <div class="feature-list knowledge-list scroll-y" :style="{ width: `${listWidth}px` }" aria-label="笔记列表">
          <p v-if="loading" class="feature-empty">正在加载…</p>
          <template v-else>
            <button v-for="item in (query.trim() ? hits : entries)" :key="item.id" type="button" class="feature-row" :class="{ selected: selected?.id === item.id }" @click="open(item.id)">
              <strong>{{ item.title }}</strong><small>{{ item.readonly ? '只读文档' : item.scope === 'project' ? '项目笔记' : '个人笔记' }}</small>
              <span v-if="'snippet' in item && item.snippet" class="feature-snippet">{{ item.snippet }}</span>
            </button>
            <p v-if="!(query.trim() ? hits : entries).length" class="feature-empty">{{ query ? '没有找到匹配内容' : '这里还没有笔记，点击“新建笔记”开始。' }}</p>
          </template>
        </div>

        <div
          class="knowledge-divider"
          :class="{ dragging: draggingDivider }"
          title="拖动调宽，双击复位"
          @pointerdown.prevent="onDividerDown"
          @dblclick="resetListWidth"
        />

        <div class="feature-detail knowledge-detail scroll-y">
          <form v-if="editing" class="feature-form" @submit.prevent="save">
            <label>标题 <input v-model="title" required maxlength="200" placeholder="笔记标题" /></label>
            <label>正文（Markdown） <textarea v-model="content" rows="14" placeholder="写下内容…" /></label>
            <div class="feature-actions"><button class="feature-button primary" type="submit" :disabled="busy">{{ busy ? '保存中…' : '保存笔记' }}</button><button class="feature-button" type="button" @click="editing = false">取消</button></div>
          </form>
          <template v-else-if="selected">
            <div class="feature-detail-head"><div><small>{{ selected.readonly ? '项目文档 · 只读' : '笔记' }}</small><h2>{{ selected.title }}</h2></div><div v-if="!selected.readonly" class="feature-actions"><button class="feature-button" type="button" @click="editing = true">编辑</button><button class="feature-button danger" type="button" :disabled="busy" @click="remove">删除</button></div></div>
            <!-- Markdown 渲染（非源文） -->
            <div v-if="selected.content" class="feature-document md-body" v-html="renderedContent" />
            <p v-else class="feature-empty">暂无正文</p>
          </template>
          <p v-else class="feature-empty">选择左侧条目查看内容，或创建一条新笔记。</p>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* 左列表 / 可拖分隔线 / 右详情
 * 契约：页壳不滚，内容区自身 .scroll-y（禁止 min-height 撑破壳） */
.knowledge-split {
  display: flex;
  align-items: stretch;
  flex: 1;
  min-height: 0;
  border-top: 1px solid var(--border-weak);
}
.knowledge-list {
  flex: 0 0 auto;
  border-right: 0;
  padding-right: 16px;
  min-width: 200px;
  min-height: 0;
}
.knowledge-divider {
  flex: 0 0 var(--handle-hit, 8px);
  margin: 0 calc(var(--handle-hit, 8px) / -2 + var(--divider, 1px) / 2);
  cursor: col-resize;
  background: transparent;
  border-left: var(--divider, 1px) solid var(--border-weak);
  z-index: 2;
}
.knowledge-divider:hover,
.knowledge-divider.dragging {
  background: var(--accent-weaker);
  border-left-color: var(--accent);
}
.knowledge-split.dragging {
  cursor: col-resize;
  user-select: none;
}
.knowledge-detail {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

/* Markdown 正文（与 files-preview-md 同族度量） */
.md-body {
  white-space: normal;
  overflow-wrap: anywhere;
}
.md-body :deep(> :first-child) {
  margin-top: 0;
}
.md-body :deep(> :last-child) {
  margin-bottom: 0;
}
.md-body :deep(h1),
.md-body :deep(h2),
.md-body :deep(h3),
.md-body :deep(h4),
.md-body :deep(h5),
.md-body :deep(h6) {
  margin: 1.1em 0 0.5em;
  line-height: 1.3;
  font-weight: 600;
}
.md-body :deep(h1) { font-size: 1.45em; }
.md-body :deep(h2) { font-size: 1.28em; }
.md-body :deep(h3) { font-size: 1.12em; }
.md-body :deep(h4) { font-size: 1.02em; }
.md-body :deep(h5),
.md-body :deep(h6) { font-size: 0.95em; }
.md-body :deep(p),
.md-body :deep(ul),
.md-body :deep(ol),
.md-body :deep(blockquote),
.md-body :deep(pre),
.md-body :deep(table) {
  margin: 0.7em 0;
}
.md-body :deep(ul),
.md-body :deep(ol) {
  padding-left: 1.5em;
}
.md-body :deep(li + li) {
  margin-top: 0.25em;
}
.md-body :deep(a) {
  color: var(--accent-fg, var(--accent));
}
.md-body :deep(code) {
  padding: 0.12em 0.36em;
  border-radius: 4px;
  background: var(--bg-raised);
  font-size: 0.92em;
}
.md-body :deep(pre) {
  padding: 12px 14px;
  border-radius: 6px;
  background: var(--bg-raised);
  overflow-x: auto;
}
.md-body :deep(pre code) {
  padding: 0;
  background: transparent;
}
.md-body :deep(blockquote) {
  margin-left: 0;
  padding-left: 12px;
  border-left: 2px solid var(--border-weak);
  color: var(--text-weak);
}
.md-body :deep(hr) {
  margin: 1.2em 0;
  border: 0;
  border-top: 1px solid var(--border-weak);
}
.md-body :deep(table) {
  border-collapse: collapse;
  width: 100%;
}
.md-body :deep(th),
.md-body :deep(td) {
  padding: 6px 10px;
  border: 1px solid var(--border-weak);
  text-align: left;
}
.md-body :deep(th) {
  background: var(--bg-raised);
}
.md-body :deep(img) {
  max-width: 100%;
}

@media (max-width: 768px) {
  .knowledge-split {
    flex-direction: column;
  }
  .knowledge-list {
    width: 100% !important;
    max-height: 240px;
    border-right: 0;
    border-bottom: 1px solid var(--border-weak);
  }
  .knowledge-divider {
    display: none;
  }
}
</style>
