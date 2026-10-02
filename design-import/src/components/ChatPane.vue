<script setup lang="ts">
import { ref, reactive } from 'vue'
import { ui } from '@/store'
import ComposerDock from './ComposerDock.vue'

/* Plan 面板（4 项执行计划） */
const planOpen = ref(true)
const planItems = [
  '① 新增 runtime/src/config/provider.rs 单一读取源',
  '② CLI 读取委托 runtime 共享实现',
  '③ 修复 activeProvider/current 混用缺陷',
  '④ 下沉 to_model_provider / resolved_api_key',
]

/* AI 回复逐行折叠步骤（思考过程 + 工具调用） */
const steps = [
  {
    label: '思考过程',
    meta: '3.2s',
    body: `<p>用户希望统一 CLI 与 daemon 的 <code>providers.json</code> 读取来源，避免双份解析漂移。决定新增 <code>ProviderCatalogStore</code> 作为唯一读取源，并将 CLI 的读取逻辑委托给 runtime 共享实现。</p>`,
  },
  {
    label: 'read_file',
    meta: 'runtime/src/config/provider.rs',
    body: `<div class="tool-call">read_file(path="runtime/src/config/provider.rs")
// 识别三种历史格式：标准 / camelCase / legacy-single
// 计划新增 load_from_file + ProviderCatalogStore</div>`,
  },
  {
    label: 'edit_file',
    meta: 'interfaces/cli/src/provider_config.rs',
    body: `<div class="tool-call">edit_file(path="interfaces/cli/src/provider_config.rs")
- // 旧：CLI 内独立解析
+ use sacode_runtime::config::provider::ProviderCatalogStore;
+ let catalog = ProviderCatalogStore::default().load_from_file()?;</div>`,
  },
  {
    label: 'cargo test',
    meta: 'passed 4',
    body: `<div class="tool-call">cargo test -p sacode-runtime --lib config::provider
test result: ok. 4 passed; 0 failed</div>`,
  },
]
const openSteps = reactive<Record<number, boolean>>({})
function toggleStep(i: number) {
  openSteps[i] = !openSteps[i]
}

/* 排队的（折叠，替代原「执行中」状态条） */
const queueOpen = ref(false)
const queueItems = [
  '重构 daemon 预热阶段的 provider 注入',
  '为 CLI 增加 provider 自检命令',
]

/* 审批卡 */
const approvalVisible = ref(true)
</script>

<template>
  <div class="chat-column">
    <!-- Plan 面板 -->
    <div class="plan-panel">
      <button class="plan-panel-head" type="button" @click="planOpen = !planOpen">
        <svg class="ic sm"><use href="#i-bot" /></svg>
        <span class="plan-panel-title">执行计划 · 4 项</span>
        <span style="margin-left: auto; opacity: .6">{{ planOpen ? '▾' : '▸' }}</span>
      </button>
      <ul class="plan-panel-list" v-show="planOpen">
        <li class="plan-panel-item" v-for="(it, i) in planItems" :key="i">{{ it }}</li>
      </ul>
    </div>

    <!-- 对话流 -->
    <div class="chat-stream scroll-y">
      <div class="chat-turn user">
        <div class="chat-turn-prompt">帮我重构 providers.json 的读取逻辑，统一 CLI 和 daemon 两处读取来源</div>
        <div class="chat-turn-meta">你 · 2 分钟前</div>
      </div>

      <div class="chat-turn ai">
        <div class="chat-turn-output">
          已完成。新增 <code>runtime/src/config/provider.rs</code>（ProviderCatalogStore：三种历史格式解析 + user/project 合并），CLI 的读取逻辑委托 runtime 共享实现，消除了双份解析。<br /><br />
          <strong>改动要点：</strong><br />
          • 修复 activeProvider/current 混用缺陷<br />
          • camelCase 格式优先判定（避免标准解析吞掉 base_url）<br />
          • to_model_provider / resolved_api_key 一并下沉 runtime
        </div>
        <div class="chat-turn-meta">SaCode · 2 分钟前 · deepseek-v4-flash</div>
      </div>

      <!-- AI 回复逐行折叠步骤 -->
      <div class="chat-steps">
        <div
          class="chat-step"
          v-for="(s, i) in steps"
          :key="i"
          :class="{ open: openSteps[i] }"
        >
          <button class="chat-step-head" type="button" @click="toggleStep(i)">
            <svg class="ic sm"><use href="#i-chevron" /></svg>
            <span class="chat-step-label">{{ s.label }}</span>
            <span class="chat-step-meta">{{ s.meta }}</span>
          </button>
          <div class="chat-step-body" v-show="openSteps[i]" v-html="s.body"></div>
        </div>
      </div>
    </div>

    <!-- 排队的（折叠，替代「执行中」状态条） -->
    <div class="queue-panel" :class="{ open: queueOpen }">
      <button class="queue-head" type="button" @click="queueOpen = !queueOpen">
        <svg class="ic sm"><use href="#i-chevron" /></svg>
        <span class="queue-title">排队的</span>
        <span class="group-badge">{{ queueItems.length }}</span>
      </button>
      <div class="queue-body" v-show="queueOpen">
        <div class="queue-item" v-for="(q, i) in queueItems" :key="i">
          <svg class="ic sm"><use href="#i-file" /></svg>{{ q }}
        </div>
      </div>
    </div>

    <!-- 交互卡：审批（底部吸附） -->
    <div class="approval-card ask-float" v-if="approvalVisible">
      <span class="approval-icon"><svg class="ic sm"><use href="#i-more" /></svg></span>
      <div class="approval-text">
        <div class="approval-title">需要审批：执行 cargo test</div>
        <div class="approval-desc">sacode.exe test -p sacode-runtime --lib config::provider</div>
      </div>
      <div class="approval-actions">
        <button class="btn-approve" type="button" @click="approvalVisible = false">允许</button>
        <button class="btn-reject" type="button" @click="approvalVisible = false">拒绝</button>
      </div>
    </div>

    <!-- Composer 上方：项目文件芯片（折叠，hover 展开） -->
    <div class="composer-context-chips">
      <span class="ctx-chip-label">上下文</span>
      <div class="project-file-chips">
        <span class="attachment-chip" title="src/runtime/config/provider.rs">
          <svg class="ic sm"><use href="#i-file" /></svg>
          <span class="attachment-name">src/runtime/config/provider.rs</span>
          <button class="attachment-remove" type="button" aria-label="移除">×</button>
        </span>
        <span class="attachment-chip" title="src/daemon/mod.rs">
          <svg class="ic sm"><use href="#i-file" /></svg>
          <span class="attachment-name">src/daemon/mod.rs</span>
          <button class="attachment-remove" type="button" aria-label="移除">×</button>
        </span>
        <span class="attachment-chip chip-collapsed" title="providers.json">
          <svg class="ic sm"><use href="#i-file" /></svg>
          <span class="attachment-name">providers.json</span>
        </span>
        <button class="ctx-chip-more" type="button" title="添加文件">+ 2</button>
      </div>
    </div>

    <!-- ComposerDock -->
    <ComposerDock />
  </div>
</template>
