<script setup lang="ts">
/**
 * 上下文菜单浮层 — 由 useContextMenu composable 驱动。
 * 固定定位在鼠标点击位置，支持键盘导航、外部点击关闭。
 */
import { onMounted, onBeforeUnmount, ref, type Ref } from 'vue';
import { useContextMenu, type ContextMenuState } from '../composables/useContextMenu.ts';

const { activeMenu, close } = useContextMenu();

function onItemClick(item: { action: () => void; disabled?: boolean }) {
  if (item.disabled) return;
  item.action();
  close();
}

// 外部 pointerdown 关闭菜单
function onPointerDown(e: PointerEvent) {
  const el = document.querySelector('.context-menu-panel');
  if (el && el.contains(e.target as Node)) return;
  close();
}

// ESC 关闭
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close();
}

onMounted(() => {
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('keydown', onKeydown, true);
  window.addEventListener('blur', close);
});
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onPointerDown, true);
  window.removeEventListener('keydown', onKeydown, true);
  window.removeEventListener('blur', close);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="activeMenu"
      class="context-menu-panel"
      role="menu"
      :style="{ left: `${activeMenu.x}px`, top: `${activeMenu.y}px` }"
      @pointerdown.stop
      @contextmenu.prevent
    >
      <template v-for="(item, idx) in activeMenu.items" :key="idx">
        <div v-if="item.separator" class="ctx-separator" />
        <button
          v-else
          type="button"
          role="menuitem"
          class="ctx-item"
          :class="{ danger: item.danger, disabled: item.disabled }"
          :disabled="item.disabled"
          @click="onItemClick(item)"
        >
          <span v-if="item.icon" class="ctx-icon" aria-hidden="true">{{ item.icon }}</span>
          <span class="ctx-label">{{ item.label }}</span>
          <span v-if="item.shortcut" class="ctx-shortcut">{{ item.shortcut }}</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.context-menu-panel {
  position: fixed;
  z-index: 9999;
  min-width: 160px;
  max-width: 240px;
  padding: 4px;
  background: var(--bg-raised, #161b22);
  border: 1px solid var(--border-weak, #30363d);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  gap: 1px;
  user-select: none;
  font-size: 13px;
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-strong, #e6edf3);
  cursor: pointer;
  text-align: left;
  width: 100%;
  font: inherit;
  font-size: 13px;
  transition: background 80ms ease;
}

.ctx-item:hover:not(.disabled) {
  background: var(--accent-soft, rgba(54, 108, 255, 0.12));
}

.ctx-item.danger {
  color: var(--danger, #f85149);
}

.ctx-item.danger:hover:not(.disabled) {
  background: var(--danger-soft, rgba(248, 81, 73, 0.12));
}

.ctx-item.disabled {
  opacity: 0.4;
  cursor: default;
}

.ctx-icon {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  flex-shrink: 0;
}

.ctx-label {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ctx-shortcut {
  color: var(--text-weak, #8b949e);
  font-size: 11px;
  flex-shrink: 0;
}

.ctx-separator {
  height: 1px;
  background: var(--border-weak, #30363d);
  margin: 3px 6px;
}
</style>
