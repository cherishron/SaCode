<script setup lang="ts">
import { computed } from 'vue';
import { ABOUT_INFO } from '../logic/preferences.ts';
import { localModeBannerHint, localModeBannerText, type LocalMode } from '../logic/local-mode.ts';

/** 关于页：产品标识 + 版本/许可/源码位 + 当前模式。只读，无假动作。 */
const props = defineProps<{
  /** 当前运行模式（本地 / 云），由设置页账号数据推断后传入 */
  mode: LocalMode;
  /** 完整工作区路径，可选 */
  workspacePath?: string;
}>();

const modeText = computed(() => localModeBannerText(props.mode));
const modeHint = computed(() => localModeBannerHint(props.mode));
</script>

<template>
  <div class="about-block">
    <h3 class="settings-section-title">关于</h3>

    <div class="about-card">
      <div class="about-row about-row--title">
        <strong>{{ ABOUT_INFO.productName }}</strong>
        <span class="muted">{{ ABOUT_INFO.desktopName }}</span>
      </div>
      <div class="about-row">
        <span class="about-label">版本</span>
        <span class="mono">{{ ABOUT_INFO.version }}</span>
        <span class="muted about-note">（跟踪根 Cargo.toml workspace 版本）</span>
      </div>
      <div class="about-row">
        <span class="about-label">开源许可</span>
        <span>{{ ABOUT_INFO.license }}</span>
        <span class="muted about-note">{{ ABOUT_INFO.licenseText }}</span>
      </div>
      <div class="about-row">
        <span class="about-label">源码</span>
        <a class="about-link mono" :href="ABOUT_INFO.sourceUrl" target="_blank" rel="noopener noreferrer">
          {{ ABOUT_INFO.sourceLabel }}
        </a>
      </div>
      <div class="about-row">
        <span class="about-label">当前模式</span>
        <span class="about-mode" :class="`about-mode--${props.mode}`">{{ modeText }}</span>
        <span class="muted about-note">{{ modeHint }}</span>
      </div>
      <div v-if="workspacePath" class="about-row">
        <span class="about-label">工作区</span>
        <span class="mono about-path" :title="workspacePath">{{ workspacePath }}</span>
      </div>
    </div>

    <p class="muted about-foot">
      技术栈：Vue 3 + TDesign + Tauri 2 · 布局契约 docs/plans/desktop-layout-contract.md
    </p>
  </div>
</template>

<style scoped>
.about-block {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.about-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--border-weak);
  border-radius: 6px;
  background: var(--bg-surface);
}
.about-row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  min-height: var(--list-row-min);
  font: var(--text-12-regular);
  color: var(--text-base);
}
.about-row--title {
  min-height: var(--chrome-row);
  font: var(--text-14-medium, var(--text-12-medium));
  color: var(--text-strong);
}
.about-label {
  min-width: 64px;
  color: var(--text-weak);
  font: var(--text-12-medium);
}
.about-note {
  font-size: 11px;
}
.about-link {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.about-path {
  font-size: 11px;
  word-break: break-all;
}
.about-mode--local {
  color: var(--accent);
}
.about-mode--online {
  color: var(--success);
}
.about-mode--cloud_degraded {
  color: var(--warning);
}
.about-foot {
  font: var(--text-12-regular);
}
</style>
