# 安全扫描结果与增量适配层

此模块是 F17 的独立纯数据处理层，不执行扫描器、不读取源码、不写文件、不提供新的授权机制。未修改 ACP、Host/CLI、桌面主入口或包清单；无第三方运行时依赖。

## 接口

`report.cjs` 导出三个函数和 `ScanError`：

- `normalizeReport({scanner, level, files, findings})`：`level` 为 static/incremental/deep；`files` 为 `{path,digest}` 数组，digest 是调用方取得的 SHA256；发现包含 path/ruleId/severity/startLine/可选 endLine/message。输出绑定对应文件摘要并提供内容 ID，完全相同发现去重。异常发现逐条进入 issues，不回显载荷。`normalization: partial` 明示存在异常；valid 仅表示归一有效，不是扫描通过，接口没有 passed 字段。
- `incrementalScope(previous, current)`：比较文件摘要快照，返回 added/changed/deleted/unchanged 及待扫描 scan 列表，均稳定排序。删除需让旧发现失效；路径变化按删除＋新增处理，不自称识别重命名。只表达直接改动范围，不等于跨文件影响分析或深度扫描范围。
- `checkFixPreconditions(proposal, current)`：提案为 `{path,expectedDigest}` 数组，对比当前快照；文件缺失或摘要不同报告冲突，任一冲突令 applicable 为 false。不会执行 patch，applicable 为 true 只代表提供快照下的前置版本匹配，不授予执行权限。

路径只接受项目内相对路径，将反斜线规范为斜线；拒绝绝对路径、盘符、URI、控制字符、空片段、`.` 和 `..`。不折叠大小写，不解析软链接，不宣称通过字符串检查已实现文件系统隔离。

## 限额与边界

最多 10000 个文件快照、10000 条发现、1000 项修复前置条件；规则/扫描器名称最多 200 字符、发现正文最多 10000 字符。归一过程中累计文件快照与发现的字节预算为 16 MiB，超限整批拒绝（不是进程总内存限制）。非法顶层数据、重复文件快照、非法摘要、重复修复路径整批拒绝。

扫描器是否真实成功、退出码、扫描范围是否齐全、项目身份、符号链接/平台别名、结果是否迟到以及授权/取消/持久化由共享核心和调用链负责。报告中的 deep 只是提供方声明，不能凭这个字段认定完成跨函数数据流扫描。显示正文必须转义，正文可能含敏感信息，不自动脱敏。

真正应用修复必须在核心重新核项目身份、所有受影响路径和当前版本，并走写入授权与 CAS；本模块检查后存在 TOCTOU，不能直接按先前 applicable 值落盘。当前未接入扫描器、UI、IPC 或打包，不能宣称 F17 产品完成。

## 报告失效与交接

`handoff.cjs` 提供 `evaluateFreshness(report,current)` 和 `buildScanHandoff(report,current,context)`。先重新归一并核发现 ID 与摘要，拒绝损坏、重复、被修改的报告；保留原部分状态，不因二次归一洗掉 issues。

扫描范围内任何文件变化或删除，整体 freshness 为 stale，并分别列出 currentFindingIds/staleFindingIds。新增文件列入 outsideScope，不声称已扫描；current 只表示原扫描范围的摘要仍一致，不是整个项目扫描完整。

context 包含 projectId/taskId/requestId/expectedRevision/executionStatus；状态为 succeeded/failed/cancelled/unknown。交接仅在成功、完整归一、原范围未过期时 usable 为 true；这表示可展示该范围的事实，不是无漏洞、任务完成或允许修复。上下文由调用方提供，核心必须核任务归属与真实执行事实，不能相信外部自报成功。指纹只检查内容一致性，不认证来源。未知上下文字段不复制。

## 验证

从仓库根运行 `node apps/desktop/test/scan/scan-report.test.mjs`。合成夹具覆盖结果归一、损坏与部分状态、路径、白名单、摘要绑定与去重、增量范围、大小写差异以及修复版本冲突；不调用模型、Host、数据库或用户项目。共 16 条专项测试。另运行 `node apps/desktop/test/scan/scan-handoff.test.mjs`，6 条覆盖范围失效、部分/失败状态、交接一致性与独立副本。
