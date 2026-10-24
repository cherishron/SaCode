# F13 自动化调度「持久触发准入」核心切片（AU-02 第一阶段）

用户要求「方案走得通就不要降级」，并授权启动 AU-02（自动化按 cron 真实执行）。按 [`docs/plans/2026-10-20-hooks-automation-design.md`](../plans/2026-10-20-hooks-automation-design.md) §4.1/§4.3/§4.4 的推荐顺序，先落地**可离线自测的核心触发准入**，不启动模型/命令/网络，不制造成功历史。**未提交、未打包。**

## 一、为何是「核心准入」而不是「桌面接 tick」

复核确认 A1 不是桌面降级、也不是简单接线：

- `core/src/automation_store.cj`（`ScheduleStore` 的持久入口）存的是 **prompt 型 agent 任务**，其 `view()` **硬编码 `executorAvailable:false`**，注释写明「配置保存不执行」。
- 已存在的 `AutomationExecutor`/`AutomationExecRpc` 跑的是 **shell hook `command`**（`AutomationHookRunner` → `ShellExecutor`），与 store 的 prompt 任务是**两条子系统**；设计稿明确「Shell `ExecutionService` 不可伪装自然语言 Agent 任务」。
- `core/src/schedule.cj` 的 `dueTasks/recordFire/updateFireResult/fireHistory` **零生产调用方**；`recordFire` 的 ID 基于事件数、非稳定触发键，不足以实现触发唯一性/时区/跨进程 owner。
- `apps/daemon` 无常驻调度循环；旧 `DaemonScheduler` 已按「死代码」删除。
- 台账 `product-closure-goal-2026-10-15.md` 的 **AU-02 / F13 调度执行** 行标为「**未开始**」，且要求「先在核心新增持租约、持久屏障、并发去重且重核任务启用/未删除的火次准入」。

因此第一阶段只做该前提：**持久触发准入**。桌面端硬接 `automationTick` 只会得到永远空的假入口（=用户要避免的降级），故不做。

## 二、交付

新增 `core/src/automation_trigger.cj`：

- `AutomationTriggerIntent`：把一次「打算触发」转成有身份、可持久去重的记录；幂等键 `hash(scope + taskId + triggerKind + logicalOccurrence)`，**不含 `definitionRevision`**，使内容编辑不令同一逻辑分钟再次触发（design §4.1 末段）；`manual` 用调用方 `requestId` 作 occurrence。
- `AutomationTriggerLog`：**与 `AutomationStore` 配置日志分离**的独立版本化运行日志（design §4.3 末段「不把新事实写入只允许三类旧 schedule 事件的配置日志」）：
  - 单写者：`WriteLease` 取唯一所有权，`open()` 回放并校验；未拥有者准入即 `automation-trigger-not-owned`。
  - 幂等准入：`admit()` 同键返回同一记录、`admitted=false`，不产生第二个派发。
  - 屏障：**先 `append`+`flush` 成功才改内存**——准入失败零派发（`automation-trigger-persistence-failed`）。
  - overlap=skip：同 task 已有在途火次（admitted/dispatched/unknown）时记 `skipped`+`overlap-skip`，不排队。
  - 恢复屏障：`open()` 回放后把未结算的 admitted/dispatched **降为 `unknown`**，禁止自动重发（design §4.3）。
  - `markDispatched(triggerKey,runRef)` / `settle(triggerKey,status,detail)`：只允许真实终态，绝不拿准入成功冒充执行成功。
  - `advanceWatermark`：misfire=skip，墙钟回退不推进、不重发，累计错过数。
- `automationTriggerCronMatches(cron, timezone, utcMinute)`：复用 `automationExecutorCron` 的严格五字段校验 + `CronSpec` + IANA `TimeZone`，不新增第二套 cron 调度器（ADR-HOOK-02）。

新增 `core/src/automation_trigger_test.cj`：7 条 `@Test`——幂等键稳定性与坏输入拒绝、同键幂等、overlap-skip、dispatch→settle 释放、崩溃重开→unknown 屏障与禁重发、单写者租约/未拥有守卫、水位错过计数、Cron 按 UTC 分钟匹配与非法 cron 显式报错。

**不做/边界**：不启动模型/命令/网络；不改 daemon/Host/桌面/共享配置；core 仅新增两个文件。

## 三、验证（Windows，本机）

- **编译**：`cd core && cjpm build` → **rc=0**，36 warnings（含新模块，无 error）。
- **单测未执行**：`cjpm test`（含 `--filter automationTrigger` 与 `--no-run`）在本机**编译/链接停滞**——日志停在库编译后 15+ 分钟无进展、`core.exe` 未重建（mtime 仍是 2026-10-21）。这与仓库既有证据 `2026-10-21` 所述「core `cjpm test` 编译/链接超时未取得最终计数」一致。**故本批不宣称测试通过**；用例已随源码入库，待可构建环境执行。
- IPC 面未变（未改 `preload.cjs`/`main.cjs`）。

## 四、下一步（未做，属 F13-E 交接，跨模块）

1. **F13-E 执行方**：独立会话/运行上下文与 Runner 接缝（design §4.6），无此则调度不得真实派发。
2. **调度 owner**：桌面 Host「仅应用存活期」或经用户授权的常驻 daemon（design ADR-HOOK-03；不用 renderer timer 冒充后台）。
3. Host 具名方法 `automation/trigger|run-describe|run-cancel`（design §6；不把 `automation/control` 扩成任意动作容器）。
4. 桌面「手动触发/运行记录」入口与策略说明（design §7），取代当前 `executorAvailable=false` 的常量投影。

以上均需 F13-E 握手后才有可核验的真实运行；在此之前保持 fail-closed（缺 runner 报 `automation-executor-unavailable`，**不写准入事实**，避免无主 unknown 累积）。

## 五、F13-E 执行接缝契约（本轮追加，core）

新增 `core/src/automation_runner.cj`：

- `AutomationRunDispatcher`（接口）：`dispatch(triggerKey, taskId, definitionDigest): ?String` 返回 runId；这是 design §4.6 的**编译期有限接缝**，不是用户可提交回调；无实现即 fail-closed，实现方须复用共享核心链、不复制第二套执行器。
- `AutomationRunCoordinator`：把 design §4.3 顺序固化于一处——①执行器不可用 → 报告 `automation-executor-unavailable` 且**不写准入事实**（无主 unknown 不累积）；②持久准入（幂等/`overlap-skip` 由 `AutomationTriggerLog` 负责）；③派发；派发失败 → `settle unknown`（不重发）；④成功 → `markDispatched` 登记 runRef。

新增 `core/src/automation_runner_test.cj`：3 用例（合成 dispatcher 覆盖「无执行器 fail-closed 且不写准入」/「正常派发且幂等不二次派发」/「派发失败留 unknown 屏障」）。

验证：`cd core && cjpm build` **rc=0**（35 warnings，含新契约模块）。测试执行同 §三——本机 core 测试编译停滞，未执行、不宣称通过。

**仍缺（下一步）**：Host 侧真实 `AutomationRunDispatcher` 实现（独立会话轮次运行）+ `automation/trigger|run-describe` 具名方法 + 调度 owner（Host 存活期/常驻 daemon）。需复用/重构 `apps/host/src/main.cj` 的 `task/start` 轮次启动路径（约 2700–2910，内联且与 `activeId`/`turnSink`/`turnHandle`/`leaseHeld` 强耦合），属**尚未裁定的 F13-E 执行方契约与文件范围**（design 待确认 #1），且共享 Host 正被并发编辑；按用户选定以「**私有副本实现并验证、产出可合并 diff、不动共享文件**」推进。

## 六、Host 私副本与 F13-E 实施台阶（本轮）

按用户选定「私有副本实现并验证、不动共享文件」：在 `target/tmp/f13e-20261024/` 搭同级布局（`.deps/stdx` + `core` + `apps/host` + 根 `cjpm.toml`），`cd target/tmp/f13e-20261024/apps/host && cjpm build` → **rc=0（`cjpm build success`，29 warnings）**，确认私副本可独立构建（含拷贝的 core 与新契约模块）。

F13-E 在副本内的实施草图（下一步，共享 `apps/host/src/main.cj` 未改）：

- 新增 `apps/host/src/automation_runner_rpc.cj`：`AutomationRunHost <: AutomationRunDispatcher`——用独立 `SessionLog`（任务定义里的 `sessionLogPath`）+ `TurnFrameJournal(4096)`（`core/src/cancel.cj:410`）+ `ModelAgentRunner().start(...)`（`core/src/model_agent.cj:246`）起**独立会话**，不复用 GUI `task/start` 会话；provider 由任务 `modelId` 经 `CustomModelRegistry`/`resolveCredentialKey` 装配；handle `automation/trigger` / `automation/run-describe`。
- 无人值守审批：本刀用自建 `ApprovalDesk`，无人应答按核心 TTL 过期 → `blocked`，**绝不自动放行**；接桌面审批面待 F13-E 执行方契约确认。
- `main.cj` 只加有限分派行（仿 `AutomationExecRpc`）+ capabilities；副本内 `cjpm build` + 定向用例；产出**可合并 diff**。

**边界**：本刀为「应用存活期」最小真执行（非常驻 daemon）；桌面运行记录、审批面、预算与结算仍待与 F13-E 执行方握手。