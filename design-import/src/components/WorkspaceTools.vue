<script setup lang="ts">
import { ui, setTool, closeTools } from '@/store'

const tabs = [
  { key: 'files', label: '文件' },
  { key: 'changes', label: '变更', count: 3 },
  { key: 'terminal', label: '终端' },
  { key: 'design', label: '设计' },
  { key: 'preview', label: '预览' },
]
</script>

<template>
  <aside class="workspace-tools" id="tools" :style="{ display: ui.toolsOpen ? 'flex' : 'none', width: '300px' }">
    <div class="tools-resizer" title="调整工具栏宽度"></div>
    <header class="tools-head">
      <div class="tools-tabs" role="tablist">
        <button
          v-for="t in tabs"
          :key="t.key"
          type="button"
          :data-tab="t.key"
          :class="{ active: ui.activeTool === t.key }"
          @click="setTool(t.key)"
        >
          {{ t.label }}<span v-if="t.count" class="tools-count">{{ t.count }}</span>
        </button>
      </div>
      <button class="ghost-btn" type="button" title="关闭工具栏" @click="closeTools">
        <svg class="ic sm"><use href="#i-close" /></svg>
      </button>
    </header>

    <div class="tools-content">
      <!-- 文件 -->
      <div class="tools-tab-page" data-page="files" v-show="ui.activeTool === 'files'">
        <div class="tree-row"><span class="twist"></span><span class="fv"><svg class="ic sm"><use href="#i-folder" /></svg></span>runtime</div>
        <div class="tree-row tree-indent"><span class="twist"></span><span class="fv"><svg class="ic sm"><use href="#i-folder" /></svg></span>src</div>
        <div class="tree-row tree-indent" style="padding-left: 32px"><span class="twist"></span><span class="fv"><svg class="ic sm"><use href="#i-folder" /></svg></span>config</div>
        <div class="tree-row tree-indent" style="padding-left: 48px"><span class="fv"><svg class="ic sm"><use href="#i-file" /></svg></span>provider.rs</div>
        <div class="tree-row tree-indent" style="padding-left: 48px"><span class="fv"><svg class="ic sm"><use href="#i-file" /></svg></span>mod.rs</div>
        <div class="tree-row tree-indent"><span class="twist"></span><span class="fv"><svg class="ic sm"><use href="#i-folder" /></svg></span>daemon</div>
        <div class="tree-row tree-indent" style="padding-left: 32px"><span class="fv"><svg class="ic sm"><use href="#i-file" /></svg></span>providers.rs</div>
        <div class="tree-row tree-indent"><span class="twist"></span><span class="fv"><svg class="ic sm"><use href="#i-folder" /></svg></span>task_routing</div>
      </div>

      <!-- 变更 -->
      <div class="tools-tab-page" data-page="changes" v-show="ui.activeTool === 'changes'">
        <header class="files-head"><span class="files-title">本轮变更</span><span style="flex: 1"></span></header>
        <div class="tools-diff-body" style="display: flex; flex-direction: column">
          <div style="display: flex">
            <div style="width: 55%; border-right: 1px solid var(--border-weak)">
              <button class="plus-sub-item" style="width: 100%; text-align: left"><span class="plus-sub-name">runtime/src/config/provider.rs</span></button>
              <button class="plus-sub-item" style="width: 100%; text-align: left"><span class="plus-sub-name">interfaces/cli/src/provider_config.rs</span></button>
              <button class="plus-sub-item" style="width: 100%; text-align: left"><span class="plus-sub-name">runtime/src/daemon/providers.rs</span></button>
            </div>
            <pre class="tools-diff" style="flex: 1; margin: 0"><span class="added">+pub struct ProviderCatalogStore;</span>
<span class="added">+impl ProviderCatalogStore {</span>
<span class="added">+    pub fn load_from_file(&self) -> Result&lt;ProviderCatalog&gt; {</span>
<span class="hunk">@@ -0,0 +1,42 @@</span>
<span class="removed">-// 旧：CLI 内独立解析</span></pre>
          </div>
        </div>
        <header class="files-head" style="margin-top: 8px"><span class="files-title">Git 工作区</span><span class="git-branch mono">main</span><span style="flex: 1"></span></header>
        <div class="files-empty">工作区无未提交变更</div>
      </div>

      <!-- 终端 -->
      <div class="tools-tab-page" data-page="terminal" v-show="ui.activeTool === 'terminal'">
        <div class="terminal-body"><span class="terminal-prompt">sacode&gt;</span> cargo test -p sacode-runtime --lib config::provider
<span style="color: var(--text-weak)">running 4 tests</span>
<span style="color: var(--success)">test config::provider::tests::loads_standard_catalog ... ok</span>
<span style="color: var(--success)">test config::provider::tests::loads_desktop_camelcase_format ... ok</span>
<span style="color: var(--success)">test config::provider::tests::loads_legacy_single_provider ... ok</span>
<span style="color: var(--success)">test config::provider::tests::normalize_catalog_fixes_dangling_current ... ok</span>
<span style="color: var(--text-strong)">test result: ok. 4 passed; 0 failed</span>
<span class="terminal-prompt">sacode&gt;</span> <span class="terminal-cursor" aria-hidden="true"></span></div>
      </div>

      <!-- 设计 -->
      <div class="tools-tab-page" data-page="design" v-show="ui.activeTool === 'design'">
        <header class="files-head"><span class="files-title">设计令牌</span></header>
        <div class="design-tokens">
          <div class="dt-row"><span class="dt-swatch" style="background: var(--accent)"></span><code>--accent #366CFF</code></div>
          <div class="dt-row"><span class="dt-swatch" style="background: var(--success)"></span><code>--success</code></div>
          <div class="dt-row"><span class="dt-swatch" style="background: var(--warning)"></span><code>--warning</code></div>
          <div class="dt-row"><span class="dt-swatch" style="background: var(--danger)"></span><code>--danger</code></div>
        </div>
        <header class="files-head" style="margin-top: 8px"><span class="files-title">圆角</span></header>
        <div class="design-radii">
          <span class="dt-radius" style="border-radius: var(--radius-sm)">sm</span>
          <span class="dt-radius" style="border-radius: var(--radius-md)">md</span>
          <span class="dt-radius" style="border-radius: var(--radius-lg)">lg</span>
        </div>
      </div>

      <!-- 预览 -->
      <div class="tools-tab-page" data-page="preview" v-show="ui.activeTool === 'preview'">
        <div class="files-empty-preview">
          <svg class="preview-empty-icon" viewBox="0 0 48 48" aria-hidden="true">
            <rect x="6" y="9" width="36" height="26" rx="4" fill="none" stroke="currentColor" stroke-width="1.6" />
            <line x1="6" y1="15" x2="42" y2="15" stroke="currentColor" stroke-width="1.6" />
            <circle cx="11" cy="12" r="1.1" fill="currentColor" />
            <circle cx="15" cy="12" r="1.1" fill="currentColor" />
            <circle cx="19" cy="12" r="1.1" fill="currentColor" />
            <path d="M14 28l6-7 5 5 4-3 5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <p class="preview-empty-title">预览将在任务产出网页/文档后显示</p>
          <p class="preview-empty-sub">Build 模式产出 HTML / 文档后，此处自动嵌入渲染视图</p>
        </div>
      </div>
    </div>
  </aside>
</template>
