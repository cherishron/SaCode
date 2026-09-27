import { el } from '../dom.ts';
import type { DesktopApp } from './service.ts';
import type { AutomationRule, AutomationRun, AutomationRuleInput } from '@cherishron/sacode-client-core';

type Frequency = 'daily' | 'weekly' | 'monthly' | 'custom';
export interface AutomationState {
  rules: AutomationRule[]; history: AutomationRun[]; activeTab: 'rules' | 'history';
  showCreateForm: boolean; editingRuleId: string | null; searchText: string;
  loading: boolean; error: string | null; frequency: Frequency;
  draft: { name: string; prompt: string; time: string; weekday: string; day: string; custom: string } | null;
}
export function createAutomationState(): AutomationState {
  return { rules: [], history: [], activeTab: 'rules', showCreateForm: false,
    editingRuleId: null, searchText: '', loading: false, error: null, frequency: 'daily', draft: null };
}
export async function loadAutomationData(app: DesktopApp, state: AutomationState, rerender: () => void) {
  state.loading = true; state.error = null; rerender();
  try { const data = await app.refreshAutomation(); state.rules = data.rules; state.history = data.history; }
  catch (error) { state.error = String(error); }
  finally { state.loading = false; rerender(); }
}
function operate(state: AutomationState, rerender: () => void, operation: () => Promise<void>) {
  state.error = null;
  void operation().catch(error => { state.error = String(error); rerender(); });
}
function localTime(value: string | null): string {
  if (!value) return '—';
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? value : time.toLocaleString();
}
function classify(expr: string): Frequency {
  const fields = expr.split(/\s+/);
  if (fields.length !== 6 || fields[0] !== '0') return 'custom';
  if (fields[3] === '*' && fields[4] === '*' && fields[5] === '*') return 'daily';
  if (fields[3] === '*' && fields[4] === '*' && fields[5] !== '*') return 'weekly';
  if (fields[3] !== '*' && fields[4] === '*' && fields[5] === '*') return 'monthly';
  return 'custom';
}
function cronFor(freq: Frequency, time: string, weekday: string, day: string, custom: string): string {
  if (freq === 'custom') return custom.trim();
  const [hour, minute] = time.split(':');
  return freq === 'daily' ? `0 ${minute} ${hour} * * *`
    : freq === 'weekly' ? `0 ${minute} ${hour} * * ${weekday}`
    : `0 ${minute} ${hour} ${day} * *`;
}
function validateCron(value: string): string | null {
  const fields = value.trim().split(/\s+/);
  if (fields.length !== 6) return '需要 6 段（秒 分 时 日 月 周）';
  if (fields.some(field => !/^[0-9*,/?\-]+$/.test(field))) return '表达式包含无效字符';
  return null;
}
export function buildAutomationWorkspace(app: DesktopApp, state: AutomationState, rerender: () => void): Node {
  return el('section', { className: 'automation' }, [
    el('div', { className: 'automation-header' }, [
      el('span', { className: 'automation-title' }, ['自动化']),
      el('button', { className: 'header-btn', onclick: () => void loadAutomationData(app, state, rerender) }, ['刷新']),
      el('button', { className: 'header-btn', onclick: () => { state.showCreateForm = true;
        state.editingRuleId = null; state.frequency = 'daily'; state.draft = null; rerender(); } }, ['+ 新建规则']),
    ]),
    el('div', { className: 'automation-scope-tabs' }, (['rules', 'history'] as const).map(tab =>
      el('button', { className: `automation-scope-tab ${state.activeTab === tab ? 'active' : ''}`,
        onclick: () => { state.activeTab = tab; void loadAutomationData(app, state, rerender); } },
      [tab === 'rules' ? '规则' : '历史']))),
    state.error ? el('div', { className: 'automation-empty', style: 'color:var(--danger)' }, [state.error]) : '',
    state.loading ? el('div', { className: 'automation-empty' }, ['正在加载…']) :
      state.showCreateForm ? form(app, state, rerender) : state.activeTab === 'rules'
        ? rules(app, state, rerender) : history(app, state, rerender),
  ].filter(Boolean) as Node[]);
}
function rules(app: DesktopApp, state: AutomationState, rerender: () => void): Node {
  const query = state.searchText.toLowerCase();
  const filtered = state.rules.filter(rule => `${rule.name} ${rule.prompt}`.toLowerCase().includes(query));
  return el('div', { className: 'automation-content' }, [
    el('input', { className: 'automation-search-input', placeholder: '搜索规则', value: state.searchText,
      oninput: (event: Event) => { state.searchText = (event.target as HTMLInputElement).value; rerender(); } }),
    filtered.length ? el('div', { className: 'automation-rule-list' }, filtered.map(rule =>
      el('div', { className: `automation-rule-card ${rule.enabled ? '' : 'disabled'}` }, [
        el('button', { className: `automation-toggle ${rule.enabled ? 'on' : 'off'}`, title: rule.enabled ? '停用' : '启用',
          onclick: () => operate(state, rerender, async () => { await app.toggleAutomationRule(rule.id);
            await loadAutomationData(app, state, rerender); }) }, [rule.enabled ? '开' : '关']),
        el('div', { className: 'automation-rule-body' }, [
          el('div', { className: 'automation-rule-name' }, [rule.name]),
          el('div', { className: 'automation-rule-prompt' }, [rule.prompt]),
          el('div', { className: 'automation-rule-meta' }, [
            el('span', { className: 'mono' }, [rule.cron_expr]),
            el('span', { className: 'muted' }, [`下次: ${rule.enabled ? localTime(rule.next_run) : '已停用'}`]),
          ]),
        ]),
        el('div', { className: 'automation-rule-actions' }, [
          el('button', { className: 'header-btn', title: '立即执行',
            onclick: () => operate(state, rerender, async () => { const run = await app.runAutomationRule(rule.id);
              await loadAutomationData(app, state, rerender); await app.refreshTasks();
              state.activeTab = 'history'; state.error = `已创建任务 ${run.task_id}`; rerender(); }) }, ['▶']),
          el('button', { className: 'header-btn', title: '编辑', onclick: () => {
            state.editingRuleId = rule.id; state.frequency = classify(rule.cron_expr); state.draft = null; state.showCreateForm = true; rerender();
          } }, ['编辑']),
          el('button', { className: 'header-btn', title: '删除', onclick: () => {
            if (!window.confirm(`删除规则“${rule.name}”？`)) return;
            operate(state, rerender, async () => { await app.deleteAutomationRule(rule.id);
              await loadAutomationData(app, state, rerender); });
          } }, ['删除']),
        ]),
      ]))) : el('div', { className: 'automation-empty' }, [query ? '没有匹配的规则' : '暂无规则']),
  ]);
}
function history(app: DesktopApp, state: AutomationState, rerender: () => void): Node {
  const names = new Map(state.rules.map(rule => [rule.id, rule.name]));
  const query = state.searchText.toLowerCase();
  const runs = state.history.filter(run => `${names.get(run.rule_id) || run.rule_id} ${run.task_id}`.toLowerCase().includes(query));
  return el('div', { className: 'automation-content' }, [
    el('input', { className: 'automation-search-input', placeholder: '搜索历史', value: state.searchText,
      oninput: (event: Event) => { state.searchText = (event.target as HTMLInputElement).value; rerender(); } }),
    runs.length ? el('div', { className: 'automation-timeline' }, runs.map(run =>
      el('button', { className: `automation-history-entry ${run.status}`, title: '查看对应任务',
        onclick: () => operate(state, rerender, async () => { await app.refreshTasks(); await app.selectTask(run.task_id); }) }, [
        el('span', { className: 'automation-history-icon' }, [run.status === 'completed' ? '✓' : run.status === 'failed' ? '×' : '·']),
        el('span', { className: 'automation-history-name' }, [names.get(run.rule_id) || run.rule_id]),
        el('span', { className: 'automation-history-time mono' }, [localTime(run.triggered_at)]),
        el('span', { className: 'muted' }, [run.status]),
      ]))) : el('div', { className: 'automation-empty' }, ['暂无执行历史']),
  ]);
}
function form(app: DesktopApp, state: AutomationState, rerender: () => void): Node {
  const editing = state.rules.find(rule => rule.id === state.editingRuleId);
  const fields = editing?.cron_expr.split(/\s+/) || [];
  const draft = state.draft ?? { name: editing?.name || '', prompt: editing?.prompt || '',
    time: editing && fields.length === 6 && /^\d+$/.test(fields[1]) && /^\d+$/.test(fields[2])
      ? `${fields[2].padStart(2, '0')}:${fields[1].padStart(2, '0')}` : '09:00',
    weekday: fields[5] || '0', day: fields[3] || '1', custom: editing?.cron_expr || '' };
  state.draft = draft;
  const name = el('input', { className: 'automation-form-input', placeholder: '规则名称', value: draft.name,
    oninput: (event: Event) => { draft.name = (event.target as HTMLInputElement).value; } }) as HTMLInputElement;
  const prompt = el('textarea', { className: 'automation-form-textarea', placeholder: '任务提示词',
    oninput: (event: Event) => { draft.prompt = (event.target as HTMLTextAreaElement).value; } }, [draft.prompt]) as HTMLTextAreaElement;
  const time = el('input', { className: 'automation-form-input', type: 'time', value: draft.time,
    oninput: (event: Event) => { draft.time = (event.target as HTMLInputElement).value; } }) as HTMLInputElement;
  const weekday = el('select', { className: 'automation-form-input' }, Array.from({ length: 7 }, (_, i) =>
    el('option', { value: String(i), selected: draft.weekday === String(i) }, [`周${'日一二三四五六'[i]}`]))) as HTMLSelectElement;
  weekday.addEventListener('change', () => { draft.weekday = weekday.value; });
  const day = el('select', { className: 'automation-form-input' }, Array.from({ length: 28 }, (_, i) =>
    el('option', { value: String(i + 1), selected: draft.day === String(i + 1) }, [`${i + 1} 日`]))) as HTMLSelectElement;
  day.addEventListener('change', () => { draft.day = day.value; });
  const custom = el('input', { className: 'automation-form-input mono', placeholder: '秒 分 时 日 月 周', value: draft.custom }) as HTMLInputElement;
  const feedback = el('div', { className: 'muted' }, ['时间以 UTC 输入；下次运行由服务端计算并按本地时间展示。']);
  custom.addEventListener('input', () => { draft.custom = custom.value; feedback.textContent = validateCron(custom.value) || '格式预检通过，保存时由服务端校验'; });
  return el('div', { className: 'automation-content automation-form' }, [
    el('h3', {}, [editing ? '编辑规则' : '新建规则']),
    el('label', { className: 'automation-form-field' }, ['名称', name]),
    el('div', { className: 'automation-form-frequency' }, (['daily', 'weekly', 'monthly', 'custom'] as const).map(freq =>
      el('button', { className: `freq-option ${state.frequency === freq ? 'active' : ''}`,
        onclick: () => { state.frequency = freq; rerender(); } },
      [({ daily: '每日', weekly: '每周', monthly: '每月', custom: '自定义 cron' })[freq]]))),
    state.frequency === 'custom' ? el('label', { className: 'automation-form-field' }, ['cron 表达式（6 段）', custom]) :
      el('div', { className: 'automation-form-row' }, [time,
        ...(state.frequency === 'weekly' ? [weekday] : []),
        ...(state.frequency === 'monthly' ? [day] : [])]),
    feedback,
    el('label', { className: 'automation-form-field' }, ['任务提示词', prompt]),
    el('div', { className: 'automation-form-actions' }, [
      el('button', { className: 'btn', onclick: () => operate(state, rerender, async () => {
        const cron_expr = cronFor(state.frequency, draft.time, draft.weekday, draft.day, draft.custom);
        const error = validateCron(cron_expr);
        if (error) throw new Error(error);
        if (!name.value.trim() || !prompt.value.trim()) throw new Error('名称和任务提示词不能为空');
        const input: AutomationRuleInput = { name: name.value.trim(), prompt: prompt.value.trim(), cron_expr,
          enabled: editing?.enabled ?? true, backend_id: editing?.backend_id };
        await app.saveAutomationRule(input, editing?.id);
        state.showCreateForm = false; state.editingRuleId = null; state.draft = null; await loadAutomationData(app, state, rerender);
      }) }, ['保存']),
      el('button', { className: 'btn ghost', onclick: () => { state.showCreateForm = false; state.editingRuleId = null; state.draft = null; rerender(); } }, ['取消']),
    ]),
  ]);
}
