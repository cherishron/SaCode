# W30 宿主模型路由与账本接线（独立树取证）

日期：2026-10-06。基点：`0384a63e342de0d6b7a10cd1d819547d7fc3aa71`。
分支：`codex/w30-host-routing`。
工作树：`D:/Temp/SaCode-w30-host-0384a63-20261006`。
本批不修改共享主树、不吞并其他会话的在途文件，不升级全产品完成状态。

## 已接切片

- `turn/start`、`task/start` 接可选 `customModelId`；非法类型明确拒绝，非空身份错误不回退默认供应商。旧请求缺字段时沿用原路径。
- 新增宿主装配文件 `apps/host/src/model_routing.cj`。每次真实请求（含工具续跑）刷新自定义模型、供应商、凭据可用性、健康及已用金额视图，调用共享核心 `route`、`planFor`；按实际绑定模型和图片能力从日志重建请求。
- 请求身份包含会话、Host PID、毫秒时间与轮次；步骤另编 attemptId。预检不推进实际调度游标。
- 金额额度配置时先预留再派发标记；标记失败不发网络请求并尝试释放预留。未配置额度不虚构额度，直接走派发标记屏障。
- `RealSseProvider.open` 保留结构化 HTTP 失败，经 `classifyFailure`、`AttemptLog`、`RouteHealth` 归因；成功结束每一步结算、失败/取消释放该步预留。上游已成功而结算被占用时保留派发/预留事实，不伪装成传输失败。
- 现有 SSE 仅提供合计 token，不能据此推算四档费用；实际请求记录 `LedgerUsage.absent()`，明确进入待核算。
- `ledger/stats` 返回 providerTotals、modelTotals、usageKindTotals、待核算及崩溃遗留尝试、预留。`LedgerState` 没有 revision，返回 `revision: null`，不伪造修订号。
- Electron 新增有限 `ledgerStats` IPC；`taskStart` 只传可选模型身份；同步 UI 冒烟 preload 清单。
- 变更单建议的 -32010..-32013 已被旧功能占用，本批预检错误使用 -32040；执行期错误仍经 turn/poll 的 finishReason 返回。

## 实测

最终源码冻结后：`cd apps/host; cjpm build` rc=0。自包含 Host 40 文件，私有运行目录 `D:/Temp/SaCode-w30-host-runtime-20261006/bin`。
最终 Host SHA256：`6818bbf89991ef89dc3746b5f783b28b047a65f2438dbd444875bddaade84045`。

| 检查 | 结果 |
| --- | --- |
| `node --test apps/desktop/test/host-routing-ledger.test.mjs` | 13/13，FAILED 0，SKIPPED 0，rc=0 |
| `node --test apps/desktop/test/host-routing-real.test.mjs` | 真实 StepFun step-5-preview，1/1，SKIPPED 0，rc=0 |
| task-start-ipc + custom-models-ipc | 5/5，rc=0 |
| check_ipc_surface_parity | 68 preload / 68 main，7 checks，0 failed |
| 主进程、preload、UI 冒烟脚本语法 | node --check rc=0 |

13 个 Host 行为用例覆盖：工具续跑换绑定、未知用量不冒充零、无效身份拒绝、500/401/429 归因、账本损坏拒绝、派发标记活租约屏障、杀进程后不重发、取消、三次5xx冷却、结算拒收保留事实、真实连接拒绝、协议不完整归因 unknown。
真模型用例通过 credential/set 配置后端凭据，自定义模型绑定 step-5-preview，完成实际 HTTPS 请求，并核查账本不含凭据值；凭据没有复制入树或输出。

最终日志（忽略产物，不入库）：`apps/host/w30-host-frozen-build.log`、`apps/host/w30-routing-tests.log`、`apps/host/w30-real-model.log`。

红先证据：结算被活租约占用时，修前用例收到 `error:attempt-failure-write-failed`，掩盖了原结算拒收；修后收到 `ledger-settlement-rejected`，保留遗留尝试与预留。统计面曾遗漏已结束待核算条目，已补齐其与崩溃遗留的去重并集。
构建入口注意：根 workspace 的 Host 产物为 `target/release/bin/host.exe`，成员构建为 `apps/host/target/release/bin/main.exe`；中途误取旧成员产物的红读数不作为最终源码结论。

## 未闭合范围与交接

- 本批仅完成宿主可调用路径与有限 IPC。输入区目录当前仍展示供应商默认模型，尚未把自定义模型选择持久化并提交 customModelId；不得据此宣称完整模型中心端到端通过。
- 分档 SSE 用量、实际金额计费、token/月额度、模型参数透传、全部协议 provider、探测/中转费用仍待后续契约及实现。
- 凭据轮换后的健康恢复、全桌面回归、最终 Electron 安装包/升级卸载/无 SDK 验收未在本批执行；CLI 用户执行路径也未据此升级完成。
- shared main 的 Host/CLI/桌面入口仍有其他会话改动；合入需保留工具管线与目标入口的在途接线，并重编、重新验收最终组合。没有复制旧二进制到主树，没有运行安装器。

## 已提交工具管线兼容性复验

在本独立树仅接入主树已提交的 `ffa6d72`，对应 cherry-pick 为 `3d09af5`；没有复制共享主树未提交的目标、MCP、Office、SSH 或公共入口改动。复验源码组合为 `f7aaf6e` + `3d09af5`。

- `cd apps/host; cjpm build`：rc=0，重新编译共享核心及 Host。
- 重新组装私有自包含 Host：40 文件。
- Host SHA256：`7deaef90cf6dcb279df7b64d100ef4a884da7d0701c6075ce5c57234e8e8af90`。
- `host-routing-ledger.test.mjs`：13/13 PASS，FAILED 0 / SKIPPED 0，rc=0。实际工具续跑覆盖新执行器表与每步模型绑定重选的组合路径。
- task-start-ipc + custom-models-ipc：5/5 PASS，rc=0。
- IPC 面对账：68 preload / 68 main，7 checks / 0 failed。
- `host-routing-real.test.mjs`：PASS 0 / SKIPPED 1，rc=0；本轮指定凭据文件不可用。不能把跳过计为真实模型通过，也不能把上一版真模型成功自动转记到本组合。

日志：`apps/host/w30-tool-compat-tests.log`、`apps/host/w30-tool-compat-real.log`（忽略产物，不提交）。

本轮没有运行全量核心单测，未升级 `ffa6d72` 中 6 条新文件操作单测的“编译通过、运行待核”状态。未合入共享主树、未重打最终 Electron 安装包；前文未闭合范围继续有效。