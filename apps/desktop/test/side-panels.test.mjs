// 工作台右侧面板装配的行为回归：这批面板原先长在 app.js 的 render 里，
// 迁出后必须仍交出同一组页面标识与同一套事件接线——标识是 ui-smoke 的靶子，
// 接线是用户实际操作的路径，两者丢了就等于把功能搬没了。
import assert from 'node:assert/strict';
import { test } from 'node:test';

// 渲染层是经典脚本：模块只往 globalThis 挂工厂，没有 ES 导出，所以按副作用导入取全局。
import '../renderer/side-panels.js';
import '../renderer/workspace-state.js';
import '../renderer/session-state.js';

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
const visibleText = node => {
  if (Array.isArray(node)) return node.map(visibleText).join(' ');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (node && typeof node === 'object') return visibleText(node.children);
  return '';
};
const findNode = (node, predicate) => {
  if (Array.isArray(node)) { for (const child of node) { const found = findNode(child, predicate); if (found) return found; } return null; }
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  return findNode(node.children, predicate);
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
function render(model = self) {
  globalThis.window = { SaCodeSlots: { WorkbenchTabs: 'workbench-tabs' }, Vue: { nextTick: fn => fn() } };
  globalThis.document = { getElementById: () => null };
  try {
    return globalThis.SaCodeSidePanels.renderPanels(model, ctx);
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

test('选择来源时刷新当前会话审计，来源页激活期间切换会话也会重新读取', () => {
  const calls = [];
  const model = {
    ...self, sideTab: 'trace', scrollSession: 'session-1',
    traceEvents: [{ seq: 1, type: 'knowledge/retrieval', data: '{"version":1,"status":"skipped","workspace":"repo","matches":[]}' }],
    refreshTrace: (reset, sessionId) => calls.push([reset, sessionId]),
  };
  const view = render(model);
  view.sideTabs.props.onSelect('sources');
  assert.equal(model.sideTab, 'sources');
  assert.deepEqual(calls, [[true, 'session-1']]);
  render(model);
  assert.deepEqual(calls, [[true, 'session-1']], '同一会话的重渲染不能重复发起读取');
  model.scrollSession = 'session-2';
  render(model);
  assert.deepEqual(calls, [[true, 'session-1'], [true, 'session-2']], '来源页应始终按会话身份读取');
  assert.deepEqual(model.traceEvents, [], '切换会话时应先清除上一会话来源，避免跨会话闪现');
});

test('轨迹迟到回执不会覆盖切换后的会话，且请求和回执都校验 sessionId', async () => {
  const traceEvents = { value: [] }, traceCursor = { value: 0 }, traceMore = { value: false };
  const traceBusy = { value: false }, traceError = { value: '' }, scrollSession = { value: 'session-old' };
  let traceGeneration = 0, sessionGeneration = 0;
  const requests = [];
  const api = {
    sessionEvents(sessionId, cursor, limit) {
      return new Promise(resolve => requests.push({ sessionId, cursor, limit, resolve }));
    },
  };
  const workspace = globalThis.SaCodeWorkspace.createWorkspaceAssembly({
    api, traceEvents, traceCursor, traceMore, traceBusy, traceError, scrollSession,
    getSessionGeneration: () => sessionGeneration,
    incrementTraceGeneration: () => ++traceGeneration,
    getTraceGeneration: () => traceGeneration,
  });

  const oldRead = workspace.refreshTrace(true);
  assert.deepEqual([requests[0].sessionId, requests[0].cursor, requests[0].limit], ['session-old', 0, 64]);
  workspace.invalidateTrace();
  scrollSession.value = 'session-new';
  sessionGeneration++;
  const newRead = workspace.refreshTrace(true);
  assert.equal(requests[1].sessionId, 'session-new');

  requests[1].resolve({
    sessionId: 'session-new',
    events: [{ seq: 2, type: 'knowledge/retrieval', data: '{"status":"matched"}' }],
    nextCursor: 2, more: false,
  });
  await newRead;
  requests[0].resolve({
    sessionId: 'session-old',
    events: [{ seq: 1, type: 'knowledge/retrieval', data: '{"content":"old private source"}' }],
    nextCursor: 1, more: false,
  });
  await oldRead;
  assert.deepEqual(traceEvents.value.map(event => event.seq), [2], '迟到的旧会话审计不得覆盖新会话');
  assert.equal(traceError.value, '');

  const mismatchedRead = workspace.refreshTrace(true);
  assert.equal(requests[2].sessionId, 'session-new');
  requests[2].resolve({
    sessionId: 'session-old',
    events: [{ seq: 3, type: 'knowledge/retrieval', data: '{"content":"forged source"}' }],
    nextCursor: 3, more: false,
  });
  await mismatchedRead;
  assert.deepEqual(traceEvents.value.map(event => event.seq), [2], '回执 sessionId 不匹配时不得应用事件');
  assert.equal(traceError.value, '会话记录响应身份不匹配。');
  assert.equal(traceBusy.value, false);

  await workspace.refreshTrace(true, 'session-old');
  assert.equal(requests.length, 3, '请求 sessionId 与当前界面会话不一致时不得发出请求');
});

test('开始切换会话时先作废轨迹，并在切换失败后按旧 sessionId 恢复', async () => {
  const order = [];
  const ref = value => ({ value });
  const deps = {
    api: {
      sessionSelect: async () => { order.push('sessionSelect'); throw new Error('select failed'); },
    },
    catalog: ref({ entries: [{ id: 'session-old', current: true }] }),
    catalogBusy: ref(false), catalogNote: ref(''), catalogOpen: ref(false), newSessionTitle: ref(''),
    draft: ref(''), error: ref(''), selectedScrollId: ref('session-old'), scrollSession: ref('session-old'),
    turn: ref({ running: false }), approval: ref(null), sendBusy: ref(false), budgetBusy: ref(false),
    appearanceBusy: ref(false), workspaceBusy: ref(false), sessionDrafts: new Map(),
    getSessionGeneration: () => 0, incrementSessionGeneration() {},
    catalogError: error => error.message, clearEnhance() {}, clearAttachments() {}, stopPolling() {},
    foldOpen: { ids: new Set() }, loadCustomModels() {},
    fileEditor: { state: { busy: false }, dirty: () => false },
    invalidateTrace: () => order.push('invalidateTrace'),
    refreshTrace: async (reset, sessionId) => { order.push(['refreshTrace', reset, sessionId]); },
  };
  const sessions = globalThis.SaCodeSessionState.createSessionAssembly(deps);
  await assert.rejects(sessions.applySelection('session-new'), /select failed/);
  assert.deepEqual(order, [
    'invalidateTrace',
    'sessionSelect',
    ['refreshTrace', true, 'session-old'],
  ]);
});

test('来源页只显示持久检索审计元数据，不显示知识正文或摘要', () => {
  const privateBody = '私密知识正文不应出现在来源页';
  const audit = {
    version: 1, status: 'matched', workspace: 'D:/repo', queryDigest: 'query-secret-digest',
    matches: [{ scope: 'project', id: 'project-current', revision: 3, sourcePath: 'docs/current.md', content: privateBody }],
  };
  const model = { ...self, sideTab: 'trace', scrollSession: 'session-3', traceEvents: [], refreshTrace() {} };
  const trace = render(model);
  trace.sideTabs.props.onSelect('sources');
  // Simulate the durable session/subscribe reply after the explicit refresh.
  model.traceEvents = [{ seq: 8, type: 'knowledge/retrieval', data: JSON.stringify(audit) }];
  const view = render(model);
  const found = ids(view.tracePage);
  const text = visibleText(view.tracePage);
  assert.ok(found.includes('side-page-sources'));
  assert.ok(found.includes('sources-panel'));
  for (const value of ['检索状态：已匹配', '工作区：D:/repo', 'project · project-current', '修订 3', 'docs/current.md']) {
    assert.ok(text.includes(value), '来源页缺少审计字段：' + value);
  }
  assert.equal(text.includes(privateBody), false);
  assert.equal(text.includes('query-secret-digest'), false);
});

test('来源页提供空态、失败提示、刷新与分页，并且不回显 Host 错误正文', () => {
  const refreshes = [];
  const model = {
    ...self, sideTab: 'trace', scrollSession: 'session-4', traceEvents: [], traceMore: true,
    traceError: '', refreshTrace: (reset, sessionId) => { refreshes.push([reset, sessionId]); },
  };
  const trace = render(model);
  trace.sideTabs.props.onSelect('sources');
  model.traceError = 'host-internal-payload-must-not-be-rendered';
  model.traceMore = true;
  const failed = render(model);
  const failedText = visibleText(failed.tracePage);
  assert.ok(ids(failed.tracePage).includes('sources-error'));
  assert.ok(!failedText.includes('当前会话暂无知识检索来源'));
  assert.ok(!failedText.includes('host-internal-payload-must-not-be-rendered'));
  const refresh = findNode(failed.tracePage, node => node.props?.id === 'refresh-sources');
  assert.ok(refresh);
  refresh.props.onClick();
  assert.deepEqual(refreshes, [[true, 'session-4'], [true, 'session-4']], '来源页首次打开后仍提供显式刷新且带会话身份');
  const loadEarlier = findNode(failed.tracePage, node => node.children === '加载更早的来源');
  assert.ok(loadEarlier);
  loadEarlier.props.onClick();
  assert.deepEqual(refreshes, [[true, 'session-4'], [true, 'session-4'], [false, 'session-4']], '分页也必须绑定当前会话');

  const empty = render({ ...model, sideTab: 'sources', scrollSession: 'session-4-empty', traceError: '', traceBusy: false, traceEvents: [], traceMore: false, refreshTrace() {} });
  assert.ok(ids(empty.tracePage).includes('sources-empty'));
});

test('来源页把无法解析的审计标为格式异常，不展示原始数据', () => {
  const secret = 'malformed-secret-body';
  const model = { ...self, sideTab: 'trace', scrollSession: 'session-5', traceEvents: [], refreshTrace() {} };
  const trace = render(model);
  trace.sideTabs.props.onSelect('sources');
  model.traceEvents = [{ seq: 9, type: 'knowledge/retrieval', data: secret }];
  const view = render(model);
  const text = visibleText(view.tracePage);
  assert.ok(text.includes('来源审计格式无法识别'));
  assert.equal(text.includes(secret), false);
});
