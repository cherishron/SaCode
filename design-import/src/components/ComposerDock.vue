<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { ui, togglePlus, toggleModel, setMode, setThink, pickModel } from '@/store'

/* 技能多选（原设计稿中 refactor / test-writer 可多选） */
const skills = ref<Record<string, boolean>>({ refactor: false, 'test-writer': false })
function toggleSkill(name: string) {
  skills.value[name] = !skills.value[name]
}
const skillModels = [
  { key: 'refactor', label: 'refactor' },
  { key: 'test-writer', label: 'test-writer' },
]

const thinkOptions = ['关闭', '低', '中', '高']

/* 点击外部关闭弹层 */
const root = ref<HTMLElement | null>(null)
function onDocClick(e: MouseEvent) {
  if (!root.value) return
  if (!root.value.contains(e.target as Node)) {
    ui.plusMenu = false
    ui.modelMenu = false
  }
}
onMounted(() => document.addEventListener('mousedown', onDocClick))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClick))
</script>

<template>
  <div class="composer-dock td-chat-shell" ref="root">
    <div class="td-chat-sender">
      <!-- 约束 4：原对话的输入框组件保持原有结构与功能，不得改动 -->
      <textarea class="td-chat-sender__inner" placeholder="描述你要构建或修复的内容，Enter 发送"></textarea>

      <div class="composer-bar">
        <div class="plus-wrap">
          <button class="ghost-btn composer-add" type="button" title="添加附件、项目文件或技能" @click="togglePlus">
            <svg class="ic sm"><use href="#i-add" /></svg>
          </button>
          <div class="plus-menu" v-show="ui.plusMenu">
            <button class="plus-item" type="button">
              <svg class="ic sm"><use href="#i-file" /></svg><span>添加照片和文件</span>
            </button>
            <button class="plus-item" type="button">
              <svg class="ic sm"><use href="#i-folder" /></svg>
              <span>@ 项目文件<span class="plus-desc">引用工作区文件到任务</span></span>
            </button>
            <button class="plus-item" type="button" @click="setMode('plan')">
              <svg class="ic sm"><use href="#i-bot" /></svg>
              <span>编排模式<span class="plus-desc">澄清需求、规格、实现与评审</span></span>
            </button>
            <div class="plus-sep"></div>
            <div class="plus-section-label">技能（可多选）</div>
            <button
              class="plus-sub-item"
              type="button"
              v-for="s in skillModels"
              :key="s.key"
              :class="{ on: skills[s.key] }"
              @click="toggleSkill(s.key)"
            >
              <span class="skill-check">{{ skills[s.key] ? '☑' : '☐' }}</span>
              <span class="plus-sub-name">{{ s.label }}</span>
            </button>
          </div>
        </div>

        <!-- 三段模式循环：Plan | Build | Yolo -->
        <div class="mode-toggle-group" role="radiogroup" aria-label="运行模式">
          <button
            class="mode-toggle mode-plan"
            type="button"
            role="radio"
            :aria-checked="ui.mode === 'plan'"
            title="只聊不动手"
            :class="{ on: ui.mode === 'plan' }"
            @click="setMode('plan')"
          >Plan</button>
          <button
            class="mode-toggle mode-build"
            type="button"
            role="radio"
            :aria-checked="ui.mode === 'build'"
            title="先出方案再动手"
            :class="{ on: ui.mode === 'build' }"
            @click="setMode('build')"
          >Build</button>
          <button
            class="mode-toggle mode-yolo"
            type="button"
            role="radio"
            :aria-checked="ui.mode === 'yolo'"
            title="直接干，自主决策"
            :class="{ on: ui.mode === 'yolo' }"
            @click="setMode('yolo')"
          >Yolo</button>
        </div>

        <button class="model-btn" type="button" title="选择模型" @click="toggleModel">
          <span>{{ ui.model }}</span>
        </button>

        <div class="composer-bar-end">
          <div class="usage-ring" role="img" aria-label="上下文 64%" title="上下文 64%（24,576 / 38,400）">
            <svg viewBox="0 0 24 24" class="u-ring">
              <circle class="u-track" cx="12" cy="12" r="9" fill="none" stroke-width="3" />
              <circle class="u-bar" cx="12" cy="12" r="9" fill="none" stroke-width="3" stroke-linecap="round" stroke-dasharray="56.5" stroke-dashoffset="20.3" transform="rotate(-90 12 12)" />
            </svg>
          </div>
          <button class="ghost-btn" type="button" title="语音输入">
            <svg class="ic sm"><use href="#i-mic" /></svg>
          </button>
          <button class="ghost-btn" type="button" title="提示词增强">
            <svg class="ic sm"><use href="#i-bot" /></svg>
          </button>
        </div>
      </div>
    </div>

    <!-- 模型菜单（思考深度 + 模型列表） -->
    <div class="model-menu plus-menu" v-show="ui.modelMenu">
      <div class="think-depth">
        <div class="think-label">思考深度</div>
        <div class="think-group">
          <button
            class="think-btn"
            type="button"
            v-for="t in thinkOptions"
            :key="t"
            :class="{ on: ui.think === t }"
            @click="setThink(t)"
          >{{ t }}</button>
        </div>
      </div>
      <div class="plus-sep"></div>
      <button class="plus-sub-item" type="button" :class="{ on: ui.model === '默认模型' }" @click="pickModel('')">默认模型</button>
      <button class="plus-sub-item" type="button" :class="{ on: ui.model === 'deepseek-v4-flash' }" @click="pickModel('deepseek-v4-flash')"><span class="plus-sub-name">deepseek-v4-flash</span></button>
      <button class="plus-sub-item" type="button" :class="{ on: ui.model === 'qwen3:32b' }" @click="pickModel('qwen3:32b')"><span class="plus-sub-name">qwen3:32b</span></button>
      <button class="plus-sub-item" type="button" :class="{ on: ui.model === 'claude-sonnet-4' }" @click="pickModel('claude-sonnet-4')"><span class="plus-sub-name">claude-sonnet-4</span></button>
    </div>
  </div>
</template>
