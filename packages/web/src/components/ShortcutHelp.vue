<script setup lang="ts">
import { computed } from "vue";
import { useShortcutsStore } from "@/stores/shortcuts";

const store = useShortcutsStore();

const categoryLabels: Record<string, string> = {
  navigation: "导航",
  action: "操作",
  chat: "对话",
  system: "系统",
};

const categoryIcons: Record<string, string> = {
  navigation: "navigation",
  action: "operation",
  chat: "chat",
  system: "setting",
};

const sortedCategories = computed(() => {
  return ["navigation", "action", "chat", "system"];
});

function close() {
  store.closeHelp();
}

function handleOverlayClick(event: MouseEvent) {
  if (event.target === event.currentTarget) {
    close();
  }
}
</script>

<template>
  <teleport to="body">
    <transition name="fade">
      <div
        v-if="store.showHelp"
        class="shortcut-help-overlay"
        @click="handleOverlayClick"
      >
        <div class="shortcut-help-modal">
          <div class="modal-header">
            <h2>键盘快捷键</h2>
            <tiny-button
              icon="close"
              size="mini"
              type="text"
              @click="close"
            />
          </div>

          <div class="modal-body">
            <div
              v-for="category in sortedCategories"
              :key="category"
              class="category-section"
            >
              <h3 class="category-title">
                <tiny-icon :name="categoryIcons[category]" />
                {{ categoryLabels[category] }}
              </h3>
              <div class="shortcut-list">
                <div
                  v-for="shortcut in store.shortcutsByCategory[category]"
                  :key="shortcut.id"
                  class="shortcut-item"
                >
                  <span class="shortcut-description">
                    {{ shortcut.description }}
                  </span>
                  <span class="shortcut-keys">
                    {{ store.getShortcutText(shortcut) }}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div class="modal-footer">
            <span class="hint">
              按 <kbd>Ctrl</kbd> + <kbd>/</kbd> 或 <kbd>?</kbd> 显示/隐藏此帮助
            </span>
          </div>
        </div>
      </div>
    </transition>
  </teleport>
</template>

<style scoped>
.shortcut-help-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.shortcut-help-modal {
  background: white;
  border-radius: 12px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.2);
  max-width: 560px;
  width: 90%;
  max-height: 80vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.dark .shortcut-help-modal {
  background: #1f2937;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #e5e7eb;
}

.dark .modal-header {
  border-bottom-color: #374151;
}

.modal-header h2 {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
}

.modal-body {
  padding: 16px 20px;
  overflow-y: auto;
}

.category-section {
  margin-bottom: 20px;
}

.category-section:last-child {
  margin-bottom: 0;
}

.category-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: #6b7280;
  margin: 0 0 12px 0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.dark .category-title {
  color: #9ca3af;
}

.shortcut-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.shortcut-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #f9fafb;
  border-radius: 6px;
}

.dark .shortcut-item {
  background: #374151;
}

.shortcut-description {
  font-size: 14px;
  color: #374151;
}

.dark .shortcut-description {
  color: #e5e7eb;
}

.shortcut-keys {
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
    "Liberation Mono", "Courier New", monospace;
  font-size: 12px;
  font-weight: 500;
  color: #f97316;
}

.modal-footer {
  padding: 12px 20px;
  border-top: 1px solid #e5e7eb;
  text-align: center;
}

.dark .modal-footer {
  border-top-color: #374151;
}

.hint {
  font-size: 12px;
  color: #9ca3af;
}

.hint kbd {
  display: inline-block;
  padding: 2px 6px;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
    "Liberation Mono", "Courier New", monospace;
  background: #f3f4f6;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.dark .hint kbd {
  background: #374151;
  border-color: #4b5563;
}

/* 过渡动画 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-active .shortcut-help-modal,
.fade-leave-active .shortcut-help-modal {
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.fade-enter-from .shortcut-help-modal,
.fade-leave-to .shortcut-help-modal {
  transform: scale(0.95);
  opacity: 0;
}
</style>
