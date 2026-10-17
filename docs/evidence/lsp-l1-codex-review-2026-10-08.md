# LSP L1 契约与入口复核（2026-10-08）

## 基线与范围

产品仓库 `D:/Project/sa/saai/sa-code`，分支 `refactor/dsh-learning`，HEAD `35a69ca9e0f8b7b6ac51271ec76eff3515eaa820`。本批是此提交上的未提交增量；并行工作区不能冒充固定提交态。没有提交、推送或安装发布。

协议参考：[LSP 3.17 官方规范](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/)。`line` 0 起始，`character` 是 UTF-16 列；诊断来自插件缓存的 publishDiagnostics 快照。进程与 JSON-RPC 转换留给 L2。

## 实现与复核

- 七个 verb 共用 `LspRequest/LspResponse`、`LspServer` 与按扩展名注册、撤销的 `LspRouter`；模型工具名为 `lsp_*`，Host 为固定 `lsp/*`。
- 模型注册面由旧的一个 lsp 改成七个免审批工具；旧手工 lsp 执行器与 `lspSymbols` 原样保留。
- 无插件保持失败态 `lsp-no-server`，附 `nonSemantic:true` 与「非语义结果」标记，不填语义结果。坏参数、越界、取消不进入回退扫描。
- 插件返回身份、文档版本、位置范围与工作区边界复核；版本表不接受倒退，已存在路径祖先做 canonicalize，避免链接逃逸。
- rename 返回跨文件 TextEdit 预览，`previewOnly:true`，不写文件。诊断与 rename 预览均不增加 ModelAgent 的 successfulToolCalls，因此不能仅凭其生成 GoalEvidence。
- 响应带会话与请求身份；七个有限 IPC 动作支持文档版本，拒绝额外键、错误类型及不安全整数。没有通用 method 转发。
- 复核修复了 Schema 多余闭括号、相对工作区重复拼接、返回越界路径二次拼接后误放行、失败对象二次转义及缺文档版本传递等问题。

## 当前源码验证

私有核心副本 `apps/desktop/.tmp-test/lsp-l1-source`：131 个生产/选定测试文件与主树 SHA256 全部相同，辅助 appendSse 从既有测试辅助文件复用。最终清单 `apps/desktop/.tmp-test/lsp-l1-final-source-manifest.json`。不包含所有核心测试，因此不能称为全量核心回归。

| 验证 | 实测结果 | 日志（相对仓库根） |
|---|---|---|
| 私有副本 `cjpm test --no-run -i` | rc=0 | `apps/desktop/.tmp-test/lsp-l1-test-build.log` |
| `core.exe --no-color --parallel=1 --no-progress` | 72 总数 / 71 通过 / 1 跳过 / 0 ERROR / 0 FAILED，rc=0 | `apps/desktop/.tmp-test/lsp-l1-tests.log` |
| Host 私有目标 `cjpm build -i` | rc=0 | `apps/desktop/.tmp-test/lsp-l1-host-build.log` |
| Node `--test-name-pattern='LSP|lsp'` bridge.test.mjs | 4/4，rc=0；包含七个真实 Host 请求 | `apps/desktop/.tmp-test/lsp-l1-ipc.log` |
| 同一桥接测试，PATH 仅 Windows System32 | 4/4，rc=0，Host 同目录携带 DLL | `apps/desktop/.tmp-test/lsp-l1-ipc-no-sdk.log` |

核心集含 36 条 L1 契约测试，以及既有 LSP、文件、模型工具与管线回归。跳过的是缺少 STEPFUN_API_KEY 的真实模型测试；没有用跳过冒充模型通过。rename 跨文件预览核对磁盘前后哈希，诊断上下文与 rename 不推进目标均有测试。

Host 生成于 `apps/desktop/.tmp-test/lsp-l1-host/release/bin/main.exe`，自包含私有产物 `apps/desktop/.tmp-test/lsp-l1-packed/bin/sacode-host.exe`。测试设 SACODE_HOST 指向这个新产物，TMP/TEMP 位于私有 D 盘目录；没有使用 dist/host 的旧二进制。

核心测试二进制 SHA256：`82E0D3C4175E2AD1EDF3D65C5756030E0A2E2F3FA4EE55E73DE90A36FCCE254B`。

Host 二进制 SHA256：`AB75BAD2E1ABAFEA5419DF83D66809CC5DF18086BC8C23ABA1DF43BCB2A72335`。

## 验收边界

L1 是契约与入口，不代表真实 language server 通信。内存 ContractServer 夹具明确为契约夹具。L2 仍需真实插件激活、文档同步、语言服务器进程、请求取消与断连证据；F08 应用 rename 仍需审查、版本冲突检测与授权。没有安装包、Linux/鸿蒙或完整产品验收结论。

验证期间检测到同文件并行写入；中间通过数被作废，当前记录只采用最后固定副本及新 Host 的结果。`fs_tools.cj/lsp.cj/lsp_test.cj` 与开工基线哈希一致。
