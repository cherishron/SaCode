// 工作台右侧面板装配的行为回归：这批面板原先长在 app.js 的 render 里，
// 迁出后必须仍交出同一组页面标识与同一套事件接线——标识是 ui-smoke 的靶子，
// 接线是用户实际操作的路径，两者丢了就等于把功能搬没了。
import assert from 'node:assert/strict';
import { test } from 'node:test';

// 渲染层是经典脚本：模块只往 globalThis 挂工厂，没有 ES 导出，所以按副作用导入取全局。
import '../renderer/side-panels.js';

const h = (tag, props, children) => ({ tag, props, children });
const el = (tag, cls, children, props = {}) => h(tag, { class: cls, ...props }, children);
const navIcon = path => h('svg', { d: path }, null);
// 只收集 props 上的标识：够定位「控件还在不在」，又不把断言退化成整棵树快照。
const ids = node => {
  const out = [];
  const walk = n => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n && typeof n === 'object') { if (n.props?.id) out.push(n.props.id); walk(n.children); }
  };
  walk(node);
  return out;
};

const self = {
  tools: [{ name: 'read', description: '读取文件', needsApproval: false }],
  approval: { name: 'write', approvalId: '7', source: 'user', displayArguments: '{}' },
  outcome: '', outcomeKind: 'outcome', toolCounters: { misses: 0, guardDenials: 0 },
  usage: { used: 3, budget: 10, verdict: 'within', over: false },
  budgetDraft: '5', budgetBusy: false, budgetNote: '',
  diagnosticsOpen: false, proj: { events: 1, durable: 1, pending: 0, truncatedTail: false, todos: [] },
  workspaceFilesBusy: false, workspaceFiles: [], workspace: { configured: true },
  fileTreeOpen: new Set(), fileTreeChildren: {}, fileTreeBusy: '',
  traceError: '', traceBusy: false, traceEvents: [], traceMore: false,
  filePreview: { state: { path: 'a.txt', busy: false, error: '', loaded: true, text: 'x' } },
  filePreviewRevision: 0, readPreview: null,
  sideTab: 'inspect', sideSplit: false, sideRatio: 50, workbenchExpanded: false,
  askTool() {}, answerTool() {}, setBudget() {}, openSide() {}, toggleTreeDir() {},
  openWorkspaceFile() {}, openFileEditor() {}, refreshTrace() {}, beginResize() {},
};
const ctx = { h, el, navIcon, turnBar: el('div', 'turn-actions', null), renderTreeEntries: () => [], verdictName: v => v };

// 工作台标签条直接引用 window.SaCodeSlots（渲染层没有模块加载器，全局命名空间就是接线方式），
// 所以探针需要提供这组最小全局，用完即撤，别让它污染同文件里的其他用例。
function render() {
  globalThis.window = { SaCodeSlots: { WorkbenchTabs: 'workbench-tabs' }, Vue: { nextTick: fn => fn() } };
  globalThis.document = { getElementById: () => null };
  try {
    return globalThis.SaCodeSidePanels.renderPanels(self, ctx);
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
}

test('side-panels.js 交出工作台面板装配入口', () => {
  assert.equal(typeof globalThis.SaCodeSidePanels?.renderPanels, 'function');
});

test('工具面板保留审批与诊断，移除重复的用量预算入口', () => {
  const view = render();
  const found = ids(view.inspection);
  for (const id of ['tool-read', 'detail-read', 'approval', 'allow-once', 'deny', 'tool-counters',
    'developer-diagnostics']) {
    assert.ok(found.includes(id), '缺少控件 ' + id);
  }
  for(const id of ['budget-panel','open-budget','turn-usage','budget-input','apply-budget']) assert.ok(!found.includes(id),'不应保留重复入口 '+id);
});

test('文件、轨迹、指南各面板交出 own 容器标识，预览正文按前缀出双份标识', () => {
  const view = render();
  assert.ok(ids(view.filesPage).includes('files-panel'));
  assert.ok(ids(view.tracePage).includes('trace-panel'));
  assert.ok(ids(view.guide).includes('guide-panel'));
  assert.ok(ids(view.previewBody('preview')).includes('preview-panel'));
  assert.ok(ids(view.previewBody('split-preview')).includes('split-preview-panel'));
});
