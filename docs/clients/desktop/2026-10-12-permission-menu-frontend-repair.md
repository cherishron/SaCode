# 权限菜单前端回执与生命周期修复（2026-10-12）

## 范围与并发边界

用户允许处理不冲突另一个会话的事项。本批开始时 `permission-menu.ts` 无未提交差异，新增专属测试路径不存在；仅修改以下两份业务文件，不改其他会话的 Host、core、模型、app.js、IPC、打包配置或公共文档：

- `apps/desktop/renderer/pages/permission-menu.ts`
- `apps/desktop/test/permission-menu.test.mjs`

本记录是第三个新增文件。未提交、未发布、未读取密钥、未修改用户数据，未写公共 vendor/dist 或运行全套测试。Git 无差异仅为起点观察，不代表跨会话文件锁或独占写权。

## 修复与影响

1. 严格解析当前宿主读取回执 `{ok:true,mode}`，仅接受 plan/build/auto/yolo；初次读取失败或非法回执显示“未确认”，不猜 build，不允许未确认状态下切换。
2. 设置仅接受 `{ok:true,result:"committed"|"noop"}`，等待设置和后端回读确认后更新。回读不一致显示实际后端值与错误；设置失败保留旧值，设置被接受后回读失败改为未确认。
3. 请求在途禁用模式选项与重复调用；错误留在菜单，可重试或重新读取，不留下未处理 Promise 拒绝。
4. 将匿名 keydown 监听改为具名监听，卸载同时移除 pointerdown/keydown；异步回执由卸载标志及代次保护，不更新旧会话组件。
5. Shift+Tab 仅处理菜单内焦点，不劫持别处的输入；Esc 可关闭在途菜单，迟到失败不强制重新打开。
6. 明示“模式回读不代表持久化或权限策略已生效；工具仍以核心实际审批为准”。未改变四种模式的核心授权语义，不自动批准任何工具。

## 验证

- 红先：实现前新增的前 12 条组件测试，1 通过/11 失败，rc=1；旧实现另产生未捕获读取/设置拒绝。
- 修复后首轮：`node --test test/permission-menu.test.mjs test/composer-menu.test.mjs`，15/15、rc=0（新组件12条＋相邻文件选择菜单3条）。
- 补充回读在途卸载及 Esc 迟到失败两条后，同命令最终 **17/17、rc=0**（新组件14条＋相邻菜单3条），无失败、跳过或取消。
- 新测试通过 esbuild 在内存编译实际产品组件，用 Vue 生命周期/渲染替身驱动真实 setup 和点击回调，不另写一份模式业务实现；不替代真实 Electron 页面验收。
- 对真实 `client-slots.ts` 入口执行内存 IIFE 构建，权限组件在依赖图内；单一 `globalThis.Vue` runtime 与现有 `assertStaticRendererBundle` CSP/无运行时模块加载检查通过，rc=0；没有写产物。
- `node --check test/permission-menu.test.mjs` 与定向 `git diff --check` 通过。
- `package.json` 没有 lint/typecheck 脚本，当前依赖中没有 eslint/typescript，也无 tsconfig。本批不安装新依赖；esbuild 仅证明构建期语法/折叠，不宣称完整类型检查或 lint 通过。

## 仍未闭合

- Host `approval/set-mode` 的持久屏障、重启恢复及生产工具路径的权限策略消费未由本批修改或验收。
- 没有修改已经生成或正在运行的桌面包；需由负责集成的会话重建 pages/vendor 和目录包后做实际页面验证。
- 本批没有修改 IPC 或新增通道，仍只调用既有 approvalGetMode/approvalSetMode。
