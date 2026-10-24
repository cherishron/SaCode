# F11 知识库管理与显式引用接线

基线 HEAD：e10c60144ad06a2689ff997e98cacd29cb8280fd。本批为未提交工作区实现；未包含 ACP 接手会话的新实现。未提交、推送、安装或调用外部模型。

## 已接通

- core `KnowledgeStore`：用户与项目独立存储；项目身份来自规范目录；原文快照、WriteLease、持久屏障与原子发布；集合 CAS；损坏回放拒绝写入。
- Host 五个有限 RPC：`knowledge/list`、`save`、`remove`、`import`、`reference`。项目从当前会话读取，不接受客户端指定存储根或其他项目。
- CLI `knowledge list/save/remove/import/reference` 共用核心。
- Electron 有限 IPC、preload、打包文件清单、真实知识页面。创建/编辑/删除、字面搜索、项目文件导入、来源变化检查、显式引用到输入框；不自动发送。
- 来源快照保存 SHA-256；删除、不再可读或摘要变化时拒绝引用，重新导入才能更新。保存知识不修改原文件。
- 页面保存冲突保留草稿；刷新不自动提升编辑修订；明确核对后才允许采用新修订。迟到结果与卸载保护；草稿在本次应用内存按作用域保留。

每个作用域最多 200 份文档，单正文/导入 64 KiB，快照 JSON 2 MiB；文件仅限当前项目内 UTF-8 常规文件。搜索是字面匹配，不冒充向量索引。

## 实测

全部日志位于 `apps/desktop/.tmp-test/knowledge-focused/`，每轮使用独立 TEMP/TMP，仓颉 1.1.3、stdx 1.1.3.1。

| 验证 | 命令与结果 | 日志 |
|---|---|---|
| 核心本域 | 私有副本 `cjpm test --no-color --no-progress --filter 'knowledgeStore*' --timeout-each=30s`；TOTAL 2/PASSED 2/SKIPPED 0/ERROR 0/FAILED 0，rc=0 | knowledge-core-final.log |
| Host、CLI | 私有副本分别 `cjpm build`，均 rc=0 | host-final-build.log、cli-final-build.log |
| 前端与真实链 | `node --test --test-concurrency=1` 运行 knowledge-host、knowledge-electron、knowledge-page、knowledge-ipc 四份测试；9/9，rc=0 | final-integration.log |
| 桥接 | `node --test --test-name-pattern='知识库桥接' apps/desktop/test/bridge.test.mjs`；1/1，rc=0 | bridge-test.log |
| 页面构建 | `node scripts/pack-pages.mjs`，rc=0 | pages-build.log |

真实 Host 验证持久恢复、项目隔离、CAS、来源失效、越界拒绝、CLI 读取同一数据。真实任务链向本地 HTTP/SSE 模型夹具发送一次请求，核对知识正文、作用域和修订实际进入请求；不是外部模型效果评测。

Electron 使用实际 preload→IPC→新 Host，CSP `script-src 'self'`，独立用户数据。最终截图：`apps/desktop/.tmp-test/knowledge-ui/run-Z4ZpAQ/knowledge-{light,dark,narrow}.png`，亮暗及 500px 窄窗，无水平溢出。

默认 Electron 夹具启动曾以 0x80000003 退出，页面未执行。页面验收使用仓库既有的 `--no-sandbox --disable-gpu` 隔离夹具方式；未修改产品参数，不能证明默认安装态启动通过。另一次早期失败由 ELECTRON_RUN_AS_NODE 未删除导致，已修正夹具。

早期 `knowledge-check` 全测试源过滤轮仍可能在后台编译，未取得 Summary，不作验收证据；其停止/清理命令被自动审批拒绝，未执行。没有终止其他会话进程。

## 尚未完成，不能升级 F11 全域状态

以上为 2026-10-15 快照；自动检索与当前页面的后续复验见下一节。全项目源码监听/索引、符号关联、长期记忆、速记/批注、导出和冻结代码理解任务集效果对照仍未完成。显式引用是选入草稿的时间点快照，不代表发送时再次核实所有来源。未生成新安装包，也未替换桌面默认 dist/host。

## 2026-10-17 当前源码 Host 与 Electron 复验

HEAD `7a249a1c2ca03f5d4ad7a7c5e82eb81d60a00238` 加未提交工作区实现；修复后的本机仓颉 1.1.3 在 `apps/host` 执行 `cjpm build --target-dir D:\Project\sa\saai\sa-code\target\tmp\product-host-current-20261017-f31c\build`，退出码 0。Host SHA256 为 `1DC05E7A15B30F78372F5E4E2A75F6F16978911D55FA924C9CEDF44F069913B1`。测试父进程仅按项目约定前置已安装 stdx 和 SDK 运行库，未改全局环境。

- `node --test --test-concurrency=1 test/knowledge-host.test.mjs test/file-editor-live-host.test.mjs test/build-test-live-host.test.mjs test/git-action-live-host.test.mjs`：5/5 通过，无跳过、退出码 0。知识管理/显式请求引用两项、文件编辑一项有真实 Host 请求；构建测试与 Git 各一项只证明独立审批、执行门禁拒绝且状态不变，不能作为真实执行成功证据。
- `node --test apps/host/test/knowledge/knowledge-context-host.test.mjs`：自动检索 1/1 通过，无跳过、退出码 0；低信任 user 请求注入、修订/来源审计、来源失效与外部伪造拒绝由该测试核对。
- `node --test test/knowledge-electron.test.mjs`：Electron→实际 preload→IPC→本轮 Host 1/1 通过，验证保存、搜索、引用、用户/项目隔离、项目文件导入；亮暗与窄窗截图，`overflow=false`。仍使用隔离夹具的 `--no-sandbox --disable-gpu`，不代表产品默认安全启动或安装态通过。
- 看图发现页面仍写“不自动发送给模型”，与自动检索实际行为矛盾。现改为“相关片段会随任务请求发送给当前模型”，增加实际 Electron 可见文案检查；`node scripts/pack-pages.mjs` 及页面复验通过。没有修改自动发送/检索权限或更换模型。

日志均在 `target/tmp/product-host-current-20261017-f31c/`：`build.log`、`chain-tests.log`、`knowledge-auto-host.log`、`pages-build.log`、`knowledge-electron-v2.log` 及已记录的退出码文件。最终页面证据为 `target/tmp/knowledge-ui/run-AmTkLo/result.json` 和 `knowledge-{light,dark,narrow}.png`；已检查亮色与窄窗截图。CLI 自动检索和核心 5/5 的当前证据见 [CLI 专项 §11](../clients/cli/2026-10-17-cli-launch-0xc0000135-stdx-dll-missing.md)。完整桌面装配、默认安全启动、安装态及代码理解效果仍待验。

跑后产物守卫 `GATE: FAIL (13 checks, fail=4)`，原始输出为同目录 `artifact-gate.log`：先前误生成的 `core/core/` 仍在，另有 `apps/daemon/target/`、`apps/host/target/`、`apps/desktop/target/`，后三项归属未核，未触碰。当前全部新运行输出位于根 `target/tmp`；未把专项通过扩大为全门禁通过。
