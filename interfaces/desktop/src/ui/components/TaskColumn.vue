<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  AddIcon,
  FolderIcon,
  FolderOpenIcon,
  MenuFoldIcon,
  MenuUnfoldIcon,
  SettingIcon,
  TerminalIcon,
} from 'tdesign-icons-vue-next';
import { useDesktopApp } from '../composables/useDesktopApp';
import { loadDesktopPreferences } from '../../app/settings.ts';

const prefs = loadDesktopPreferences();
const nickname = prefs.nickname || 'SaCode 用户';
const avatarChar = (nickname.trim().slice(0, 1) || 'S').toUpperCase();

const groupOpen = ref(true);

const collapsed = ref(false);

function toggleCollapse() {
  collapsed.value = !collapsed.value;
  emit('collapsed', collapsed.value);
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
  refreshConversations,
  selectConversation,
  projectGroup,
  selectedId,
  connection,
  loading,
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
}>();

const emit = defineEmits<{
  openSettings: [];
  newTask: [];
  select: [id: string];
  newInProject: [];
  collapsed: [value: boolean];
}>();

const waitingCount = computed(() =>
  projectGroup.value.sessions.filter((s) => s.tone === 'running').length,
);

function onSelect(id: string) {
  void selectConversation(id);
  emit('select', id);
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

onMounted(() => {
  void start();
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

      <div class="task-col-list scroll-y">
        <template>
          <div class="task-group">
            <div class="group-label" @click="groupOpen = !groupOpen">
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
                v-for="session in projectGroup.sessions"
                :key="session.id"
                class="list-row"
                :class="{
                  selected: session.id === selectedId,
                  attention: session.tone === 'failed',
                  loaded: props.loadedIds?.includes(session.id),
                }"
                :title="session.title"
                @click="onSelect(session.id)"
              >
                <span class="list-row-icon"><TerminalIcon size="12" /></span>
                <span class="list-row-label">{{ session.title }}</span>
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
            </div>
          </div>
        </template>
      </div>
    </template>

    <div class="task-col-footer">
      <button class="task-col-user" type="button" title="个人资料" @click="$emit('openSettings')">
        <span class="task-col-avatar">{{ avatarChar }}</span>
        <span v-if="!collapsed" class="task-col-nickname">{{ nickname }}</span>
      </button>
      <button v-if="!collapsed" class="ghost-btn" type="button" title="设置" @click="$emit('openSettings')">
        <SettingIcon size="14" />
      </button>
    </div>

    <div
      v-if="!collapsed"
      class="task-col-resizer"
      :class="{ dragging }"
      title="拖动调宽，双击复位"
      @pointerdown.prevent="onResizeStart"
      @dblclick="resetWidth"
    />
  </aside>
</template>
