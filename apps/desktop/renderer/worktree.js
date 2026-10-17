// 会话级隔离工作树的桌面面板：经典脚本（CSP script-src 'self'，运行时无模块加载器、
// 无模板编译器），渲染只用 Vue runtime 的 h()，与 Node 单测共用同一份实现。
// 状态形状 = worktree-ipc.cjs 校验过的 describe 视图（恰好 8 个字段）+ 本地草稿/在途标记。
(function (root) {
  var ACTIONS = ['keep', 'remove'];

  function createController(state, api, refreshWorkspace) {
    // 一条串行队列：在途时后到的动作直接丢弃，避免「点了两次删除」这种竞态。
    async function run(operation, changed) {
      if (state.busy) return;
      state.busy = true;
      state.error = '';
      try {
        const view = await operation();
        // 用户在主进程确认框里取消：什么都没发生，视图与草稿都保持原样。
        if (view && view.cancelled) return;
        if (!view || typeof view.active !== 'boolean') throw new Error('worktree-contract: active');
        state.view = view;
        if (changed) await refreshWorkspace();
      } catch (error) {
        // 保护规则拒绝的原因原样留着显示，不折叠成「成功」也不清空当前状态。
        state.error = String((error && error.message) || error);
      } finally {
        state.busy = false;
      }
    }
    return {
      restore: function () { return run(function () { return api.worktreeDescribe(); }, false); },
      enter: function (kind) {
        return run(function () {
          var byName = kind === 'name';
          var value = byName ? state.name : state.reference;
          return Promise.resolve(api.worktreeEnter(byName ? value : '', byName ? '' : value))
            .then(function (view) {
              // 宿主说「进去了」但权威状态说没绑定：这是契约破坏，不能当成成功。
              if (view && !view.cancelled && view.active !== true) throw new Error('worktree-enter-not-active');
              return view;
            });
        }, true);
      },
      // 退出对话框只在本地打开：三个选项（保留 / 删除 / 取消）都由用户点出来，
      // 关闭时收起对话框但保留草稿，失败原因继续在错误行里显示。
      openExit: function () {
        if (state.busy || !state.view || !state.view.active) return;
        state.error = '';
        state.dialog = 'exit';
      },
      cancelExit: function () { state.dialog = null; },
      resolveExit: function (action) {
        if (ACTIONS.indexOf(action) < 0) {
          state.dialog = null;
          state.error = 'bad-worktree-action: ' + action;
          return Promise.resolve();
        }
        var name = state.view && state.view.name;
        // 只有删除才可能丢未提交更改，且必须用户在对应对话框里显式勾过。
        var discard = action === 'remove' && state.discardChanges === true;
        return run(function () { return api.worktreeExit(name, action, discard); }, true)
          .then(function () { state.dialog = null; });
      },
      // 过期代理工作树清理：桌面只能按一个按钮，说不出目录、天数与 force。
      cleanup: function () {
        if (state.busy) return Promise.resolve();
        state.busy = true;
        state.error = '';
        state.cleaned = null;
        return Promise.resolve()
          .then(function () { return api.worktreeCleanup(); })
          .then(function (removed) { state.cleaned = removed; })
          .catch(function (error) { state.error = String((error && error.message) || error); })
          .then(function () { state.busy = false; });
      },
    };
  }

  function renderPanel(h, state, controller, locked) {
    var view = state.view;
    var active = !!(view && view.active);
    var busy = locked === true || state.busy === true;
    var disabled = busy || !active;
    var button = function (id, label, action, isDisabled) {
      return h('button', {
        id: id, class: 'btn', type: 'button',
        disabled: (isDisabled === undefined ? busy : isDisabled) === true,
        onClick: action,
      }, label);
    };
    var stateLine = !view
      ? '状态未知，请点「恢复当前状态」；不会按未激活处理。'
      : active
        ? '名称 ' + view.name + ' · 分支 ' + view.branch + ' · 未提交 ' + view.uncommittedCount + ' 个 · 独有提交 ' + view.uniqueCommits + ' 个'
        : '当前未进入隔离工作树';
    var children = [
      h('h2', {}, '隔离工作树'),
      h('p', { id: 'worktree-state' }, stateLine),
      active ? h('p', { id: 'worktree-directory', class: 'workspace-path' }, '工作树目录：' + view.directory) : null,
      active ? h('p', { id: 'worktree-original', class: 'workspace-path' }, '原目录：' + view.originalDirectory) : null,
      h('label', { for: 'worktree-name' }, '新工作树名称（字母、数字、. _ -，不超过 64 字符）'),
      h('input', {
        id: 'worktree-name', type: 'text', value: state.name, disabled: busy || active,
        onInput: function (e) { state.name = e.target.value; },
      }),
      h('label', { for: 'worktree-pr' }, 'PR 编号或链接（如 #42 或 https://github.com/owner/repo/pull/42）'),
      h('input', {
        id: 'worktree-pr', type: 'text', value: state.reference, disabled: busy || active,
        onInput: function (e) { state.reference = e.target.value; },
      }),
      button('worktree-create', '创建并进入', function () { return controller.enter('name'); }, busy || active || !(state.name || '').trim()),
      button('worktree-select', '拉取 PR 并进入', function () { return controller.enter('pr'); }, busy || active || !(state.reference || '').trim()),
      button('worktree-refresh', '恢复当前状态', function () { return controller.restore(); }, busy),
      active ? button('worktree-exit', '退出工作树…', function () { return controller.openExit(); }) : null,
      button('worktree-cleanup', '清理过期代理工作树', function () { return controller.cleanup(); }, busy),
      state.cleaned === null || state.cleaned === undefined
        ? null
        : h('p', { id: 'worktree-cleanup-result', role: 'status' }, '已清理 ' + state.cleaned + ' 个过期代理工作树；用户命名的工作树永不自动清理。'),
    ];
    if (state.dialog === 'exit' && active) {
      children.push(h('div', {
        id: 'worktree-exit-dialog', class: 'worktree-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': '退出隔离工作树',
      }, [
        h('h3', {}, '退出工作树 ' + view.name),
        // 删除的代价在点之前就说清楚：未提交文件数与独有提交数都来自刚核实的权威状态。
        h('p', { id: 'worktree-dialog-counts' }, '未提交文件 ' + view.uncommittedCount + ' 个 · 独有提交 ' + view.uniqueCommits + ' 个'),
        h('p', {}, '保留=退出但留着目录与分支；删除=退出并删目录，独有提交没有任何强制通路。'),
        view.uncommittedCount > 0 ? h('label', {}, [
          h('input', {
            id: 'worktree-discard', type: 'checkbox', checked: state.discardChanges === true, disabled: busy,
            onChange: function (e) { state.discardChanges = e.target.checked; },
          }),
          '允许丢弃未提交更改（独有提交仍然删不掉）',
        ]) : null,
        h('div', { class: 'worktree-dialog-actions' }, [
          button('worktree-keep', '保留并退出', function () { return controller.resolveExit('keep'); }),
          button('worktree-remove', '删除并退出', function () { return controller.resolveExit('remove'); },
            busy || (view.uncommittedCount > 0 && state.discardChanges !== true)),
          button('worktree-cancel', '取消', function () { return controller.cancelExit(); }),
        ]),
      ]));
    }
    children.push(h('p', { id: 'worktree-error', role: 'status', 'aria-live': 'polite' },
      state.busy ? '正在处理，请稍候…' : state.error));
    return h('section', { class: 'workspace-panel worktree-panel', 'aria-label': '隔离工作树' }, children);
  }

  var exports = { createController: createController, renderPanel: renderPanel };
  if (typeof module === 'object' && module.exports) module.exports = exports;
  else root.SaCodeWorktree = exports;
})(globalThis);
