<script setup lang="ts">
import { ref } from 'vue'
import { ui, setTheme, closeSettings } from '@/store'

type Tab = 'appearance' | 'model' | 'git' | 'security' | 'import' | 'about'
const active = ref<Tab>('appearance')

const themes: { mode: 'system' | 'dark' | 'light'; label: string; swatch: string[] }[] = [
  { mode: 'system', label: '跟随系统', swatch: ['var(--td-gray-color-13)', 'var(--td-gray-color-2)'] },
  { mode: 'dark', label: '深色', swatch: ['var(--td-gray-color-14)', 'var(--td-gray-color-12)'] },
  { mode: 'light', label: '浅色', swatch: ['#ebeef2', '#fff'] },
]

const navItems: { key: Tab; label: string }[] = [
  { key: 'appearance', label: '外观' },
  { key: 'model', label: '模型执行' },
  { key: 'git', label: 'Git' },
  { key: 'security', label: '安全扫描' },
  { key: 'import', label: '配置导入' },
  { key: 'about', label: '关于' },
]
</script>

<template>
  <div class="settings-overlay" id="settingsOverlay">
    <div class="settings-window">
      <header class="settings-head">
        <span class="settings-title">设置</span>
        <span style="margin-left: auto"></span>
        <button class="ghost-btn" type="button" title="关闭" @click="closeSettings">
          <svg class="ic sm"><use href="#i-close" /></svg>
        </button>
      </header>

      <div class="settings-body">
        <nav class="settings-nav">
          <button
            v-for="n in navItems"
            :key="n.key"
            class="settings-nav-item"
            type="button"
            :class="{ active: active === n.key }"
            @click="active = n.key"
          >{{ n.label }}</button>
        </nav>

        <div class="settings-content">
          <!-- 外观 -->
          <template v-if="active === 'appearance'">
            <h2 class="settings-section-title">外观</h2>
            <div class="settings-field">
              <span>主题模式</span>
              <div class="appearance-options" id="appearanceOpts">
                <button
                  v-for="t in themes"
                  :key="t.mode"
                  class="appearance-opt"
                  type="button"
                  :class="{ on: ui.theme === t.mode }"
                  @click="setTheme(t.mode)"
                >
                  <span class="appearance-swatch">
                    <i :style="{ background: t.swatch[0] }"></i>
                    <i :style="{ background: t.swatch[1] }"></i>
                  </span>
                  <span class="lbl">{{ t.label }}</span>
                </button>
              </div>
            </div>
            <div class="settings-field">
              <span>主色</span>
              <div style="display: flex; align-items: center; gap: 8px">
                <span style="width: 16px; height: 16px; border-radius: 4px; background: var(--accent)"></span>
                <code style="font-family: var(--font-mono); color: var(--text-base)">#366CFF</code>
                <span style="color: var(--text-weak); font-size: 11px">（品牌唯一真源，不可改）</span>
              </div>
            </div>
            <p class="settings-save-status" style="margin-top: 8px">更改即时生效并持久化。</p>
          </template>

          <!-- 模型执行 -->
          <template v-else-if="active === 'model'">
            <h2 class="settings-section-title">模型执行</h2>
            <div class="settings-field">
              <span>默认模型</span>
              <code style="font-family: var(--font-mono); color: var(--text-base)">{{ ui.model }}</code>
            </div>
            <div class="settings-field">
              <span>思考深度</span>
              <code style="font-family: var(--font-mono); color: var(--text-base)">{{ ui.think }}</code>
            </div>
            <div class="settings-field">
              <span>运行模式</span>
              <code style="font-family: var(--font-mono); color: var(--text-base)">{{ ui.mode }}</code>
            </div>
          </template>

          <!-- Git -->
          <template v-else-if="active === 'git'">
            <h2 class="settings-section-title">Git</h2>
            <div class="settings-field">
              <span>本地仓库</span>
              <code style="font-family: var(--font-mono); color: var(--text-base)">D:/Project/sa/saai/sa-code</code>
            </div>
            <div class="settings-field">
              <span>当前分支</span>
              <code style="font-family: var(--font-mono); color: var(--text-base)">main</code>
            </div>
          </template>

          <!-- 安全扫描 -->
          <template v-else-if="active === 'security'">
            <h2 class="settings-section-title">安全扫描</h2>
            <div class="settings-field">
              <span>依赖漏洞扫描</span>
              <span style="color: var(--text-weak)">每次构建后自动执行（cargo audit）</span>
            </div>
            <div class="settings-field">
              <span>密钥泄漏检测</span>
              <span style="color: var(--text-weak)">推送前扫描 .env / 凭据文件</span>
            </div>
          </template>

          <!-- 配置导入 -->
          <template v-else-if="active === 'import'">
            <h2 class="settings-section-title">配置导入</h2>
            <div class="settings-field">
              <span>导入现有配置</span>
              <span style="color: var(--text-weak)">支持从 JSON / TOML 导入 provider 与执行偏好</span>
            </div>
          </template>

          <!-- 关于 -->
          <template v-else-if="active === 'about'">
            <h2 class="settings-section-title">关于</h2>
            <div class="settings-field">
              <span>产品</span>
              <code style="font-family: var(--font-mono); color: var(--text-base)">SaCode Desktop</code>
            </div>
            <div class="settings-field">
              <span>版本</span>
              <code style="font-family: var(--font-mono); color: var(--text-base)">v0.3 · 设计产物构建版</code>
            </div>
          </template>
        </div>
      </div>

      <footer class="settings-foot">
        <span class="settings-save-status">SaCode Desktop · 原型 v0.3</span>
      </footer>
    </div>
  </div>
</template>
