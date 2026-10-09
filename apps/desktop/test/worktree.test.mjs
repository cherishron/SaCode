import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const load = () => require('../worktree-ipc.cjs');

// 冻结契约（docs/superpowers/plans/2026-10-08-session-worktree.md「冻结契约」）：
// describe 的字段集恰好 8 个，退出动作取值只有 keep / remove。
const KEYS = ['active', 'name', 'directory', 'originalDirectory', 'branch', 'dirty', 'uncommittedCount', 'uniqueCommits'];
const active = {
  active: true, name: 'feature-x',
  directory: 'D:/repo/.sacode/worktrees/feature-x',
  originalDirectory: 'D:/repo', branch: 'worktree-feature-x',
  dirty: true, uncommittedCount: 3, uniqueCommits: 2,
};
const inactive = {
  active: false, name: '', directory: '', originalDirectory: '',
  branch: '', dirty: false, uncommittedCount: 0, uniqueCommits: 0,
};

test('worktree describe 适配器只认恰好八个字段，缺 uncommittedCount 也拒', () => {
  const { describe } = load();
  assert.deepEqual(describe(active), active);
  assert.deepEqual(Object.keys(describe(active)).sort(), [...KEYS].sort());
  assert.deepEqual(describe(inactive), inactive, '未激活状态同样必须带齐八个字段，不许塌成 {active:false}');
  const missing = KEYS.slice(1).map((key) => {
    const partial = { ...active };
    delete partial[key];
    return partial;
  });
  // 少任何一个字段、多任何一个字段、类型不符、计数为负或非整数——一律 worktree-contract，
  // 绝不猜成「干净」或「未激活」。
  for (const bad of [{}, { active: false }, ...missing, { ...active, extra: 1 },
    { ...active, uncommittedCount: '3' }, { ...active, uncommittedCount: 1.5 },
    { ...active, uncommittedCount: -1 }, { ...active, uncommittedCount: NaN },
    { ...active, uniqueCommits: 2.5 }, { ...active, dirty: 'false' },
    { ...active, name: 42 }, { ...active, name: '' }, { ...active, branch: '' },
    { ...active, directory: null }, { active: true }]) {
    assert.throws(() => describe(bad), /worktree-contract/, JSON.stringify(bad));
  }
});

test('worktree 四个通道按动作命名，参数与负载逐字段校验', async () => {
  const { handlers, calls } = ipc({ request: async (method, args) => { calls.push([method, args]); return method === 'worktree/cleanup' ? 0 : method === 'worktree/exit' ? inactive : active; } });
  assert.deepEqual([...handlers.keys()], ['sacode:worktreeDescribe', 'sacode:worktreeEnter', 'sacode:worktreeExit', 'sacode:worktreeCleanup']);
  const enter = handlers.get('sacode:worktreeEnter');
  for (const good of [{ name: 'feature' }, { name: 'a_b.c-d' }, { name: 'x'.repeat(64) },
    { reference: '#42' }, { reference: '42' }, { reference: 'https://github.com/owner/repo/pull/42' }]) {
    await enter(null, good);
    assert.deepEqual(calls.at(-1), ['worktree/enter', good]);
  }
  for (const bad of [null, undefined, {}, [], 'feature',
    { name: 'x', reference: 'y' }, { name: '' }, { name: 'x'.repeat(65) }, { name: 'a b' },
    { name: '../x' }, { name: 'a\\b' }, { name: '-x' }, { name: 'x\n' }, { name: 42 },
    { reference: 'https://example.com/o/r/pull/42' }, { reference: 'https://github.com/o/pull/42' },
    { reference: 'https://github.com/o/r/pull/0' }, { reference: '#0' }, { reference: 'pull/42' },
    { reference: 42 }, { reference: 'x', directory: 'z' }, { name: 'x', force: true }]) {
    await assert.rejects(() => enter(null, bad), /bad-worktree-arguments/, JSON.stringify(bad));
  }
  assert.equal(calls.length, 6, '被拒的负载一个也不许转到宿主');
  const exit = handlers.get('sacode:worktreeExit');
  for (const good of [{ name: 'feature-x', action: 'keep', discardChanges: false },
    { name: 'feature-x', action: 'remove', discardChanges: true }]) {
    assert.deepEqual(await exit(null, good), inactive, JSON.stringify(good));
    assert.deepEqual(calls.at(-1), ['worktree/exit', good], '退出动作必须作用在刚核实过的那条绑定上');
  }
  for (const bad of [null, {}, { action: 'keep', discardChanges: false },
    { name: 'feature-x', action: 'delete', discardChanges: false },
    { name: 'feature-x', action: 'remove' }, { name: 'feature-x', action: 'remove', discardChanges: 'true' },
    { name: 'feature-x', action: 'remove', discardChanges: false, force: true },
    { name: '../x', action: 'remove', discardChanges: false }]) {
    await assert.rejects(() => exit(null, bad), /bad-worktree-arguments/, JSON.stringify(bad));
  }
  for (const bad of [null, { directory: 'D:/x' }, { force: true }]) {
    await assert.rejects(() => handlers.get('sacode:worktreeCleanup')(null, bad), /bad-worktree-arguments/, JSON.stringify(bad));
  }
  await handlers.get('sacode:worktreeCleanup')(null);
  assert.deepEqual(calls.at(-1), ['worktree/cleanup', {}]);
});

test('worktree describe 与 cleanup 通道把结果也过一遍契约', async () => {
  const { handlers, calls } = ipc({ request: async (method) => { calls.push(method); return method === 'worktree/cleanup' ? '3' : inactive; } });
  assert.deepEqual(await handlers.get('sacode:worktreeDescribe')(null), inactive);
  await assert.rejects(() => handlers.get('sacode:worktreeCleanup')(null), /worktree-contract/);
  const clean = ipc({ request: async () => 7 });
  assert.equal(await clean.handlers.get('sacode:worktreeCleanup')(null), 7);
});

test('删除被保护规则拒绝时原因必须冒泡，取消不发 RPC，成功也要读权威状态', async () => {
  let asked = 0;
  const { handlers, calls } = ipc({
    request: async (method, args) => {
      calls.push([method, args]);
      if (method === 'worktree/describe') return active;
      throw Object.assign(Error('4005 worktree-delete-protected: unique-commits'), { data: { reason: 'unique-commits' } });
    },
    confirmDelete: async (state) => { assert.deepEqual(state, active); asked++; return asked > 1; },
  });
  const exit = handlers.get('sacode:worktreeExit');
  assert.deepEqual(await exit(null, { name: 'feature-x', action: 'remove', discardChanges: true }), { cancelled: true });
  assert.deepEqual(calls, [['worktree/describe', {}]], '用户取消删除后一个删除 RPC 也不许发出');
  // 原因原样冒泡给渲染层，不许被压成成功或 cancelled。
  await assert.rejects(
    () => exit(null, { name: 'feature-x', action: 'remove', discardChanges: true }),
    (error) => /unique-commits/.test(error.message),
  );
  // 名称与刚核实的绑定不一致时先本地拒绝，不去猜用户想退哪一条。
  await assert.rejects(() => exit(null, { name: 'other-x', action: 'remove', discardChanges: true }), /worktree-name-mismatch/);
  assert.equal(calls.filter((row) => row[0] === 'worktree/exit').length, 1, '名称不符的那次不许发出删除');
});

test('退出后宿主仍报活动绑定即视为失败，不写回旧状态冒充成功', async () => {
  const { handlers, calls } = ipc({ request: async (method) => { calls.push(method); return active; } });
  await assert.rejects(
    () => handlers.get('sacode:worktreeExit')(null, { name: 'feature-x', action: 'keep', discardChanges: false }),
    /worktree-still-active/,
  );
  assert.deepEqual(calls, ['worktree/describe', 'worktree/exit']);
});

test('关闭保护：未激活放行，取消与读取失败都不许继续退出', async () => {
  const { protectClose } = load();
  assert.equal(await protectClose({ request: async () => inactive, choose: () => { throw Error('unexpected'); } }), true);
  assert.equal(await protectClose({ request: async () => active, choose: async () => 'cancel' }), false);
  await assert.rejects(() => protectClose({ request: async () => { throw Error('host-gone'); }, choose: async () => 'keep' }), /host-gone/);
  const calls = [];
  await assert.rejects(() => protectClose({
    request: async (method, args) => { calls.push([method, args]); if (method === 'worktree/describe') return active; throw Error('flush-failed'); },
    choose: async () => 'keep',
  }), /flush-failed/);
  assert.deepEqual(calls.at(-1), ['worktree/exit', { name: 'feature-x', action: 'keep', discardChanges: false }]);
});

test('关闭删除走同一确认，确认失败或保护拒绝都不静默强删', async () => {
  const { protectClose } = load();
  let calls = [];
  const request = async (method, args) => { calls.push([method, args]); return method === 'worktree/describe' ? active : inactive; };
  assert.equal(await protectClose({ request, choose: async () => 'remove', confirmDelete: async () => false }), false);
  assert.equal(calls.length, 1, '二次确认被拒后不许发出删除');
  calls = [];
  assert.equal(await protectClose({ request, choose: async () => 'remove', confirmDelete: async (state, discardChanges) => { assert.deepEqual(state, active); assert.equal(discardChanges, true); return true; } }), true);
  assert.deepEqual(calls.at(-1), ['worktree/exit', { name: 'feature-x', action: 'remove', discardChanges: true }]);
  // 独有提交这类保护没有强制通路：原因必须原样抛给调用方，由主进程显示并中止退出。
  await assert.rejects(() => protectClose({
    request: async (method) => { if (method === 'worktree/describe') return active; throw Error('4005 worktree-delete-protected: unique-commits'); },
    choose: async () => 'remove', confirmDelete: async () => true,
  }), /unique-commits/);
  await assert.rejects(() => protectClose({ request: async () => active, choose: async () => 'delete' }), /bad-worktree-close-choice/);
  await assert.rejects(() => protectClose({ request: async () => active, choose: async () => 'keep' }), /worktree-still-active/);
});

test('worktree UI 状态恢复、草稿保留和在途防重入', async () => {
  const { createController } = require('../renderer/worktree.js');
  const state = newState({ name: '草稿', reference: '#7' });
  let resolveEnter;
  let exits = 0;
  const api = {
    worktreeDescribe: async () => active,
    worktreeEnter: () => new Promise((resolve) => { resolveEnter = resolve; }),
    worktreeExit: async () => { exits++; throw Error('4005 worktree-delete-protected: unique-commits'); },
    worktreeCleanup: async () => { throw Error('worktree-cleanup-unavailable'); },
  };
  let refreshed = 0;
  const controller = createController(state, api, async () => { refreshed++; });
  await controller.restore();
  assert.deepEqual(state.view, active);
  const pending = controller.enter('name');
  await controller.enter('name');
  assert.equal(state.busy, true, '在途操作不许并发重入');
  resolveEnter({ ...inactive });
  await pending;
  assert.equal(state.name, '草稿', '进入失败必须保留用户草稿');
  assert.match(state.error, /worktree-enter-not-active/);
  assert.equal(refreshed, 0, '没真正改变绑定就不许谎报工作区已刷新');
  await controller.restore();
  controller.openExit();
  assert.equal(state.dialog, 'exit');
  await controller.resolveExit('remove');
  assert.equal(state.view.active, true, '删除被拒后当前状态不许被清空');
  assert.match(state.error, /unique-commits/, '保护原因要显示出来');
  assert.equal(state.reference, '#7', '错误路径保留草稿');
  assert.equal(state.dialog, null, '失败后对话框收起，用户可改选保留');
  await controller.cleanup();
  assert.match(state.error, /worktree-cleanup-unavailable/, '清理失败要显示原因，不能报 0 条成功');
  assert.equal(state.cleaned, null);
  controller.resolveExit('delete');
  assert.match(state.error, /bad-worktree-action/);
  assert.equal(exits, 1, '非法动作不许发出退出 RPC');
  api.worktreeExit = async () => { exits++; return inactive; };
  await controller.resolveExit('keep');
  assert.deepEqual(state.view, inactive);
  assert.equal(refreshed, 1, '真正退出后要把工作区刷新一次');
  assert.equal(exits, 2);
});

test('worktree UI 取消退出只收起对话框，不发任何 RPC', async () => {
  const { createController } = require('../renderer/worktree.js');
  const state = newState({ view: active, name: '草稿' });
  let exited = 0;
  const controller = createController(state, { worktreeExit: async () => { exited++; return inactive; } }, async () => {});
  await controller.openExit();
  controller.cancelExit();
  assert.equal(state.dialog, null);
  assert.equal(exited, 0);
  assert.equal(state.name, '草稿');
});

test('worktree 面板有名称与 PR 入口、当前状态三要素、退出对话框三选项与两项计数', () => {
  const { renderPanel } = require('../renderer/worktree.js');
  const { nodes, h } = recorder();
  const actions = [];
  const state = newState({ view: active });
  const controller = { restore: () => actions.push('restore'), enter: (k) => actions.push(k), openExit: () => actions.push('open'), cancelExit: () => actions.push('cancel'), resolveExit: (a) => actions.push(['exit', a]), cleanup: () => actions.push('cleanup') };
  renderPanel(h, state, controller, false);
  for (const id of ['worktree-name', 'worktree-pr', 'worktree-create', 'worktree-select', 'worktree-refresh', 'worktree-exit', 'worktree-cleanup']) assert.ok(nodes.some((n) => n.props.id === id), id);
  const shownIds = ['worktree-state', 'worktree-directory', 'worktree-original'];
  assert.deepEqual(shownIds.filter((id) => !nodes.some((n) => n.props.id === id)), [], '名称/分支/工作树目录/原目录都要有落点');
  const shown = nodes.filter((n) => shownIds.includes(n.props.id)).map((n) => n.children.join('')).join('');
  for (const text of ['feature-x', 'worktree-feature-x', 'D:/repo', '3', '2']) assert.ok(shown.includes(text), '面板须显示 ' + text);
  nodes.find((n) => n.props.id === 'worktree-exit').props.onClick();
  assert.deepEqual(actions.at(-1), 'open');
  nodes.find((n) => n.props.id === 'worktree-cleanup').props.onClick();
  assert.deepEqual(actions.at(-1), 'cleanup');
  nodes.length = 0;
  renderPanel(h, newState({ view: active, dialog: 'exit' }), controller, false);
  const dialog = nodes.filter((n) => ['worktree-keep', 'worktree-remove', 'worktree-cancel'].includes(n.props.id));
  assert.deepEqual(dialog.map((n) => n.props.id), ['worktree-keep', 'worktree-remove', 'worktree-cancel'], '退出对话框给保留/删除/取消三个选项');
  assert.deepEqual(nodes.filter((n) => n.props.id === 'worktree-dialog-counts').map((n) => n.children.join('')), ['未提交文件 3 个 · 独有提交 2 个']);
  dialog.find((n) => n.props.id === 'worktree-remove').props.onClick();
  assert.deepEqual(actions.at(-1), ['exit', 'remove'], '删除按钮走 remove，不是 delete');
  dialog.find((n) => n.props.id === 'worktree-cancel').props.onClick();
  assert.deepEqual(actions.at(-1), 'cancel');
  nodes.length = 0;
  renderPanel(h, newState({ view: inactive }), controller, false);
  assert.equal(nodes.filter((n) => n.props.id === 'worktree-exit').length, 0, '未激活时不该有退出入口');
});

test('worktree 面板在途锁与错误行按状态显示，不把处理中当空闲', () => {
  const { renderPanel } = require('../renderer/worktree.js');
  const { nodes, h } = recorder();
  renderPanel(h, newState({ view: active, busy: true }), { restore: () => {}, enter: () => {}, openExit: () => {}, cancelExit: () => {}, resolveExit: () => {}, cleanup: () => {} }, false);
  const buttons = nodes.filter((n) => n.tag === 'button');
  assert.ok(buttons.length >= 5, `在途时只渲染到 ${buttons.length} 个按钮`);
  assert.ok(buttons.every((n) => n.props.disabled === true), '在途时所有动作按钮必须禁用');
  assert.equal(nodes.find((n) => n.props.id === 'worktree-error').children.join(''), '正在处理，请稍候…');
  nodes.length = 0;
  renderPanel(h, newState({ view: active, error: '4005 worktree-delete-protected: unique-commits' }), { restore: () => {}, enter: () => {}, openExit: () => {}, cancelExit: () => {}, resolveExit: () => {}, cleanup: () => {} }, false);
  assert.equal(nodes.find((n) => n.props.id === 'worktree-error').children.join(''), '4005 worktree-delete-protected: unique-commits', '拒绝原因必须原样显示');
});

test('worktree 面板在真实 Vue runtime 下渲染：h() 出树、reactive 状态驱动重绘、退出对话框按点展开', async () => {
  const Vue = require('vue');
  const { createController, renderPanel } = require('../renderer/worktree.js');
  const tree = mountNoDom(Vue);
  const state = Vue.reactive(newState({ view: null }));
  const api = {
    worktreeDescribe: async () => active,
    worktreeEnter: async () => active,
    // 第一次删除被保护规则拒（原因要留在界面上），改选保留后成功。
    worktreeExit: async (name, action, discardChanges) => {
      calls.push([name, action, discardChanges]);
      if (action === 'remove') throw Error('4005 worktree-delete-protected: unique-commits');
      return inactive;
    },
    worktreeCleanup: async () => 2,
  };
  const calls = [];
  const controller = createController(state, api, async () => {});
  tree.mount(Vue.h(Panel(Vue, state, controller, renderPanel)));
  await Vue.nextTick();
  assert.match(tree.text('worktree-state'), /状态未知/, '没有权威状态时不能说「未进入」');
  await controller.restore();
  await Vue.nextTick();
  assert.match(tree.text('worktree-state'), /feature-x · |名称 feature-x/);
  assert.equal(tree.has('worktree-exit'), true, '激活后才有退出入口');
  tree.click('worktree-exit');
  await Vue.nextTick();
  assert.deepEqual(['worktree-keep', 'worktree-remove', 'worktree-cancel'].filter((id) => tree.has(id)), ['worktree-keep', 'worktree-remove', 'worktree-cancel']);
  assert.match(tree.text('worktree-dialog-counts'), /未提交文件 3 个 · 独有提交 2 个/);
  await tree.click('worktree-remove');
  await Vue.nextTick();
  assert.deepEqual(calls.at(-1), ['feature-x', 'remove', false]);
  assert.match(tree.text('worktree-error'), /unique-commits/, '拒绝原因必须留在界面上');
  assert.equal(tree.has('worktree-exit'), true, '删除被拒后仍在工作树里，入口不该消失');
  tree.click('worktree-exit');
  await tree.click('worktree-keep');
  await Vue.nextTick();
  assert.deepEqual(calls.at(-1), ['feature-x', 'keep', false]);
  assert.equal(tree.has('worktree-exit'), false, '退出成功后退出入口收起');
  assert.equal(tree.has('worktree-discard'), false, '对话框已收起');
});

function Panel(Vue, state, controller, renderPanel) {
  return {
    render() {
      // 与 app.js 同一条路径：直接吃 window.Vue 的 h()，运行时无模板编译器。
      return renderPanel(Vue.h, state, controller, false);
    },
  };
}

// 无 DOM 的 Vue 自定义渲染器：把 vnode 落到普通对象树上，好让纯 Node 用例核真实响应式。
function mountNoDom(Vue) {
  const make = (tag) => ({ tag, props: {}, children: [], text: '' });
  const nodeOps = {
    createElement: (tag) => make(tag),
    createText: (text) => Object.assign(make('#text'), { text: String(text) }),
    createComment: (text) => Object.assign(make('#comment'), { text: String(text) }),
    setText: (node, text) => { node.text = String(text); },
    setElementText: (node, text) => { node.text = String(text); node.children.length = 0; },
    remove: (child) => {
      const parent = child.parentNode;
      if (parent) parent.children.splice(parent.children.indexOf(child), 1);
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
  };
  // Vue 3.5 的 createRenderer 收的是「扁平」选项：nodeOps 的方法与 patchProp 同级。
  const renderer = Vue.createRenderer(Object.assign({}, nodeOps, {
    patchProp: (el, key, prev, next) => { el.props[key] = next === null ? undefined : next; },
  }));
  const root = make('root');
  return {
    mount(vnode) { renderer.createApp(vnode).mount(root); },
    find(id) {
      const walk = (node) => {
        if (node.props && node.props.id === id) return node;
        for (const child of node.children || []) { const hit = walk(child); if (hit) return hit; }
        return null;
      };
      return walk(root);
    },
    has(id) { return !!this.find(id); },
    text(id) { const node = this.find(id); return node ? String(node.text || '') : ''; },
    click(id) { const node = this.find(id); if (!node || typeof node.props.onClick !== 'function') throw new Error('找不到可点控件 ' + id); node.props.onClick({ target: node }); },
  };
}

test('worktree preload 只交四个动作与必要字段，不提供通用转发', async () => {
  const { api, calls } = preloadApi();
  await api.worktreeDescribe();
  await api.worktreeEnter('feature', '');
  await api.worktreeEnter('', '#42');
  await api.worktreeExit('feature-x', 'remove', true);
  await api.worktreeCleanup();
  assert.deepEqual(calls.map((row) => row[0]), ['sacode:worktreeDescribe', 'sacode:worktreeEnter', 'sacode:worktreeEnter', 'sacode:worktreeExit', 'sacode:worktreeCleanup']);
  assert.equal(JSON.stringify(calls[1][1]), JSON.stringify({ name: 'feature' }));
  assert.equal(JSON.stringify(calls[2][1]), JSON.stringify({ reference: '#42' }));
  assert.equal(JSON.stringify(calls[3][1]), JSON.stringify({ name: 'feature-x', action: 'remove', discardChanges: true }));
  assert.deepEqual(Object.keys(calls[4][1]), []);
  for (const forbidden of ['request', 'worktreeRequest', 'worktreeCall', 'worktree', 'hostRequest']) {
    assert.equal(forbidden in api, false, `预加载暴露了通用转发 ${forbidden}`);
  }
});

test('worktree 宿主请求有覆盖默认五秒的有界超时，进入与删除都不会被掐断', () => {
  const { HostBridge, delays } = bridgeWithTimer();
  const b = new HostBridge('x.exe');
  b.proc = { exitCode: null, signalCode: null, stdin: { destroyed: false, writableEnded: false, write: () => {} } };
  b.request('session/projection', {});
  b.request('worktree/enter', { name: 'feature' }, 45000);
  assert.deepEqual(delays, [5000, 45000], '未显式给超时的调用仍走 5 秒，worktree 走调用方给的有界值');
});

test('worktree 文件入包、经典脚本接线和应用关闭保护均实际接入', () => {
  const pkg = require('../package.json');
  assert.ok(pkg.build.files.includes('worktree-ipc.cjs'), 'worktree-ipc.cjs 未入包清单');
  const html = readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
  assert.match(html, /<script src="worktree\.js"><\/script>/, 'worktree.js 必须以经典脚本挂载');
  assert.equal([...html.matchAll(/<script[^>]+type="module"/g)].length, 0, '渲染层不许出现 ES module');
  const app = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');
  assert.match(app, /SaCodeWorktree\.renderPanel/);
  assert.match(app, /SaCodeWorktree\.createController/);
  assert.match(app, /worktreeController\.restore/);
  const main = readFileSync(new URL('../main.cjs', import.meta.url), 'utf8');
  assert.match(main, /require\(['"]\.\/worktree-ipc\.cjs['"]\)/);
  assert.match(main, /registerWorktreeIpc\(/);
  assert.match(main, /protectClose\(/);
  assert.match(main, /const WORKTREE_TIMEOUT = 45000/);
  assert.match(main, /win\.on\("close"/);
  assert.match(main, /event\.preventDefault\(\)/);
});

function newState(extra) {
  return Object.assign({ view: null, name: '', reference: '', error: '', busy: false, dialog: null, discardChanges: false, cleaned: null }, extra);
}

function ipc(harness) {
  const handlers = new Map();
  const calls = [];
  load().registerWorktreeIpc({
    ipcMain: { handle: (key, fn) => handlers.set(key, fn) },
    request: (method, args) => harness.request(method, args),
    confirmDelete: harness.confirmDelete || (async () => true),
  });
  return { handlers, calls };
}

function preloadApi() {
  let api;
  const calls = [];
  vm.runInNewContext(readFileSync(new URL('../preload.cjs', import.meta.url), 'utf8'), {
    require: () => ({
      contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } },
      ipcRenderer: { invoke: (...args) => { calls.push(args); return Promise.resolve({}); }, on: () => {}, removeListener: () => {} },
    }),
  });
  return { api, calls };
}

function recorder() {
  const nodes = [];
  const h = (tag, props, children) => {
    const node = { tag, props: props || {}, children: children === undefined ? [] : (Array.isArray(children) ? children : [children]) };
    nodes.push(node);
    return node;
  };
  return { nodes, h };
}

// host-bridge 用全局 setTimeout 起超时；在 vm 里换成记录用值的桩，才能直接断言生效的超时值。
function bridgeWithTimer() {
  const delays = [];
  const sandbox = {
    require: (id) => (id === 'node:child_process' ? { spawn: () => ({}) } : require(id)),
    module: { exports: {} },
    process: { env: {}, stderr: { write: () => {} }, exit: () => {} },
    console: { log: () => {}, error: () => {}, warn: () => {} },
    Buffer, URL, TextEncoder, TextDecoder,
    setTimeout: (_fn, ms) => { delays.push(ms); return { unref: () => ({}) }; },
    clearTimeout: () => {},
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInNewContext(readFileSync(new URL('../host-bridge.cjs', import.meta.url), 'utf8'), sandbox, { filename: 'host-bridge.cjs' });
  return { HostBridge: sandbox.module.exports.HostBridge, delays };
}
