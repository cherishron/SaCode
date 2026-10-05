# SaCode 模型中心 B2「调度闭环」实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「自定义模型 → 过滤链 → 选路 → 上游尝试 → 失败归类 → 冷却与低频探测 → 试恢复」这条链在仓颉 `core` 里建成唯一决策真源，并让宿主任务路径、CLI 与桌面都只经这同一套规则取路由——本批不做计量账本（B3）、不做迁移（B5）、不做 relay（B4）。

**Architecture:** 决策集中在三个新单元：`RouteHealth`（状态：作用域 / 失败计数 / `notBefore` / 下次探测）、`ModelRouter`（纯决策：过滤链 + 轮询 + 平滑加权，不 I/O、不读时钟）、`AttemptLog`（上游尝试的先发标记与失败事实，落 `usage-ledger.log`，与 B3 的账本同一条写路径同一个文件）。宿主把 `nextProvider` 工厂从「冻结单上游」换成「每步向 `ModelRouter` 要一条路由」，`core` 的 `ModelAgentRunner.start` 签名一字不动。

**Tech Stack:** 仓颉 cjc/cjpm **1.1.3**（cjnative，target `x86_64-w64-mingw32`）；`stdx.encoding.json`、`stdx.net.http`；`std.unittest`；Node ≥18（桌面 `node --test`、CLI 自检、`ui-smoke`）。

**Spec:** `docs/superpowers/specs/2026-10-05-model-center-design.md` —— 本计划实现 §3 表中 `RouteHealth`/`ModelRouter` 两行（`UsageLedger` 只落最小事件面）、§4 调度规则与 §4.1 插入点、§5 失败分类与健康恢复全节、§6 的重放闸（`attempt/dispatched` 与「一步内不换绑定」）、§9.4 的 CLI 四条、§10 的 B2 出口判据，以及 §11 断言 3、5–10、12、32–39、44（CLI 参数半）、45（继承）、49、50、53–55、57、59、62、69–72、79–85。

**前置批次：** B1（`docs/superpowers/plans/2026-10-05-model-center-b1-catalog.md`）已全部落库：三层文档面（`core/src/provider_registry.cj`、`core/src/custom_model_registry.cj`、`core/src/upstream_pull.cj`、`core/src/principal.cj`）、宿主十个目录动词、桌面 IPC 十条通道、`models-page.ts` 校验收紧。B2 只消费这些读面，**不改它们的落盘形态**。

---

## Global Constraints

**执行状态：待开工。** 本计划按设计文档 §10 的 B2 出口判据逐条对齐；开工前先做 Task 0 的基线重测与命名契约核对。

- **产品命名契约（2026-10-05 重命名会话确立）**：Electron IPC `sacode:<动作>`；preload 全局桥 `window.sacode`；宿主可执行文件 `sacode-host.exe`；CLI 目标 `sacode`；npm 目录 `npm/sacode-cli`、`npm/sacode-cli-win32-x64`；产品环境变量 `SACODE_HOST`、`SACODE_PROVIDER_BASE_URL/KEY/MODEL`、`SACODE_EXTJS_DIR`。**JSON-RPC 业务方法名不改**（`turn/start`、`custom/describe` 等一律照旧）。本批新增的任何通道、命令、测试环境都按新契约写，**不回退 `dsh:` 前缀**。
- 仓颉 `cjc`/`cjpm` **1.1.3**；`core/cjpm.toml` 是 `output-type = "static"`。**不新增任何依赖**。
- 会话日志是唯一真源；`append` 只在实例内可见，`flush` 才跨进程持久。所有新文档面（`route-health.log`、`usage-ledger.log`）都按事件回放派生状态，**不缓存进程内视图**。
- 冲突与拒绝必须分开：版本落后 → `settings-conflict`；内容非法 → `settings-rejected`。
- **确定性合同**（§4）：给定同一文档态 + 同一健康态 + **同一游标起点** + 同一注入时钟 + 同一请求能力，`ModelRouter` 的输出必须逐字可重放。`ModelRouter` **不读真实时钟**（时钟由调用方注入）、**不做 I/O**、**不写状态**。
- **游标住在进程内**（§4 表）：不落 `route-health.log`（请求路径上多一次同步落盘）、**禁止**落配置文档（每选一次推高用户编辑面 revision）。因此**不宣称**同机 CLI 与桌面并发时的全局精确比例；承诺**无饥饿**与**单实例内比例**（断言 84、85）。
- **租约临界区只许覆盖落盘写入，绝不跨网络**（断言 51 同族，B2 的 `dispatched`/`failed` 落盘同受此限）。
- **失败事实进日志**：`RouteHealth` 从 `attempt/failed` 事件回放派生，跨重启不丢。
- 注释、文档、commit message 一律中文；commit 形如 `feat(core,host): 描述`，scope ∈ `core/host/cli/desktop/scripts/docs`。
- 不提交构建产物：`target/`、`apps/desktop/dist/`、`npm/sacode-cli-*/bin/`、`*.log`。
- **工作区有并发会话在改源码**：每次只 `git add` 本批路径；若目标文件混有他人 hunk，用 `git apply --cached` 只暂存本批 hunk（B1 已实测此法可行，见 `git show f088177`），提交后 `git show --stat` 核对文件清单。
- **锚点纪律**：`apps/host/src/main.cj` 只认符号不认行号（该文件改动最频繁）；`core/src/*.cj` 的锚点同样先核再改。定位一律 `grep -n "func X"` 这类符号式检索。
- 测试红灯唯一合法形态：**新用例名出现在剥码后 Summary 的 FAILED 列表里**，且 `TOTAL` 比基线恰好多出新增条数；`TOTAL: 0` 或过滤器空匹配一律按 FAIL 处理。
- 计时敏感用例（冷却、退避、探测）用**注入时钟**，且**独占跑**，不与并发构建抢时序窗口。
- 本机跑测试的两个环境项（与代码无关，写进每条命令的注释）：`SSE_OPENSSL` 已由 `scripts/sse-contract-server.cjs` 自愈定位（`ba30500` 起无需手工设置）；跑 Electron 前须清 `ELECTRON_RUN_AS_NODE`（harness 自身环境会带，否则 `electron .` 以 node 模式启动、`main.cjs` 读不到 `app`）。

**基线（开工当日实跑，写入 Task 0 的日志）：**

| 面 | 命令 | 期望 |
| --- | --- | --- |
| 核心单测 | `cd core && cjpm test` | `TOTAL: B`、`FAILED: 0`、`ERROR: 0`、`rc=0`（B1 收尾实测 554 / 552 / 2 / 0 / 0） |
| 桌面单测 | `cd apps/desktop && node --test` | 全绿（B1 收尾实测 205 pass / 0 fail） |
| 宿主协议面 | `node --test test/host-verbs.test.mjs` | 6 pass / 0 fail |
| 桌面冒烟 | `npm run ui-smoke` | `UI_SMOKE PASS` |
| CLI 自检 | `cd apps/cli && cjpm build` 后逐模式 | 见 B1 计划的基线表；新增 `modelcenter` 模式后重算 |

**行号锚点只当参照**：本计划登记时实测（2026-10-05 19:30）——`apps/host/src/main.cj` 的 `registryView.defaultProviderId && registryView.defaultModel.size` 命中 **2**（断言 69 的锚）；`core/src/model_agent.cj:105` 是 `public func start(first: Provider, nextProvider: (String) -> Provider, model: String, …)`；`core/src/sse.cj:49` 抛 `http-status:${resp.status}`、`:57` 抛 `http-request-error`；`core/src/lease.cj` 的 `takeoverIfStale():87`、`acquire():108`、`release():139`。动手前一律重新 grep 核一遍。

---

## 文件结构（本批落点）

| 文件 | 职责 | 本批动作 |
| --- | --- | --- |
| `core/src/transport_failure.cj` | **新建**：结构化失败对象（`kind`/`reachedUpstream`/`status`/`retryAfterSeconds`/`resetEpoch`/`bodyLen`/摘要）与白名单响应头采集 | 新 |
| `core/src/transport_failure_test.cj` | 上者的回归用例（断言 53、55、81） | 新 |
| `core/src/sse.cj` | 传输层：非 200 时**先读头再关响应**，产出结构化失败而不是裸字符串 | 改 |
| `core/src/attempt_log.cj` | **新建**：`attempt/dispatched` 先发标记与 `attempt/failed` 事实，落 `usage-ledger.log`（与 B3 账本同文件同写路径） | 新 |
| `core/src/attempt_log_test.cj` | 上者的回归用例（断言 54、79、80、82 的调用计数半） | 新 |
| `core/src/route_health.cj` | **新建**：三档作用域（`upstream`/`route-set`/`channel`）、失败归类、冷却、`notBefore`、墙钟护栏、跨重启回放 | 新 |
| `core/src/route_health_test.cj` | 上者的回归用例（断言 5、6、7、9、32、33、37、38、53、55、57） | 新 |
| `core/src/model_router.cj` | **新建**：纯决策——过滤链 + 轮询 + 平滑加权 + 游标 + 带类型拒绝 | 新 |
| `core/src/model_router_test.cj` | 上者的回归用例（断言 3、4、10、83、84、85） | 新 |
| `core/src/route_probe.cj` | **新建**：冷却后的低频探测、试恢复、一作用域一租约、全局探测闸 | 新 |
| `core/src/route_probe_test.cj` | 上者的回归用例（断言 11、12、39、50、59） | 新 |
| `apps/host/src/main.cj` | 任务路径：`nextProvider` 工厂改为每步要路由；取参收敛；`-32016` 拆码 | 改 |
| `apps/desktop/test/turn-routing.test.mjs` | **新建**：宿主两步换路、开关语义、缺配置 fail-loud（断言 34、36、49、62） | 新 |
| `apps/cli/src/main.cj` | 新增 `modelcenter` 自检模式与单发子命令（选模型跑任务 / 看费用 / `route/probe/run`） | 改 |
| `apps/desktop/renderer/pages/model-select.ts` | 任务侧选择器只列第 3 层；推理等级归属收口 | 改 |
| `docs/evidence/model-center-b2-2026-10-05.md` | **新建**：批次现场（读数、变异反证、双入口证据） | 新 |

---

## Task 0: 开工前置——基线重测与命名契约核对

**Files:** 无源码改动；证据写进 `docs/evidence/model-center-b2-2026-10-05.md` 的开头一节。

- [ ] **Step 1: 工作区体检**

```bash
cd /d/Project/sa/saai/sa-code
git log --oneline -12
git status --short | head -40
```

要点：确认重命名会话已落库（`sacode` 契约出现在 `apps/desktop/preload.cjs` 的 `exposeInMainWorld("sacode", …)` 与 `scripts/pack-host.mjs` 的产物名 `sacode-host.exe`）；确认本批要改的四个文件（`core/src/sse.cj`、`apps/host/src/main.cj`、`apps/cli/src/main.cj`、`apps/desktop/renderer/pages/model-select.ts`）当前工作区是否混有他人 hunk。

- [ ] **Step 2: 重测五条基线并落日志**

```bash
cd /d/Project/sa/saai/sa-code/core && cjpm test > ../target/b2-baseline-core.log 2>&1; echo "core rc=$?"
cd /d/Project/sa/saai/sa-code/apps/desktop && node --test > ../../target/b2-baseline-desktop.log 2>&1; echo "desktop rc=$?"
node --test test/host-verbs.test.mjs > ../../target/b2-baseline-verbs.log 2>&1; echo "verbs rc=$?"
```

读结果的方法：输出重定向落盘 → 剥 ANSI → 只认**最后一个** Summary 块的五个计数，并与退出码交叉验证。**禁止**用 `grep -c '\[ PASSED \]'` 之类的 token 计数判通过。`B` 取本步实测的 `TOTAL`，此后每个任务的期望值写成 `B + 本批到该任务为止的累计新增`。

- [ ] **Step 3: 核命名契约与锚点**

```bash
grep -n "exposeInMainWorld" apps/desktop/preload.cjs
grep -n "sacode-host.exe" scripts/pack-host.mjs apps/desktop/paths.cjs
grep -c "registryView.defaultProviderId && registryView.defaultModel.size" apps/host/src/main.cj   # 期望 2
grep -n "public func start" core/src/model_agent.cj
```

任一项对不上就停在 Task 0，先报告差异，不改代码。

---

## Task 1: 结构化失败对象与响应头采集（断言 53、55、81）

**为什么先做这个**：设计文档 §5.2 实测三段输入通路全缺——非 200 时 `core/src/sse.cj:47-50` **先 `resp.close()` 再抛**，响应头与正文都拿不到；除 `http-status:` 前缀外，连接被拒、DNS、TLS、读超时**一律塌成 `http-request-error`**（`:57`）。不补这两段，「遵守供应商恢复时间」与「线路/模型分档」只能由夹具喂绿。

**Files:**
- Create: `core/src/transport_failure.cj`
- Create: `core/src/transport_failure_test.cj`
- Modify: `core/src/sse.cj`（`RealSseProvider` 的生产构造器：**先读白名单头，再关响应**；失败改抛结构化对象）

**Interfaces:**
- Produces:
  - `public class TransportFailure { kind: String; reachedUpstream: Bool; status: Int64; retryAfterSeconds: Int64; resetEpoch: Int64; bodyLen: Int64; summary: String }`——`kind ∈ {"transport","http-status","protocol","read","cancelled","credential"}`；`-1` 表示该维未知（`status`/`retryAfterSeconds`/`resetEpoch`）。
  - `public func failureOf(kind: String, reachedUpstream: Bool, status!: Int64 = -1, retryAfterSeconds!: Int64 = -1, resetEpoch!: Int64 = -1, bodyLen!: Int64 = -1, summary!: String = ""): TransportFailure`
  - `public func whitelistedHeaders(raw: Array<(String, String)>): Array<(String, String)>`——**只留** `retry-after`、`x-ratelimit-reset`、`x-ratelimit-reset-requests`、`x-ratelimit-reset-tokens`（大小写不敏感），其余一律丢弃。
  - `public func parseRetryAfterSeconds(value: String, nowEpoch: Int64): Int64`——纯数字按秒；HTTP-date 形态按墙钟解析；解析不出回 `-1`。
  - `public func redactBody(body: String): (Int64, String)`——返回 `(长度, 摘要)`；**正文原文永不入日志**（上游错误体常回显请求片段，可能含键值材料）；摘要取前 80 字符并把 `sk-`/`Bearer ` 形态替换为 `«redacted»`。
- Consumes: `core/src/sse.cj` 的 `Client.send` 响应对象（`resp.headers`、`resp.status`、`resp.body`）。

> **符号证据（2026-10-05 19:35 只读实测，`stdx-1.1.3.1`）**：`libstdx.net.http.dll` 导出 `HttpHeaders` 类型与其 `getFirst` / `iterator` / `HeaderValueIterator` / `isEmpty` 等方法；同区可见 `(stdx.net.http:HttpRequest)->stdx.net.http:HttpHeaders` 与 `HttpResponse` 的 `status`/`body`/`headers` 成员。→ **「响应头取不到」不是 API 缺失**；响应体是 `HttpBufferedBody`（符号可见），`close()` 后仍可读。
> **变异反证纠正（2026-10-05 19:50 实测，务必先读）**：原计划把「先 `close()` 再抛」当成取不到头与正文的**根因**，实测**不成立**——把 `close()` 提前到读取之前，`core/src/sse.cj` 仍能读出 `headers` 与缓冲正文，指定用例照样全绿。所以：
> - 「读取顺序」**不构成可断言的不变量**；实现按「先读后关」写只是为了不依赖 `close()` 的实现细节，**不许**把它写成断言。
> - 本任务真正的增量是**把供应商证据取出来并结构化**（`retryAfterSeconds`/`status`/`bodyLen`/`reachedUpstream` 进 `TransportFailure` 并落日志），不是时序。钉住它的变异是：把 `retryAfterSeconds` 换成常量 `-1` → `quotaFailureCarriesRetryAfterFromTheRealHeader` 必红（已实测）。
> - 设计文档 §5.2 第一段那句「响应头与错误正文都拿不到」应改标为「原实现没有把这两样**取出来**」，措辞差异会误导后来者把工期花在时序上。
> 仍未证的一点：**HTTP-date 形态的解析**。符号里只有 `getRFC1123String`（格式化方向），没有看到解析入口；`parseRetryAfterSeconds` 的日期分支要在 Step 3 用**一次性探针**核（不靠编译器猜），拿不到就只认秒数并在规格里如实标「HTTP-date 形态待实现」——**不允许**把认不出的形态当成 0 秒。

- [ ] **Step 1: 写失败测试**

`core/src/transport_failure_test.cj`：

```cangjie
package core

import std.unittest.*

// 失败对象要带得出「请求是否已上线」这一维：同是 transport，
// 连接被拒/DNS/TLS 握手失败是「未上线」，读超时与半身后断是「已上线」——
// 缺这一维时 §6 交给 TransportChannel 的重发白名单只能靠错误文案猜。
@Test
func reachedUpstreamIsAnInputNotADerivation() {
    let refused = failureOf("transport", false, summary: "connection-refused")
    let half = failureOf("transport", true, summary: "read-timeout-after-headers")
    @Expect(refused.reachedUpstream, false)
    @Expect(half.reachedUpstream, true)
    // 两者 kind 同名，这一维必须来自调用点的证据，不能由 kind 反推
    @Expect(refused.kind, half.kind)
}

@Test
func onlyWhitelistedHeadersSurvive() {
    let kept = whitelistedHeaders([("Content-Type", "application/json"), ("Retry-After", "17"),
        ("X-RateLimit-Reset", "1730000000"), ("Set-Cookie", "session=abc")])
    @Expect(kept.size, Int64(2))
    var sawRetry = false
    for (kv in kept) {
        if (kv[0].toAsciiLower() == "retry-after") { sawRetry = true }
        // Cookie 与内容类型都不该出现在重试判据里
        @Expect(kv[0].toAsciiLower() == "set-cookie", false)
    }
    @Expect(sawRetry, true)
}

@Test
func retryAfterAcceptsSecondsAndHttpDate() {
    @Expect(parseRetryAfterSeconds("17", 1000), Int64(17))
    // HTTP-date 形态按墙钟解析后换算成秒；解析不出回 -1（不猜）
    @Expect(parseRetryAfterSeconds("not-a-date", 1000), Int64(-1))
    let delta = parseRetryAfterSeconds("Wed, 21 Oct 2026 07:28:00 GMT", 1000)
    @Expect(delta > Int64(0), true)
}

@Test
func errorBodyNeverEntersTheLogVerbatim() {
    let (len, summary) = redactBody("{\"error\":{\"message\":\"bad key sk-abcdef123456\"}}")
    @Expect(len > Int64(0), true)
    @Expect(summary.contains("sk-abcdef123456"), false)
    @Expect(summary.size <= Int64(80), true)
}
```

- [ ] **Step 2: 跑到红**

```bash
cd /d/Project/sa/saai/sa-code/core && cjpm test > ../target/b2-t1-red.log 2>&1; echo "rc=$?"
```

Expected：编译期红在 `failureOf` / `whitelistedHeaders` / `parseRetryAfterSeconds` / `redactBody` 未声明上。出现语法/惯用法错就按语言坑处理，别改用例。

- [ ] **Step 3: 实现 `transport_failure.cj`**

要点：
- `TransportFailure` 全部字段 `public let`，构造器带命名默认值（照 `core/src/model_catalog.cj:101` 的 `readTimeout!: Duration = …` 形态）。
- `whitelistedHeaders` 逐条比小写名；**不保留**任何含 `set-cookie`/`authorization`/`content-*` 的头。
- `parseRetryAfterSeconds`：纯十进制按秒；否则按 HTTP-date 解析；`std.time` 的可用 API 先用探针核（**不靠编译器猜**），拿不到就只认秒并在规格里如实标「HTTP-date 形态待实现」——但**不允许**把认不出的形态当成 0 秒。
- `redactBody`：`sk-` 与 `Bearer ` 之后的连续串替换为 `«redacted»`；返回长度是**原文长度**（不是摘要长度）。

- [ ] **Step 4: 改 `core/src/sse.cj` 的生产构造器**

把「非 200 → 先 `close()` 再 `throw Exception("http-status:…")`」改成：

1. 非 200 时：**先** `whitelistedHeaders(resp.headers)` + `redactBody(readBody(resp.body))`，**再** `finally` 关响应；
2. 抛出 `TransportFailure`（`kind="http-status"`, `reachedUpstream=true`, `status=resp.status`, `retryAfterSeconds=…`, `bodyLen`, `summary`）；
3. 连接类异常按 `reachedUpstream` 分档：连接被拒/DNS/TLS 握手失败 → `false`，读超时/半身后断 → `true`；分不清写 `unknown` 语义（`kind="transport"` + `reachedUpstream=false` 并 `summary` 标 `unattributed`）时**不进任何一档计数**（§5.2 末行）；
4. 保留现有 `termination`/`errorCode` 只读面语义（断言 35 的不盲发依赖它）。

> **兼容性**：现有用例（`core/src/sse_test.cj`）按 `e.message.startsWith("http-status:")` 断言。改造时**同时**保留 `message` 的可读文本（形如 `http-status:429`），把结构化对象挂在**独立的 getter**上（如 `public func failure(): TransportFailure`），这样既有断言不被迫改写、新断言读结构面。若实现上做不到两条并存，则同步改既有断言并在 commit body 写明「断言口径从文本迁到结构面」。

- [ ] **Step 5: 补「响应头真的读到了」的用例并跑绿**

追加到 `core/src/transport_failure_test.cj`：

```cangjie
// 断言 53 的取数面：429 且响应头带 Retry-After 时，失败对象必须带得出该值。
// 夹具必须是「头里真有」的那一种——常量注入不算这条的绿。
@Test
func retryAfterComesFromTheHeaderNotAConstant() {
    let f = failureOf("http-status", true, status: 429, retryAfterSeconds: parseRetryAfterSeconds("42", 0),
        summary: "http-status:429")
    @Expect(f.status, Int64(429))
    @Expect(f.retryAfterSeconds, Int64(42))
}
```

Expected：`TOTAL: B+5`、`FAILED: 0`、`ERROR: 0`、`rc=0`。

- [ ] **Step 6: 变异反证（两处）**

| 变异 | 期望转红 |
| --- | --- |
| 把 `reachedUpstream` 从入参改成 `kind == "read"` 推导 | `reachedUpstreamIsAnInputNotADerivation` |
| 白名单去掉 `retry-after` | `onlyWhitelistedHeadersSurvive` + `retryAfterComesFromTheHeaderNotAConstant` |

- [ ] **Step 7: 提交**

```bash
git add core/src/transport_failure.cj core/src/transport_failure_test.cj core/src/sse.cj
git show --stat --cached   # 只许这三个路径
git commit -m "feat(core): 结构化失败对象与白名单响应头，先读头再关响应"
```

---

## Task 2: 尝试事件落盘（断言 54、79、80、82 的调用计数半）

**Files:**
- Create: `core/src/attempt_log.cj`
- Create: `core/src/attempt_log_test.cj`

**Interfaces:**
- Produces:
  - `public class AttemptLog { init(file: String); markDispatched(logicalRequestId: String, attemptId: String, routeKey: String): Bool; markFailed(attemptId: String, failure: TransportFailure): Bool; dispatched(attemptId: String): Bool; lastDispatchedUnsettled(): Array<String> }`
  - 事件类型：`attempt/dispatched`（带 `logicalRequestId`/`attemptId`/`routeKey`/`epoch`）、`attempt/failed`（带 `attemptId`/`kind`/`reachedUpstream`/`status`/`retryAfterSeconds`/`bodyLen`/`summary`）。
  - 落盘路径：**`usage-ledger.log`**（与 B3 的 `UsageLedger` 同一个文件、同一条 `WriteLease` 写路径）——B2 只写这两类事件，不写金额。
- 约束：
  - **标记写不下去就不发**（fail-closed，断言 80）：`markDispatched` 返回 `false` 时调用方必须回带类型拒绝，**绝不**「先发出去、回头补记」。
  - `reserve` 与 `dispatched` 各是「取租约 → 写一条 → 归还」的**短临界区**，不许把网络圈进任何一次持锁（断言 80 后半）。
  - 复用 `core/src/model_settings.cj:58` 的 `takeoverIfStale()` → `finally release()` 形态；**一个文件一个租约**（`<path>.lease`），与 `core/src/lease.cj` 按路径的语义一致。

- [ ] **Step 1: 写失败测试**

```cangjie
package core

import std.fs.*
import std.unittest.*

let alFile = "core-test-usage-ledger.log"

func alCleanup(): Unit {
    for (f in [alFile, "${alFile}.lease"]) {
        if (exists(f)) { try { removeIfExists(f, recursive: false) } catch (e: Exception) {} }
    }
}

// 重放闸读的是日志里先发落盘的标记，不是内存标志：发送完才写标记的话，
// 崩溃正好落在发送与补记之间时重启后毫无痕迹，于是把可能已送达上游的请求重发一遍。
@Test
func dispatchedMarkIsDurableBeforeAnySend() {
    alCleanup()
    let log = AttemptLog(alFile)
    @Expect(log.markDispatched("lr-1", "at-1", "step/m-a"), true)
    // 换实例读同一份日志：唯一的证据是盘上那条事件
    @Expect(AttemptLog(alFile).dispatched("at-1"), true)
    @Expect(AttemptLog(alFile).dispatched("at-2"), false)
    alCleanup()
}

@Test
func dispatchedSurvivesReplayAndKeepsRouteKey() {
    alCleanup()
    AttemptLog(alFile).markDispatched("lr-9", "at-9", "deepseek-b/m-1")
    let unsettled = AttemptLog(alFile).lastDispatchedUnsettled()
    @Expect(unsettled.size, Int64(1))
    @Expect(unsettled[0], "at-9")
    alCleanup()
}

// 失败事实要能带出「是否已上线」这一维，供 §6 的重发白名单判定
@Test
func failureEventCarriesReachedUpstream() {
    alCleanup()
    let log = AttemptLog(alFile)
    log.markDispatched("lr-2", "at-2", "step/m-a")
    @Expect(log.markFailed("at-2", failureOf("transport", true, summary: "read-timeout")), true)
    @Expect(AttemptLog(alFile).lastDispatchedUnsettled().size, Int64(0))
    alCleanup()
}
```

- [ ] **Step 2: 跑到红 → Step 3: 实现 → Step 4: 跑绿**

Expected：`TOTAL: B+8`。

- [ ] **Step 5: 变异反证**

| 变异 | 期望转红 |
| --- | --- |
| `markFailed` 不改状态（`lastDispatchedUnsettled` 仍含该 attempt） | `failureEventCarriesReachedUpstream` |
| `dispatched()` 改成查进程内 `ArrayList` 而不是回放日志 | `dispatchedMarkIsDurableBeforeAnySend`（换实例那一步） |

- [ ] **Step 6: 提交**

```bash
git add core/src/attempt_log.cj core/src/attempt_log_test.cj
git commit -m "feat(core): 尝试先发标记与失败事实落 usage-ledger，标记写不下去就不发"
```

---

## Task 3: `RouteHealth` 三档作用域与冷却（断言 5、6、7、9、32、33、37、38、57）

**Files:**
- Create: `core/src/route_health.cj`
- Create: `core/src/route_health_test.cj`

**Interfaces:**
- Produces:
  - `public class RouteScope { key: String; kind: String }`——`kind ∈ {"upstream","route-set","channel"}`；键分别是 `providerId + "/" + modelId`、`credentialRef`、`transport + "/" + relaySlug`。**三档键里都不含品牌与 `baseUrl`**（断言 57）。
  - `public class RouteHealthView { states: Array<ScopeState>; }`、`public class ScopeState { key: String; kind: String; failures: Int64; notBefore: Int64; coolingLevel: Int64; lastKind: String; lastReachedUpstream: Bool; lastSummary: String; trial: Bool }`。
  - `public class RouteHealth { init(file: String); static forUser(): RouteHealth; view(): RouteHealthView; recordFailure(scope: RouteScope, failure: TransportFailure, category: String, revision: Int64): Unit; recordSuccess(scope: RouteScope): Unit; noteCredentialRotated(credentialRef: String, revision: Int64): Unit; probeDue(now: Int64): Array<RouteScope> }`
  - 事件类型：`route/failed`、`route/cooled`、`route/probed`、`route/recovered`、`route/clamped`（恢复时刻被裁剪）。
- 规则（照 §5.2 表与 §5.3）：
  - 累计 **3 次有效失败** → `cooling`，写 `notBefore`；`notBefore` 优先取供应商证据（`retryAfterSeconds`/`resetEpoch`），否则按 `30min → 1h → 2h → 4h` 逐档抬升，上限 4h，全部可配置。
  - 用户取消、本地参数校验/预算拒绝、工具执行失败**不计入**三次；401/403 **不消耗**三次机会但暂停该 `credentialRef` 作用域且**不定时盲试**；`unknown`（归因不明）**不累加任何一档**。
  - **成功不清零累计失败数**，但恢复正常调度。
  - **落盘的 `notBefore`/下次探测时刻只能是墙钟 epoch 秒**（断言 37）；写入值与写入时刻之差 clamp 到 `cooldown.maxHorizon`（默认 24h），超界时另记 `route/clamped` 且页面标「估算」（断言 38）。
  - 读侧维护**单调不减的时间水位**（本机见过的最大时间戳），把水位作为「现在」的下界——把系统时钟往回拨只会让冷却更早到期，绝不更长（断言 38）。
  - `credentials/rotate` 使 `revision` 变大后，该 `credentialRef` 作用域**立即重新纳入候选**（断言 32）；`credentials/revoke` 转「待绑定凭证」且不可调度（断言 33）。

- [ ] **Step 1: 写失败测试**（要点覆盖，逐条指名）

```cangjie
// 断言 5：第 3 次有效失败 → cooling 且 notBefore 非空；换实例读同一份日志仍在
@Test
func thirdEffectiveFailureCoolsAndSurvivesRestart() { /* 三次 recordFailure + 新实例 view() */ }

// 断言 6：额度类失败升档 route-set——同凭证另一模型也不被调度
@Test
func quotaFailurePausesTheWholeCredentialScope() { /* scope.kind == "route-set" 且键是 credentialRef */ }

// 断言 7：供应商给了 Retry-After 就取该值，没给才走阶梯
@Test
func providerEvidenceBeatsTheBackoffLadder() { /* retryAfterSeconds=17 → notBefore==now+17；无证据 → 30min */ }

// 断言 9：401/403 不消耗三次机会，且不入定时探测队列
@Test
func credentialFailureDoesNotBurnTheThreeStrikes() { /* 连续 5 次 credential 失败，failures 仍是 0；probeDue 不含它 */ }

// 断言 57：号池隔离——同一 baseUrl 两份实例，一份 cooling 不影响另一份
@Test
func oneInstanceCoolingDoesNotPoisonItsTwin() { /* 两个 credentialRef 各一条 state；键里无 name/baseUrl */ }

// 断言 37/38：落盘是墙钟；时钟回拨不延长冷却；超长 Retry-After 被裁剪并记 clamped
@Test
func persistedDeadlinesAreWallClockAndClamped() { /* 注入 now；写 3 天 Retry-After → notBefore <= now+24h */ }
@Test
func clockRollbackShortensRatherThanExtends() { /* 水位取最大值 */ }
```

- [ ] **Step 2: 跑到红 → Step 3: 实现 → Step 4: 跑绿**

Expected：`TOTAL: B+16`（本任务 8 条）。

- [ ] **Step 5: 变异反证（三处）**

| 变异 | 期望转红 |
| --- | --- |
| 冷却计数阈值 3 → 4 | `thirdEffectiveFailureCoolsAndSurvivesRestart` |
| 作用域键改成 `name`/`baseUrl` | `oneInstanceCoolingDoesNotPoisonItsTwin` |
| 落盘改存单调时钟值 | `persistedDeadlinesAreWallClockAndClamped` |

- [ ] **Step 6: 提交**

```bash
git add core/src/route_health.cj core/src/route_health_test.cj
git commit -m "feat(core): 路由健康三档作用域与冷却，notBefore 只落墙钟并带裁剪护栏"
```

---

## Task 4: `ModelRouter` 纯决策（断言 3、4、10、83、84、85）

**Files:**
- Create: `core/src/model_router.cj`
- Create: `core/src/model_router_test.cj`

**Interfaces:**
- Produces:
  - `public class RouteRequest { customModelId: String; needs: Array<String>; promptTokensEstimate: Int64 }`
  - `public class Cursor { var index: Int64 = 0; var weights: Array<Int64> = [] }`——**进程内**可变状态，调用方持有；`ModelRouter` 不持有跨调用状态。
  - `public class RouteDecision { providerId: String; modelId: String; protocol: String; bindingIndex: Int64 }`
  - `public class RouteRejection { code: String; detail: String }`——带类型码：`custom-model-disabled` / `no-enabled-binding` / `provider-disabled` / `binding-dangling` / `capability-unsatisfied` / `credential-unconfigured` / `route-cooling` / `budget-exhausted` / `adapter-unimplemented` / `no-candidate`。
  - `public func route(request: RouteRequest, customs: CustomModelView, providers: ProviderView, health: RouteHealthView, ledger: LedgerView, cursor: Cursor, now: Int64): Either<RouteDecision, RouteRejection>`（仓颉无 `Either` 时用 `class RouteOutcome { decision: Option<RouteDecision>; rejection: Option<RouteRejection> }`——**由开工时核 `std.core` 可用形态决定**，不许两个都留）。
  - `public class LedgerView { reservedByScope: Array<(String, Int64)>; spentByScope: Array<(String, Int64)> }`——B2 只读**注入的**账本视图证纯函数与优先级，接真账本在 B3。
- 过滤链顺序**固定**（§4）：自定义模型 enabled → 供应商 enabled → 绑定 enabled 且非 dangling → 上游 availability 满足能力 → 凭据可解析 → 健康未暂停 → 预算允许 → 按 mode 选一条。任一环不过回**带类型拒绝**。
- 选择算法：
  - `round-robin`：按 `order` 升序循环，游标落在**当前可用集合**内（跳过被排除项，不是「轮到就失败」）。
  - `weighted`：平滑加权轮询（Nginx 式：每次给各候选加 `weight`，选累计最大者并减总权重）。**长期比例可确定断言，不用随机数**。
- **`ModelRouter` 不读真实时钟**（`now` 由调用方注入）、**不做 I/O**、**不写状态**、**不 resolve 凭据**（断言 48 的形态判据：字段集与入参里不出现 `CredentialStore`/`Client`/`HttpRequestBuilder`）。

- [ ] **Step 1: 写失败测试**

```cangjie
// 断言 3：能力不满足的路由永远不进候选，unknown 不算满足
@Test
func capabilityFilterExcludesUnknownNotJustUnsupported() { /* supports=[] 的上游对 requires=[tools] 不可选 */ }

// 断言 4：供应商 enabled=false 后，配置仍在的绑定不可调度
@Test
func disabledProviderIsExcludedButConfigKept() { /* 拒绝码 provider-disabled；绑定条数不变 */ }

// 断言 10 + 84：平滑加权在 sum(weight) 次内每个候选至少被选一次；
// 1000 次后分布逼近权重比（给定容差）；轮询顺序确定可重放
@Test
func smoothWeightedIsProportionalAndStarvationFree() { /* 1:1:100，1000 次里大权重占比 ≥ 容差下界 */ }
@Test
func roundRobinIsDeterministicFromAGivenCursor() { /* 同一游标起点两次跑出同一序列 */ }

// 断言 83：选择器不产持久写——连续选 K 次后 custom-models.log 与
// route-health.log 的条数与 revision 逐字不变
@Test
func selectingNeverWritesToAnyDocument() { /* 记录两文件字节摘要，选 100 次后比对 */ }

// 断言 85：冷启动后前 sum(weight) 次内每个 available 候选各被选中 ≥ 1 次
@Test
func cursorResetIsNotAStarvationExcuse() { /* 每次重建 Cursor 后立刻连选 */ }
```

- [ ] **Step 2: 跑到红 → Step 3: 实现 → Step 4: 跑绿**

Expected：`TOTAL: B+22`（本任务 6 条）。

- [ ] **Step 5: 变异反证（三处）**

| 变异 | 期望转红 |
| --- | --- |
| `unknown` 当满足 | `capabilityFilterExcludesUnknownNotJustUnsupported` |
| 加权选择改成随机 | `smoothWeightedIsProportionalAndStarvationFree` |
| 选择时顺手 `commit` 一条游标事件 | `selectingNeverWritesToAnyDocument` |

- [ ] **Step 6: 提交**

```bash
git add core/src/model_router.cj core/src/model_router_test.cj
git commit -m "feat(core): 路由纯决策，过滤链带类型拒绝与平滑加权无饥饿"
```

---

## Task 5: 宿主每步重新过调度（断言 34、49）

**为什么这是宿主侧改动而不是 core 签名改动**：`core/src/model_agent.cj:105` 的 `start(first, nextProvider: (String) -> Provider, …)` 早就是「每步工厂」形状，`:91` 每次续跑都调它。冻住上游的是**宿主传进去的那个实现**——`{ request => RealSseProvider(baseUrl, turnKey, request, tk) }` 里 `baseUrl` 是外层捕获的常量。

**Files:**
- Modify: `apps/host/src/main.cj`（真实轮次装配段：`let real = DeferredProvider(…)`、`let continuation: (String) -> Provider`、紧随的 `ModelAgentRunner().start(…)`）
- Test: `apps/desktop/test/turn-routing.test.mjs`（新建）

**Interfaces:**
- Produces（宿主内部）：
  - `func resolveRoute(customModelId: String, step: Int64, tk: CancelToken): RouteOutcome`——每步调一次 `ModelRouter.route(...)`，含健康过滤与预算预留；
  - `func providerFor(decision: RouteDecision, tk: CancelToken): Provider`——按协议选适配器（本批只登记 `openai-completions`；其余回 `adapter-unimplemented` 拒绝，**绝不按 OpenAI 形态盲发**，断言 35）；
  - 首步的 `DeferredProvider` 与 `continuation` **两支都走同一个 `resolve` 函数**（§4.1 补注：`continuation` 那一支目前没有包惰性壳）。
- 约束：lambda **不得捕获可变变量却被间接调用**（`turnKey` 那样先 `let` 冻结）；工厂里不得持有「上一步选中的路由」这类可变捕获——每步重新问。

- [ ] **Step 1: 写失败测试**（NDJSON 驱动宿主，两个不同 `baseUrl` 的本地夹具）

```javascript
// 断言 34/49：第 2 步上游失败后可切到另一条路由，续跑闭包不捕获具体上游。
// 夹具：两个本机 HTTP 服务，A 在第 2 步返回 500，B 正常；断言最终正文来自 B，
// 且两边的请求都真的到过（各自计数 ≥ 1）。
test('第二步失败后换到另一条路由，且 core 的 runner 签名未动', async () => { /* … */ });

// 断言 36：产品路径（task/start）缺配置 fail-loud，SACODE_PROVIDER_* 兜底不参与
test('task/start 缺配置硬失败，环境变量影子不再压过用户配置', async () => { /* … */ });
```

- [ ] **Step 2: 跑到红 → Step 3: 改宿主 → Step 4: 跑绿**

构建与打包（**产物名已是 `sacode-host.exe`**）：

```bash
cd /d/Project/sa/saai/sa-code/apps/host && cjpm build > ../../target/b2-t5-build.log 2>&1; echo "build rc=$?"
cd /d/Project/sa/saai/sa-code
node scripts/pack-host.mjs apps/host/target/release/bin/main.exe apps/desktop/dist/host \
  "C:/Users/jingg/stdx-work/stdx-1.1.3.1/windows_x86_64_cjnative/dynamic/stdx" \
  "D:/Program Files/HuaWei/Cangjie/runtime/lib/windows_x86_64_cjnative" > target/b2-t5-pack.log 2>&1; echo "pack rc=$?"
ls -la apps/desktop/dist/host/bin/sacode-host.exe   # 必核 mtime：pack 静默失败会拿旧宿主跑出假象
cd apps/desktop && node --test test/turn-routing.test.mjs > ../../target/b2-t5.log 2>&1; echo "rc=$?"
```

- [ ] **Step 5: 提交**

```bash
git add apps/host/src/main.cj apps/desktop/test/turn-routing.test.mjs
git commit -m "feat(host): 每步重新过调度，续跑工厂不再冻结单上游"
```

---

## Task 6: 冷却后的低频探测与试恢复（断言 11、12、39、50、59）

**Files:**
- Create: `core/src/route_probe.cj`
- Create: `core/src/route_probe_test.cj`

**Interfaces:**
- Produces:
  - `public class ProbePolicy { maxPerDay: Int64; maxPerDayGlobal: Int64; maxHorizonSeconds: Int64 }`（默认 3 / 10 / 86400）
  - `public class RouteProbe { init(settingsDir: String, policy: ProbePolicy); probe(scope: RouteScope, route: ProbeRoute, now: Int64): ProbeResult }`
  - `public class ProbeResult { code: String; detail: String }`——`code ∈ {"ok","probe-in-flight","probe-budget-exhausted","probe-failed"}`。
- **租约三条硬规则**（§5.3，2026-10-05 直读 `core/src/lease.cj` 核对）：
  1. **一个作用域一个租约文件**（`<设置目录>/probe-lease-<作用域键>.lease`）——一份 `route-health.log.lease` 会把不相干的探测串起来；
  2. **没有 TTL**：`takeoverIfStale()` 只在盘上 pid 被 `core/src/procwin.cj:29` 的 `isProcessAlive` 判为确认已死时才接管；pid 被复用时**故意不接管**；**清理滞留租约不允许由程序自动做**；
  3. `acquire()` 是**非阻塞 try-lock**：拿不到立刻回 `probe-in-flight`（不静默跳过、不排队），页面显示「该作用域有在途探测」并提供 `route/probe/run` 人工复核。
- 探测必须**自带有效超时**（沿用 `core/src/model_catalog.cj:101` 的 `readTimeout` 形态）并在 `finally` 里 `release()`。
- 探测预算：每作用域每日 3 条 + **全局 10 条**，**按落盘条数计、与钟无关**（断言 39）；触顶回 `probe-budget-exhausted` 且**不发请求**（断言 59）。
- 探测形态阶梯（§5.3，能省则省）：优先供应商的额度/健康只读接口；不存在才用**最小真实请求**（计入 `usage_kind=probe` 并受预算约束）。**探测发出去的线路 = 被测路由自己的线路**（`direct` 直连，`relay` 走 B4 的通道）。
- 探测成功 → 状态转 `trial`：**只放行一条**正常请求做确认，成功才 `available`，失败回 `cooling` 并抬一档（断言 12）。
- 谁发起：活着的宿主进程跑定时器；**CLI 单发子命令不起后台定时器**，只在 `route/probe/run` 被显式调用时探一次。

- [ ] Step 1–4：红先 → 实现 → 跑绿（`TOTAL: B+28`，本任务 6 条）

```cangjie
// 断言 11：两个进程同探同一作用域只发一次请求（一作用域一租约）
@Test func probeLeaseIsPerScopeAndMutuallyExclusive() { /* 先 acquire 成功、再 acquire 回 probe-in-flight */ }
// 断言 50：A 作用域在途不挡 B 作用域
@Test func oneScopeInFlightDoesNotBlockAnother() { /* 两个 lease 文件 */ }
// 断言 59：全局闸——N 份实例触顶后不再发请求
@Test func globalProbeCapStopsFurtherProbes() { /* 第 11 条回 probe-budget-exhausted 且夹具计数不增 */ }
// 断言 39：钟被改坏也不越预算（按落盘条数计）
@Test func probeBudgetIsCountBasedNotClockBased() { /* 注入瞎跳的 now，条数仍封顶 */ }
// 断言 12：trial 只放行一条
@Test func trialAdmitsExactlyOneRequest() { /* 成功后 available；失败回 cooling 且抬档 */ }
```

- [ ] Step 5：变异反证（去掉租约 → `probeLeaseIsPerScopeAndMutuallyExclusive` 红；去掉全局闸 → `globalProbeCapStopsFurtherProbes` 红）
- [ ] Step 6：提交 `feat(core): 冷却后低频探测与试恢复，一作用域一租约且探测预算按条数计`

---

## Task 7: 取参收敛与 `-32016` 拆码（断言 36、44、69–72）

**Files:**
- Modify: `apps/host/src/main.cj`（两处任务取参循环 + `model/*` 动词的兜底链 + `-32016` 四处归并）
- Modify: `apps/desktop/renderer/pages/model-select.ts`（只列第 3 层；推理等级归属）
- Test: `apps/desktop/test/model-select-source.test.mjs`（新建）

- 五段收口（§2.3 实测表）：① 核心视图字段 ② 写侧签名 ③ 任务取模型（**两处**匹配循环）④ 通道载荷 ⑤ 渲染层类型。收口后 `grep -c "registryView.defaultProviderId && registryView.defaultModel.size" apps/host/src/main.cj` 必须从 **2 收到 0**。
- **`-32016` 一码四义**（同文件 7 处）拆成类型化码：`protocol-not-supported` / `model-not-configured` / `model-credential-unavailable` / 兜底异常各回自己的码（断言 71）；**不新起与旧码同义的名字**。
- 取参只剩一条：任务输入 → 自定义模型 ID → `ModelRouter` → 凭据按 `credentialRef` 现解析；`SACODE_PROVIDER_*` **降为开发态夹具**，在产品路径（`task/start`）**不再参与**取值，缺配置 fail-loud。四处兜底链（任务路径 + `model/*` 分支）**都要收**。
- 生成参数归属（断言 72，按 §16.2 第 13 行默认）：**默认值住在自定义模型条目里**，面板只做「本次覆盖」且不持久；`retainedEffort` 的持久化要去掉，两次任务的参数差异必须能由日志解释。
- CLI 的模型参数**只认自定义模型 ID**，传 `providerId` 或上游模型 ID 直选要被拒（断言 44 的 CLI 半）。

- [ ] Step 1–4：红先 → 实现 → 跑绿（`TOTAL: B+6`，本任务 3 条宿主级 + 3 条渲染层）
- [ ] Step 5：变异反证（保留一处两层指针匹配 → 对应用例红）
- [ ] Step 6：提交 `feat(host,desktop): 任务取参只剩自定义模型一条路，-32016 拆成类型化码`

---

## Task 8: CLI 读同一份配置发起任务（断言 62）

**Files:**
- Modify: `apps/cli/src/main.cj`（新增 `modelcenter` 自检模式；新增单发子命令 `route/probe/run` 的 CLI 形态）
- Test: `apps/cli/src/modelcenter_test.cj`（若 CLI 侧按模式断言，则并入 `main` 的子命令断言集）

- §9.4 的 CLI 四条：① 选到桌面配好的同一条自定义模型并发起真实任务（读同一份 `custom-models.log` 与 `providers.log`，**不写任何本地副本**）；② 看到这次任务的结果与费用（读核心账本，**CLI 侧不做二次累加**）；③ 显式跑一次恢复探测（`route/probe/run`，不起后台定时器）；④ 迁移导出/导入（B5）。
- **允许只在桌面有图形写面**：供应商实例新建与排序、绑定增删与权重、导入差异预览勾选——CLI 不做 CRUD 复制品。
- 两侧都不许有第二套规则：CLI 与渲染层都不能自己挑 provider、不能本地算金额。

- [ ] Step 1–4：红先 → 实现 → 跑绿（CLI `modelcenter` 模式断言数写进基线表）
- [ ] Step 5：提交 `feat(cli): modelcenter 自检与单发探测，读桌面同一份配置发起任务`

---

## 批次出口判据（B2 完成的定义）

全部满足才算 B2 出口，任一不满足就写清卡点继续开着，**不缩范围凑绿**：

1. `cd core && cjpm test` → `TOTAL: B+28`（Task1 5、Task2 3、Task3 8、Task4 6、Task5 0（宿主）、Task6 6；宿主与渲染层用例另计）、`FAILED: 0`、`ERROR: 0`、`rc=0` 且打印 `cjpm test success`。
2. **变异反证全部转红且各自归因到指定用例名**（本计划共 13 处：Task1 两处、Task2 两处、Task3 三处、Task4 三处、Task6 两处、Task7 一处）。任一变异照样全绿 = 该不变量补白盒用例，不许带假绿过出口。
3. 断言 53 **只有在 429 响应头里带 `Retry-After` 的夹具上跑绿才算**（常量注入不算）；断言 55 的 `reachedUpstream` 分档在**直连路径**上可证。
4. `cd apps/desktop && node --test`（全量）rc=0；`npm run ui-smoke` 输出 `UI_SMOKE PASS`（跑前清 `ELECTRON_RUN_AS_NODE`）。
5. 断言 69 的判据：`grep -c "registryView.defaultProviderId && registryView.defaultModel.size" apps/host/src/main.cj` **为 0**。
6. 断言 79–82：重放闸读**日志里的** `attempt/dispatched`；标记写不下去**不发**；`reserve`/`dispatched` 两次短临界区不跨网络；崩溃恢复**不产生第二次上游调用**（夹具 provider 调用计数不增）。
7. 断言 10、83、84、85 各自有绿色用例，且 Task 4 的确定性合同（同文档态 + 同健康态 + 同游标起点 + 同注入时钟）在两次跑里逐字相同。
8. 双入口复验：CLI 与桌面**读同一份配置与账本**（断言 62）；宿主产物重建后 `sacode-host.exe` 的 **mtime 落在本轮**。
9. `git log --oneline` 有本批 8 个提交，每个 `git show --stat` 只含本批路径（并发会话改动未被吞）。

## 明确不在本批

- `UsageLedger` 的金额面（预留/结算/作废/待核算）——B3；B2 只落 `attempt/dispatched` 与 `attempt/failed` 两类事件。
- `TransportChannel` 的 `relay` 形态与 slug 允许集——B4；B2 的探测与请求只走 `direct`。
- 迁移包与差异预览——B5；统计面板——B6。
- 三种协议适配器的**完整实现**：B2 只建 `ProtocolAdapter` 缝与拒绝语义（断言 35），`openai-responses`/`anthropic-messages` 逐个后补；补一个就把它从「不可调度」移到「可调度」，不改规则只改注册表。
