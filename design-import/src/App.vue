<script setup lang="ts">
import { ui } from '@/store'
import TaskColumn from './components/TaskColumn.vue'
import PaneFrame from './components/PaneFrame.vue'
import SettingsView from './components/SettingsView.vue'
import IconSprite from './components/IconSprite.vue'

function closeNav() {
  ui.navOpen = false
}
</script>

<template>
  <IconSprite />

  <div class="app-shell">
    <TaskColumn />
    <div class="shell-divider" aria-hidden="true"></div>

    <main class="work-area">
      <div class="split-grid">
        <div class="split-node axis-column">
          <div class="split-leaf">
            <PaneFrame />
          </div>
        </div>
      </div>
      <!-- 移动端抽屉遮罩 -->
      <div class="nav-scrim" v-show="ui.navOpen" @click="closeNav"></div>
    </main>
  </div>

  <SettingsView v-if="ui.showSettings" />
</template>
