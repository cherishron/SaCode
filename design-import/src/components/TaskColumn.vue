<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import {
  ui,
  onSidebarToggle,
  selectSession,
  addSession,
  toggleUserPopper,
  openSettings,
  newTask,
  addProject,
} from '@/store'

/* 点击外部关闭账号弹层 */
const root = ref<HTMLElement | null>(null)
function onDocClick(e: MouseEvent) {
  if (!root.value) return
  if (!root.value.contains(e.target as Node)) ui.userPopper = false
}
onMounted(() => document.addEventListener('mousedown', onDocClick))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClick))
</script>

<template>
  <aside class="task-col" :class="{ collapsed: ui.collapsed, 'nav-open': ui.navOpen }" id="taskCol" ref="root">
    <div class="task-col-brand">
      <span class="task-col-brand-name">SaCode</span>
      <div class="task-col-actions">
        <button class="ghost-btn" type="button" title="收缩侧栏" @click="onSidebarToggle">
          <svg class="ic"><use href="#i-sidebar" /></svg>
        </button>
        <button class="ghost-btn" type="button" title="新建" @click="newTask">
          <svg class="ic"><use href="#i-add" /></svg>
        </button>
      </div>
    </div>

    <div class="task-col-tabs"><span class="task-col-tab-label">本地项目</span></div>

    <div class="session-search">
      <svg class="ic sm"><use href="#i-search" /></svg>
      <input type="search" placeholder="搜索会话…" aria-label="搜索会话" />
    </div>

    <div class="task-col-list scroll-y">
      <div class="task-group">
        <div class="group-label">
          <svg class="ic sm"><use href="#i-folder" /></svg>
          <span class="group-label-title" title="D:/Project/sa/saai/sa-code">sa-code</span>
          <span class="group-badge" title="运行中">{{ ui.runningBadge }}</span>
          <button class="ghost-btn group-add" type="button" title="在此新建会话" @click="addSession">
            <svg class="ic sm"><use href="#i-add" /></svg>
          </button>
        </div>
        <div class="group-body">
          <div
            v-for="s in ui.sessions"
            :key="s.id"
            class="list-row"
            :class="{
              selected: ui.selectedSession === s.id,
              attention: s.state === 'failed',
              unread: s.state === 'unread',
            }"
            @click="selectSession(s.id)"
          >
            <span class="list-row-icon"><svg class="ic sm"><use href="#i-folder" /></svg></span>
            <span class="list-row-label">{{ s.name }}</span>
            <span class="list-row-status">
              <template v-if="s.state === 'running'">
                <span class="list-loaded-mark" title="已入格"></span>
                <span class="status-dot running"></span>
              </template>
              <template v-else-if="s.state === 'failed'">
                <span class="status-dot failed"></span>
              </template>
              <template v-else-if="s.state === 'loaded'">
                <span class="list-loaded-mark" title="已入格"></span>
                <span class="status-dot"></span>
              </template>
              <template v-else>
                <span class="status-dot"></span>
              </template>
            </span>
          </div>

          <div class="archive-divider">
            <button class="archive-toggle" type="button" @click="ui.archivedOpen = !ui.archivedOpen">
              ▸ 已归档<span class="group-badge">1</span>
            </button>
          </div>
          <div id="arch" v-show="ui.archivedOpen">
            <div class="list-row archived" @click="selectSession('a1')">
              <span class="list-row-icon"><svg class="ic sm"><use href="#i-folder" /></svg></span>
              <span class="list-row-label">早期 POC 验证</span>
              <span class="list-row-status">
                <button class="ghost-btn restore-btn" type="button" title="恢复" style="font-size: 11px">↩</button>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="task-col-bottom-nav">
      <button class="task-col-new-task" type="button" title="启动任务（⌘N）" @click="newTask">
        <svg class="ic sm"><use href="#i-add" /></svg><span>启动任务</span><kbd class="kbd-hint">⌘N</kbd>
      </button>
      <div class="task-col-link-row">
        <button class="task-col-footer-link" type="button" title="知识库"><svg class="ic sm"><use href="#i-book" /></svg><span>知识库</span></button>
        <button class="task-col-footer-link" type="button" title="自动化"><svg class="ic sm"><use href="#i-cal" /></svg><span>自动化</span></button>
        <button class="task-col-footer-link" type="button" title="添加项目" @click="addProject"><svg class="ic sm"><use href="#i-folder" /></svg><span>添加项目</span></button>
        <button class="task-col-footer-link" type="button" title="技术交流群"><svg class="ic sm"><use href="#i-chat" /></svg><span>技术交流群</span></button>
        <button class="task-col-footer-link" type="button" title="配置" @click="openSettings"><svg class="ic sm"><use href="#i-settings" /></svg><span>配置</span></button>
      </div>
    </div>

    <div class="task-col-footer">
      <button class="task-col-user" type="button" title="账号与模式（点击展开）" @click="toggleUserPopper">
        <span class="task-col-avatar">罗</span>
        <span class="task-col-nickname">罗景光</span>
      </button>
      <button class="ghost-btn" type="button" title="设置" @click="openSettings">
        <svg class="ic sm"><use href="#i-settings" /></svg>
      </button>

      <div class="user-popper" v-show="ui.userPopper">
        <div class="user-popper-head">
          <span class="task-col-avatar" style="width: 32px; height: 32px">罗</span>
          <div class="user-popper-id"><strong>罗景光</strong><small>本地模式</small></div>
        </div>
        <dl class="user-popper-meta">
          <dt>账号状态</dt><dd>本地模式</dd>
          <dt>当前模式</dt><dd>Build 构建</dd>
        </dl>
        <div class="user-popper-actions">
          <button class="user-popper-item" type="button" @click="openSettings"><svg class="ic sm"><use href="#i-settings" /></svg>打开设置</button>
          <button class="user-popper-item danger" type="button" disabled>退出登录</button>
        </div>
      </div>
    </div>

    <div class="task-col-resizer" title="拖动调宽，双击复位" @dblclick="ui.collapsed = false"></div>
  </aside>
</template>
