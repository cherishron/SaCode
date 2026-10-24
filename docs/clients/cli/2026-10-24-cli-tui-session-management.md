# 2026-10-24 TUI 会话搜索、改名与归档

## 范围与身份

沿用户“继续”授权补齐既有Node/Ink TUI会话管理，不改Host/core/桌面契约，不调用供应商、不安装依赖或产品、不提交/推送/发布。Gemini CLI仍为交互主基线（固定上游`a3dd9f8c7bcb495a46d0b505b6f179996ccd8332`），本批不是完整对齐或整版交付声明。

- 平台：Windows、Node v22.23.2、React18.3.1/Ink5.2.1；工作区未提交，取证时HEAD为`a0b16c38a1147708f2ef75302695092f3d3ed833`，不将该提交视为包含本批源码的冻结快照。
- 默认开发Host仍为`apps/desktop/dist/host/bin/sacode-host.exe`，SHA256 `71389261df9c29c91a9a219af2683293aea671f9745403b239b8d976fef00e6e`；本轮未重编或替换Host/80DLL载荷，正式桌面候选未改。
- 本批TUI `apps/cli/tui/dist/index.mjs`与`npm/sacode-cli/tui/index.mjs`均 **547,489 B**，SHA256 `b02920b13c450e017809bff90d9ec6c95896deeea0c0ae5db6bc860a51ef48d6`。它们是生成物，不入库；新哈希未安装。

## 实现与影响

- `session-browser.mjs`集中目录过滤、标题校验、确认快照和元信息适配。`/resume [词]`与`/archive`支持标题/ID/目录搜索、Ctrl+A切归档、Ctrl+U清空、无匹配安全返回。过滤重置选中位置，不将目录标题当身份。
- `/rename 新标题`修改当前会话；`/archive`仅选非当前会话，保留日志。已归档条目只进入恢复归档确认，成功后需重新`/resume`选择，不自动恢复并切换。均先核Host capability。
- 确认携带`sessionId`与原`expectedRevision`，默认取消。写前复查同ID/修订/归档及当前状态；分别调用`session/rename {sessionId,expectedRevision,title}`、`session/archive {sessionId,expectedRevision,archived}`。要求`saved:true`、同ID、递增revision，再读目录核revision及目标值。冲突不自动换修订；不明确的写入/回读冻结发送，不重试、不假报回滚。
- `session-confirmation.mjs`保留固定确认/取消行，详情独立视口PgUp/PgDn，标题/ID/目录完整可读。普通输入与浏览/确认互斥，底栏不再对面板提示“Enter发送”。底栏即时显示改名，Static旧历史不重画。
- 运行中/审批中不修改会话；同步ref防重复Enter，保存中Esc不提前关闭；目录读在途可退出，epoch拒绝迟到重开。未新增清空/删除入口。
- 初次空`current`尚无日志文件时目录可能为空。仅凭Host同ID精确投影`events=durable=0`补足可确认条目，绝不本地猜修订0。提交前同样重新核对，保存后必须在持久目录中读到。

## 验证及失败修正

最终全量 **99 tests / 99 pass / 0 fail / 0 skip**（约17.32秒）。相对上批82项新增17项；包括6项目录/修订适配、7项合成交互、1项宽窄布局、3项真实Host会话管理。既有运行中禁切换用例扩充改名/归档断言。

1. 真实Host：改名→切走→归档→停Host→冷重开→恢复归档→选择，正文与工作区不丢，旧修订请求被拒；真实TUI确认前不写、确认后回读、搜索接线；首次空current改名与冷重开回读。没有真实模型请求。
2. 合成边界：默认取消、搜索无匹配、过滤/归档切换、输入隔离、运行/审批守卫、保存中重复Enter/Esc、写前旧修订及Host冲突、未知写冻结、目录迟到读不重开、恢复归档不自动select。
3. 14合成帧：80×24/48×18各7帧（浏览长目录、无匹配、归档、恢复确认、归档确认、长标题顶部/底部）。逐行字格宽度和总高度断言，标题尾部可翻到，取消可见，无模型或元信息写请求。不是用户终端截图。
4. `node scripts/pack-tui.mjs`通过单文件自足及许可收集；45个源码/测试/构建`.mjs`与最终bundle语法检查通过；本子工程无lint/typecheck脚本，不将语法检查冒充二者。
5. npm dry-run：46文件、解包613,330 B，保留Apache全文及37个内联包许可。未安装/发布。
6. 新bundle从主包入口实际运行：显式`tui`、无参TTY均无`SACODE_HOST`/bundle覆盖，隔离空目录，完成改名→新建切换→搜索归档→恢复归档→about→退出rc0；无参额外仅保留Windows系统PATH（Node用绝对路径），证明默认Host本地DLL可启动。伪TTY不等于Windows Terminal亲手验收。

失败与学习保留，不删断言凑通过：

- 初版真实Host测试在`session/append`后多flush得到`no-pending-writes`；改核Host投影events===durable，未改产品持久化。
- 长标题帧初测42过/1败，发现可伸缩Text在固定高度容器中挤掉确认标题并与操作区重叠。改用不可收缩固定行和显式高度详情视口，布局定向1/1、最终全量通过；既有Viewport不改。
- 首个默认入口烟测失败：空current未落盘不在catalog，改名无确认目标。补精确空投影校验和真实Host回归后重新构建；最终显式/无参通过。该失败对应旧中间bundle，不沿用旧hash。
- Context7核useInput/isActive、PageUp/PageDown、Text wrap和Box布局；结果包含新版本API，本批仍只用本地Ink5已有Viewport/height/flexShrink，不采用新contentOffset或升级依赖。

## 可复现入口与原始输出

```powershell
cd apps/cli/tui
$env:SACODE_HOST=(Resolve-Path '../../desktop/dist/host/bin/sacode-host.exe').Path
npm test
node test/support/session-frames.mjs <target/tmp下绝对路径>/frames.json
# 仓库根执行：
node scripts/pack-tui.mjs
node apps/cli/tui/test/support/default-session-smoke.mjs <target/tmp下独立目录> explicit
node apps/cli/tui/test/support/default-session-smoke.mjs <target/tmp下独立目录> noargs
```

原始输出：`target/tmp/tui-session-handoff-20261024-7c3e19a2/`，含`tests-final.log`、`frames.json`、`frames.log`、`pack.log`、`npm-pack-final.json`、`default-explicit-final.log`、`default-noargs-clean-path.log`、`syntax.log`与`artifact-hashes.json`；`source-manifest.json`记录53个TUI非产物文件的路径/大小/SHA256，只是工作区输入取样，不冒充已提交全仓快照。首个失败默认入口日志`default-explicit.log`留存。隔离测试只写自有会话，真实Host测试结束清理；默认烟测会话仅保留在该忽略目录供取证。

## 剩余限制

真实Windows Terminal观感、真实模型读取→审批→落盘→真实diff→重启、新包安装及Linux/macOS终端未验。完整附件注入、MCP/技能执行与安装、权限/计划变更、压缩及更多Gemini功能仍未对齐。元信息写使用已有Host租约/修订，不宣称新增事务或全局强一致；回读遇并发变化保守冻结。F01仍为局部验证、不升级完成；当前桌面候选及主阻塞不变。
