<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  AddIcon,
  FolderIcon,
  FolderOpenIcon,
  MenuFoldIcon,
  MenuUnfoldIcon,
  SettingIcon,
  BookIcon,
  CalendarIcon,
  SearchIcon,
} from 'tdesign-icons-vue-next';
import { useDesktopApp } from '../composables/useDesktopApp';
import { loadDesktopPreferences, type ConversationMode } from '../logic/preferences.ts';
import { LOAD_MIME } from '../logic/split-slots.ts';
import { filterSessionsByQuery } from '../logic/session-search.ts';
import { updateUnreadSessions } from '../logic/session-visibility.ts';
import {
  archiveConversation,
  deleteConversation,
  readLocalArchived,
  renameConversation,
  restoreConversation,
} from '../logic/conversation-manage.ts';

const prefs = loadDesktopPreferences();
const nickname = prefs.nickname || 'SaCode 用户';
const avatarChar = (nickname.trim().slice(0, 1) || 'S').toUpperCase();

const groupOpen = ref(true);

const collapsed = ref(false);

function toggleCollapse() {
  collapsed.value = !collapsed.value;
  emit('collapsed', collapsed.value);
}

// ── 头像便捷浮窗（契约：绝对定位 popper 卡，点外部关闭） ──────
const userPopperOpen = ref(false);
const userPopperRef = ref<HTMLElement | null>(null);
const userAnchorRef = ref<HTMLElement | null>(null);
const accountState = ref<'unknown' | 'local' | 'logged-in'>('unknown');
const accountSubject = ref('');
const accountBusy = ref(false);

const modeLabelMap: Record<ConversationMode, string> = {
  plan: 'Plan 规划',
  build: 'Build 构建',
  yolo: 'YOLO 自动',
};
const modeLabel = computed(() => modeLabelMap[prefs.defaultMode as ConversationMode] ?? 'Build 构建');

const accountLabel = computed(() => {
  if (accountState.value === 'logged-in') return accountSubject.value || '已登录';
  if (accountState.value === 'local') return '本地模式';
  return '检测中…';
});

async function refreshAccountBrief() {
  if (!app.client) {
    accountState.value = 'local';
    return;
  }
  accountBusy.value = true;
  try {
    const res = await app.client.accountStatus();
    if (res.account?.logged_in) {
      accountState.value = 'logged-in';
      accountSubject.value = res.account.subject || '已登录';
    } else {
      accountState.value = 'local';
      accountSubject.value = '';
    }
  } catch {
    accountState.value = 'local';
    accountSubject.value = '';
  } finally {
    accountBusy.value = false;
  }
}

function toggleUserPopper() {
  userPopperOpen.value = !userPopperOpen.value;
  if (userPopperOpen.value) void refreshAccountBrief();
}

function closeUserPopper() {
  userPopperOpen.value = false;
}

function onOpenSettingsFromPopper() {
  closeUserPopper();
  emit('openSettings');
}

async function onLogoutFromPopper() {
  if (accountBusy.value) return;
  closeUserPopper();
  if (!app.client || accountState.value !== 'logged-in') return;
  accountBusy.value = true;
  try {
    await app.client.accountLogout();
    accountState.value = 'local';
    accountSubject.value = '';
  } catch {
    /* 浮窗级操作失败静默；详情在设置页呈现 */
  } finally {
    accountBusy.value = false;
  }
}

function onGlobalPointerDown(ev: PointerEvent) {
  closeMenu();
  // 点浮窗外部关闭（浮窗内部点击用 @click.stop 阻断）
  if (!userPopperOpen.value) return;
  const target = ev.target as Node | null;
  if (target && userPopperRef.value?.contains(target)) return;
  if (target && userAnchorRef.value?.contains(target)) return;
  closeUserPopper();
}

const WIDTH_KEY = 'sacode.workbench.listWidth';
function loadWidth(): number {
  try {
    const raw = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(raw) ? Math.min(420, Math.max(184, raw)) : 232;
  } catch {
    return 232;
  }
}
const width = ref(loadWidth());
const dragging = ref(false);

function persistWidth() {
  try {
    localStorage.setItem(WIDTH_KEY, String(Math.round(width.value)));
  } catch {
    /* ignore */
  }
}

function resetWidth() {
  width.value = 232;
  persistWidth();
}

const {
  start,
  projectGroup,
  selectedId,
  connection,
  loading,
  conversations,
  workspace,
  app,
  refreshConversations,
} = useDesktopApp();

/** 组名只用目录名，完整路径进 title */
const groupName = computed(() => {
  const path = projectGroup.value.path || projectGroup.value.name || '未命名项目';
  const base = path.replace(/\\/g, '/').split('/').filter(Boolean).pop();
  return base || '未命名项目';
});

/** 已入格会话：行带标记（契约） */
const props = defineProps<{
  loadedIds?: string[];
  activeView: 'sessions' | 'knowledge' | 'automation';
}>();

const emit = defineEmits<{
  openSettings: [];
  newTask: [];
  select: [id: string];
  newInProject: [];
  collapsed: [value: boolean];
  changeView: [view: 'sessions' | 'knowledge' | 'automation'];
}>();

const waitingCount = computed(() =>
  projectGroup.value.sessions.filter((s) => s.tone === 'running').length,
);

function onSelect(id: string) {
  if (renamingId.value === id) return;
  emit('select', id);
  // 契约 §3.3：会话在分格中可见 → 立即清未读
  if (unreadIds.value.delete(id)) unreadIds.value = new Set(unreadIds.value);
}

/** P2-7：把会话拖到某个格位装载（LOAD_MIME） */
function onSessionDragStart(id: string, ev: DragEvent) {
  ev.dataTransfer?.setData(LOAD_MIME, id);
  if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
}

function onResizeStart(e: PointerEvent) {
  if (e.button !== 0) return;
  dragging.value = true;
  const startX = e.clientX;
  const startW = width.value;
  const move = (ev: PointerEvent) => {
    const next = startW + (ev.clientX - startX);
    width.value = Math.min(420, Math.max(184, next));
  };
  const up = () => {
    dragging.value = false;
    persistWidth();
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

// ── 搜索（契约 §3.2：title + preview 子串匹配） ──────────────
const searchQuery = ref('');

/** daemon 提供 preview 后（Agent4）自动用上；此前只匹配 title。 */
function previewOf(id: string): string {
  const raw = conversations.value.find((c) => c.id === id) as
    | (typeof conversations.value)[number]
    | undefined;
  return (raw as { preview?: string } | undefined)?.preview ?? '';
}

const decoratedSessions = computed(() =>
  projectGroup.value.sessions.map((session) => ({
    ...session,
    preview: previewOf(session.id),
  })),
);

const filteredSessions = computed(() =>
  filterSessionsByQuery(decoratedSessions.value, searchQuery.value),
);

// ── 归档区（本地集合；API 就绪后改读会话 archived 字段） ─────
const showArchived = ref(false);
const archivedIds = ref<Set<string>>(new Set());

function refreshArchived() {
  archivedIds.value = readLocalArchived(workspace.value || app.workspace || '');
}

const activeSessions = computed(() =>
  filteredSessions.value.filter((s) => !archivedIds.value.has(s.id)),
);
const archivedSessions = computed(() =>
  filteredSessions.value.filter((s) => archivedIds.value.has(s.id)),
);

// ── 未读（契约 §3.3：行首 2px warning 竖条） ─────────────────
const unreadIds = ref<Set<string>>(new Set());
const previousStatuses = new Map<string, string>();

function visibleIdSet(): Set<string> {
  return new Set(props.loadedIds ?? []);
}

watch(
  () => projectGroup.value.sessions.map((s) => `${s.id}:${s.status}`).join('|'),
  () => {
    updateUnreadSessions(
      previousStatuses,
      unreadIds.value,
      projectGroup.value.sessions.map((s) => ({ id: s.id, status: s.status })),
      visibleIdSet(),
    );
    unreadIds.value = new Set(unreadIds.value);
  },
  { immediate: true },
);

watch(
  () => props.loadedIds,
  (ids) => {
    if (!ids?.length) return;
    let changed = false;
    for (const id of ids) {
      if (unreadIds.value.delete(id)) changed = true;
    }
    if (changed) unreadIds.value = new Set(unreadIds.value);
  },
  { deep: true },
);

// ── 右键菜单 ─────────────────────────────────────────────────
const menu = ref<{ x: number; y: number; id: string } | null>(null);

function onContextMenu(sessionId: string, ev: MouseEvent) {
  ev.preventDefault();
  ev.stopPropagation();
  // 钳制在视口内，避免贴边截断
  const x = Math.min(ev.clientX, window.innerWidth - 168);
  const y = Math.min(ev.clientY, window.innerHeight - 132);
  menu.value = { x, y, id: sessionId };
  if (renamingId.value && renamingId.value !== sessionId) cancelRename();
}

function closeMenu() {
  menu.value = null;
}

onMounted(() => {
  window.addEventListener('pointerdown', onGlobalPointerDown);
  window.addEventListener('blur', closeMenu);
});
onUnmounted(() => {
  window.removeEventListener('pointerdown', onGlobalPointerDown);
  window.removeEventListener('blur', closeMenu);
});

// ── 重命名（契约 PUT /api/desktop/conversations/:id） ────────
const renamingId = ref<string | null>(null);
const renamingText = ref('');
const manageError = ref('');

function startRename(id: string) {
  const session = projectGroup.value.sessions.find((s) => s.id === id);
  renamingId.value = id;
  renamingText.value = session?.title ?? '';
  menu.value = null;
}

function cancelRename() {
  renamingId.value = null;
  renamingText.value = '';
}

async function commitRename() {
  const id = renamingId.value;
  const title = renamingText.value.trim();
  if (!id) return;
  if (!title) {
    manageError.value = '标题不能为空';
    return;
  }
  manageError.value = '';
  try {
    await renameConversation(app.client, id, title);
    cancelRename();
    await refreshConversations();
  } catch (e) {
    manageError.value = e instanceof Error ? e.message : String(e);
  }
}

// ── 归档 / 恢复 / 删除 ──────────────────────────────────────
async function onArchive(id: string) {
  menu.value = null;
  manageError.value = '';
  try {
    await archiveConversation(
      app.client,
      id,
      workspace.value || app.workspace || '',
    );
    refreshArchived();
  } catch (e) {
    manageError.value = e instanceof Error ? e.message : String(e);
  }
}

async function onRestore(id: string) {
  menu.value = null;
  manageError.value = '';
  try {
    await restoreConversation(
      app.client,
      id,
      workspace.value || app.workspace || '',
    );
    refreshArchived();
  } catch (e) {
    manageError.value = e instanceof Error ? e.message : String(e);
  }
}

async function onDelete(id: string) {
  menu.value = null;
  const session = projectGroup.value.sessions.find((s) => s.id === id);
  const label = session?.title || id.slice(0, 8);
  // 删除二次确认（契约 §3.2）
  if (!window.confirm(`删除会话「${label}」？此操作无法撤销。`)) return;
  manageError.value = '';
  try {
    await deleteConversation(app.client, id);
    if (unreadIds.value.delete(id)) unreadIds.value = new Set(unreadIds.value);
    refreshArchived();
    await refreshConversations();
  } catch (e) {
    manageError.value = e instanceof Error ? e.message : String(e);
  }
}

onMounted(() => {
  void start();
  refreshArchived();
});
</script>

<template>
  <aside
    class="task-col"
    :style="{ '--w-side': collapsed ? '56px' : `${width}px` }"
    :class="{ collapsed }"
  >
    <div class="task-col-brand">
      <span v-if="!collapsed" class="task-col-brand-name">SaCode</span>
      <div class="task-col-actions">
        <button
          class="ghost-btn"
          type="button"
          :title="collapsed ? '展开侧栏' : '收缩侧栏'"
          @click="toggleCollapse"
        >
          <MenuFoldIcon v-if="!collapsed" size="16" />
          <MenuUnfoldIcon v-else size="16" />
        </button>
        <button class="ghost-btn" type="button" title="新建" @click="emit('newTask')">
          <AddIcon size="14" />
        </button>
      </div>
    </div>

    <template v-if="!collapsed">
      <div class="task-col-tabs">
        <span class="task-col-tab-label">本地项目</span>
      </div>

      <!-- 搜索框：子串匹配 title + preview -->
      <div class="session-search">
        <SearchIcon size="12" class="session-search-icon" />
        <input
          v-model="searchQuery"
          type="search"
          class="session-search-input"
          placeholder="搜索会话…"
          aria-label="搜索会话"
        />
        <button
          v-if="searchQuery"
          class="ghost-btn session-search-clear"
          type="button"
          title="清空搜索"
          @click="searchQuery = ''"
        >
          ×
        </button>
      </div>

      <div class="task-col-list scroll-y">
        <template>
          <div class="task-group">
            <div class="group-label" @click="emit('changeView', 'sessions'); groupOpen = !groupOpen">
              <FolderOpenIcon v-if="groupOpen" size="12" />
              <FolderIcon v-else size="12" />
              <span class="group-label-title" :title="projectGroup.path">
                {{ groupName }}
              </span>
              <!-- waiting 徽标：仅 >0 时出现 -->
              <span v-if="waitingCount > 0" class="group-badge" :title="`${waitingCount} 运行中`">
                {{ waitingCount }}
              </span>
              <!-- hover「+」：常驻占位，invisible→visible -->
              <button
                class="ghost-btn group-add"
                type="button"
                title="在此新建"
                @click.stop="emit('newInProject')"
              >
                <AddIcon size="12" />
              </button>
            </div>
            <div v-if="groupOpen" class="group-body">
              <div
                v-if="projectGroup.sessions.length === 0"
                class="list-row"
                style="opacity: 0.55; cursor: default"
              >
                <span class="list-row-label">
                  {{ loading ? '加载中…' : connection === 'error' ? '守护进程未连接' : '暂无会话' }}
                </span>
              </div>
              <div
                v-else-if="activeSessions.length === 0"
                class="list-row"
                style="opacity: 0.55; cursor: default"
              >
                <span class="list-row-label">
                  {{ searchQuery ? '没有匹配的会话' : '暂无活跃会话' }}
                </span>
              </div>
              <div
                v-for="session in activeSessions"
                :key="session.id"
                class="list-row"
                :class="{
                  selected: session.id === selectedId,
                  attention: session.tone === 'failed',
                  loaded: props.loadedIds?.includes(session.id),
                  unread: unreadIds.has(session.id),
                }"
                :title="session.title"
                draggable="true"
                @dragstart="(e) => onSessionDragStart(session.id, e)"
                @click="onSelect(session.id)"
                @contextmenu="onContextMenu(session.id, $event)"
              >
                <span class="list-row-icon"><FolderIcon size="12" /></span>
                <!-- 重命名内联输入 -->
                <input
                  v-if="renamingId === session.id"
                  v-model="renamingText"
                  class="session-rename-input"
                  maxlength="60"
                  @click.stop
                  @keydown.enter.prevent="commitRename"
                  @keydown.esc.prevent="cancelRename"
                  @blur="commitRename"
                />
                <span v-else class="list-row-label">{{ session.title }}</span>
                <span class="list-row-status">
                  <span
                    v-if="props.loadedIds?.includes(session.id)"
                    class="list-loaded-mark"
                    title="已入格"
                  />
                  <span
                    class="status-dot"
                    :class="{
                      running: session.tone === 'running',
                      failed: session.tone === 'failed',
                    }"
                  />
                </span>
              </div>

              <!-- 归档区 -->
              <div v-if="archivedSessions.length || showArchived" class="archive-divider">
                <button
                  class="archive-toggle"
                  type="button"
                  @click="showArchived = !showArchived"
                >
                  {{ showArchived ? '▾' : '▸' }} 已归档
                  <span v-if="archivedSessions.length" class="group-badge">
                    {{ archivedSessions.length }}
                  </span>
                </button>
              </div>
              <template v-if="showArchived">
                <div
                  v-for="session in archivedSessions"
                  :key="`archived-${session.id}`"
                  class="list-row archived"
                  :class="{ selected: session.id === selectedId }"
                  :title="`${session.title}（已归档）`"
                  @click="onSelect(session.id)"
                  @contextmenu="onContextMenu(session.id, $event)"
                >
                  <span class="list-row-icon"><FolderIcon size="12" /></span>
                  <span class="list-row-label">{{ session.title }}</span>
                  <span class="list-row-status">
                    <button
                      class="ghost-btn restore-btn"
                      type="button"
                      title="恢复"
                      @click.stop="onRestore(session.id)"
                    >
                      ↩
                    </button>
                  </span>
                </div>
              </template>
            </div>
          </div>
        </template>
      </div>

      <p v-if="manageError" class="session-manage-error" role="alert">{{ manageError }}</p>
    </template>

    <div class="task-col-footer">
      <div class="task-col-footer-nav" role="navigation" aria-label="主视图">
        <button
          class="task-col-footer-link"
          type="button"
          title="知识库"
          aria-label="知识库"
          :aria-current="activeView === 'knowledge' ? 'page' : undefined"
          :class="{ selected: activeView === 'knowledge' }"
          @click="emit('changeView', 'knowledge')"
        >
          <BookIcon size="14" />
          <span v-if="!collapsed" class="task-col-footer-link-label">知识库</span>
        </button>
        <button
          class="task-col-footer-link"
          type="button"
          title="自动化"
          aria-label="自动化"
          :aria-current="activeView === 'automation' ? 'page' : undefined"
          :class="{ selected: activeView === 'automation' }"
          @click="emit('changeView', 'automation')"
        >
          <CalendarIcon size="14" />
          <span v-if="!collapsed" class="task-col-footer-link-label">自动化</span>
        </button>
      </div>
      <div class="task-col-footer-row">
        <button
          ref="userAnchorRef"
          class="task-col-user"
          type="button"
          title="账号与模式"
          aria-haspopup="dialog"
          :aria-expanded="userPopperOpen"
          @click.stop="toggleUserPopper"
        >
          <span class="task-col-avatar">{{ avatarChar }}</span>
          <span v-if="!collapsed" class="task-col-nickname">{{ nickname }}</span>
        </button>
        <button v-if="!collapsed" class="ghost-btn" type="button" title="设置" @click="$emit('openSettings')">
          <SettingIcon size="14" />
        </button>
      </div>

      <!-- 头像便捷浮窗：绝对定位 popper 卡（点外部关闭） -->
      <div
        v-if="userPopperOpen"
        ref="userPopperRef"
        class="user-popper"
        role="dialog"
        aria-label="账号与模式"
        @click.stop
        @pointerdown.stop
      >
        <div class="user-popper-head">
          <span class="task-col-avatar user-popper-avatar">{{ avatarChar }}</span>
          <div class="user-popper-id">
            <strong>{{ nickname }}</strong>
            <small>{{ accountLabel }}</small>
          </div>
        </div>
        <dl class="user-popper-meta">
          <dt>账号状态</dt>
          <dd>{{ accountLabel }}</dd>
          <dt>当前模式</dt>
          <dd>{{ modeLabel }}</dd>
        </dl>
        <div class="user-popper-actions">
          <button class="user-popper-item" type="button" @click="onOpenSettingsFromPopper">
            <SettingIcon size="14" />
            打开设置
          </button>
          <button
            class="user-popper-item danger"
            type="button"
            :disabled="accountBusy || accountState !== 'logged-in'"
            @click="onLogoutFromPopper"
          >
            退出登录
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="!collapsed"
      class="task-col-resizer"
      :class="{ dragging }"
      title="拖动调宽，双击复位"
      @pointerdown.prevent="onResizeStart"
      @dblclick="resetWidth"
    />

    <!-- 右键菜单（契约 §3.2：重命名 / 归档 / 恢复 / 删除） -->
    <div
      v-if="menu"
      class="session-ctx-menu"
      role="menu"
      :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
      @pointerdown.stop
      @contextmenu.prevent
    >
      <button type="button" role="menuitem" @click="startRename(menu.id)">重命名</button>
      <template v-if="archivedIds.has(menu.id)">
        <button type="button" role="menuitem" @click="onRestore(menu.id)">恢复</button>
      </template>
      <template v-else>
        <button type="button" role="menuitem" @click="onArchive(menu.id)">归档</button>
      </template>
      <button type="button" role="menuitem" class="danger" @click="onDelete(menu.id)">删除…</button>
    </div>
  </aside>
</template>

<style scoped>
/* 搜索框 */
.session-search {
  display: flex;
  align-items: center;
  gap: var(--space-2, 6px);
  margin: 0 var(--space-2, 6px) var(--list-gap, 4px);
  padding: 0 var(--space-2, 6px);
  min-height: var(--list-row-min, 28px);
  border: 1px solid var(--border-weak);
  border-radius: var(--radius-sm, 4px);
  background: var(--bg-base);
  color: var(--text-weak);
}
.session-search:focus-within {
  border-color: var(--accent);
}
.session-search-icon {
  flex-shrink: 0;
}
.session-search-input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text-strong);
  font-size: var(--list-font, 12px);
  line-height: var(--list-line, 1.45);
}
.session-search-input::placeholder {
  color: var(--text-weak);
}
.session-search-clear {
  flex-shrink: 0;
  padding: 0 4px;
  font-size: 12px;
  line-height: 1;
}

/* 未读：行首 2px warning 竖条（契约 layout：未读=行首 2px 竖条） */
.list-row.unread {
  position: relative;
}
.list-row.unread::before {
  content: '';
  position: absolute;
  left: 0;
  top: 3px;
  bottom: 3px;
  width: 2px;
  border-radius: 1px;
  background: var(--warning, #e0a100);
}

/* 重命名内联输入 */
.session-rename-input {
  flex: 1;
  min-width: 0;
  min-height: calc(var(--list-row-min, 28px) - var(--list-gap, 4px) * 2);
  padding: 0 4px;
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm, 4px);
  background: var(--bg-base);
  color: var(--text-strong);
  font-size: var(--list-font, 12px);
  outline: none;
}

/* 归档区 */
.archive-divider {
  margin-top: var(--space-2, 6px);
  border-top: 1px solid var(--border-weak);
  padding-top: var(--list-gap, 4px);
}
.archive-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 2px var(--space-2, 6px);
  border: 0;
  border-radius: var(--radius-sm, 4px);
  background: transparent;
  color: var(--text-weak);
  font-size: var(--list-font, 12px);
  line-height: var(--list-line, 1.45);
  cursor: pointer;
  text-align: left;
}
.archive-toggle:hover {
  background: var(--bg-surface);
  color: var(--text-strong);
}
.restore-btn {
  padding: 0 2px;
  font-size: 11px;
}

.session-manage-error {
  margin: 0;
  padding: var(--space-2, 6px) var(--space-3, 10px);
  color: var(--danger, #c65c5d);
  font-size: 11px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

/* 右键菜单 */
.session-ctx-menu {
  position: fixed;
  z-index: 1000;
  min-width: 148px;
  padding: 4px;
  border: 1px solid var(--border-weak);
  border-radius: var(--radius-sm, 4px);
  background: var(--bg-raised);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
  display: flex;
  flex-direction: column;
}
.session-ctx-menu button {
  display: block;
  width: 100%;
  padding: 6px 10px;
  border: 0;
  border-radius: var(--radius-sm, 4px);
  background: transparent;
  color: var(--text-strong);
  font-size: var(--list-font, 12px);
  line-height: var(--list-line, 1.45);
  text-align: left;
  cursor: pointer;
}
.session-ctx-menu button:hover {
  background: var(--accent-weaker);
}
.session-ctx-menu button.danger:hover {
  background: var(--danger-soft, rgba(198, 92, 93, 0.18));
  color: var(--danger, #c65c5d);
}
</style>
