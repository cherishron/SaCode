/** ContextPanel — 右栏上下文面板：Changes / Approvals / Activity 三 Tab
 * Phase 3: 接入独立组件，Changes 用 DiffView，Approvals 用 ApprovalCard
 */
import { el } from '../dom.ts';
import type { DesktopApp } from './service.ts';
import { buildApprovalCard } from '../components/approval-card.ts';
import { buildDiffView, parseDiff } from '../components/diff-view.ts';

export type ContextTab = 'changes' | 'approvals' | 'audit' | 'activity';

export function buildContextPanel(app: DesktopApp, activeTab: ContextTab = 'changes') {
  const pendingCount = app.approvals.length;
  const changeCount = app.changes.length;
  const auditCount = app.auditFindings.length;

  return el('aside', { className: 'context-panel' }, [
    // Tab 切换
    el('div', { className: 'context-tabs' }, [
      buildTab('changes', 'Changes', activeTab, changeCount),
      buildTab('approvals', 'Approvals', activeTab, pendingCount),
      buildTab('audit', 'Audit', activeTab, auditCount),
      buildTab('activity', 'Activity', activeTab, 0),
    ]),

    // 内容区
    el('div', { className: 'context-content' }, [
      activeTab === 'changes' ? buildChangesTab(app) : '',
      activeTab === 'approvals' ? buildApprovalsTab(app) : '',
      activeTab === 'audit' ? buildAuditTab(app) : '',
      activeTab === 'activity' ? buildActivityTab(app) : '',
    ].filter(Boolean) as Node[]),
  ]);
}

function buildTab(
  key: ContextTab,
  label: string,
  active: ContextTab,
  count: number,
) {
  return el('button', {
    className: `context-tab ${active === key ? 'active' : ''}`,
    dataset: { tab: key },
  }, [
    el('span', {}, [label]),
    ...(count > 0
      ? [el('span', { className: `badge ${key === 'approvals' ? 'warn' : 'accent'} context-tab-count` }, [String(count)])]
      : []),
  ]);
}

/** Changes Tab — 文件变更列表，每项可展开 DiffView */
function buildChangesTab(app: DesktopApp) {
  if (app.changes.length === 0) {
    return el('div', { className: 'context-tab-content' }, [
      el('div', { className: 'context-empty' }, [
        el('div', { className: 'context-empty-icon' }, ['📝']),
        el('div', { className: 'muted' }, ['尚无文件变更']),
      ]),
    ]);
  }

  const kindLabel: Record<string, string> = {
    added: '新增',
    modified: '修改',
    deleted: '删除',
    renamed: '重命名',
    copied: '复制',
    type_changed: '类型变更',
  };

  return el('div', { className: 'context-tab-content' },
    app.changes.slice(-50).map((c) => {
      const diffLines = c.binary ? [] : parseDiff(c.diff);
      const hasDiff = diffLines.length > 0;
      const label = kindLabel[c.kind] ?? c.kind;
      const title = c.previous_path ? `${c.previous_path} → ${c.path}` : c.path;

      return el('div', { className: 'change-item' }, [
        el('div', { className: 'change-item-header' }, [
          el('span', { className: 'badge' }, [label]),
          el('span', { className: 'change-item-path mono truncate', title }, [title]),
          ...(c.binary || hasDiff
            ? [
                el('span', { className: 'change-stats' }, [
                  el('span', { className: 'change-stats-add' }, [`+${c.additions}`]),
                  el('span', { className: 'change-stats-del' }, [`-${c.deletions}`]),
                ]),
              ]
            : []),
        ]),

        c.binary
          ? el('div', { className: 'change-item-detail mono muted' }, ['二进制文件变更'])
          : hasDiff
            ? el('div', { className: 'change-diff-wrapper' }, [
                el('button', {
                  className: 'change-diff-toggle',
                  onclick: (e: Event) => {
                    const btn = e.currentTarget as HTMLButtonElement;
                    const dv = btn.nextElementSibling as HTMLElement | null;
                    if (dv) {
                      const hidden = dv.classList.contains('hidden');
                      dv.classList.toggle('hidden');
                      btn.textContent = hidden ? '▾ 收起 Diff' : '▸ 展开 Diff';
                    }
                  },
                }, ['▸ 展开 Diff']),
                el('div', { className: 'change-diff-view hidden' }, [
                  buildDiffView(diffLines),
                ]),
              ])
            : el('div', { className: 'change-item-detail mono muted' }, ['无文本差异']),
      ]);
    }),
  );
}

/** Approvals Tab — 使用 ApprovalCard 组件 */
function buildApprovalsTab(app: DesktopApp) {
  if (app.approvals.length === 0) {
    return el('div', { className: 'context-tab-content' }, [
      el('div', { className: 'context-empty' }, [
        el('div', { className: 'context-empty-icon' }, ['✓']),
        el('div', { className: 'muted' }, ['无待审批']),
      ]),
    ]);
  }

  return el('div', { className: 'context-tab-content' },
    app.approvals.map((a) => buildApprovalCard(app, a)),
  );
}

/** Audit Tab — 安全审查发现列表 */
function buildAuditTab(app: DesktopApp) {
  const severityClass: Record<string, string> = {
    high: 'severity-high',
    medium: 'severity-medium',
    low: 'severity-low',
    info: 'severity-info',
  };
  const severityLabel: Record<string, string> = {
    high: '高',
    medium: '中',
    low: '低',
    info: '信息',
  };

  return el('div', { className: 'context-tab-content' }, [
    // 操作区
    el('div', { className: 'audit-actions' }, [
      el('button', {
        className: 'btn btn-primary',
        disabled: app.auditRunning,
        onclick: () => void app.runAudit(),
      }, [app.auditRunning ? '扫描中...' : '开始安全扫描']),
    ]),

    // 历史报告
    app.auditReports.length > 0
      ? el('div', { className: 'audit-history' }, [
          el('div', { className: 'audit-history-title muted' }, ['历史报告']),
          ...app.auditReports.slice(0, 5).map((r) =>
            el('button', {
              className: `audit-report-item ${r.audit_id === app.currentAuditId ? 'active' : ''}`,
              onclick: () => void app.selectAudit(r.audit_id),
            }, [
              el('span', { className: 'audit-report-date' }, [r.created_at.slice(0, 19).replace('T', ' ')]),
              el('span', { className: 'audit-report-stats' }, [
                `H:${r.high} M:${r.medium} L:${r.low} I:${r.info}`,
              ]),
            ]),
          ),
        ])
      : '',

    // 发现列表
    app.auditFindings.length === 0
      ? el('div', { className: 'context-empty' }, [
          el('div', { className: 'context-empty-icon' }, ['🔍']),
          el('div', { className: 'muted' }, ['点击上方按钮开始扫描']),
        ])
      : el('div', { className: 'audit-findings' },
          app.auditFindings.map((f) =>
            el('div', { className: 'audit-finding' }, [
              el('div', { className: 'audit-finding-header' }, [
                el('span', {
                  className: `severity-badge ${severityClass[f.severity] ?? 'severity-info'}`,
                }, [severityLabel[f.severity] ?? f.severity]),
                el('span', { className: 'audit-finding-path mono truncate' }, [
                  f.file + (f.line ? `:${f.line}` : ''),
                ]),
                el('span', { className: 'badge muted' }, [f.source]),
              ]),
              el('div', { className: 'audit-finding-title' }, [f.title]),
              el('div', { className: 'audit-finding-detail muted' }, [f.detail]),
              el('div', { className: 'audit-finding-suggestion' }, [
                el('span', { className: 'muted' }, ['建议: ']),
                f.suggestion,
              ]),
            ]),
          ),
        ),
  ]);
}

/** Activity Tab — 分级系统事件日志 */
function buildActivityTab(app: DesktopApp) {
  const logs = app.timeline
    .filter((t) => t.kind === 'system' || t.kind === 'error')
    .slice(-80);

  if (logs.length === 0) {
    return el('div', { className: 'context-tab-content' }, [
      el('div', { className: 'context-empty' }, [
        el('div', { className: 'context-empty-icon' }, ['📊']),
        el('div', { className: 'muted' }, ['无系统事件']),
      ]),
    ]);
  }

  return el('div', { className: 'context-tab-content' }, [
    el('div', { className: 'activity-list' },
      logs.map((entry) =>
        el('div', { className: `activity-entry activity-${entry.kind}` }, [
          el('span', { className: 'activity-entry-kind' }, [
            entry.kind === 'error' ? '✕' : '●',
          ]),
          el('span', { className: 'activity-entry-text' }, [entry.text]),
        ]),
      ),
    ),
  ]);
}
