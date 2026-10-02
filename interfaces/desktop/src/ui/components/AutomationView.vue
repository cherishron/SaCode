<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { AutomationRule, AutomationRun } from '@cherishron/sacode-client-core';
import { useDesktopApp } from '../composables/useDesktopApp';

const props = defineProps<{ active: boolean }>();
const emit = defineEmits<{ close: [] }>();
const { app, connection } = useDesktopApp();
const rules = ref<AutomationRule[]>([]);
const history = ref<AutomationRun[]>([]);
const loading = ref(false);
const busy = ref(false);
const editing = ref(false);
const editId = ref<string | null>(null);
const name = ref('');
const cron = ref('');
const prompt = ref('');
const backend = ref('');
const enabled = ref(true);
const error = ref('');
const notice = ref('');
/** 右侧详情当前选中的规则 */
const selectedRuleId = ref<string | null>(null);
let generation = 0;
const recentHistory = computed(() => history.value.slice(0, 50));
const selectedRule = computed(() =>
  rules.value.find((rule) => rule.id === selectedRuleId.value) ?? null,
);
/** 选中规则的运行历史 */
const selectedRuns = computed(() => {
  if (!selectedRuleId.value) return recentHistory.value;
  return recentHistory.value.filter((run) => run.rule_id === selectedRuleId.value);
});
function message(e: unknown) { return e instanceof Error ? e.message : String(e); }
function ruleName(id: string) { return rules.value.find(rule => rule.id === id)?.name ?? id; }
function formatTime(value: string | null) { return value ? new Date(value).toLocaleString() : '未计划'; }
async function refresh() {
  const current = ++generation;
  loading.value = true;
  error.value = '';
  try {
    const data = await app.refreshAutomation();
    if (current !== generation) return;
    rules.value = data.rules;
    history.value = data.history;
    // 保持选中；被删则回退到第一条
    if (selectedRuleId.value && !rules.value.some((r) => r.id === selectedRuleId.value)) {
      selectedRuleId.value = rules.value[0]?.id ?? null;
    } else if (!selectedRuleId.value) {
      selectedRuleId.value = rules.value[0]?.id ?? null;
    }
  } catch (e) { if (current === generation) error.value = message(e); }
  finally { if (current === generation) loading.value = false; }
}
function create() {
  editId.value = null; name.value = ''; cron.value = ''; prompt.value = ''; backend.value = ''; enabled.value = true;
  editing.value = true; error.value = '';
  selectedRuleId.value = null;
}
function edit(rule: AutomationRule) {
  editId.value = rule.id; name.value = rule.name; cron.value = rule.cron_expr; prompt.value = rule.prompt;
  backend.value = rule.backend_id ?? ''; enabled.value = rule.enabled;
  editing.value = true; error.value = '';
  selectedRuleId.value = rule.id;
}
function selectRule(rule: AutomationRule) {
  selectedRuleId.value = rule.id;
  // 查看详情时退出编辑态
  if (editing.value && editId.value !== rule.id) editing.value = false;
}
async function save() {
  if (!name.value.trim() || !cron.value.trim() || !prompt.value.trim()) { error.value = '请填写名称、Cron 表达式和任务内容'; return; }
  busy.value = true; error.value = '';
  try {
    await app.saveAutomationRule({ name: name.value.trim(), cron_expr: cron.value.trim(), prompt: prompt.value.trim(), backend_id: backend.value.trim() || null, enabled: enabled.value }, editId.value ?? undefined);
    const savedId = editId.value;
    editing.value = false; notice.value = '规则已保存'; await refresh();
    if (savedId) selectedRuleId.value = savedId;
    else selectedRuleId.value = rules.value[0]?.id ?? null;
  } catch (e) { error.value = message(e); }
  finally { busy.value = false; }
}
async function perform(action: 'toggle' | 'run' | 'delete', rule: AutomationRule) {
  if (action === 'delete' && !window.confirm(`删除规则“${rule.name}”？此操作无法撤销。`)) return;
  if (action === 'run' && !window.confirm(`立即执行“${rule.name}”？这会启动真实任务。`)) return;
  busy.value = true; error.value = ''; notice.value = '';
  try {
    if (action === 'toggle') await app.toggleAutomationRule(rule.id);
    else if (action === 'run') { const run = await app.runAutomationRule(rule.id); notice.value = `任务已启动：${run.task_id}`; }
    else {
      await app.deleteAutomationRule(rule.id);
      if (selectedRuleId.value === rule.id) selectedRuleId.value = null;
    }
    await refresh();
  } catch (e) { error.value = message(e); }
  finally { busy.value = false; }
}
watch(() => props.active, active => {
  generation++;
  if (active) void refresh();
}, { immediate: true });
</script>

<template>
  <section class="feature-overlay" aria-label="自动化" @click.self="emit('close')">
    <div class="feature-panel">
      <header class="feature-panel-head">
        <div class="feature-panel-title">
          <span class="feature-eyebrow">WORKSPACE / AUTOMATION</span>
          <h1>自动化</h1>
        </div>
        <div class="feature-actions">
          <button class="feature-button primary" type="button" @click="create">新建规则</button>
          <button class="ghost-btn" type="button" title="关闭" aria-label="关闭自动化" @click="emit('close')">×</button>
        </div>
      </header>
      <div class="feature-toolbar">
        <span>左栏选择规则，右栏查看详情与运行历史</span>
        <button class="feature-button" type="button" @click="refresh">刷新</button>
      </div>
      <p v-if="connection !== 'healthy'" class="feature-hint" role="status">守护进程尚未就绪；连接后可重试。</p>
      <p v-if="error" class="feature-error" role="alert">{{ error }} <button type="button" @click="refresh">重试</button></p>
      <p v-if="notice" class="feature-hint" role="status">{{ notice }}</p>

      <!-- 左规则列表 / 右详情（页壳不滚，内容区自身 .scroll-y） -->
      <div class="automation-split">
        <div class="automation-list scroll-y" aria-label="规则列表">
          <div class="feature-section-title"><h2>规则</h2><span>{{ rules.length }} 条</span></div>
          <p v-if="loading" class="feature-empty">正在加载…</p>
          <p v-else-if="!rules.length" class="feature-empty">尚无自动化规则，点击“新建规则”开始。</p>
          <button
            v-for="rule in rules"
            :key="rule.id"
            type="button"
            class="automation-rule-row"
            :class="{ selected: selectedRuleId === rule.id }"
            @click="selectRule(rule)"
          >
            <strong>{{ rule.name }}</strong>
            <small>{{ rule.enabled ? '已启用' : '已暂停' }} · {{ rule.cron_expr }}</small>
            <small>下次执行：{{ formatTime(rule.next_run) }}</small>
          </button>
        </div>

        <div class="automation-detail scroll-y">
          <!-- 编辑表单（新建 / 编辑） -->
          <form v-if="editing" class="feature-form feature-editor" @submit.prevent="save">
            <h2>{{ editId ? '编辑规则' : '新建规则' }}</h2>
            <label>名称 <input v-model="name" required maxlength="200" placeholder="例如：每日项目回顾" /></label>
            <label>Cron 表达式 <input v-model="cron" required placeholder="例如：0 30 9 * * *" /><small>使用 6 段 Cron（秒 分 时 日 月 周），以 UTC 计算执行时间。</small></label>
            <label>任务内容 <textarea v-model="prompt" required rows="5" placeholder="描述需要执行的任务" /></label>
            <label>执行后端（可选） <input v-model="backend" placeholder="留空使用默认后端" /></label>
            <label class="feature-check"><input v-model="enabled" type="checkbox" /> 启用规则</label>
            <div class="feature-actions"><button class="feature-button primary" type="submit" :disabled="busy">{{ busy ? '保存中…' : '保存规则' }}</button><button class="feature-button" type="button" @click="editing = false">取消</button></div>
          </form>

          <!-- 详情 -->
          <template v-else-if="selectedRule">
            <div class="feature-detail-head">
              <div>
                <small>{{ selectedRule.enabled ? '已启用' : '已暂停' }}</small>
                <h2>{{ selectedRule.name }}</h2>
              </div>
              <div class="feature-actions">
                <button class="feature-button" type="button" :disabled="busy" @click="edit(selectedRule)">编辑</button>
                <button class="feature-button" type="button" :disabled="busy" @click="perform('toggle', selectedRule)">{{ selectedRule.enabled ? '暂停' : '启用' }}</button>
                <button class="feature-button" type="button" :disabled="busy" @click="perform('run', selectedRule)">立即执行</button>
                <button class="feature-button danger" type="button" :disabled="busy" @click="perform('delete', selectedRule)">删除</button>
              </div>
            </div>
            <dl class="automation-meta">
              <dt>Cron 表达式</dt><dd class="mono">{{ selectedRule.cron_expr }}</dd>
              <dt>下次执行</dt><dd>{{ formatTime(selectedRule.next_run) }}</dd>
              <dt>执行后端</dt><dd>{{ selectedRule.backend_id || '默认后端' }}</dd>
            </dl>
            <h3 class="settings-section-title">任务内容</h3>
            <p class="feature-document">{{ selectedRule.prompt }}</p>

            <div class="feature-section-title"><h2>运行历史</h2><span>最近 {{ selectedRuns.length }} 条</span></div>
            <p v-if="!selectedRuns.length" class="feature-empty">暂无运行记录。</p>
            <div v-for="run in selectedRuns" :key="run.id" class="feature-history">
              <strong>{{ ruleName(run.rule_id) }}</strong>
              <span>{{ run.status }}</span>
              <small>{{ formatTime(run.triggered_at) }}</small>
              <small :title="run.task_id">任务 {{ run.task_id }}</small>
            </div>
          </template>

          <p v-else class="feature-empty">{{ loading ? '正在加载…' : '选择左侧规则查看详情，或点击“新建规则”。' }}</p>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* 左规则列表 / 右详情
 * 契约：页壳不滚，内容区自身 .scroll-y（禁止 min-height 撑破壳） */
.automation-split {
  display: flex;
  align-items: stretch;
  flex: 1;
  min-height: 0;
  border-top: 1px solid var(--border-weak);
}
.automation-list {
  flex: 0 0 280px;
  min-width: 220px;
  max-width: 360px;
  border-right: 1px solid var(--border-weak);
  padding-right: 16px;
  min-height: 0;
}
.automation-rule-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 12px;
  border: 0;
  border-bottom: 1px solid var(--border-weak);
  border-radius: var(--radius-sm, 4px);
  background: transparent;
  color: var(--text-strong);
  text-align: left;
  cursor: pointer;
}
.automation-rule-row:hover {
  background: var(--bg-raised);
}
/* 选中=填充（布局契约） */
.automation-rule-row.selected {
  background: var(--accent-weaker);
  color: var(--text-strong);
}
.automation-rule-row strong {
  font-weight: 600;
}
.automation-rule-row small {
  color: var(--text-weak);
}
.automation-detail {
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding: 20px 26px;
}
.automation-meta {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 8px 16px;
  margin: 0 0 8px;
}
.automation-meta dt {
  color: var(--text-weak);
  font-size: 12px;
}
.automation-meta dd {
  margin: 0;
  color: var(--text-base);
}
.settings-section-title {
  margin: 18px 0 8px;
  font-size: 14px;
  font-weight: 600;
}

@media (max-width: 768px) {
  .automation-split {
    flex-direction: column;
  }
  .automation-list {
    flex: 0 0 auto;
    max-width: none;
    max-height: 240px;
    border-right: 0;
    border-bottom: 1px solid var(--border-weak);
    padding-right: 0;
  }
  .automation-detail {
    padding: 20px 0;
  }
}
</style>
