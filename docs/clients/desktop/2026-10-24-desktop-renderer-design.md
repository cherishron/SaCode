# 2026-10-24 桌面渲染层设计规范（awesome-design-md 原则提取）

## 范围与来源

- 起因：用户询问 [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) 是否对本仓有帮助，并选择按 `apps/cli/tui/DESIGN.md` 同口径，产出 `apps/desktop/renderer/DESIGN.md`（只含「原则 + 映射到本仓 `--*` 令牌」，注明上游来源，不复制品牌/商标/布局）。
- 本批**只新增文档并登记**，不改渲染层代码、令牌或 IPC；UI-FIX-8/9/10/11 的代码改动已各自登记，本文件只把原则固化成规范并引用它们作为范例。
- 上游读取方式与限制：本机直连 `raw.githubusercontent.com` 与 jsDelivr 均被 robots/连接阻挡（`mcp_fetch` 报 robots.txt 连接失败），Hyperbrowser 通道未认证；改经搜索引擎快照读取上游 `main` 分支的 [linear.app DESIGN.md](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/linear.app/DESIGN.md) 与 [vercel DESIGN.md](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/vercel/DESIGN.md) 正文（含 9 节结构、色板角色、字阶表、间距尺度、Grid/Container、Depth & Elevation、Do's and Don'ts、Responsive）。**未锁定 commit**；本地同源先例 `apps/cli/tui/DESIGN.md` 已固定 commit `3b605329240ce735b510037cca322f1831fdd7f8`，如需严格同源以该版本复核。
- 上游文件是对**网站**的设计分析，不是 Linear/Vercel 官方产品规范；只采纳原则（单一强调色、表面阶梯 + 发丝描边、克制留白、动效克制、显式焦点），不复制品牌、商标、专有字体或网页布局。

## 改动与影响

| 文件 | 变化 | 说明与边界 |
|---|---|---|
| `apps/desktop/renderer/DESIGN.md` | 新增 | 10 条原则 → 本仓 `--*` 令牌落点 + 组件基线 + Do/Don't + 不可越过边界 + 验证口径；声明权威顺序为「源码与 `desktop-design-standard.md` > 本文件」 |
| `docs/README.md` | 加索引条目 | 按仓规「新增文档同批登记索引页」 |
| `docs/product/PRD-tracking.md` | 加 UI-FIX-12 条目 | 台账同批登记 |
| 本文件 | 新增证据 | 来源与读取限制留痕 |

不改 `preload.cjs` / `main.cjs` / `main.cj` / `core`；不改任何 `--*` 令牌或组件样式。

## 实跑读数

- 本批无代码改动，故无新增测试读数；前批定点用例读数（`msg-waiting.test.mjs` 3/3、`test/session/user-question-card.test.mjs` 5/5、`test/tool-card.test.mjs` 8/8、渲染层定向 11/11 与 39/39）见各自台账条目，本文件不重复宣称。
- 上游正文来自搜索结果快照，非锁定 commit 原文；链接指向 `main`，可能随后续提交变动。

## 未验边界与交付状态

- 本文件是**规范文档**，不构成 GUI 验收，也不改变任何产品行为。
- 上游未锁定 commit；如两处规范需严格同源，须按 `3b605329…` 复核。
- 未收费请求、未安装新依赖、未构建候选、未提交/推送/发布。

复验入口（仓库内）：`apps/desktop/renderer/DESIGN.md`；同源先例 `apps/cli/tui/DESIGN.md`。

## 2026-10-25 追加：桌面装配职责收拢（工作区局部验证）

用户确认合理解耦、不机械拆文件、不引入无必要抽象。本轮未增加生产文件、事件总线、依赖或 IPC，未改 Host/core。

- `turn-poll-state.js` 提供同一套轮次状态操作，发送、轮询、会话清空不再各写对象初始化与结算形状。状态仍是同一 Vue ref，不是另建事实真源；尚未把所有写权限做成只读封装。
- `send-queue-state.js` 持有执行侧 `resetSession`：停止轮询、清除轮次、模型审批身份及待入队状态。`session-state.js` 只调用此操作和模型选择重置，不再直接改这两域的内部字段。其余提示、附件等跨域清理仍保留，未声称会话切换完全解耦。
- `model-directory-state.js` 收拢模型选择互斥、自定义目录读取序号与适配器写后刷新；返回包装适配器而不修改原对象。`app.js` 不再枚举写动作并改写方法。发送与轮询的续队列双向调用仍存在，未宣称本轮已消除。
- 新测试 `apps/desktop/test/session/assembly-ownership.test.mjs`：轮次重置、真实会话/执行模块联动（失败保留草稿）、目录失效/选择互斥、迟到目录回执；先取得 3 条缺能力红灯，再实现。旧文案断言基线 50 项 49 过/1 败，超时提示改为验证超时含义、操作建议与不泄漏原始错误码，不再绑定一句固定文案；产品文案未修改。
- 最终受影响装配/审批/模型/会话与渲染层门禁 **86/86、rc=0、0 跳过/取消**。日志 `target/tmp/electron-neutral-20261024/assembly-{baseline,red,final}.log`。
- 中立目录 `D:/tmp/sacode-dialog-ui-20261024/app` 只覆盖本轮 5 个经典脚本，逐文件 SHA256 与工作区一致。默认沙箱真实窗口模型中心 **rc=0、MODEL_MAIN_SMOKE PASS**，日志 `assembly-ui-smoke.log`；此为混合开发副本局部证据，不是同源完整候选或安装态验收。
- 额外清空窗口验收 **rc=1**：出现两条 `CLEAR_UI FAIL`——surface 预期 11 实际 12，以及已有 `self.cancelReview is not a function` 导致真源清空成功但界面报失败；核心投影归零、盘上旧正文清除与标题保留均通过。驱动虽输出 `CLEAR_UI_ACCEPTANCE PASS`，不采用该标记覆盖 rc 与失败行。日志 `assembly-clear-smoke.log`；未扩大范围修复，清空完整验收保持未通过。

### 清空缺陷后续复验

- `app.js` 的 `clearConversation` 位于 `setup()` 闭包，却误用渲染函数的 `self`；改为直接调用 `cancelReview()` 并清理两个审查 ref。新增成功/拒绝两条行为测试，修复前成功用例取得「清空失败：self is not defined」红灯；拒绝时保留原审查和轮次状态。
- 五文件关联回归 **49/49、rc=0、0 跳过/取消**。中立开发副本默认沙箱重跑真实窗口「填充并清空」「重开再发」两阶段，均 **rc=0、CLEAR_UI_ACCEPTANCE PASS**，分别 11 与 8 项检查；日志 `target/tmp/electron-neutral-20261024/clear-r3-{fill-and-clear,reopen-and-send}.log`。
- 驱动不再假定种子 surface 固定为 3：发送前读取基线，断言新增恰为 8，且按实际 DTO 的 `eventType`/`text` 逐条核对八条消息不重复；失败时不再无条件打印 PASS。r2 曾误用不存在的 `role` 字段造成一条驱动失败，核对 `MessageProjectionRow.toJson` 后更正，保留 r2 日志，不拿它当产品失败或通过。
- 本次没有模型配置或付费请求，起轮的 `model-not-configured` 是预期失败；这里只证明消息追加、清空、审查本地清理、重启回放和新消息落盘，不证明 AI 任务执行成功。

尚未重打完整候选、未做收费模型请求、未提交/推送/安装/发布；不升级 F 域完成状态。