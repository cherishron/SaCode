# SDD ledger — plan: docs/superpowers/plans/2026-10-09-hooks-lifecycle-implementation.md

**Identity**: 2026-10-09-hooks-lifecycle-sdd
**Start**: 2026-10-09
**Status**: SETUP

> **2026-10-09 整理注**：本台账任务 2/3 的 `cjpm test` 阻塞含两类——(a) stdx 硬编码路径（已于 2026-10-09 经 `scripts/setup-stdx.mjs` + cjpm.toml 相对路径解耦修复，见 `product/PRD.md` 进度对账）；(b) `core/src/cmds.cj:64`（resolveWithArgs 元组返回类型）与 `cmds.cj:70`（未闭合分隔符）既有语法错误（**仍未修复**，仍阻塞）。需重跑 `cjpm test` 复核任务 2/3 是否解除；产品整体进度以 `product/PRD.md` 进度对账为准。

## Tasks

| ID | Subject | Status | Owner | Notes |
|----|---------|--------|-------|-------|
| 1 | HookEvent enum + unit test | completed | task1 / task3-fix | 真包已随批 8 提交（6499647）；隔离包 18/18 复验通过 |
| 2 | HookInput + HookEventData union | completed | task2 / task3-fix | 构造参数顺序与命名参数规则修正后编译通过；16 种 eventSpecific 序列化有真实断言覆盖 |
| 3 | HookResult + HookDecision | completed | task3 / task3-fix | 补 @Derive 与 hookEventName/hookDecisionName，日志载荷不再依赖枚举插值 |
| 4 | executeCommand exit-2 path | completed | task4 → 6499647 | 真子进程；退出码 2 取 stderr 为 reason 并 Deny，变异反证已杀 |
| 5 | executeCommand real spawn | completed | task5 → 6499647 | stdin 独占临时文件交出完整 HookInput，双管道各线程抽干，有界 wait+terminate；300KB 双管道与超时不留孤儿进程 |
| 6 | executeHttp SSRF + DNS + env whitelist | completed | task6 → 6499647 | stdx 客户端真实 POST；URL 白名单默认拒、环回放行、链路本地/IPv4 映射/元数据永不放行、逐条核 DNS 并钉死首址、noProxy、不跟随重定向、env 插值只认白名单且拒递归；非 2xx 放行 |
| 7 | HookRegistry dispatch + SessionLog | completed | task7 → 6499647 | 隔离包验证（SessionLog 为同签名桩）：hook/dispatch、hook/result、hook/decision 三类写入与 deny 优先聚合 |
| 8 | settings.json read + security | 部分 | task8 | worktree_setup.cj 内的 SettingsLoader 未纳入本轮编译验证，且未接进 HookRegistry 的 HookSecurityPolicy 装配 |
| 9 | webhook.cj migration | completed（编译级） | task9 → 6499647 | dispatch→HookResult；迁移文件在隔离包 cjpm build rc=0 |
| 10 | schedule.cj migration | completed（编译级） | task10 → 6499647 | fire→HookResult；同上 |
| 11 | workflow.cj migration | completed（编译级） | task11 → 6499647 | start/done/fail 先 dispatch 再状态转换；同上 |
| 12 | pipeline.cj PreToolUse integration | blocked | — | 计划假设的 pipeline.cj 不存在；真实入口是 agent.cj:410 pipeline 与 :317 execute，属并发改动区，未提交 |
| 13 | approval.cj PermissionRequest hook | blocked | — | approval.cj 无 CAS 主体（:246 为 stub）；接入点在 model_tool_runtime.cj:89，未提交 |
| 14 | session.cj Session* hooks | 未提交 | task14 | 生命周期三方法改为构造 HookInput 交 HookRegistry.dispatch；该文件混有他人 durable 改动，按路径提交会吞其 hunk，故留工作区待裁决 |
| 15 | Integration + mutation tests | 部分（执行器面完成） | 6499647 | 变异反证见下节；端到端「PreToolUse allow 跳过审批」仍未做（依赖任务 12/13） |

## 真实包当前状态（2026-10-09 收尾复核）

- `cd core && cjpm build`：**rc=0**（当场捕获退出码，非命令链尾部）——生产源码含
  `hook_registry.cj` 与 `hook_executor.cj` 在真包编译通过。
- `cd core && cjpm test`：**失败，60 errors generated / 8 printed**，全部落在他人
  在途测试源（acp_delegation_test、plugin_manifest_test、custom_import_test、
  custom_model_registry_test、provider_capability_test 等）；按 `hook` 过滤报错文件
  命中 0 条错误，仅 2 条警告。故本轮无法在真包跑真实套件，隔离包 18/18 仍是执行器
  与注册表的唯一运行证据。
- 归因更正（记录以免重犯）：后台任务回报「exit code 0」是命令链末尾 `grep` 的退出码，
  不是 cjpm 的；cjpm 真实结果写在日志里是 `Error: cjpm test failed`。
- 已判定的非缺陷：`hook_executor.cj:276-277` 编译器报
  `unreachable block in 'if' expression`（finally 里关闭 response 与 client 两段）。
  用可观察副作用定根因：在隔离副本这两段里 `setVariable`，另起本机夹具跑一次真实 2xx
  请求后断言两个变量皆为 `Some("1")`——`cjpm test` rc=0，TOTAL 19 / PASSED 19 / FAILED 0 /
  ERROR 0，即两段清理确实执行，警告是流分析误报，不存在连接泄漏。同形态也见于既有
  `web_http.cj:117` 与 `web_search_service.cj:144`，互为佐证。探针只活在本轮新建的
  `hookreg/` 隔离包（`hook_executor.cj` 从真源新拷，非上轮已验副本），用完即删；真源
  全程未改，事后与 HEAD 逐字核对为空输出。不补常驻用例：剩下的可观测判据只有套接字
  计数，会把计时抖动引进单测，比不测更糟。

## 验证边界（2026-10-09 记录，避免误读）

- 全 core 包在本轮开始时因他人 23 条编译错误不可构建，故执行器与注册表在
  `apps/desktop/.tmp-test/hookreg/` 隔离包验证：真源全文 `hook_registry.cj`、`hook_executor.cj`
  与两份真源测试，`SessionLog` 用与真实 `append(eventType,data): SessionEvent` 同签名桩。
  结果 `cjpm test` rc=0，Summary TOTAL:18 PASSED:18 FAILED:0 ERROR:0。
- 因此「注册表写日志」证明的是调用契约与聚合语义，**不是**与真实持久化日志的集成；
  真包跑通后需复验。
- 变异反证（变异体只活在工作区隔离副本，真源 md5 全程未变，还原后 8/8 回绿）：
  | 不变量 | 变异 | 指定受害用例 | 结果 |
  |---|---|---|---|
  | 退出码 2 才算阻塞拒绝 | 判据改为 3 | testHookRealCommandExitCodes | 杀（FAILED，三条断言同时失守） |
  | 私网开关不得越过永不放行地址表 | 删该表 | testHookHttpAddressPolicyAndUserinfo | 杀（FAILED） |
  | 同上（仅调换判断次序） | 私网检查前置 | 同上 | 存活；标准库语义探针证实为等价变异（169.254.169.254 的 isPrivate 与 isGlobalUnicast 均为 false） |
  | 环境变量插值只认白名单 | 删守卫 | testHookHttpRealPostRedirectTimeoutAndEnvironment | 杀（FAILED） |
  | eventSpecific 必须完整序列化 | 不写该字段 | testHookEventSpecificSerializationAllVariants | 杀（ERROR 而非 FAILED） |
  | 永不跟随重定向 | autoRedirect(true) | testHookHttpRealPostRedirectTimeoutAndEnvironment | 杀（ERROR） |
  | 超时按非阻塞错误放行 | 归类改 Deny | testHookCommandTimeoutAndLargePipes | **存活**——探针查明该分支不可达（异常先被外层 catch 吸收），非测试缺口，但这条分支是死代码，待清理 |
- 探针顺带查出真实缺陷并补了永久用例：超时回收子进程原先无覆盖，新增
  `testHookCommandTimeoutReapsChild`（标记文件法，真实现下通过）。
- 一处运行器健壮性问题：移除 URL 白名单后，用例真连 127.0.0.1:1 触发 stdx 读超时，
  cjpm 工作进程内部崩溃（`nOutputs=23, nResults=13`，整轮无 Summary），该轮不作归因证据。

## Pre-flight
- Plan read: pending
- Conflict scan: pending
- Worktree: main workspace (D:\Project\sa\saai\sa-code)
