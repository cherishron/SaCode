# 持续目标：DSH 契约裁决与 SaCode 差异（2026-10-05）

基线固定 `deepseek-ai/deepseek-harness@639ed015397290b3745d163aafe02ffee4aa3f84`。本轮核对 goal 服务、自动驱动、模型工具的源码和测试；不是以 SaCode 已写出的类倒推上游需求，也未执行 DSH 的 TypeScript 测试。

## 裁决

| 子能力 | 冻结上游证据 | SaCode 当前状态及实施方式 |
| --- | --- | --- |
| 一会话一目标、CAS、生命周期 | [goal 服务源码](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/goal/goal/src/index.ts) | 属复刻。已有核心与控制 IPC；空目标、非法状态迁移仍须修复；唯一目标 id、严格回放、轮数上限字段及结构化阻塞原因尚不完整 |
| 自动跨轮 | [驱动源码](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/goal/goal-round-driver/src/index.ts)、[测试](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/goal/goal-round-driver/tests/goal-round-driver.spec.ts) | 属复刻接入，不是独立新设计。已有 GoalDriver/GoalRunner；实际用户入口仍未闭环 |
| 恢复后续跑授权 | 同上及 goal 服务的 runtimeStates/agent-created 路径 | 上游分开持久 phase 与进程 activation；恢复或挂载不自动续跑。SaCode 尚缺 activation，接线前补齐，不能仅看到 active 就自动发模型请求 |
| 保留的轮次提示与准入计数 | [prompt.ts](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/goal/goal-round-driver/src/prompt.ts)、驱动 validReservation/pre-step/session-event | 上游用保留 user/message 的目标来源记录准入轮次，且有前后修订围栏和持久化检查点。SaCode 当前 goal/round 记录完成轮次，系统提示注入不等同该契约；须分别补准入计数和时长统计 |
| 运行中插话、人类消息优先 | 驱动 competingQueued、inbox-inserted、restoreOtherClaimed 及测试 | 复用已有 inbox 契约；已有步骤/轮次送达，自动轮次与人类输入竞争仍须端到端验证 |
| 暂停时不打断当前轮 | 驱动 goal-changed 的宿主暂停调用 cancel；测试覆盖宿主与模型发起的两种暂停 | 上游宿主暂停会取消当前轮。用户明确要求边界生效、不强杀当前轮，因此保留 SaCode 行为，作为对上游暂停策略的扩展差异，单独验收 |
| 完成与阻塞策略 | [模型目标工具](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/goal/tool-goal/README.md)、[authority.ts](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/goal/tool-goal/src/authority.ts) | 上游已有模型目标工具及执行时授权，阻塞有连续轮数门槛；不是只看 assistant 文本。SaCode evidence 回调目前无产品接线，三个模型工具与授权尚未接。独立自动验证器不应作为复刻前置条件；用户要求的可追溯证据约束仍保留 |
| token/时间/无进展限额 | [驱动限制说明](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/goal/goal-round-driver/README.md) | 驱动已有轮数上限，其他资源策略独立。SaCode 已有调度限额切片；在保留上游契约后扩展，并接实际用量，不把全部限额说成上游已实现 |
| 桌面目标条与人类命令 | [ui-goal 文档](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-goal/README.md)、[command-goal 文档](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/goal/command-goal/README.md) | 已核文档：目标条在 Todo 后、Queue 前，区分 phase/activation，有编辑/暂停/恢复/清除及内联错误；完成和无目标时隐藏。人类 /goal 控制不消耗模型轮。布局源码、样式、截图和命令解析仍待核，随后按指定技术栈复刻，不能先设计替代目标卡 |

取证目录：`D:\Temp\SaCode-goal-upstream-20261005`。`tree.json` 为冻结 GitHub 递归树，`truncated=false`；网页直读用于上述源码核验。旧矩阵只读 goal 子系统文档，遗漏同组消费者，不能据此认定自动驱动不存在。

## 后续验收边界

复刻基线、用户指定扩展与尚缺接入分开登记。已通过的核心测试不能代替桌面、实际 CLI、真实模型和最终安装包；本轮不宣称持续目标产品已交付，也不宣称已运行上游测试。

## 本轮核心修复与取证

- GoalService 直接调用时也拒绝空白目标和空白阻塞说明；目标正文在核心边界去除首尾 ASCII 空白。暂停/阻塞仅从 active 接受；完成后不能恢复、暂停或重复完成。拒绝不追加事件、不推进修订。
- `goal_contract_test.cj` 四条回归：空目标拒绝、正文规范化、完成终态迁移拒绝、暂停/阻塞合法来源及空说明拒绝。原实现红灯为 FAILED 2 / ERROR 2 / rc=1（非法操作被接受导致后续状态检查抛错）；修复后四条均 PASSED。
- 隔离基点 `d8018dd` 的已提交核心加本轮 goal.cj/goal_contract_test.cj；不带工作区未提交模型工具管线及并发 prompt 增强。核心最后读数 **TOTAL 497 / PASSED 496 / SKIPPED 1 / ERROR 0 / FAILED 0 / rc=0**。SKIPPED 为既有真实模型凭据门控；本轮未调用真实模型。
- 第一次全量缺 extjs/scripts 夹具，FAILED 13 / ERROR 9，明确不采信为通过；从同一 HEAD 补齐已提交夹具并设置 SSE_OPENSSL 后运行同一编译出的 core.exe，取得上述最后读数。初次未落测试文件的空匹配运行（全部跳过）也不作证据。日志 `core-contract-red.log`、`core-contract-green.log`、`core-contract-final.log` 均保留在取证目录。
- 隔离重编 CLI 后 `main.exe goal` 为 **10 PASS / ALL PASS / rc=0**，日志 `cli-contract-goal.log`。仍是组合自测，不是可操作持续目标用户入口；本轮未重打安装包。
- 文档本地链接及 git diff 空白检查通过。此修复不代表完整 goal 兼容：结构化事件/原因、UUID、新目标独立修订、Unicode 空白规范化、activation、轮数准入与模型工具授权仍需按上游补齐。
