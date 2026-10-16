// 模型中心·模型调用日志页：注册到 'model-center.tab' 槽位，放在「供应商」之后。
// 数据源：适配器已从各会话日志回放出调用清单（供应商 / 模型 / 耗时 / 状态 / 用量），
// 这里只做展示与展开明细，不另算账、不复制投影逻辑。
import { defineComponent, h, ref, onMounted, onBeforeUnmount, type PropType } from 'vue';
import type { ClientScope } from './slot-core';

// --- 类型 ---
export interface CallRequest { version: number; time: number; turnSeq: number; step: number; reason: string;
  header: { config: Record<string, unknown>; tools: unknown[] } }
export interface CallEnd { requestSeq: number; time: number; durationMs: number; ttftMs: number | null;
  state: string; finishReason: string; usageTokens: string | null }
export interface CallRow { request: CallRequest; prompts: unknown[]; end: CallEnd | null; output: string;
  toolCalls: unknown[]; sessionId: string; sessionTitle: string }
export interface CallLogView { sessions: { id: string; title: string }[]; calls: CallRow[]; scanned: number; total: number }
export interface Adapter { describe(): Promise<CallLogView>; subscribe?(invalidate: () => void): () => void }

// --- 格式化 ---
const STATE_LABEL: Record<string, string> = {
  completed: '完成', interrupted: '中断', failed: '失败', cancelled: '已取消',
};
function fmtTime(ms: number | undefined): string {
  if (!ms || ms <= 0) return '—';
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { hour12: false });
}
function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return ms + ' ms';
  return (ms / 1000).toFixed(2) + ' s';
}
function fmtUsage(raw: string | null | undefined): string {
  if (!raw) return '—';
  try {
    const u = JSON.parse(raw);
    const parts: string[] = [];
    if (u.total_tokens != null) parts.push('总 ' + u.total_tokens);
    if (u.prompt_tokens != null) parts.push('入 ' + u.prompt_tokens);
    if (u.completion_tokens != null) parts.push('出 ' + u.completion_tokens);
    return parts.length ? parts.join(' / ') : raw;
  } catch { return raw; }
}

// --- UI 原语 ---
const el = (tag: string, cls: string, children: any, props: any = {}) => h(tag, { class: 'mcl-' + cls, ...props }, children);

// --- 主组件 ---
export const Page = defineComponent({
  name: 'SaCodeModelCallLog',
  props: { adapter: Object as PropType<Adapter> },
  setup(props) {
    const view = ref<CallLogView | null>(null);
    const loading = ref(false);
    const error = ref('');
    let off: (() => void) | undefined, disposed = false;

    const load = async () => {
      if (!props.adapter) return;
      loading.value = true; error.value = '';
      try { const r = await props.adapter.describe(); if (!disposed) view.value = r; }
      catch (e) { if (!disposed) error.value = String((e as any)?.message || e); }
      finally { if (!disposed) loading.value = false; }
    };

    onMounted(() => { off = props.adapter?.subscribe?.(() => { void load(); }); void load(); });
    onBeforeUnmount(() => { disposed = true; off?.(); });

    const detail = (c: CallRow) => el('div', 'detail', [
      el('div', 'detail-row', [el('span', 'k', '请求配置'), el('span', 'v', JSON.stringify(c.request?.header?.config ?? {}))]),
      Array.isArray(c.prompts) && c.prompts.length
        ? el('div', 'detail-row', [el('span', 'k', '提示词'), el('pre', 'v', JSON.stringify(c.prompts, null, 2))])
        : null,
      el('div', 'detail-row', [el('span', 'k', '输出'), el('pre', 'v', c.output || '（无文本输出）')]),
      Array.isArray(c.toolCalls) && c.toolCalls.length
        ? el('div', 'detail-row', [el('span', 'k', '工具调用'), el('pre', 'v', JSON.stringify(c.toolCalls, null, 2))])
        : null,
      el('div', 'detail-row', [el('span', 'k', '用量原始'), el('pre', 'v', c.end?.usageTokens || '—')]),
    ]);

    const row = (c: CallRow, i: number) => h('tr', { key: i, class: 'mcl-row' }, [
      h('td', { class: 'mcl-time' }, fmtTime(c.request?.time)),
      h('td', { class: 'mcl-provider' }, String(c.request?.header?.config?.provider ?? '—')),
      h('td', { class: 'mcl-model' }, String(c.request?.header?.config?.model ?? '—')),
      h('td', { class: 'mcl-session' }, c.sessionTitle || c.sessionId || '—'),
      h('td', { class: 'mcl-state' }, STATE_LABEL[c.end?.state ?? ''] ?? (c.end?.state ?? '—')),
      h('td', { class: 'mcl-duration' }, fmtDuration(c.end?.durationMs)),
      h('td', { class: 'mcl-ttft' }, fmtDuration(c.end?.ttftMs)),
      h('td', { class: 'mcl-usage' }, fmtUsage(c.end?.usageTokens)),
      h('td', { class: 'mcl-expand' }, h('details', null, [
        h('summary', { class: 'mcl-summary' }, '明细'),
        detail(c),
      ])),
    ]);

    return () => {
      if (!props.adapter) return el('section', 'root', [el('h2', null, '模型调用日志'), el('p', 'notice', '模型调用日志后端尚未接入。', { role: 'status' })]);

      const v = view.value;
      return el('section', 'root', [
        el('div', 'header', [
          el('h2', null, '模型调用日志'),
          el('p', 'intro', '跨所有会话聚合的最近模型调用：供应商、模型、耗时、状态与用量。点击「明细」查看提示词、输出与工具调用。'),
          h('button', { type: 'button', class: 'mcl-refresh', onClick: () => void load(), disabled: loading.value }, loading.value ? '加载中…' : '刷新'),
        ]),
        loading.value ? el('p', 'loading', '正在加载…') : null,
        error.value ? el('p', 'error', error.value, { role: 'alert' }) : null,
        v ? el('p', 'scope', `已扫描 ${v.scanned} / 共 ${v.total} 个会话，展示最近 ${v.calls.length} 条调用。`) : null,
        v && v.calls.length
          ? h('table', { class: 'mcl-table', role: 'table' }, [
              h('thead', null, h('tr', null, [
                h('th', null, '时间'), h('th', null, '供应商'), h('th', null, '模型'), h('th', null, '会话'),
                h('th', null, '状态'), h('th', null, '耗时'), h('th', null, '首字延迟'), h('th', null, '用量'), h('th', null, '明细'),
              ])),
              h('tbody', null, v.calls.map(row)),
            ])
          : (v ? el('p', 'empty', '没有已记录的模型调用。') : null),
      ]);
    };
  },
});

// --- 槽位注册 ---
export function install(scope: ClientScope): () => void {
  return scope.inject('model-center.tab', (child) => {
    child.register({ name: 'model-center.tab', id: 'model-call-log', order: 2, label: '模型调用日志' },
      defineComponent({ name: 'SaCodeModelCallLogSlot', props: ['owner'], setup: (props) => () => h(Page, { adapter: (props.owner as any)?.adapter }) }));
  });
}
