# F02/F04 桌面模型工具审批消费

本批沿用 bf68db6 工作区，不创建分支、不暂存、提交或安装。共享文件只修改 W00 登记的审批消费与轮询保护 hunk；冻结输入及哈希在 `target/model-approval-proof-1fb27e3775014ceb8e45bf20ef710b4b/manifest.json`，包含 main、app、index、样式、独立状态脚本及两类测试源码。它是本批源码快照，不代表当前全部工作区已统一构建。

## 行为与接口

main.cjs 的既有 sacode:turnPoll 返回原 Host poll 字段，并增加 approvalRequests。只取走 HostBridge 中 source=model 的 approval/asked；其他通知保留。renderer/model-approval.js 为经典脚本，沿用 CSP 和既有运行时，不引入 npm 运行依赖。

通知必须包含正整数 approvalId、起轮 sessionId、tool 与完整 argumentsJson。其他会话和已结算任务的提案不显示；缺失、损坏和冲突参数拒绝进入可批准状态。UI 以文本展示完整 JSON，不截断或插入 HTML，并支持换行、滚动和键盘聚焦。

模型审批只通过既有 approvalAnswer 回答原票，不再调用手动工具 callTool。手动工具原路径保持独立；运行中不能另起需要审批的手动动作。审批尚未处理或已有任务运行时不能再次起轮。

轮询避免重叠，并校验会话与轮询代际。停止立即隐藏模型工单并抑制后续审批通知，继续轮询等待实际终态；断连、终态清理模型读面。新轮次/切换后的迟到 poll、应答和停止失败均不得改当前读面。这里没有把“停止请求成功”当作进程已退出。

## 状态与产品分支验证

命令 `C:/Users/jingg/.codearts/runtimes/node/node.exe --test apps/desktop/test/model-approval.test.mjs`：11 tests / pass 11 / fail 0 / skipped 0，真实退出 0。包含纯派生层和从真实 renderer/app.js 取出的应答、轮询、停止分支；覆盖完整参数、保留其他通知、跨会话/终态、缺参数、工单冲突、允许与拒绝不重复执行、停止前不应答、迟到失败与旧轮询不回流。

私有逐字副本反证：baseline=0；删除模型应答分支的 return 后 duplicate-tool-mutation=1；去掉轮询代际校验后 late-poll-mutation=1；还原原始文件字节后 restored=0。11 项基线与恢复均通过，两个故障分别命中实际 renderer 应答及旧轮询场景；所有原件位于上述 proof 目录，没有修改共享源码做变异。首次反证脚本遇到 CRLF 匹配不符、在修改前停止；该次不算故障反证，最终采用保留原行尾的成功四轮记录。

main.cjs、renderer/app.js 的 Node 语法检查均真实退出 0。package.json 既有 renderer/** 包含新增经典脚本，无需增改包清单；没有构建或运行新的 Electron 安装包。

## 真实 Host 与 IPC 逻辑

命令：明确指定 `SACODE_HOST=.../target/host-file-approval-594f084e72e543b3b95d8292be52b7f7/bin-increment/sacode-host.exe` 后运行 `node apps/desktop/test-support/model-approval-host-verify.mjs`。

最终原件 `apps/desktop/.tmp-test/model-approval-host-fFWGmS`，输出 MODEL_APPROVAL_HOST_PASS 3，真实退出 0。Host SHA256 为 `8088faaa9ba555ad0fa908ce76ccf1c7f2fe1377528f697309b86659356793a7`。脚本执行产品 main.cjs 的实际 turnPoll 分派逻辑，连接真实 Host 和本机 HTTP SSE 协议模型夹具，审批状态层回答原工单；未启动 Electron，也不称为真实 Electron IPC 验收。

| 场景 | 事实 |
| --- | --- |
| 允许一次 | 完整 path/content 提案一致；唯一批准回执；真实 result.txt 内容正确；仅一次 write 调用尝试；目标 complete |
| 拒绝 | 唯一拒绝回执；日志结果 denied:write:approval-denied；文件不存在；目标因无进展 blocked |
| 审批等待中停止 | 真实 turn/cancel；5 秒内终态 cancelled；旧提案不再发送应答；文件不存在；目标保持 active |
| 三者重启读取 | goal/describe 恢复相同 phase；均未增加模型请求或重新执行 |

首次真实集成运行错误地期待拒绝场景零条“调用尝试”，实际日志有一次尝试及拒绝结果，文件仍不存在。这是验收断言错误，已纠正为核对拒绝结果、一次尝试和实际文件；没有为测试改核心拒绝语义。旧 mrJyR2 记录不算整体通过；两场景修订版 bSejRW 与最终三场景 fFWGmS 分开保留。

## 同会话跨任务身份增量

后续复核发现单靠会话身份和本地 poll 代际不能识别缓存中的旧任务通知。Host 在审批回调中冻结 task/start 信封 ID，通知增加 turnRequestId；Main 用 HostBridge 发号绑定成功起轮与 poll，状态层同时核对该身份。旧 poll 不得取走新任务提前到达的通知，成功起轮只清旧模型通知。这是原通知契约的身份扩展，不引入第二份任务权威源。

新增状态测试后为 14/14、跳过 0；最新源码快照与三项反证在 `target/model-approval-proof-25513ecc584f4840a1b2a824c39e600e`。去掉任务身份比较会命中同会话旧任务用例；逐字还原后全部恢复。此前 11 项快照和 fFWGmS 三场景是未加入 turnRequestId 的前一增量，不冒充最终当前消费端的验收。

任务身份 Host 隔离编译真实退出 0，目录 `target/host-turn-approval-962728c673fc4c53b838947e748275a1`；精确源和库记录 manifest-increment.json。可执行文件 SHA256 为 `7c1a025ba3fa24a892f1f1cd11574710c034f9c63625d219a5a51df8545e39d3`。仅在原已验收三份 Host 源上加入本批身份 hunk，使用固定已验收核心；当前并发团队等源仍须最终统一重建。第一次准备脚本只替换枚举路径、遗漏复制路径，误拷了当前团队接线文件，编译真实退出 1；原件 `host-turn-approval-996cf6b309314171a789e5898f5bf067` 保留，不算源码验收。修正私有准备脚本后采用新目录重建，未覆盖共享源码或借此删除团队改动。

最新真实三场景原件为 `apps/desktop/.tmp-test/model-approval-host-j3V0s4`，MODEL_APPROVAL_HOST_PASS 3，退出码原件 `target/host-turn-approval-962728c673fc4c53b838947e748275a1/verify-exit.txt` 为 0。本次执行实际 taskStart 与 turnPoll 两个 Main 分派，断言审批 turnRequestId 等于真实 task/start 起轮信封身份。允许一次真实写文件并使目标 complete；拒绝不写文件且因无进展 blocked；审批等待中取消不应答旧工单、不写文件且目标保持 active。三者重启只读恢复均不发起新模型请求或重新执行。manifest.json 记录真实 Host、Main、状态脚本、桥接、验证器哈希与命令；本机 SSE 协议夹具不是远端模型，Node VM 执行 IPC handler 也不是 Electron GUI。

## 最新源码统一构建准入

当前产品另冻结至 `target/unified-current-96fd8a63dfce4f298bc610a82e27d90e`：634 个输入文件逐字复制，复制前后差集为空，HEAD 均为 bf68db63d331257485494f153c1a2ae5f8f379e1。source-manifest.json 记录源码哈希、未提交状态、空 index 和 W00 归属表哈希，不凭状态猜写者。该快照包含当前核心、团队、CLI 和桌面输入，未复用旧核心缓存。默认 cjpm Host 构建已启动，原始进程 28220、编译子进程 26836，日志和命令保留；在 host-exit.json 与产物证据出现之前，不记为编译通过。默认构建不改变源码选项、不设置观察超时杀进程。

## 尚未收口的交付

Electron 的窗口站创建被 Windows 拒绝，原生诊断见 windows-desktop-runtime-recheck-2026-10-08.md。完整窗口交互、真实 Electron IPC、断连重连、关闭标签及统一最新源码安装包仍需独立验收。OS 隔离准入也未通过，执行门禁继续关闭。本批仅推进 F02/F04 消费端，不升级整个能力域或最终目标为通过。
