// 工具结果卡：把投影里的 tool/result 行从「原始文本段」升级为结构化卡片
// （状态点 + 类型 + 目标 + 元信息 + 可折叠正文）。
// 数据边界：tool/call 不进投影（core isSurfaceEvent 冻结集合只有五类），
// 因此卡内不显示调用名与参数——投影里没有的事实不编造。
// 折叠态只是视图态，不进日志；阈值统一取 FOLD.FOLD_THRESHOLD，不设第二套数字。
import { defineComponent, h, ref, type PropType } from 'vue';
import { StateDot } from './state-dot';

export type ToolMessage = { id?: string; role?: string; content?: string; sourceRole?: string };

const bytesText = (bytes: number | null): string => {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

// 展示名取基名，完整路径留在 title——绝对路径在窄头部里只会变成噪声。
const baseName = (path: string): string => {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut >= 0 && cut + 1 < path.length ? path.slice(cut + 1) : path;
};

export const ToolCard = defineComponent({
  name: 'SaCodeToolCard',
  props: { message: { type: Object as PropType<ToolMessage>, required: true } },
  setup(props) {
    const fold = () => (window as unknown as { SaCodeMsgFold: { parseToolResult(text: string): Record<string, unknown>; foldPlan(text: string, threshold: number): { folded: boolean; shown: string }; FOLD_THRESHOLD: number } }).SaCodeMsgFold;
    const expanded = ref(false);
    return () => {
      const api = fold();
      const p = api.parseToolResult(String(props.message?.content ?? '')) as {
        kind: string; label: string; status: string; target: string; reason?: string; bytes: number | null; lines: string | null; body: string;
      };
      const plan = api.foldPlan(p.body, api.FOLD_THRESHOLD);
      const open = expanded.value;
      const state = p.status === 'done' ? 'done' : p.status === 'warning' ? 'warning' : p.status === 'error' ? 'error' : 'idle';
      const meta = [bytesText(p.bytes), p.lines ? '行 ' + p.lines : ''].filter(Boolean).join(' · ');
      const bodyVisible = p.body.length > 0 && (!plan.folded || open);
      const children = [
        h('header', { class: 'tool-head' }, [
          h(StateDot, { state, size: 12 }),
          h('span', { class: 'tool-label' }, p.label),
          p.target ? h('span', { class: 'tool-target', title: p.target }, baseName(p.target)) : null,
          p.reason ? h('span', { class: 'tool-reason', title: p.reason }, p.reason) : null,
          meta ? h('span', { class: 'tool-meta' }, meta) : null,
          plan.folded
            ? h('button', {
                type: 'button', class: 'tool-toggle', 'aria-expanded': open,
                onClick: () => { expanded.value = !expanded.value; },
              }, open ? '收起' : '展开')
            : null,
        ]),
        bodyVisible ? h('pre', { class: 'tool-body' }, open ? p.body : plan.shown) : null,
        plan.folded && !open ? h('p', { class: 'tool-hint' }, '正文较长，已折叠') : null,
      ];
      return h('div', { class: 'tool-node', 'data-tool-kind': p.kind, 'data-tool-status': p.status, 'data-msg-id': props.message?.id || '' }, children);
    };
  },
});
