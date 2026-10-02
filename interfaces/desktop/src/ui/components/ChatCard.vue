<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  isCollapsibleCard,
  defaultCollapsed,
  conflictToneClass,
  type RoleAssignmentRole,
  type ModelRouteTarget,
} from '../logic/turn-events.ts';

/** 与 turn-events.ts 的 DisplayItem 对齐的卡片 item。 */
export interface ChatCardItem {
  id: string;
  type: 'user' | 'text' | 'thinking' | 'tool' | 'approval' | 'ask' | 'subagent' | 'error' | 'system'
    | 'role_assignment' | 'conflict' | 'model_route' | 'summary';
  taskId?: string;
  // text / user / error / system
  text?: string;
  // thinking
  collapsed?: boolean;
  // tool
  tool?: string;
  input?: unknown;
  output?: string;
  status?: string;
  durationMs?: number;
  // approval
  approvalId?: string;
  summary?: string;
  diff?: string;
  // ask
  questionId?: string;
  question?: string;
  options?: string[];
  allowMultiple?: boolean;
  answer?: string | string[];
  // subagent
  agentId?: string;
  title?: string;
  result?: string;
  summaryText?: string;
  // role_assignment（灵枢 · 自组织）
  roles?: RoleAssignmentRole[] | string[];
  // conflict（灵枢 · 自防护）
  conflictId?: string;
  kind?: string;
  details?: string[];
  intervention?: { target_role?: string; action?: string };
  // model_route（灵枢 · 自愈合）
  roleId?: string;
  primary?: ModelRouteTarget;
  fallbacks?: Array<{ provider: string; model: string; score?: number }>;
  reason?: string;
  failedOver?: boolean;
  // summary（灵枢 · 收尾）
  task?: string;
  conclusion?: string;
  keyRisks?: string[];
  nextAction?: string;
  conflicts?: string[];
}

const props = withDefaults(
  defineProps<{
    item: ChatCardItem;
    /** 强制展开（历史回放时可外部控制） */
    forceOpen?: boolean;
  }>(),
  { forceOpen: false },
);

/** 折叠状态：thinking/tool/subagent/role_assignment/model_route 默认折叠 */
const open = ref(!defaultCollapsed(props.item.type));
const isOpen = computed(() => props.forceOpen || open.value);

function toggle() {
  open.value = !open.value;
}

const collapsible = computed(() => isCollapsibleCard(props.item.type));

const headerLabel = computed(() => {
  switch (props.item.type) {
    case 'user': return '你';
    case 'text': return 'SaCode';
    case 'thinking': return '思考';
    case 'tool': return props.item.tool || '工具';
    case 'approval': return '审批';
    case 'ask': return '提问';
    case 'subagent': return props.item.title || '子代理';
    case 'error': return '错误';
    case 'role_assignment': return '灵枢 · 角色编排';
    case 'conflict': return '灵枢 · 冲突干预';
    case 'model_route': return '模型路由';
    case 'summary': return '任务摘要';
    default: return '系统';
  }
});

const statusLabel = computed(() => {
  const s = props.item.status;
  if (!s) return '';
  const map: Record<string, string> = {
    running: '运行中',
    ok: '完成',
    err: '失败',
    done: '完成',
    failed: '失败',
    pending: '待处理',
    approved: '已通过',
    rejected: '已拒绝',
    answered: '已回答',
    cancelled: '已取消',
    detected: '已检测',
    intervening: '干预中',
    resolved: '已解决',
    ignored: '已忽略',
  };
  return map[s] ?? s;
});

const toolInputText = computed(() => {
  const input = props.item.input;
  if (input == null) return '';
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
});

const answerText = computed(() => {
  const a = props.item.answer;
  if (a == null) return '';
  return Array.isArray(a) ? a.join('、') : a;
});

// ---- 灵枢四卡 ----

/** role_assignment 展开行：角色名 + 打分/原因 + 模型 */
const roleRows = computed(() => {
  if (props.item.type !== 'role_assignment') return [];
  const roles = props.item.roles;
  if (!Array.isArray(roles)) return [];
  return roles.map((r) => {
    if (typeof r === 'string') return { name: r, scoreText: '', reason: '', model: '' };
    const name = r.role_name || r.role_id;
    const scoreText = r.score != null ? String(r.score) : '';
    const model = [r.model_provider, r.model_name].filter(Boolean).join(' / ');
    return { name, scoreText, reason: r.reason ?? '', model };
  });
});

/** conflict.status → 样式类（detected/intervening 警示、resolved 成功、ignored 弱化） */
const conflictClass = computed(() => {
  if (props.item.type !== 'conflict') return '';
  return conflictToneClass(props.item.status ?? 'detected');
});

/** model_route 头部摘要：主模型 → 备选 */
const routeHeadline = computed(() => {
  if (props.item.type !== 'model_route') return '';
  const primary = props.item.primary;
  if (!primary) return '';
  const primaryText = [primary.provider, primary.model].filter(Boolean).join(' / ');
  const fallbackText = (props.item.fallbacks ?? [])
    .map((f) => [f.provider, f.model].filter(Boolean).join(' / '))
    .filter(Boolean)
    .join('、');
  return fallbackText ? `${primaryText} → ${fallbackText}` : primaryText;
});

/** summary 风险列表；缺字段时不渲染 */
const riskList = computed(() => {
  if (props.item.type !== 'summary') return [];
  return props.item.keyRisks ?? [];
});
</script>

<template>
  <article
    class="chat-card"
    :class="[
      `chat-card--${item.type}`,
      conflictClass,
      { 'chat-card--collapsible': collapsible, 'chat-card--open': isOpen },
    ]"
  >
    <!-- 可折叠卡片：thinking / tool / subagent / role_assignment / model_route -->
    <template v-if="collapsible">
      <button type="button" class="chat-card__head chat-card__head--btn" @click="toggle">
        <span class="chat-card__chevron" :class="{ open: isOpen }">▸</span>
        <span class="chat-card__label">{{ headerLabel }}</span>
        <!-- model_route 细条：折叠态直接露出主 → 备 -->
        <span v-if="item.type === 'model_route' && routeHeadline" class="chat-card__route">{{ routeHeadline }}</span>
        <span v-if="item.type === 'model_route' && item.failedOver" class="chat-card__dot" title="发生过故障切换"></span>
        <span v-if="statusLabel" class="chat-card__status" :class="`st-${item.status}`">{{ statusLabel }}</span>
        <span v-if="item.durationMs != null" class="chat-card__meta">{{ item.durationMs }}ms</span>
      </button>
      <div v-if="isOpen" class="chat-card__body">
        <!-- thinking -->
        <pre v-if="item.type === 'thinking'" class="chat-card__pre chat-card__thinking">{{ item.text }}</pre>

        <!-- tool -->
        <template v-else-if="item.type === 'tool'">
          <div v-if="toolInputText" class="chat-card__section">
            <div class="chat-card__section-label">输入</div>
            <pre class="chat-card__pre">{{ toolInputText }}</pre>
          </div>
          <div v-if="item.output" class="chat-card__section">
            <div class="chat-card__section-label">输出</div>
            <pre class="chat-card__pre">{{ item.output }}</pre>
          </div>
        </template>

        <!-- subagent -->
        <template v-else-if="item.type === 'subagent'">
          <p v-if="item.summaryText" class="chat-card__text">{{ item.summaryText }}</p>
          <pre v-if="item.result" class="chat-card__pre">{{ item.result }}</pre>
        </template>

        <!-- role_assignment：角色名 + 打分/原因 + 模型 -->
        <template v-else-if="item.type === 'role_assignment'">
          <ul class="chat-card__roles">
            <li v-for="(row, i) in roleRows" :key="i" class="chat-card__role-row">
              <span class="chat-card__role-name">{{ row.name }}</span>
              <span v-if="row.scoreText" class="chat-card__role-score">{{ row.scoreText }}</span>
              <span v-if="row.model" class="chat-card__role-model">{{ row.model }}</span>
              <p v-if="row.reason" class="chat-card__role-reason">{{ row.reason }}</p>
            </li>
          </ul>
        </template>

        <!-- model_route：主模型 / 备选 / 路由原因 -->
        <template v-else-if="item.type === 'model_route'">
          <div v-if="item.primary" class="chat-card__section">
            <div class="chat-card__section-label">主模型</div>
            <p class="chat-card__text">
              {{ [item.primary.provider, item.primary.model].filter(Boolean).join(' / ') }}
              <span v-if="item.primary.needs_thinking" class="chat-card__meta-inline">需思考</span>
            </p>
          </div>
          <div v-if="item.fallbacks?.length" class="chat-card__section">
            <div class="chat-card__section-label">备选</div>
            <ul class="chat-card__roles">
              <li v-for="(f, i) in item.fallbacks" :key="i" class="chat-card__role-row">
                <span class="chat-card__role-name">{{ [f.provider, f.model].filter(Boolean).join(' / ') }}</span>
                <span v-if="f.score != null" class="chat-card__role-score">{{ f.score }}</span>
              </li>
            </ul>
          </div>
          <p v-if="item.reason" class="chat-card__text chat-card__reason">原因：{{ item.reason }}</p>
        </template>
      </div>
    </template>

    <!-- 普通文字气泡 -->
    <template v-else-if="item.type === 'user' || item.type === 'text' || item.type === 'error' || item.type === 'system'">
      <header class="chat-card__head">
        <span class="chat-card__label">{{ headerLabel }}</span>
        <span v-if="item.taskId" class="chat-card__id mono">{{ item.taskId.slice(0, 8) }}</span>
      </header>
      <div class="chat-card__body">
        <p class="chat-card__text" :class="{ 'chat-card__text--error': item.type === 'error' }">{{ item.text }}</p>
      </div>
    </template>

    <!-- 灵枢 · 冲突/干预警示卡（非折叠；标题=summary，下挂 details） -->
    <template v-else-if="item.type === 'conflict'">
      <header class="chat-card__head">
        <span class="chat-card__label">{{ headerLabel }}</span>
        <span v-if="item.kind" class="chat-card__meta-inline">{{ item.kind }}</span>
        <span v-if="statusLabel" class="chat-card__status" :class="`st-${item.status}`">{{ statusLabel }}</span>
      </header>
      <div class="chat-card__body">
        <p class="chat-card__text"><strong>{{ item.summary }}</strong></p>
        <ul v-if="item.details?.length" class="chat-card__roles">
          <li v-for="(d, i) in item.details" :key="i" class="chat-card__role-row">{{ d }}</li>
        </ul>
        <p v-if="item.intervention?.action || item.intervention?.target_role" class="chat-card__reason">
          干预：
          <template v-if="item.intervention?.target_role">{{ item.intervention.target_role }} · </template>
          <template v-if="item.intervention?.action">{{ item.intervention.action }}</template>
        </p>
      </div>
    </template>

    <!-- 灵枢 · 任务摘要收尾卡（非折叠；结论 / 风险 / 下一步） -->
    <template v-else-if="item.type === 'summary'">
      <header class="chat-card__head">
        <span class="chat-card__label">{{ headerLabel }}</span>
        <span v-if="item.taskId" class="chat-card__id mono">{{ item.taskId.slice(0, 8) }}</span>
      </header>
      <div class="chat-card__body">
        <p v-if="item.task" class="chat-card__section-label">{{ item.task }}</p>
        <p v-if="item.conclusion" class="chat-card__text">{{ item.conclusion }}</p>
        <div v-if="riskList.length" class="chat-card__section">
          <div class="chat-card__section-label">风险</div>
          <ul class="chat-card__roles">
            <li v-for="(r, i) in riskList" :key="i" class="chat-card__role-row">{{ r }}</li>
          </ul>
        </div>
        <p v-if="item.nextAction" class="chat-card__reason">下一步：{{ item.nextAction }}</p>
      </div>
    </template>

    <!-- 审批卡占位：上层可替换为 ApprovalCard 插槽 -->
    <template v-else-if="item.type === 'approval'">
      <header class="chat-card__head">
        <span class="chat-card__label">审批</span>
        <span v-if="statusLabel" class="chat-card__status" :class="`st-${item.status}`">{{ statusLabel }}</span>
      </header>
      <div class="chat-card__body">
        <p class="chat-card__text"><strong>{{ item.tool }}</strong> — {{ item.summary }}</p>
        <pre v-if="item.diff" class="chat-card__pre">{{ item.diff }}</pre>
      </div>
      <slot name="approval-actions" />
    </template>

    <!-- 提问卡占位：上层可替换为 AskCard 插槽 -->
    <template v-else-if="item.type === 'ask'">
      <header class="chat-card__head">
        <span class="chat-card__label">提问</span>
        <span v-if="statusLabel" class="chat-card__status" :class="`st-${item.status}`">{{ statusLabel }}</span>
      </header>
      <div class="chat-card__body">
        <p class="chat-card__text">{{ item.question }}</p>
        <p v-if="answerText" class="chat-card__answer">回答：{{ answerText }}</p>
      </div>
      <slot name="ask-actions" />
    </template>

    <slot />
  </article>
</template>

<style scoped>
.chat-card {
  border-radius: var(--radius-md);
  margin-bottom: var(--space-2);
  font-size: var(--fs-body);
  overflow: hidden;
}

/* 普通气泡 */
.chat-card--user {
  background: var(--accent-soft);
  border: 1px solid var(--accent-weaker);
  padding: var(--space-3);
}
.chat-card--text {
  background: var(--bg-surface);
  border: 1px solid var(--border-weak);
  padding: var(--space-3);
}
.chat-card--error {
  background: var(--danger-soft);
  border: 1px solid var(--danger);
  padding: var(--space-3);
}
.chat-card--system {
  background: var(--bg-inset);
  border: 1px solid var(--border-weak);
  padding: var(--space-2) var(--space-3);
}

/* 可折叠卡片 */
.chat-card--thinking {
  background: var(--bg-inset);
  border: 1px solid var(--border-weak);
}
.chat-card--tool {
  background: var(--bg-surface);
  border: 1px solid var(--border-weak);
}
.chat-card--subagent {
  background: var(--info-soft);
  border: 1px solid var(--info);
}

/* 审批 / 提问 */
.chat-card--approval {
  background: var(--warning-soft);
  border: 1px solid var(--warning);
  padding: var(--space-3);
}
.chat-card--ask {
  background: var(--accent-soft);
  border: 1px solid var(--accent);
  padding: var(--space-3);
}

/* 灵枢四卡（§2.3） */
.chat-card--role_assignment {
  background: var(--bg-inset);
  border: 1px solid var(--border-weak);
}
.chat-card--conflict {
  padding: var(--space-3);
}
/* conflict 状态色调：detected/intervening 警示、resolved 成功、ignored 弱化 */
.chat-card--conflict-warning {
  background: var(--warning-soft);
  border: 1px solid var(--warning);
}
.chat-card--conflict-success {
  background: var(--success-soft);
  border: 1px solid var(--success);
}
.chat-card--conflict-muted {
  background: var(--bg-inset);
  border: 1px solid var(--border-weak);
  opacity: 0.72;
}
.chat-card--model_route {
  background: var(--bg-surface);
  border: 1px solid var(--border-weak);
}
.chat-card--summary {
  background: var(--accent-soft);
  border: 1px solid var(--accent-weaker);
  padding: var(--space-3);
}

/* 头部 */
.chat-card__head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--fs-list);
  color: var(--text-weak);
}
.chat-card__head--btn {
  width: 100%;
  background: none;
  border: none;
  cursor: pointer;
  padding: var(--space-2) var(--space-3);
  text-align: left;
  font-size: var(--fs-list);
  color: var(--text-weak);
}
.chat-card__head--btn:hover {
  background: var(--bg-inset);
}

.chat-card__chevron {
  display: inline-block;
  transition: transform var(--dur-fast) var(--ease-out);
  font-size: 10px;
}
.chat-card__chevron.open {
  transform: rotate(90deg);
}

.chat-card__label {
  font-weight: 500;
  color: var(--text-base);
}

.chat-card__status {
  font-size: 11px;
  padding: 0 6px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-base);
}
.chat-card__status.st-ok, .chat-card__status.st-done, .chat-card__status.st-approved {
  color: var(--success);
  border-color: var(--success);
}
.chat-card__status.st-err, .chat-card__status.st-failed, .chat-card__status.st-rejected {
  color: var(--danger);
  border-color: var(--danger);
}
.chat-card__status.st-running {
  color: var(--warning);
  border-color: var(--warning);
}

.chat-card__meta {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-weak);
}

.chat-card__id {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-weak);
}

/* 内容 */
.chat-card__body {
  padding: var(--space-2) var(--space-3) var(--space-3);
}
.chat-card__text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-strong);
  line-height: 1.6;
}
.chat-card__text--error {
  color: var(--danger);
}

.chat-card__thinking {
  color: var(--text-weak);
  font-style: italic;
}

.chat-card__pre {
  margin: 0;
  padding: var(--space-2);
  background: var(--code-bg);
  border: 1px solid var(--code-border);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: var(--fs-list);
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 320px;
  overflow-y: auto;
}

.chat-card__section {
  margin-top: var(--space-2);
}
.chat-card__section:first-child {
  margin-top: 0;
}
.chat-card__section-label {
  font-size: 11px;
  color: var(--text-weak);
  margin-bottom: var(--space-1);
}

.chat-card__answer {
  margin: var(--space-2) 0 0;
  font-size: var(--fs-list);
  color: var(--text-base);
}

/* 灵枢卡片元素 */
.chat-card__roles {
  margin: 0;
  padding: 0;
  list-style: none;
}
.chat-card__role-row {
  padding: var(--space-1) 0;
  border-bottom: 1px solid var(--border-weak);
  font-size: var(--fs-list);
  line-height: var(--list-line);
}
.chat-card__role-row:last-child {
  border-bottom: none;
}
.chat-card__role-name {
  font-weight: 500;
  color: var(--text-strong);
  margin-right: var(--space-2);
}
.chat-card__role-score {
  display: inline-block;
  min-width: 2em;
  padding: 0 6px;
  margin-right: var(--space-2);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-sm);
  color: var(--accent-fg);
  font-family: var(--font-mono);
  font-size: 11px;
  text-align: center;
}
.chat-card__role-model {
  color: var(--text-weak);
  font-family: var(--font-mono);
}
.chat-card__role-reason {
  margin: var(--space-1) 0 0;
  color: var(--text-base);
  font-size: var(--fs-list);
  white-space: pre-wrap;
}
.chat-card__route {
  color: var(--text-weak);
  font-family: var(--font-mono);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chat-card__dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--warning);
  flex-shrink: 0;
}
.chat-card__reason {
  margin: var(--space-2) 0 0;
  color: var(--text-base);
  font-size: var(--fs-list);
}
.chat-card__meta-inline {
  margin-left: var(--space-1);
  color: var(--text-weak);
  font-size: 11px;
}
</style>
