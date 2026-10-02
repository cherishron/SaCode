<script setup lang="ts">
import { computed, ref } from 'vue';
import { FolderOpenIcon } from 'tdesign-icons-vue-next';
import { selectWorkspaceFolder } from '../platform/tauri-bridge.ts';
import { useDesktopApp } from '../composables/useDesktopApp';
import ComposerDock from './ComposerDock.vue';

const emit = defineEmits<{
  created: [payload: { conversationId: string; taskId: string }];
}>();

const { workspace, app, refreshConversations } = useDesktopApp();
const picking = ref(false);
const error = ref('');

const folderName = computed(() => {
  const path = workspace.value || app.workspace || '';
  if (!path) return '选择工作区文件夹';
  return path.replace(/\\/g, '/').split('/').filter(Boolean).pop() || '选择工作区文件夹';
});

async function pickWorkspace() {
  if (picking.value) return;
  picking.value = true;
  error.value = '';
  try {
    const dir = await selectWorkspaceFolder();
    if (!dir) return;
    if (dir !== app.workspace) {
      await app.changeWorkspace(dir);
      await app.refreshWorkspaceCapabilities();
      await refreshConversations();
    }
  } catch (e) {
    error.value = String(e);
  } finally {
    picking.value = false;
  }
}
</script>

<template>
  <div class="new-task-pane">
    <header class="new-task-head">
      <span class="new-task-title">新建任务</span>
      <button
        class="workspace-pick"
        type="button"
        :title="workspace || '选择工作区文件夹'"
        :disabled="picking"
        @click="pickWorkspace"
      >
        <FolderOpenIcon size="13" />
        <span class="workspace-pick-path">{{ folderName }}</span>
      </button>
      <span style="flex: 1" />
    </header>
    <div class="new-task-body">
      <p class="new-task-workspace muted">
        描述你要构建或修复的内容，开始后将在本格持续会话
      </p>
      <div v-if="error" class="composer-error">{{ error }}</div>
      <ComposerDock
        conversation-id=""
        placeholder="描述你要构建或修复的内容"
        @sent="(p) => emit('created', p)"
      />
    </div>
  </div>
</template>
