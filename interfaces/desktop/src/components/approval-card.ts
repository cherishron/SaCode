/** ApprovalCard — 审批请求卡片
 * 展示工具名、风险级别、参数摘要、Diff 入口、批准/拒绝按钮。
 */
import { el } from '../dom.ts';
import type { DesktopApp } from '../app/service.ts';
import type { PendingApproval } from '@cherishron/sacode-client-core';

export function buildApprovalCard(app: DesktopApp, approval: PendingApproval) {
  const level = approval.side_effect_level as string;
  const levelClass = level === 'high' ? 'bad' : level === 'medium' ? 'warn' : '';
  const argsSummary = JSON.stringify(approval.args, null, 2).slice(0, 600);
  const resolving = app.resolvingApprovals.has(approval.approval_id);
  const error = app.approvalErrors.get(approval.approval_id);

  return el('div', { className: 'approval-card' }, [
    // 头部
    el('div', { className: 'approval-card-header' }, [
      el('span', { className: 'approval-icon' }, ['⚠']),
      el('strong', { className: 'approval-tool-name mono' }, [approval.tool_name]),
      el('span', { className: `badge ${levelClass}` }, [
        `风险: ${level}`,
      ]),
    ]),

    // 参数
    el('pre', { className: 'approval-card-args mono' }, [argsSummary]),

    // 操作按钮
    el('div', { className: 'approval-actions' }, [
      el('button', {
        className: 'btn ok',
        disabled: resolving,
        onclick: () => void app.resolveApproval(approval.task_id, approval.approval_id, true),
      }, ['批准']),
      el('button', {
        className: 'btn danger',
        disabled: resolving,
        onclick: () => void app.resolveApproval(approval.task_id, approval.approval_id, false, 'denied from desktop'),
      }, ['拒绝']),
    ]),
    ...(error ? [el('div', { className: 'approval-error', role: 'alert' }, [`提交失败：${error}`])] : []),
  ]);
}
