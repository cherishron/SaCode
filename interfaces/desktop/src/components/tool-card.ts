/** ToolCard — 工具调用卡片
 * 展示工具名称、参数、状态、耗时和输出。
 */
import { el } from '../dom.ts';

export type ToolStatus = 'running' | 'pending' | 'approved' | 'denied' | 'completed' | 'failed';

export interface ToolCardData {
  tool: string;
  args?: Record<string, unknown>;
  status: ToolStatus;
  durationMs?: number;
  output?: string;
  exitCode?: number;
}

export function buildToolCard(data: ToolCardData) {
  const statusLabel = getStatusLabel(data.status);
  const statusClass = `tool-card-status-${data.status}`;
  const showOutputToggle = !!data.output;

  const card = el('div', { className: `tool-card ${statusClass}` }, [
    // 头部：图标 + 工具名 + 耗时 + 状态
    el('div', { className: 'tool-card-header' }, [
      el('span', { className: 'tool-card-icon' }, ['🔧']),
      el('span', { className: 'tool-card-name mono' }, [data.tool]),
      ...(data.durationMs != null
        ? [el('span', { className: 'tool-card-duration muted' }, [
            `${(data.durationMs / 1000).toFixed(1)}s`,
          ])]
        : []),
      el('span', { className: `badge ${getBadgeVariant(data.status)}` }, [
        statusLabel,
      ]),
    ]),

    // 参数区
    data.args
      ? el('pre', { className: 'tool-card-args mono' }, [
          JSON.stringify(data.args, null, 2).slice(0, 400),
        ])
      : '',

    // 输出区（可折叠）
    showOutputToggle
      ? el('div', { className: 'tool-card-output-wrapper' }, [
          el('button', {
            className: 'tool-card-output-toggle',
            onclick: (e: Event) => {
              const btn = e.currentTarget as HTMLButtonElement;
              const out = btn.nextElementSibling as HTMLElement | null;
              if (out) {
                const hidden = out.classList.contains('hidden');
                out.classList.toggle('hidden');
                btn.textContent = hidden ? '▾ 输出' : '▸ 输出';
              }
            },
          }, ['▸ 输出']),
          el('pre', { className: 'tool-card-output mono hidden' }, [
            data.output!.slice(0, 800),
          ]),
        ])
      : '',
  ].filter(Boolean) as Node[]);

  return card;
}

function getStatusLabel(status: ToolStatus): string {
  switch (status) {
    case 'running':   return '运行中';
    case 'pending':   return '待审批';
    case 'approved':  return '已批准';
    case 'denied':    return '已拒绝';
    case 'completed': return '已完成';
    case 'failed':    return '失败';
    default:          return status;
  }
}

function getBadgeVariant(status: ToolStatus): string {
  switch (status) {
    case 'running':   return 'accent';
    case 'pending':   return 'warn';
    case 'approved':  return 'ok';
    case 'denied':    return 'bad';
    case 'completed': return 'ok';
    case 'failed':    return 'bad';
    default:          return '';
  }
}
