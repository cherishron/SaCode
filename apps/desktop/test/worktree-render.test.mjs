// 隔离工作树面板的「运行时挂载」证据。
//
// 为什么还要再加一份：test/worktree.test.mjs 那批用例走的是 require('vue') 与 require('../renderer/worktree.js')，
// 拿到的分别是「带 @vue/compiler-dom 的完整构建」和「CommonJS 分支」——模板字符串在那儿能悄悄编译过，
// 经典脚本的全局分支也根本没被执行。而桌面渲染层的三条硬约束（CSP script-src 'self' 禁 unsafe-eval、
// 无模板编译器、无模块加载器）恰好全落在这两条被绕开的路径上。
//
// 本文件把这三条约束变成可执行的断言：
// 1) 只装 node_modules/vue 的 **runtime** 全局构建（渲染层 <script src="vendor/vue.runtime.global.prod.js">
//    加载的就是这一份字节）；
// 2) 用 node:vm 把真实的 renderer/worktree.js 当**经典脚本**跑——沙箱里没有 module/exports，也没有 document，
//    它只能靠 globalThis.SaCodeWorktree 那条分支挂出来；
// 3) 用 Vue.createRenderer 自建无 DOM 渲染器把面板真的挂起来，节点落普通对象树。
// 零新增依赖：只用 node:vm / node:fs / node:test / node:assert（package.json 不许加东西）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP = resolve(HERE, '..');
const WORKTREE_SOURCE = readFileSync(join(DESKTOP, 'renderer/worktree.js'), 'utf8');
// 页面上真实加载的 runtime 构建；带模板编译器的 full 构建只用作对照组。
const RUNTIME_BUILD = join(DESKTOP, 'node_modules/vue/dist/vue.runtime.global.prod.js');
const FULL_BUILD = join(DESKTOP, 'node_modules/vue/dist/vue.global.prod.js');

// describe 视图 = worktree-ipc.cjs 逐字段校验过的那八个字段（形状在 test/worktree.test.mjs 已冻结）。
const ACTIVE = {
  active: true, name: 'feature-x',
  directory: 'D:/repo/.sacode/worktrees/feature-x',
  originalDirectory: 'D:/repo', branch: 'worktree-feature-x',
  dirty: true, uncommittedCount: 3, uniqueCommits: 2,
};
const CLEAN = {
  active: true, name: 'feature-clean',
  directory: 'D:/repo/.sacode/worktrees/feature-clean',
  originalDirectory: 'D:/repo', branch: 'worktree-feature-clean',
  dirty: false, uncommittedCount: 0, uniqueCommits: 0,
};
const INACTIVE = {
  active: false, name: '', directory: '', originalDirectory: '',
  branch: '', dirty: false, uncommittedCount: 0, uniqueCommits: 0,
};

// 面板消费的状态形状，与 renderer/app.js 里那份 window.Vue.reactive 初值逐字段对齐。
const newState = (extra) => Object.assign(
  { view: null, name: '', reference: '', error: '', busy: false, dialog: null, discardChanges: false, cleaned: null },
  extra,
);

const STATE_ACTIVE_TEXT = '名称 feature-x · 分支 worktree-feature-x · 未提交 3 个 · 独有提交 2 个';
const STATE_INACTIVE_TEXT = '当前未进入隔离工作树';
const STATE_UNKNOWN_TEXT = '状态未知，请点「恢复当前状态」；不会按未激活处理。';

// 四个动作在面板上的落点：进入两条（按名称 / 按 PR）、describe 一条、退出与清理各一条。
const FOUR_ACTIONS = ['worktree-create', 'worktree-select', 'worktree-refresh', 'worktree-exit', 'worktree-cleanup'];

// 面板根节点是所有变异体的落点：锚点命中数不是 1 就当场失败，
// 别拿一个没改到的字符串当反证（锚点漂了等于没施加变异，绿灯是假的）。
const PANEL_ROOT = "return h('section', { class: 'workspace-panel worktree-panel', 'aria-label': '隔离工作树' }, children);";
function splice(source, anchor, replacement, label) {
  const hits = source.split(anchor).length - 1;
  assert.equal(hits, 1, `${label} 的锚点命中 ${hits} 次（要求恰好 1 次），锚点已漂：拒绝产出变异体`);
  const mutated = source.replace(anchor, replacement);
  assert.notEqual(mutated, source, `${label} 没有改动任何字节`);
  return mutated;
}

// 变异体只存在于内存里：renderer/worktree.js 一个字节都不动。
// 把面板根节点换成「带模板字符串的组件」——渲染层三条硬约束里最贵的那条违规。
// 模板体里写死文案，别用 {{ }}：对照组要证的是「有没有编译器」，不是「能不能取到状态」。
const TEMPLATE_MUTANT_SOURCE = splice(WORKTREE_SOURCE, PANEL_ROOT,
  "return h({ template: '<section class=\"worktree-panel\" aria-label=\"隔离工作树\">" +
  '<p id="worktree-state">名称 feature-x · 分支 worktree-feature-x</p>' +
  '<button id="worktree-create">创建并进入</button><button id="worktree-refresh">恢复当前状态</button>' +
  '<button id="worktree-exit">退出工作树</button><button id="worktree-cleanup">清理过期代理工作树</button>' +
  "</section>' });",
  '模板字符串');
const TEMPLATE_MUTANT_IDS = ['worktree-state', 'worktree-create', 'worktree-refresh', 'worktree-exit', 'worktree-cleanup'];
// 空壳变异体：模拟「面板还没实现 / 退化成空 section」，用来证明入口断言不是白给的。
const EMPTY_MUTANT = splice(WORKTREE_SOURCE, PANEL_ROOT,
  "return h('section', { class: 'workspace-panel worktree-panel' }, []);", '空壳面板');
// 经典脚本装载通道遇到 ES module 语法必须在解析期就拒绝，不能等到运行时才发现。
const ESM_EXPORT_MUTANT = WORKTREE_SOURCE + '\nexport const __renderProbe = 1;\n';
const ESM_IMPORT_MUTANT = 'import { h } from "vue";\n' + WORKTREE_SOURCE;

// 无 DOM 渲染器 + 求值陷阱：把「运行时不需要模板编译器」变成能数的量。
// 沙箱里没有 document、没有 module/exports；Function 与 eval 都被换成记录用的壳，
// 任何「把字符串当代码编」的路径都会在这里留下痕迹（Vue 完整构建编译模板走的正是 new Function，
// 也就是 CSP script-src 'self' 拦下的那一类）。
function boot({ build = RUNTIME_BUILD, source = WORKTREE_SOURCE } = {}) {
  const evalCalls = [];
  const warnings = [];
  const sandbox = {
    console: {
      log: () => {}, info: () => {}, debug: () => {}, trace: () => {},
      warn: (...a) => warnings.push(String(a.join(' '))),
      error: (...a) => warnings.push('E ' + String(a.join(' '))),
    },
    setTimeout, clearTimeout, queueMicrotask,
  };
  const ctx = vm.createContext(sandbox);
  const RealFunction = vm.runInContext('Function', ctx);
  const trap = new Proxy(RealFunction, {
    construct(target, args) {
      evalCalls.push('new Function: ' + String(args[args.length - 1] ?? '').slice(0, 60));
      return Reflect.construct(target, args, target);
    },
    apply(target, thisArg, args) {
      evalCalls.push('Function(): ' + String(args[0] ?? '').slice(0, 60));
      return Reflect.apply(target, thisArg, args);
    },
  });
  sandbox.Function = trap;
  sandbox.eval = (code) => {
    evalCalls.push('eval: ' + String(code).slice(0, 60));
    return vm.runInContext(String(code), ctx);
  };
  // 全局对象同时叫 globalThis 和 window：worktree.js 认前者，app.js 的调用点认后者。
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.runInContext(readFileSync(build, 'utf8'), ctx, { filename: build });
  const Vue = sandbox.Vue;
  assert.equal(typeof Vue, 'object', `没能在沙箱里挂出 Vue：${build}`);

  const make = (tag) => ({ tag, props: {}, children: [], text: '', parentNode: null });
  const nodeOps = {
    createElement: (tag) => make(tag),
    createText: (text) => Object.assign(make('#text'), { text: String(text) }),
    createComment: (text) => Object.assign(make('#comment'), { text: String(text) }),
    setText: (node, text) => { node.text = String(text); },
    setElementText: (node, text) => { node.text = String(text); node.children.length = 0; },
    remove: (child) => {
      const parent = child.parentNode;
      if (parent) parent.children.splice(parent.children.indexOf(child), 1);
      child.parentNode = null;
    },
    insert: (child, parent, anchor) => {
      child.parentNode = parent;
      const at = anchor ? parent.children.indexOf(anchor) : -1;
      if (at >= 0) parent.children.splice(at, 0, child); else parent.children.push(child);
    },
    parentNode: (node) => node.parentNode || null,
    nextSibling: (node) => {
      const parent = node.parentNode;
      if (!parent) return null;
      return parent.children[parent.children.indexOf(node) + 1] || null;
    },
    querySelector: () => null,
    setScopeId: () => {},
    // Vue 3.5 的 createRenderer 收「扁平」选项：nodeOps 的方法与 patchProp 同级。
    patchProp: (el, key, prev, next) => { el.props[key] = next === null ? undefined : next; },
  };
  const renderer = Vue.createRenderer(nodeOps);
  const root = make('root');

  const walk = (node, out = []) => { out.push(node); for (const child of node.children || []) walk(child, out); return out; };
  const textOf = (node) => String(node.text || '') + (node.children || []).map(textOf).join('');
  const app = { value: null };
  const t = {
    sandbox, ctx, Vue, evalCalls, warnings, root,
    // 与 renderer/app.js 的调用点同形：window.SaCodeWorktree.renderPanel(h, state, controller, worktreeLocked())。
    mount(component) { app.value = renderer.createApp(component); app.value.mount(root); },
    unmount() { if (app.value) { app.value.unmount(); app.value = null; } },
    nodes: () => walk(root),
    ids: () => walk(root).filter((n) => n.props && n.props.id).map((n) => n.props.id),
    node(id) {
      const hit = walk(root).find((n) => n.props && n.props.id === id);
      assert.ok(hit, `渲染树里没有 #${id}；现有节点：${JSON.stringify(t.ids())}`);
      return hit;
    },
    has: (id) => walk(root).some((n) => n.props && n.props.id === id),
    text: (id) => textOf(t.node(id)),
    buttons: () => walk(root).filter((n) => n.tag === 'button'),
    button(id) {
      const hit = t.buttons().find((n) => n.props.id === id);
      assert.ok(hit, `没有 #${id} 按钮；现有按钮：${JSON.stringify(t.buttons().map((n) => n.props.id))}`);
      return hit;
    },
    enabledButtons: () => t.buttons().filter((n) => n.props.disabled !== true).map((n) => n.props.id),
    click(id) {
      const node = t.node(id);
      assert.equal(typeof node.props.onClick, 'function', `#${id} 上没有 onClick`);
      return node.props.onClick({ target: node, preventDefault() {}, stopPropagation() {} });
    },
    // 输入与勾选走真实的事件 prop，不直接改 state：草稿是用户敲出来的，不是测试写进去的。
    type(id, value) {
      const node = t.node(id);
      const handler = node.props.onInput || node.props.onChange;
      assert.equal(typeof handler, 'function', `#${id} 上没有输入事件`);
      handler({ target: { value, checked: value === true } });
    },
    flush: async () => { await Vue.nextTick(); await Vue.nextTick(); },
  };

  // 经典脚本装载 renderer/worktree.js：沙箱里没有 module，只能走 globalThis.SaCodeWorktree 那条分支。
  assert.equal(vm.runInContext('typeof module', ctx), 'undefined', '沙箱里不该有 module：有就说明走的是 CommonJS 分支');
  vm.runInContext(source, ctx, { filename: 'worktree.js' });
  assert.equal(typeof sandbox.SaCodeWorktree, 'object', '经典脚本没把 SaCodeWorktree 挂到全局');
  assert.equal(vm.runInContext('typeof document', ctx), 'undefined', '沙箱里出现 document，说明这条路径偷偷依赖 DOM');
  return t;
}

// 把面板挂起来：状态用真 Vue.reactive，动作走真 createController，api 由调用方给。
function mountPanel(t, { state, api, refresh = async () => {}, locked = () => false }) {
  const controller = t.sandbox.SaCodeWorktree.createController(state, api, refresh);
  t.mount({
    render: () => t.sandbox.window.SaCodeWorktree.renderPanel(
      t.sandbox.window.Vue.h, state, controller, locked(),
    ),
  });
  return { controller, state };
}

// 与 renderer/app.js 的 worktreeLocked() 同一条锁：在途轮次、待审批工单、发送中，任一即锁。
function lockRefs(Vue) {
  const turn = Vue.ref({ running: false });
  const approval = Vue.ref(null);
  const sendBusy = Vue.ref(false);
  const locked = () => turn.value.running === true || !!approval.value || sendBusy.value === true;
  return { turn, approval, sendBusy, locked };
}

test('renderer/worktree.js 以经典脚本挂上全局：无 module、无 document 也能渲染出四个动作入口', async () => {
  const t = boot();
  assert.deepEqual(Object.keys(t.sandbox.SaCodeWorktree).sort(), ['createController', 'renderPanel']);
  const state = t.Vue.reactive(newState({ view: ACTIVE, name: 'feature-y', reference: '#9' }));
  const calls = [];
  const api = {
    worktreeDescribe: async () => { calls.push('describe'); return ACTIVE; },
    worktreeEnter: async () => { calls.push('enter'); return ACTIVE; },
    worktreeExit: async () => { calls.push('exit'); return ACTIVE; },
    worktreeCleanup: async () => { calls.push('cleanup'); return 2; },
  };
  mountPanel(t, { state, api });
  for (const id of FOUR_ACTIONS) assert.ok(t.has(id), `缺少动作入口 #${id}`);
  for (const id of FOUR_ACTIONS) assert.equal(typeof t.button(id).props.onClick, 'function', `#${id} 没接动作`);
  const section = t.nodes().find((n) => n.tag === 'section');
  assert.ok(section && section.props['aria-label'] === '隔离工作树', '面板根节点必须是带 aria-label 的 section');
  // 清理结果行只有真跑过清理才出现。
  assert.equal(t.has('worktree-cleanup-result'), false, '没清理过就不该有结果行');
  await t.click('worktree-cleanup');
  await t.flush();
  assert.equal(t.text('worktree-cleanup-result'), '已清理 2 个过期代理工作树；用户命名的工作树永不自动清理。');
  assert.deepEqual(calls, ['cleanup'], '面板不该替用户多发别的动作');
  // 整条挂载路径没把任何字符串当代码编：模板编译器在这儿不存在。
  assert.deepEqual(t.evalCalls, [], `渲染路径走到了求值：${JSON.stringify(t.evalCalls)}`);
  assert.deepEqual(t.warnings, [], `挂载期间有告警：${JSON.stringify(t.warnings)}`);
  t.unmount();
  assert.equal(t.has('worktree-cleanup'), false, 'unmount 后节点该撤干净');
});

test('describe 视图驱动面板：active=true 显示名称与分支，未激活时退出入口收起，读不到状态不冒充未进入', async () => {
  const t = boot();
  const state = t.Vue.reactive(newState());
  let view = ACTIVE;
  const api = {
    worktreeDescribe: async () => view,
    // 进入成功才交回 active 视图；未激活的返回值会被控制器判成契约破坏。
    worktreeEnter: async () => ACTIVE,
    worktreeExit: async () => INACTIVE,
    worktreeCleanup: async () => 0,
  };
  const { controller } = mountPanel(t, { state, api });
  // 还没读过权威状态：面板必须说「状态未知」，不能按未激活渲染。
  assert.equal(t.text('worktree-state'), STATE_UNKNOWN_TEXT);
  assert.equal(t.has('worktree-exit'), false, '状态未知时不该有退出入口');
  await t.click('worktree-refresh');
  await t.flush();
  assert.equal(t.text('worktree-state'), STATE_ACTIVE_TEXT);
  assert.equal(t.text('worktree-directory'), '工作树目录：D:/repo/.sacode/worktrees/feature-x');
  assert.equal(t.text('worktree-original'), '原目录：D:/repo');
  assert.ok(t.has('worktree-exit'), 'active=true 才有退出入口');
  // 换会话后 describe 回未激活：退出入口收起，状态行改口，目录两行也一起消失。
  view = INACTIVE;
  await controller.restore();
  await t.flush();
  assert.equal(t.text('worktree-state'), STATE_INACTIVE_TEXT);
  assert.equal(t.has('worktree-exit'), false);
  assert.equal(t.has('worktree-directory'), false);
  assert.equal(t.has('worktree-original'), false);
  // 未激活时两条进入入口才是可用的，且要等用户敲了草稿才放开。
  assert.deepEqual(t.enabledButtons(), ['worktree-refresh', 'worktree-cleanup'], '草稿为空时两条进入入口必须禁用');
  t.type('worktree-name', 'feature-y');
  await t.flush();
  assert.equal(t.button('worktree-create').props.disabled, false, '敲下草稿后创建入口应放开');
  assert.equal(state.name, 'feature-y', '输入事件必须落到 reactive 状态上，面板才留得住草稿');
  t.type('worktree-pr', '#42');
  await t.flush();
  assert.ok(t.enabledButtons().includes('worktree-select'), 'PR 草稿同样放开拉取入口');
  // 进入之后输入框与两条入口一起让位（同一份 active 状态驱动，不是测试写死的）。
  await controller.enter('name');
  await t.flush();
  assert.equal(t.text('worktree-state'), STATE_ACTIVE_TEXT);
  assert.deepEqual(t.enabledButtons(), ['worktree-refresh', 'worktree-exit', 'worktree-cleanup']);
  assert.equal(t.node('worktree-name').props.disabled, true, '已在隔离工作树里就不许再改名称草稿');
  assert.equal(t.node('worktree-pr').props.disabled, true, '已在隔离工作树里就不许再改 PR 草稿');
  t.unmount();
});

test('退出对话框按 dirty 亮出两项计数与丢弃勾选，删除被保护规则拒绝时原因留在界面上而不是被吞掉', async () => {
  const t = boot();
  const state = t.Vue.reactive(newState({ view: ACTIVE }));
  const calls = [];
  const api = {
    worktreeDescribe: async () => ACTIVE,
    worktreeEnter: async () => ACTIVE,
    worktreeExit: async (name, action, discardChanges) => {
      calls.push([name, action, discardChanges]);
      // 独有提交没有任何强制通路：宿主拒绝的原因必须原样回到界面上。
      if (action === 'remove') throw Error('4005 worktree-delete-protected: unique-commits');
      return INACTIVE;
    },
    worktreeCleanup: async () => 0,
  };
  mountPanel(t, { state, api });
  t.click('worktree-exit');
  await t.flush();
  const dialog = t.node('worktree-exit-dialog');
  assert.equal(dialog.props.role, 'dialog');
  assert.equal(dialog.props['aria-modal'], 'true');
  assert.deepEqual(['worktree-keep', 'worktree-remove', 'worktree-cancel'].filter((id) => t.has(id)),
    ['worktree-keep', 'worktree-remove', 'worktree-cancel'], '退出对话框要有保留/删除/取消三个选项');
  assert.equal(t.text('worktree-dialog-counts'), '未提交文件 3 个 · 独有提交 2 个');
  assert.ok(t.text('worktree-exit-dialog').includes('feature-x'), '对话框要点名退的是哪一条绑定');
  // 有未提交文件时才需要「允许丢弃未提交更改」这道勾；没勾过不许点删除。
  assert.ok(t.has('worktree-discard'), '有未提交文件时必须给出丢弃勾选');
  assert.equal(t.button('worktree-remove').props.disabled, true, '没勾丢弃就不许点删除');
  t.click('worktree-cancel');
  await t.flush();
  assert.equal(t.has('worktree-exit-dialog'), false, '取消只收起对话框');
  assert.deepEqual(calls, [], '取消不许发出任何退出 RPC');

  t.click('worktree-exit');
  await t.flush();
  t.type('worktree-discard', true);
  await t.flush();
  assert.equal(t.button('worktree-remove').props.disabled, false, '勾过丢弃后删除才放开');
  await t.click('worktree-remove');
  await t.flush();
  assert.deepEqual(calls.at(-1), ['feature-x', 'remove', true]);
  assert.equal(t.text('worktree-error'), '4005 worktree-delete-protected: unique-commits', '拒绝原因必须原样显示');
  assert.equal(t.has('worktree-exit-dialog'), false, '失败后对话框收起，用户可改选保留');
  assert.ok(t.has('worktree-exit'), '删除被拒后仍在工作树里，退出入口不该消失');
  assert.equal(t.text('worktree-state'), STATE_ACTIVE_TEXT, '失败路径不许清空当前状态');

  t.click('worktree-exit');
  await t.flush();
  await t.click('worktree-keep');
  await t.flush();
  assert.deepEqual(calls.at(-1), ['feature-x', 'keep', false]);
  assert.equal(t.has('worktree-exit'), false, '退出成功后退出入口收起');
  assert.equal(t.has('worktree-discard'), false);
  assert.equal(t.text('worktree-state'), STATE_INACTIVE_TEXT);
  t.unmount();

  // 干净的工作树：没有未提交也没有独有提交时，不该逼用户去勾一个用不上的丢弃框。
  const clean = boot();
  const cleanCalls = [];
  mountPanel(clean, {
    state: clean.Vue.reactive(newState({ view: CLEAN })),
    api: {
      worktreeDescribe: async () => CLEAN, worktreeEnter: async () => CLEAN,
      worktreeExit: async (name, action) => { cleanCalls.push([name, action]); return INACTIVE; },
      worktreeCleanup: async () => 0,
    },
  });
  clean.click('worktree-exit');
  await clean.flush();
  assert.equal(clean.text('worktree-dialog-counts'), '未提交文件 0 个 · 独有提交 0 个');
  assert.equal(clean.has('worktree-discard'), false, 'uncommittedCount=0 不该出现丢弃勾选');
  assert.equal(clean.button('worktree-remove').props.disabled, false, '干净工作树可直接删除');
  clean.unmount();
});

test('待决审批、在途轮次与发送中（worktreeLocked）把动作全锁住，锁解除后入口回得来', async () => {
  const t = boot();
  const state = t.Vue.reactive(newState({ view: ACTIVE, name: 'feature-y', reference: '#9' }));
  let rpc = 0;
  const api = {
    worktreeDescribe: async () => { rpc++; return ACTIVE; },
    worktreeEnter: async () => { rpc++; return ACTIVE; },
    worktreeExit: async () => { rpc++; return ACTIVE; },
    worktreeCleanup: async () => { rpc++; return 0; },
  };
  const { turn, approval, sendBusy, locked } = lockRefs(t.Vue);
  mountPanel(t, { state, api, locked });
  await t.flush();
  // 空闲且已激活：describe / 退出 / 清理三条可用，两条进入按 active 口径让位。
  assert.deepEqual(t.enabledButtons(), ['worktree-refresh', 'worktree-exit', 'worktree-cleanup']);
  // 待审批工单挂起：一个入口也不许可用。
  approval.value = { id: 'T-7', toolCall: 'Bash' };
  await t.flush();
  assert.deepEqual(t.enabledButtons(), [], '有待决审批时不许任何入口可用');
  // 发送中与在途轮次同样锁（与 worktreeLocked() 的三个条件一一对应）。
  approval.value = null;
  sendBusy.value = true;
  await t.flush();
  assert.deepEqual(t.enabledButtons(), [], '发送中不许任何入口可用');
  sendBusy.value = false;
  turn.value = { running: true };
  await t.flush();
  assert.deepEqual(t.enabledButtons(), [], '在途轮次不许任何入口可用');
  turn.value = { running: false };
  await t.flush();
  assert.deepEqual(t.enabledButtons(), ['worktree-refresh', 'worktree-exit', 'worktree-cleanup'],
    '锁解除后入口要回得来：响应式锁必须真的驱动重绘');

  // 控制器自身的在途锁：第二条动作不许再发 RPC，处理中也不许显示成空闲。
  let release;
  api.worktreeCleanup = () => new Promise((resolve) => { release = () => resolve(0); });
  const pending = t.click('worktree-cleanup');
  await t.flush();
  assert.equal(state.busy, true, '在途动作要落在 busy 上');
  assert.equal(t.text('worktree-error'), '正在处理，请稍候…', '处理中不能显示成空闲');
  assert.deepEqual(t.enabledButtons(), [], `在途时仍有可用入口：${JSON.stringify(t.enabledButtons())}`);
  rpc = 0;
  t.click('worktree-exit');
  assert.equal(rpc, 0, '在途时面板不许再发出第二条 RPC');
  assert.equal(t.has('worktree-exit-dialog'), false, '在途时退出对话框也不许打开');
  release();
  await pending;
  await t.flush();
  assert.equal(state.busy, false);
  assert.equal(t.text('worktree-error'), '', '处理结束后错误行要收起');
  assert.deepEqual(t.enabledButtons(), ['worktree-refresh', 'worktree-exit', 'worktree-cleanup']);
  t.unmount();
});

test('面板四个动作打到 preload 的四条固定通道，负载键集不出契约', async () => {
  // 用真 preload.cjs 造 api：渲染层拼不出第五个键，也说不出别的通道名。
  const invokes = [];
  let preloadApi;
  const views = {
    'sacode:worktreeDescribe': ACTIVE,
    'sacode:worktreeEnter': ACTIVE,
    'sacode:worktreeExit': INACTIVE,
    'sacode:worktreeCleanup': 1,
  };
  vm.runInNewContext(readFileSync(join(DESKTOP, 'preload.cjs'), 'utf8'), {
    require: () => ({
      contextBridge: { exposeInMainWorld: (_name, value) => { preloadApi = value; } },
      ipcRenderer: {
        invoke: (channel, payload) => { invokes.push([channel, payload]); return Promise.resolve(views[channel]); },
        on: () => {}, removeListener: () => {},
      },
    }),
  });
  assert.equal(typeof preloadApi, 'object', 'preload 没交出 api');

  // 未激活那一侧先走 PR 入口（进入成功后两条输入框与进入入口一起让位，名称入口另开一块面板验）。
  const a = boot();
  mountPanel(a, { state: a.Vue.reactive(newState({ reference: '#42' })), api: preloadApi });
  await a.click('worktree-select');
  await a.flush();
  assert.equal(a.text('worktree-state'), STATE_ACTIVE_TEXT, 'PR 进入后按权威状态显示');
  a.click('worktree-exit');
  await a.flush();
  await a.click('worktree-keep');
  await a.flush();
  assert.equal(a.text('worktree-state'), STATE_INACTIVE_TEXT, '退出后面板要落到未激活态');
  await a.click('worktree-refresh');
  await a.flush();
  await a.click('worktree-cleanup');
  await a.flush();
  assert.equal(a.text('worktree-cleanup-result'), '已清理 1 个过期代理工作树；用户命名的工作树永不自动清理。');

  const b = boot();
  mountPanel(b, { state: b.Vue.reactive(newState({ name: 'feature-z' })), api: preloadApi });
  await b.click('worktree-create');
  await b.flush();

  assert.deepEqual(invokes.map(([channel]) => channel), [
    'sacode:worktreeEnter', 'sacode:worktreeExit', 'sacode:worktreeDescribe',
    'sacode:worktreeCleanup', 'sacode:worktreeEnter',
  ]);
  // 负载是另一个 realm 造的对象，deepStrictEqual 会先比原型再比内容，所以逐条比 JSON 串
  // （与 test/worktree.test.mjs 里 preload 那批用例同一个处理法）。
  assert.deepEqual(invokes.map(([, payload]) => JSON.stringify(payload)), [
    JSON.stringify({ reference: '#42' }),
    JSON.stringify({ name: 'feature-x', action: 'keep', discardChanges: false }),
    '{}',
    '{}',
    JSON.stringify({ name: 'feature-z' }),
  ], '四条通道各递各的键，多一个也不许');
  assert.deepEqual([...new Set(invokes.map(([channel]) => channel))].sort(), [
    'sacode:worktreeCleanup', 'sacode:worktreeDescribe', 'sacode:worktreeEnter', 'sacode:worktreeExit',
  ], '面板只能打出这四条固定通道');
  // 每条通道的键集只能是契约里那几个：说不出 force，也说不出目录。
  const ALLOWED = {
    'sacode:worktreeDescribe': [],
    'sacode:worktreeEnter': ['name', 'reference'],
    'sacode:worktreeExit': ['name', 'action', 'discardChanges'],
    'sacode:worktreeCleanup': [],
  };
  for (const [channel, payload] of invokes) {
    assert.ok(channel in ALLOWED, `面板打出了未知通道 ${channel}`);
    for (const key of Object.keys(payload)) {
      assert.ok(ALLOWED[channel].includes(key), `${channel} 多带了契约外的键 ${key}`);
    }
  }
  a.unmount();
  b.unmount();
});

test('反证：模板字符串与 ES module 都进不了这条渲染路径，空壳面板会让每条断言变红', async () => {
  // 1) 模板字符串变异体：同一份源码，runtime 构建挂不出任何节点（本文件每条入口断言都会红），
  //    只有带编译器的 full 构建渲染得出来——而那条路径要 new Function，正是 CSP script-src 'self' 拦掉的。
  const runtimeMutant = boot({ build: RUNTIME_BUILD, source: TEMPLATE_MUTANT_SOURCE });
  mountPanel(runtimeMutant, { state: runtimeMutant.Vue.reactive(newState({ view: ACTIVE })), api: {} });
  assert.deepEqual(runtimeMutant.ids(), [], 'runtime 构建竟然渲染出了模板变异体：说明这份构建偷偷带了编译器');
  assert.deepEqual(runtimeMutant.evalCalls, [], 'runtime 构建走到了求值：现场会被 CSP 拦成整页空白');

  const fullMutant = boot({ build: FULL_BUILD, source: TEMPLATE_MUTANT_SOURCE });
  mountPanel(fullMutant, { state: fullMutant.Vue.reactive(newState({ view: ACTIVE })), api: {} });
  assert.deepEqual(fullMutant.ids(), TEMPLATE_MUTANT_IDS,
    '对照组失效：完整构建本该能编译模板，否则这条反证说明不了任何事');
  assert.ok(fullMutant.evalCalls.length > 0, '完整构建没走到 new Function：反证的 CSP 那半截没有证据');

  // 2) 空壳变异体（模拟「面板没实现 / 退化成空 section」）：入口与按钮断言必须全红。
  const empty = boot({ source: EMPTY_MUTANT });
  mountPanel(empty, { state: empty.Vue.reactive(newState({ view: ACTIVE })), api: {} });
  assert.deepEqual(empty.ids(), [], `空壳面板居然还有带 id 的节点：${JSON.stringify(empty.ids())}`);
  assert.deepEqual(FOUR_ACTIONS.filter((id) => !empty.has(id)), FOUR_ACTIONS, '空壳面板不该有动作入口');
  assert.deepEqual(empty.buttons(), [], '空壳面板不该有按钮');

  // 3) ES module 变异体：经典脚本装载通道在解析期就该拒绝，而真实源码必须过。
  const esm = boot();
  for (const [label, source] of [['export', ESM_EXPORT_MUTANT], ['import', ESM_IMPORT_MUTANT]]) {
    assert.throws(
      () => vm.runInContext(source, esm.ctx, { filename: 'worktree.js' }),
      (error) => {
        const message = String((error && error.message) || error);
        assert.match(message, /import|export|module/i, `${label} 变异体被拒了，但理由不是「这是模块语法」：${message}`);
        return true;
      },
      `${label} 变异体竟然被经典脚本通道接受了`,
    );
  }
  assert.doesNotThrow(() => vm.runInContext(WORKTREE_SOURCE, esm.ctx, { filename: 'worktree.js' }),
    '真实源码必须能在经典脚本通道里解析');
  // 反证本身也要反证：同一条 export 变异体在真 ESM 通道里解析得过，
  // 红点才落在「运行时无模块加载器」上，而不是「变异体语法写坏了」。
  await import('data:text/javascript,export const __channelWorks = 1;');
  await assert.rejects(() => import('data:text/javascript,export const 1;'), /Unexpected token|SyntaxError/i);
  const mutantModule = await import('data:text/javascript;base64,' + Buffer.from(ESM_EXPORT_MUTANT, 'utf8').toString('base64'));
  assert.equal(mutantModule.__renderProbe, 1, 'export 变异体连 ESM 都解析不过，这条反证不成立');
  // 真实字节里既没有模板串、也没有模块语法和把字符串当代码编的入口；全局挂载那条分支必须还在。
  for (const forbidden of ['template:', 'new Function', 'eval(', 'import(', '\nexport ', '\nimport ']) {
    assert.equal(WORKTREE_SOURCE.includes(forbidden), false, `renderer/worktree.js 里出现了 ${forbidden}`);
  }
  assert.match(WORKTREE_SOURCE, /else root\.SaCodeWorktree = exports;/, '全局挂载这条分支必须还在');
  esm.unmount();
});

test('渲染层引的是不带运行时编译器的 runtime 构建：页面不引 full，vendor 字节与本用例加载的一致', (t) => {
  const html = readFileSync(join(DESKTOP, 'renderer/index.html'), 'utf8');
  assert.match(html, /<script src="vendor\/vue\.runtime\.global\.prod\.js"><\/script>/, '页面必须加载 runtime 构建');
  assert.equal((html.match(/src="[^"]*vue\.global[^"]*"/g) || []).length, 0,
    "页面改引带模板编译器的 full 构建后，CSP script-src 'self' 会因 unsafe-eval 整页空白");
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.includes('worktree.js'), 'worktree.js 必须以经典脚本入页面');
  assert.ok(scripts.indexOf('worktree.js') < scripts.indexOf('app.js'),
    'worktree.js 要排在 app.js 之前：app.js 的 setup 直接读 window.SaCodeWorktree');
  assert.equal((html.match(/<script[^>]+type="module"/g) || []).length, 0, '渲染层不许出现 ES module');

  const vendor = join(DESKTOP, 'renderer/vendor/vue.runtime.global.prod.js');
  if (!existsSync(vendor)) {
    // vendor 是 `npm run vendor` 的产物且已 gitignore；缺它不算回归，但要说清楚这条没验到。
    t.skip('renderer/vendor/vue.runtime.global.prod.js 未生成，跳过与 node_modules runtime 构建的字节比对');
    return;
  }
  assert.deepEqual(readFileSync(vendor), readFileSync(RUNTIME_BUILD),
    '页面上那份 vendor 与本用例加载的 node_modules runtime 构建字节不一致，本文件验的就不是现场跑的字节');
});
