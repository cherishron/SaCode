<script setup lang="ts">
/**
 * 审批卡（P0-2）
 *
 * 纯展示 + 事件派发组件：不直接调用服务层，审批数据与“提交中/错误”状态
 * 全部由 useDesktopApp 注入，点击“允许/拒绝”仅向上派发 resolve 事件，
 * 由上层调用 app.resolveApproval(taskId, approvalId, true/false)。
 */
import type { PendingApproval } from '@cherishron/sacode-client-core';

const props = defineProps<{
  taskId: string;
  approvals: PendingApproval[];
  /** 正在提交的 approval_id 集合（命中时禁用按钮并显示“提交中”） */
  resolvingIds?: string[];
  /** approval_id → 错误文案（命中时显示错误） */
  errors?: Record<string, string>;
}>();

const emit = defineEmits<{
  resolve: [payload: { taskId: string; approvalId: string; approved: boolean }];
}>();

function isResolving(approvalId: string): boolean {
  return props.resolvingIds?.includes(approvalId) === true;
}

function errorFor(approvalId: string): string {
  return props.errors?.[approvalId] ?? '';
}

/** 参数摘要：优先展示常见路径字段，否则回退为截断的 JSON。 */
function argsSummary(args: Record<string, unknown> | undefined): string {
  if (!args) return '';
  const pick = args.path ?? args.file ?? args.filename ?? args.command ?? args.pattern;
  if (typeof pick === 'string' && pick) return pick;
  try {
    const json = JSON.stringify(args);
    if (!json || json === '{}') return '';
    return json.length > 200 ? `${json.slice(0, 200)}…` : json;
  } catch {
    return '';
  }
}

function emitResolve(approvalId: string, approved: boolean) {
  if (isResolving(approvalId)) return;
  emit('resolve', { taskId: props.taskId, approvalId, approved });
}
</script>

<template>
  <article class="msg-card msg-approval">
    <header class="msg-card-head">
      <span class="msg-card-label">审批</span>
      <span class="msg-card-id mono">{{ taskId.slice(0, 8) }}</span>
    </header>

    <div
      v-for="approval in approvals"
      :key="approval.approval_id"
      class="approval-item"
    >
      <div class="approval-tool">
        <span class="approval-tool-name mono">{{ approval.tool_name }}</span>
        <span v-if="approval.side_effect_level" class="approval-level">
          {{ approval.side_effect_level }}
        </span>
      </div>
      <p v-if="argsSummary(approval.args)" class="approval-args mono">
        {{ argsSummary(approval.args) }}
      </p>
      <p class="approval-meta">
        已等待 {{ approval.waited_secs }}s · 剩余 {{ approval.expires_in_secs }}s
      </p>

      <p v-if="errorFor(approval.approval_id)" class="approval-error" role="alert">
        {{ errorFor(approval.approval_id) }}
      </p>

      <div class="approval-actions">
        <span v-if="isResolving(approval.approval_id)" class="approval-pending" role="status">
          提交中…
        </span>
        <template v-else>
          <t-button
            size="small"
            variant="outline"
            theme="danger"
            @click="emitResolve(approval.approval_id, false)"
          >
            拒绝
          </t-button>
          <t-button
            size="small"
            theme="primary"
            @click="emitResolve(approval.approval_id, true)"
          >
            允许
          </t-button>
        </template>
      </div>
    </div>
  </article>
</template>

<style scoped>
.msg-approval {
  border: 1px solid var(--warning);
  border-radius: var(--radius-md);
  padding: var(--space-3);
  background: var(--warning-soft);
}

.approval-item {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2) 0;
  border-top: 1px solid var(--border-weak);
}

.approval-item:first-child {
  border-top: 0;
}

.approval-tool {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--fs-list);
  color: var(--text-strong);
}

.approval-tool-name {
  font-weight: 500;
}

.approval-level {
  font-size: 11px;
  color: var(--text-weak);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-sm);
  padding: 0 6px;
}

.approval-args {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--code-bg);
  border: 1px solid var(--code-border);
  color: var(--text-base);
  overflow-x: auto;
  word-break: break-all;
}

.approval-meta {
  margin: 0;
  font-size: 11px;
  color: var(--text-weak);
}

.approval-error {
  margin: 0;
  font-size: var(--fs-list);
  color: var(--danger);
}

.approval-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
}

.approval-pending {
  font-size: var(--fs-list);
  color: var(--text-weak);
}
</style>
