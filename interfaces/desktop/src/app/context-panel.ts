/** ContextPanel — 右栏上下文面板：Changes / Approvals / Activity 三 Tab
 * Phase 3: 接入独立组件，Changes 用 DiffView，Approvals 用 ApprovalCard
 */
import { el } from '../dom.ts';
import type { DesktopApp } from './service.ts';
import { buildApprovalCard } from '../components/approval-card.ts';
import { buildDiffView, parseDiff } from '../components/diff-view.ts';

export type ContextTab = 'changes' | 'approvals' | 'activity';

export function buildContextPanel(app: DesktopApp, activeTab: ContextTab = 'changes') {
  const pendingCount = app.approvals.length;
  const changeCount = app.changes.length;

  return el('aside', { className: 'context-panel' }, [
    // Tab 切换
    el('div', { className: 'context-tabs' }, [
      buildTab('changes', 'Changes', activeTab, changeCount),
      buildTab('approvals', 'Approvals', activeTab, pendingCount),
      buildTab('activity', 'Activity', activeTab, 0),
    ]),

    // 内容区
    el('div', { className: 'context-content' }, [
      activeTab === 'changes' ? buildChangesTab(app) : '',
      activeTab === 'approvals' ? buildApprovalsTab(app) : '',
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

  return el('div', { className: 'context-tab-content' },
    app.changes.slice(-50).reverse().map((c, idx) => {
      const isDiff = c.detail.includes('@@') || c.detail.includes('+++') || c.detail.includes('---');
      const diffLines = isDiff ? parseDiff(c.detail) : [];
      const hasDiff = diffLines.length > 0;

      // 统计 add/del 行数
      const added = diffLines.filter(l => l.type === 'add').length;
      const deleted = diffLines.filter(l => l.type === 'del').length;

      return el('div', { className: 'change-item' }, [
        // 头部：工具 + 路径 + 行数统计
        el('div', { className: 'change-item-header' }, [
          el('span', { className: 'badge' }, [c.tool]),
          el('span', { className: 'change-item-path mono truncate' }, [c.path]),
          ...(hasDiff
            ? [
                el('span', { className: 'change-stats' }, [
                  el('span', { className: 'change-stats-add' }, [`+${added}`]),
                  el('span', { className: 'change-stats-del' }, [`-${deleted}`]),
                ]),
              ]
            : []),
        ]),

        // 如果有 Diff，展示可折叠 DiffView；否则展示原始 detail
        hasDiff
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
          : el('pre', { className: 'change-item-detail mono' }, [
              c.detail.slice(0, 400),
            ]),
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
