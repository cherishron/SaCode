/** ToolCard — 紧凑工具调用行 */
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
  const showOutputToggle = !!data.output;

  return el('div', { className: `tool-row tool-status-${data.status}` }, [
    el('div', { className: 'tool-row-head' }, [
      el('span', { className: 'tool-row-dot' }, []),
      el('span', { className: 'tool-row-name' }, [data.tool]),
      data.args
        ? el('span', { className: 'tool-row-args mono' }, [
            summarizeArgs(data.args),
          ])
        : '',
      data.durationMs != null
        ? el('span', { className: 'tool-row-duration' }, [`${(data.durationMs / 1000).toFixed(1)}s`])
        : '',
      el('span', { className: 'tool-row-status' }, [statusLabel]),
      showOutputToggle
        ? el('button', {
            className: 'tool-row-toggle',
            onclick: (e: Event) => {
              const btn = e.currentTarget as HTMLButtonElement;
              const out = btn.closest('.tool-row')?.querySelector('.tool-row-output') as HTMLElement | null;
              if (out) {
                const hidden = out.classList.contains('hidden');
                out.classList.toggle('hidden');
                btn.textContent = hidden ? '收起' : '输出';
              }
            },
          }, ['输出'])
        : '',
    ]),
    showOutputToggle
      ? el('pre', { className: 'tool-row-output mono hidden' }, [data.output!.slice(0, 800)])
      : '',
  ]);
}

function summarizeArgs(args: Record<string, unknown>): string {
  const first = Object.values(args)[0];
  if (typeof first === 'string') return first.length > 60 ? `${first.slice(0, 60)}…` : first;
  return JSON.stringify(args).slice(0, 60);
}

function getStatusLabel(status: ToolStatus): string {
  switch (status) {
    case 'running':   return '运行中';
    case 'pending':   return '待审批';
    case 'approved':  return '已批准';
    case 'denied':    return '已拒绝';
    case 'completed': return '完成';
    case 'failed':    return '失败';
    default:          return status;
  }
}

function getBadgeVariant(status: ToolStatus): string {
  switch (status) {
    case 'running':
    case 'pending':   return 'warn';
    case 'approved':
    case 'completed': return 'ok';
    case 'denied':
    case 'failed':    return 'bad';
    default:          return '';
  }
}
