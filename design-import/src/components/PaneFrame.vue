<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { ui, toggleTools, togglePaneMenu, closePaneMenu } from '@/store'
import ChatPane from './ChatPane.vue'
import WorkspaceTools from './WorkspaceTools.vue'

/* 点击外部关闭「更多」菜单 */
const root = ref<HTMLElement | null>(null)
function onDocClick(e: MouseEvent) {
  if (!root.value) return
  if (!root.value.contains(e.target as Node)) ui.paneMenu = false
}
onMounted(() => document.addEventListener('mousedown', onDocClick))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClick))
</script>

<template>
  <section class="pane pane-focus" id="paneA" ref="root">
    <header class="pane-head">
      <span class="pane-head-status"><svg class="ic sm"><use href="#i-chat" /></svg></span>
      <div class="pane-head-title" title="重构 provider 配置读取">重构 provider 配置读取</div>
      <div class="pane-head-actions">
        <button class="ghost-btn" type="button" title="右侧工具栏（文件 / 变更 / 终端 / 设计 / 预览）" @click="toggleTools">
          <svg class="ic sm"><use href="#i-sidebar" /></svg>
        </button>
        <div class="pane-menu-wrap">
          <button class="ghost-btn" type="button" title="更多" @click="togglePaneMenu">
            <svg class="ic sm"><use href="#i-more" /></svg>
          </button>
          <div class="pane-menu" v-show="ui.paneMenu">
            <button type="button" @click="closePaneMenu">向右拆分</button>
            <button type="button" @click="closePaneMenu">向下拆分</button>
            <button type="button" @click="closePaneMenu">独占</button>
            <button type="button" @click="closePaneMenu">更换</button>
            <button type="button" @click="closePaneMenu">重命名</button>
          </div>
        </div>
        <button class="ghost-btn" type="button" title="关闭">
          <svg class="ic sm"><use href="#i-close" /></svg>
        </button>
      </div>
    </header>
    <div class="pane-body" :style="{ paddingRight: ui.toolsOpen ? '300px' : '0' }">
      <ChatPane />
    </div>
    <WorkspaceTools />
  </section>
</template>
