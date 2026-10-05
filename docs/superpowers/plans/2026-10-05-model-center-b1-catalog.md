# SaCode 模型中心 B1「模型目录」实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「供应商 → 上游模型 → 自定义模型」三层目录面在仓颉 `core` 里建成唯一真源，并让宿主协议面与桌面模型页只经这同一套规则读写——本批不做调度、不做计量、不做迁移、不做加速。

**Architecture:** 沿用 `providers.log` 的事件回放 + `expectedRevision` 乐观并发形态（`core/src/provider_registry.cj`），第 2 层继续随供应商记录落同一份日志（不拆真源），第 3 层新开 `custom-models.log` 复用同一套回放/冲突/拒绝分诊。所有新类型的解析、校验、去重都只在 `core` 发生；宿主只提供有限动词，渲染层只做输入采集与呈现，不重述校验。

**Tech Stack:** 仓颉 cjc/cjpm **1.1.3**（cjnative，target `x86_64-w64-mingw32`）；`stdx.encoding.json`；`std.unittest`；桌面侧 Node ≥18 + Electron + Vue **runtime**（`h()` 手写，无模板编译器）。

**Spec:** `docs/superpowers/specs/2026-10-05-model-center-design.md` —— 本计划实现 §2（三层数据模型）、§3 表中 `ModelSettingsDoc`/`CustomModelRegistry` 两行、§9.1 里「自定义模型」「发现与导入」两组动词，以及 §11 断言 1、2、3、4、31、41、46（41、46 是 2026-10-05 覆盖核查后补进本批的：前者钉「跨币种不许用统一单价抹平」，后者钉「参数/预算/探测三组字段随本批落盘、缺省是未设置而不是 0」）。§4 的 `ModelRouter`、§5 的 `RouteHealth`、§7 的 `UsageLedger`、§8 的 `MigrationBundle`、§6 的 relay 属 B2–B5，**本批不得顺手实现，也不得因此删掉它们的需求**。

## Global Constraints

每个任务的要求都隐含本节。

- 仓颉 `cjc`/`cjpm` **1.1.3**；`core/cjpm.toml` 是 `output-type = "static"`，依赖只有 `[target.x86_64-w64-mingw32.bin-dependencies] path-option = ["C:/Users/jingg/stdx-work/stdx-1.1.3.1/windows_x86_64_cjnative/dynamic/stdx"]`。**不新增任何依赖**。
- 会话日志是唯一真源；`append` 只在实例内可见，`flush` 才跨进程持久。文档对象**每次操作都从盘重放**，不缓存进程内视图（`provider_registry.cj:147-200`）。
- 冲突与拒绝必须分开：版本落后 → `settings-conflict`；内容非法 → `settings-rejected`。绝不把前者说成后者（UI 靠它提示「别人先改了」）。
- 读面**永不调度、永不含凭据值**；草稿里出现 `apiKey/api_key/key/token/secret/value` 直接拒（`provider_registry.cj:330-336`）。
- 注释、文档、commit message 一律中文；commit 形如 `feat(core,host): 描述`，scope ∈ `core/host/cli/desktop/extjs/scripts/docs`。
- 不提交构建产物：`target/`、`apps/desktop/dist/`、`npm/dsh-cli-*/bin/`、`*.log`。
- **工作区有并发会话在改源码**：每次只 `git add` 本批路径，用「先 add 再裸 `git commit`」，绝不 `git commit -- <路径>`（那会把别人未落库的 hunk 一起吞了）。提交后 `git show --stat` 核对文件清单。
- 测试红灯要区分「预期红灯」与「真语言坑」：本批红灯的唯一合法形态是**新用例名出现在剥码后 Summary 的 FAILED 列表里**，且 `TOTAL` 比基线恰好多出本批新增条数。
- 计时敏感用例必须独占跑（并发构建/大文件校验会压穿有界轮询窗口造成假红）。本批不含计时用例；若新增了，单独跑。

**基线（HEAD `8a7dc77` 实测，`docs/superpowers/specs/2026-10-05-model-center-design.md` §14）：**

| 面 | 命令 | 基线 |
| --- | --- | --- |
| 核心单测 | `cd core && cjpm test` | **TOTAL 463 / PASSED 462 / SKIPPED 1 / FAILED 0 / ERROR 0** |
| 桌面桥接 | `cd apps/desktop && npm test` | `bridge.test.mjs` **41** 个 `test()`；`preload.cjs` **32** 条 IPC 通道（登记值）→ **2026-10-05 在当前 HEAD 复测 33 条、工作区态 42 条**（goal-control / prompt-enhance 一线在飞）。开工第一件事除了重测 `B`，还要按规格 §9.2 那条**已实测跑通**的 awk 命令重测通道数（HEAD 33 / 工作区 42 是本批实测值；简易正则先后数出过 2、29、37 三个错数，数完必须与规格 §9.2 的名单做双向差集，只核总数核不出漏数），Task 8 里「基线 +9」的算式以重测值为准。在飞那 9 条（`goalDescribe/goalCreate/goalEdit/goalPause/goalResume/goalClear/promptEnhance/promptPoll/promptCancel`）与本批新通道名**逐个比对不重叠** |
| CLI 自检 | `cd apps/cli && cjpm build` 后逐模式 | `all` 100、`stream` 21、`tool` 11、`ext` 8、`cancel` 9、`extjs` 12、`headless` 36、`sig` 6 = **203 PASS** |

读结果的方法固定：输出重定向落盘 → `sed` 剥 ANSI → `tr` 拆行 → 只认剥码后**最后一个** Summary 块里的五个计数，并与退出码交叉验证。**禁止**用 `grep -c '\[ PASSED \]'` 之类的 token 计数判通过。

**行号锚点只当参照，动手前一律用符号重定位**（`grep -n "func X"` 或 `grep -n "let X"`）。实测教训：本计划登记时 `apps/host/src/main.cj` 的四处锚点是 362 / 363-375 / 601 / 630，到复核时同一文件已被别的批次改动，真值变成 355 / 361-372 / 593 / 620——**照旧行号动手会改到别人的代码块里**。`core/src/*.cj` 相对稳（`provider_registry.cj` 的 64 / 367 / 497-527 三处复核未漂），但同样先核再改。

**基线会漂**：本工作区有并发会话在往 `core` 落用例（上一批登记时是 463，别的会话报过 484 这个**工作区态**计数）。所以每个 Step 里写死的 `TOTAL: 4xx` 是**按 `8a7dc77` 提交态**算出来的目标值，不是无条件事实。开工第一件事：

```bash
cd /d/Project/sa/saai/sa-code && git worktree add --detach ../sa-b1-head HEAD > target/b1-worktree.log 2>&1; echo "rc=$?"
cd ../sa-b1-head/core && cjpm test > ../../sa-code/target/b1-baseline.log 2>&1; echo "rc=$?"
```

读到的是**提交态基线** `B`。此后每个任务的期望值改成 `B + 本批到该任务为止的累计新增`（新增条数固定：4、3、9、5、4、4，合计 29），并在出口判据里按同一个 `B` 复算。工作区态计数只能用于「开发中不破坏别人」的参考，**不能当提交级证据**；用完 `git worktree remove ../sa-b1-head`（有残留 target 就先确认再删）。裸跑构建产物时 stdx/runtime DLL 必须与 exe 同目录，或用 **POSIX 形式**（`/c/...` 而不是 `C:/...`）加进 PATH。

---

## 文件结构（本批落点）

| 文件 | 职责 | 本批动作 |
| --- | --- | --- |
| `core/src/provider_registry.cj` | 第 1 层供应商 + 第 2 层上游模型的文档面：解析、校验、回放、乐观并发 | 改：`ModelSpec` 扩能力字段、`ProviderRecord` 扩 `sortOrder/enabled/transport`、新增有默认值的字段读取器 |
| `core/src/custom_model_registry.cj` | **新建**：第 3 层自定义模型与绑定的文档面，含能力适配与重复绑定校验 | 新 |
| `core/src/principal.cj` | **新建**：本地身份（安装 ID），只给新文档面打归属标签，不是登录态 | 新 |
| `core/src/custom_model_registry_test.cj` | 上者的回归用例 | 新 |
| `core/src/provider_capability_test.cj` | 第 2 层能力面 + 老日志向后兼容的用例 | 新 |
| `core/src/upstream_pull.cj` | **新建**：拉取候选与手动添加上游模型的合并规则（纯函数，不碰网络） | 新 |
| `core/src/upstream_pull_test.cj` | 断言 1、2 的用例 | 新 |
| `apps/host/src/main.cj` | 宿主动词分发 | 改：新增「自定义模型」+「发现与导入」两组动词、`initialize.capabilities` 同步声明 |
| `apps/desktop/preload.cjs` | IPC 通道白名单 | 改：按动作新增有限通道 |
| `apps/desktop/test/bridge.test.mjs` | IPC 面回归 | 改：新通道的形状与「无任意方法通道」不变量 |
| `apps/desktop/renderer/pages/models-page.ts` | 模型页 | 改：`validateDraft` 收紧为核心规则的真子集（断言 31） |

---

## Task 1: `ModelSpec` 能力面扩展与老日志向后兼容

**Files:**
- Modify: `core/src/provider_registry.cj:64-78`（`ModelSpec`）、`:367-402`（`parseModels`）、`:497-527`（字段读取器区）
- Test: `core/src/provider_capability_test.cj`（新建）

**Interfaces:**
- Consumes: 现有 `ModelSpec(id, name, contextWindow, maxTokens, image)` 的 5 参调用形态。
- Produces:
  - `public class ModelSpec`，新增只读字段 `inputModalities: Array<String>`、`outputModalities: Array<String>`、`supports: Array<String>`、`meterUnit: String`、`provenance: String`、`availability: String`；
  - 构造器保持向后兼容：**新字段一律用「命名参数 + 默认值」**（形态照抄 `model_catalog.cj:101` 的 `readTimeout!: Duration = Duration.second * 15`），这样 `parseModels` 之外的既有 5 参调用点不需要改；
  - `public func hasCapability(need: String): Bool`（精确匹配，`unknown` 不算满足）；
  - 常量闭集 `modalities` / `capabilityFlags` / `meterUnits` / `provenances` / `availabilities`（文件级 `let`，与 `providerProtocols`（`:41`）同区）。

- [ ] **Step 1: 写失败测试**

新建 `core/src/provider_capability_test.cj`：

```cangjie
package core

import std.collection.*
import std.fs.*
import std.unittest.*

// 第 2 层能力面：能力只能登记，不能由模型名推断；老日志缺字段必须回放成功而不是整份文档作废。
let capFile = "core-test-capability-providers.log"

func capCleanup(): Unit {
    if (exists(capFile)) {
        try { removeIfExists(capFile, recursive: false) } catch (e: Exception) {}
    }
}

// 带能力字段的草稿：只在本用例里拼，形状与模型页提交给宿主的 JSON 一致。
func capDraft(id: String, modelId: String): String {
    return "{\"id\":\"${id}\",\"name\":\"显示名\",\"baseUrl\":\"https://api.example.com/v1\","
        + "\"protocol\":\"openai-completions\",\"credentialRef\":\"SA_KEY\",\"models\":[{"
        + "\"id\":\"${modelId}\",\"name\":\"${modelId}\",\"contextWindow\":\"128k\",\"maxTokens\":\"4k\","
        + "\"image\":false,\"inputModalities\":[\"text\"],\"outputModalities\":[\"text\"],"
        + "\"supports\":[\"tools\",\"stream\"],\"meterUnit\":\"token\",\"provenance\":\"provider-listed\","
        + "\"availability\":\"available\"}]}"
}

@Test
func capabilityFieldsRoundTripThroughTheLog() {
    capCleanup()
    ProviderRegistry(capFile).update(capDraft("step", "m-a"), -1)
    // 换新实例：唯一的证据是盘上那份日志
    let spec = ProviderRegistry(capFile).describe().providers[0].models[0]
    @Expect(spec.inputModalities.size, Int64(1))
    @Expect(spec.inputModalities[0], "text")
    @Expect(spec.outputModalities[0], "text")
    @Expect(spec.supports.size, Int64(2))
    @Expect(spec.meterUnit, "token")
    @Expect(spec.provenance, "provider-listed")
    @Expect(spec.availability, "available")
    capCleanup()
}

@Test
func unknownMeterUnitIsRejectedNotCoerced() {
    capCleanup()
    var thrown = ""
    try {
        ProviderRegistry(capFile).update(
            capDraft("step", "m-a").replace("\"meterUnit\":\"token\"", "\"meterUnit\":\"characters\""), -1)
    } catch (e: Exception) {
        thrown = e.message
    }
    @Expect(thrown, "settings-rejected")
    // 拒绝必须留下完整的前态：坏草稿不能把文档写成半条
    @Expect(ProviderRegistry(capFile).describe().providers.size, Int64(0))
    capCleanup()
}

@Test
func nameLikeAModelDoesNotGrantCapability() {
    capCleanup()
    ProviderRegistry(capFile).update(capDraft("step", "m-a"), -1)
    let spec = ProviderRegistry(capFile).describe().providers[0].models[0]
    // 登记里没有 image-output，名字像也不能算满足
    @Expect(spec.hasCapability("image-output"), false)
    @Expect(spec.hasCapability("tools"), true)
    capCleanup()
}
```

- [ ] **Step 2: 跑到红，并确认红是「缺字段」而不是语法坑**

```bash
cd /d/Project/sa/saai/sa-code/core && cjpm test > ../target/b1-t1.log 2>&1; echo "rc=$?"
```

Expected：`cjpm test` 编译阶段即红（`ModelSpec` 无 `inputModalities` / `hasCapability` 成员）。这符合本仓库的红灯形态——编译器报符号未声明就是这条流水线唯一可行的红灯。若报的是 `expected ';'`、`no matching function for operator '()'` 这类**语法/惯用法**错，先按 `cangjie-compiler-error-to-fix-cookbook` 修测试写法，别去改实现。

- [ ] **Step 3: 加闭集常量与字段**

在 `provider_registry.cj` 的 `providerProtocols`（`:41`）同区追加：

```cangjie
let modalities = ["text", "image", "audio", "video", "embedding"]
let capabilityFlags = ["tools", "stream", "structured-output", "image-output"]
let meterUnits = ["token", "image", "second", "request", "unknown"]
let provenances = ["provider-listed", "user-entered", "human-confirmed", "unknown"]
let availabilities = ["available", "unsupported", "unknown"]
```

`ModelSpec` 改成（**注意 `= []` 不能省**：它是向后兼容的全部凭据）：

```cangjie
public class ModelSpec {
    public let id: String
    public let name: String
    public let contextWindow: String
    public let maxTokens: String
    public let image: Bool
    public let inputModalities: Array<String>
    public let outputModalities: Array<String>
    public let supports: Array<String>
    public let meterUnit: String
    public let provenance: String
    public let availability: String

    public init(id: String, name: String, contextWindow: String, maxTokens: String, image: Bool,
        inputModalities!: Array<String> = [], outputModalities!: Array<String> = [],
        supports!: Array<String> = [], meterUnit!: String = "unknown",
        provenance!: String = "unknown", availability!: String = "unknown") {
        this.id = id
        this.name = name
        this.contextWindow = contextWindow
        this.maxTokens = maxTokens
        this.image = image
        this.inputModalities = inputModalities
        this.outputModalities = outputModalities
        this.supports = supports
        this.meterUnit = meterUnit
        this.provenance = provenance
        this.availability = availability
    }

    // 只认显式登记：`unknown` 在能力过滤里不等于满足，名字像也不算。
    public func hasCapability(need: String): Bool {
        for (c in supports) {
            if (c == need) { return true }
        }
        return false
    }
}
```

`toJson()` 同步补这六个字段——落盘形态与解析形态必须成对，否则回放一次就丢字段。

- [ ] **Step 4: 解析侧读能力字段，缺省走 `unknown`**

`parseModels`（`:367`）里 `ModelSpec(...)` 构造处补：

```cangjie
            let spec = ModelSpec(
                textField(o, "id"), textField(o, "name"), textField(o, "contextWindow"),
                textField(o, "maxTokens"), boolField(o, "image"),
                inputModalities: stringArrayField(o, "inputModalities", modalities),
                outputModalities: stringArrayField(o, "outputModalities", modalities),
                supports: stringArrayField(o, "supports", capabilityFlags),
                meterUnit: enumField(o, "meterUnit", meterUnits, "unknown"),
                provenance: enumField(o, "provenance", provenances, "unknown"),
                availability: enumField(o, "availability", availabilities, "unknown"))
```

在 `:497-527` 的读取器区新增两个私有静态助手，**照 `boolField` 的容错风格但把闭集校验做严**：

```cangjie
    // 数组字段：缺省=空；给了就必须逐个落在闭集里，且不得重复——
    // 静默收下未知值等于把「不认识」伪装成「不支持」。
    private static func stringArrayField(obj: JsonObject, key: String, allowed: Array<String>): Array<String> {
        if (obj.get(key).isNone()) {
            return []
        }
        let arr = obj.get(key).getOrThrow().asArray()
        let out = ArrayList<String>()
        var pos: Int64 = 0
        while (let Some(item) <- arr.get(pos)) {
            pos += 1
            let v = item.asString().getValue()
            var known = false
            for (a in allowed) {
                if (a == v) { known = true }
            }
            if (!known) { throw Exception("settings-rejected") }
            for (seen in out) {
                if (seen == v) { throw Exception("settings-rejected") }
            }
            out.add(v)
        }
        return out.toArray()
    }

    // 单值枚举：缺省或 null 都取 default（老日志没有这个字段，必须回放成功而不是整份作废）
    private static func enumField(obj: JsonObject, key: String, allowed: Array<String>, dflt: String): String {
        if (let Some(v) <- obj.get(key)) {
            if (isNullValue(v)) { return dflt }
            let s = v.asString().getValue()
            for (a in allowed) {
                if (a == s) { return s }
            }
            throw Exception("settings-rejected")
        }
        return dflt
    }
```

- [ ] **Step 5: 补一条「老日志仍可回放」的用例并跑绿**

在 `provider_capability_test.cj` 追加：

```cangjie
@Test
func legacyRecordWithoutCapabilitiesStillReplays() {
    capCleanup()
    // 现有 5 字段形态（今天盘上的样子）：新字段一律缺席
    ProviderRegistry(capFile).update(
        "{\"id\":\"step\",\"name\":\"显示名\",\"baseUrl\":\"https://api.example.com/v1\","
        + "\"protocol\":\"openai-completions\",\"credentialRef\":\"SA_KEY\","
        + "\"models\":[{\"id\":\"m-a\",\"name\":\"m-a\",\"contextWindow\":\"128k\",\"maxTokens\":\"4k\",\"image\":false}]}", -1)
    let spec = ProviderRegistry(capFile).describe().providers[0].models[0]
    @Expect(spec.meterUnit, "unknown")
    @Expect(spec.provenance, "unknown")
    @Expect(spec.availability, "unknown")
    @Expect(spec.inputModalities.size, Int64(0))
    capCleanup()
}
```

```bash
cd /d/Project/sa/saai/sa-code/core && cjpm test > ../target/b1-t1b.log 2>&1; echo "rc=$?"
```

Expected：剥码后最后一个 Summary 为 `TOTAL: 467`（基线 463 + 本任务 4 条）、`PASSED: 466`、`SKIPPED: 1`、`FAILED: 0`、`ERROR: 0`，`rc=0` 且打印 `cjpm test success`。**任一计数对不上就不算过**——尤其是 `TOTAL` 少于 467 意味着用例没被构建 glob 收进去（`core/src/*_test.cj` 按扩展名收文件）。

- [ ] **Step 6: 提交**

```bash
cd /d/Project/sa/saai/sa-code
git add core/src/provider_registry.cj core/src/provider_capability_test.cj
git show --stat --cached   # 必须只有这两个路径
git commit -m "feat(core): 上游模型登记能力面，缺字段一律 unknown 且名字不授予能力"
```

---

## Task 2: `ProviderRecord` 的 `sortOrder` / `enabled` / `transport`

**Files:**
- Modify: `core/src/provider_registry.cj:79-108`（`ProviderRecord`）、`:329-365`（`parseRecordObject`）、`:109-128`（`ProviderView.asJson`）、`:149-200`（回放）、新增 `provider_enabled_test.cj`
- Test: `core/src/provider_enabled_test.cj`（新建）

**Interfaces:**
- Consumes: Task 1 的 `enumField`。
- Produces: `ProviderRecord` 新字段 `sortOrder: Int64`、`enabled: Bool`、`transport: String`（`direct` | `relay`）；`public func setSortOrder(id: String, order: Int64, expectedRevision: Int64): Unit`、`public func setEnabled(id: String, enabled: Bool, expectedRevision: Int64): Unit`（各自落一条事件，**不重写整条记录**）；事件类型 `provider/sort`、`provider/enabled`。

- [ ] **Step 1: 写失败测试**

```cangjie
package core

import std.fs.*
import std.unittest.*

let enFile = "core-test-enabled-providers.log"

func enCleanup(): Unit {
    if (exists(enFile)) {
        try { removeIfExists(enFile, recursive: false) } catch (e: Exception) {}
    }
}

func enDraft(id: String): String {
    return "{\"id\":\"${id}\",\"name\":\"显示名\",\"baseUrl\":\"https://api.example.com/v1\","
        + "\"protocol\":\"openai-completions\",\"credentialRef\":\"SA_KEY\","
        + "\"models\":[{\"id\":\"m-a\",\"name\":\"m-a\",\"contextWindow\":\"128k\",\"maxTokens\":\"4k\",\"image\":false}]}"
}

@Test
func newProviderDefaultsToEnabledDirectWithNoSortHole() {
    enCleanup()
    let r = ProviderRegistry(enFile)
    r.update(enDraft("a"), -1)
    r.update(enDraft("b"), -1)
    let view = ProviderRegistry(enFile).describe()
    @Expect(view.providers[0].enabled, true)
    @Expect(view.providers[0].transport, "direct")
    // 拖动序允许空洞，但新增时必须接在末尾：0、1 而不是 0、0
    @Expect(view.providers[0].sortOrder, Int64(0))
    @Expect(view.providers[1].sortOrder, Int64(1))
    enCleanup()
}

@Test
func disableKeepsEveryOtherFieldAndSurvivesReplay() {
    enCleanup()
    let r = ProviderRegistry(enFile)
    r.update(enDraft("a"), -1)
    r.setEnabled("a", false, r.describe().revision)
    let p = ProviderRegistry(enFile).describe().providers[0]
    @Expect(p.enabled, false)
    @Expect(p.baseUrl, "https://api.example.com/v1")   // 关断不得顺手清空配置
    @Expect(p.models.size, Int64(1))
    enCleanup()
}

@Test
func unknownTransportIsRejected() {
    enCleanup()
    var thrown = ""
    try {
        ProviderRegistry(enFile).update(enDraft("a").replace("\"protocol\":\"openai-completions\"",
            "\"protocol\":\"openai-completions\",\"transport\":\"socks\""), -1)
    } catch (e: Exception) {
        thrown = e.message
    }
    @Expect(thrown, "settings-rejected")
    enCleanup()
}
```

- [ ] **Step 2: 跑到红**

```bash
cd /d/Project/sa/saai/sa-code/core && cjpm test > ../target/b1-t2.log 2>&1; echo "rc=$?"
```

Expected：编译期红在 `setEnabled` / `setSortOrder` / `enabled` 三个未声明符号上。

- [ ] **Step 3: 加字段与「缺省为真」的读取器**

`ProviderRecord` 增三个 `public let` 与新默认参数（同 Task 1 的做法）；`toJson()` 补齐三字段。

关键陷阱：**现有 `boolField`（`:522`）在字段缺席时返回 `false`**，而 `enabled` 的向后兼容缺省是 `true`。直接复用会把所有历史提供商读成「已关断」，等于一次改动让整份目录不可调度。新增：

```cangjie
    // enabled 的缺省必须是 true：盘上的老记录根本没有这个字段，
    // 用 boolField 的「缺席即 false」会把全部历史提供商读成已关断。
    private static func boolFieldDefault(obj: JsonObject, key: String, dflt: Bool): Bool {
        if (let Some(v) <- obj.get(key)) {
            return v.asBool().getValue()
        }
        return dflt
    }

    private static func intField(obj: JsonObject, key: String, dflt: Int64): Int64 {
        if (let Some(v) <- obj.get(key)) {
            if (isNullValue(v)) { return dflt }
            return v.asInt64().getValue()
        }
        return dflt
    }
```

`parseRecordObject`（`:329`）末尾构造改：

```cangjie
        return ProviderRecord(id, name, baseUrl, protocol, ref, declared, models,
            sortOrder: intField(obj, "sortOrder", 0),
            enabled: boolFieldDefault(obj, "enabled", true),
            transport: enumField(obj, "transport", ["direct", "relay"], "direct"))
```

> 缺席时给 0 而非「按插入位置」：真正的排序发生在回放归并（下一步），把默认序塞进解析器会让「读」依赖读序上下文。

- [ ] **Step 4: 回放时按 `sortOrder` 升序出视图，缺席者接末尾**

`reload()`（`:149`）在事件循环结束后、默认指针校验之前插入归一：

```cangjie
        // 视图恒按 sortOrder 升序；未点名（全 0）时保持首次出现序，不制造随机顺序。
        var maxSeen: Int64 = -1
        for (rec in entries) {
            if (rec.sortOrder > maxSeen) { maxSeen = rec.sortOrder }
        }
        var next: Int64 = 0
        let fixed = ArrayList<ProviderRecord>()
        for (rec in entries) {
            if (rec.sortOrder <= 0) {
                fixed.add(rec.withSortOrder(maxSeen < 0 ? next : next))
            } else {
                fixed.add(rec)
            }
            next += 1
        }
        entries = sortRecords(fixed.toArray())
```

其中 `sortRecords` 用**插排**（条目上限 128，且 `provider_registry.cj` 现在没引 `std.sort`；插排零依赖、稳定、可读）：

```cangjie
func sortRecords(src: Array<ProviderRecord>): Array<ProviderRecord> {
    let out = ArrayList<ProviderRecord>()
    for (rec in src) {
        var pos = Int64(out.size)
        while (pos > 0 && out[pos - 1].sortOrder > rec.sortOrder) {
            pos -= 1
        }
        out.insert(pos, rec)
    }
    return out.toArray()
}
```

> 落地前先核一件事：`ArrayList` 的插入方法名与签名（本仓库现有代码里出现过 `.add`、下标赋值；`insert` 是否存在要在 `cangjie-std` 文档里核一遍，**不要靠编译器猜**）。若没有 `insert`，改成先收集再按序重建 `Array`，语义一致。

`ProviderView.asJson()`（`:119`）与 `providerViewJson`（宿主侧 `apps/host/src/main.cj`）都要带上 `sortOrder/enabled/transport` 三个字段，宿主模型页才读得到。

- [ ] **Step 5: 加两个只动一列的写方法**

```cangjie
    // 拖动/关断只改这一列：绝不重写上整条记录，否则会把别处刚改过的 baseUrl 盖回去。
    public func setEnabled(id: String, on: Bool, expectedRevision: Int64): Unit {
        reload()
        guardRevision(expectedRevision)
        if (find(id).id.size == 0) {
            throw Exception("settings-rejected")
        }
        commit("provider/enabled", "{\"providerId\":\"${jsonEscapeText(id)}\",\"enabled\":${if (on) { "true" } else { "false" }}}")
    }
```

`reload()` 的事件分支里补：

```cangjie
            } else if (ev.eventType == "provider/enabled") {
                let target = fieldOfText(ev.data, "providerId")
                let on = ev.data.contains("\"enabled\":true")
                var i = Int64(0)
                while (i < Int64(entries.size)) {
                    if (entries[i].id == target) {
                        entries[i] = entries[i].withEnabled(on)
                    }
                    i += 1
                }
```

`setSortOrder` / `provider/sort` 同形（`withSortOrder`）。`withX` 系列是 `ProviderRecord` 上的复制方法——仓颉的 `class` 字段是 `let`，逐字段重建新实例即可，**不要改成 `var`**（可变共享记录会让回放视图不安全）。

- [ ] **Step 6: 跑绿并核数**

```bash
cd /d/Project/sa/saai/sa-code/core && cjpm test > ../target/b1-t2b.log 2>&1; echo "rc=$?"
```

Expected：`TOTAL: 470`（463 + Task1 的 4 + 本任务 3）、`FAILED: 0`、`ERROR: 0`、`rc=0`。

- [ ] **Step 7: 提交**

```bash
cd /d/Project/sa/saai/sa-code
git add core/src/provider_registry.cj core/src/provider_enabled_test.cj
git show --stat --cached
git commit -m "feat(core): 供应商加排序、硬开关与传输通道，历史盘默认启用"
```

---

## Task 3: `CustomModelRegistry` 文档面（第 3 层）

**Files:**
- Create: `core/src/custom_model_registry.cj`
- Create: `core/src/principal.cj`（本地身份，见 Step 3b）
- Test: `core/src/custom_model_registry_test.cj`（新建）

**Interfaces:**
- Consumes: `SessionLog`（`provider_registry.cj:312-322` 的 commit 形态）、Task 1/2 的字段读取器（**把它们提为文件内 `private static` 不够用——本任务在 `custom_model_registry.cj` 里自带一份同名私有助手，两份保持逐字一致，收口进 `core/src/settings_fields.cj` 留到 B6，本批不做抽象**）。
- Produces:
  - `public class CustomModelRecord { id, name, description: String; enabled: Bool; category: String; requires: Array<String>; bindings: Array<BindingRecord>; mode: String; sortOrder: Int64; params: String; modalityBudget: String; dailyTokens: Int64; monthlyTokens: Int64; dailyAmountMicro: Int64; monthlyAmountMicro: Int64; maxOutputTokens: Int64; probeEnabled: Bool; probeMaxPerDay: Int64 }`（**共 18 个字段**。后 9 个是规格 §2.3「落盘形态在 B1 一次定死」要求随本批存下来的**参数/预算/探测**三组：`params` 与 `modalityBudget` 存**原文 JSON 文本**（空串=未设置，核心不拍平字段名，因为三种协议参数叫法不同、探测单位按 `meterUnit` 各异），五个预算列用 **`-1` 表示「未设置」而 `0` 表示「额度为零、立刻耗尽」**——这两个值的区别正是断言 46 的靶子。B2 读 `probe.*`、B3 读预算列做判定，本批只负责无损落盘与取值校验。）
  - `public class BindingRecord { providerId: String; modelId: String; enabled: Bool; order: Int64; weight: Int64; priceMicro: Int64; priceVersion: Int64; currency: String }`
  - `public class CustomModelView { models: Array<CustomModelRecord>; revision: Int64; writable: Bool }`
  - `public class CustomModelRegistry { init(file: String) / static forUser(): CustomModelRegistry / describe(): CustomModelView / upsert(draft: String, expectedRevision: Int64): Unit / upsertObject(obj: JsonObject, expectedRevision: Int64): Unit / remove(id: String, expectedRevision: Int64): Unit }`（`upsert`/`upsertObject` 成对，与 `provider_registry.cj:272-279` 的 `update`/`updateObject` 关系逐字一致：前者解析文本，后者省一次解析给宿主用）
  - 事件类型：`custom/upsert`、`custom/remove`；错误：`settings-conflict`、`settings-rejected`、`custom-replay-rejected`、`custom-flush-failed`。

- [ ] **Step 1: 写失败测试**

```cangjie
package core

import std.fs.*
import std.unittest.*

// 第 3 层：日常任务只选自定义模型。这一层不认识 baseUrl/凭据，只认 (providerId, modelId)。
let cmFile = "core-test-custom-models.log"

func cmCleanup(): Unit {
    if (exists(cmFile)) {
        try { removeIfExists(cmFile, recursive: false) } catch (e: Exception) {}
    }
}

func cmDraft(id: String, bindings: String): String {
    return "{\"id\":\"${id}\",\"name\":\"编程模型\",\"description\":\"\",\"enabled\":true,"
        + "\"category\":\"coding\",\"requires\":[\"tools\",\"text-output\"],\"mode\":\"weighted\","
        + "\"bindings\":[${bindings}]}"
}

func cmBinding(provider: String, model: String, order: Int64, weight: Int64): String {
    return "{\"providerId\":\"${provider}\",\"modelId\":\"${model}\",\"enabled\":true,"
        + "\"order\":${order},\"weight\":${weight},\"priceMicro\":1000,\"priceVersion\":1,"
        + "\"currency\":\"CNY\"}"
}

@Test
func customModelStartsEmpty() {
    cmCleanup()
    let v = CustomModelRegistry(cmFile).describe()
    @Expect(v.models.size, Int64(0))
    @Expect(v.revision, Int64(0))
    @Expect(v.writable, true)
    cmCleanup()
}

@Test
func customModelUpsertReplaysBindingsVerbatim() {
    cmCleanup()
    CustomModelRegistry(cmFile).upsert(
        cmDraft("code", cmBinding("step", "m-a", 0, 3) + "," + cmBinding("step", "m-b", 1, 1)), -1)
    let rec = CustomModelRegistry(cmFile).describe().models[0]
    @Expect(rec.id, "code")
    @Expect(rec.category, "coding")
    @Expect(rec.requires.size, Int64(2))
    @Expect(rec.mode, "weighted")
    @Expect(rec.bindings.size, Int64(2))
    @Expect(rec.bindings[0].weight, Int64(3))
    @Expect(rec.bindings[1].providerId, "step")
    cmCleanup()
}

@Test
func customModelStaleRevisionIsConflictNotRejection() {
    cmCleanup()
    let r = CustomModelRegistry(cmFile)
    r.upsert(cmDraft("code", cmBinding("step", "m-a", 0, 1)), -1)
    var thrown = ""
    try {
        r.upsert(cmDraft("code", cmBinding("step", "m-b", 0, 1)), 0)   // 落后一位
    } catch (e: Exception) {
        thrown = e.message
    }
    @Expect(thrown, "settings-conflict")
    // 冲突不留半个改动：盘上还应该是 m-a
    @Expect(CustomModelRegistry(cmFile).describe().models[0].bindings[0].modelId, "m-a")
    cmCleanup()
}

@Test
func customModelRejectsUnknownMode() {
    cmCleanup()
    var thrown = ""
    try {
        CustomModelRegistry(cmFile).upsert(
            cmDraft("code", cmBinding("step", "m-a", 0, 1)).replace("\"mode\":\"weighted\"", "\"mode\":\"lottery\""), -1)
    } catch (e: Exception) {
        thrown = e.message
    }
    @Expect(thrown, "settings-rejected")
    cmCleanup()
}

// —— 以下四条对应规格 §2.3「落盘形态在 B1 一次定死」与 §11 断言 41、46 ——

@Test
func paramsBudgetAndProbePolicySurviveReplay() {
    cmCleanup()
    let draft = cmDraft("code", cmBinding("step", "m-a", 0, 1))
        .replace("\"bindings\"",
            "\"params\":\"{\\\"temperature\\\":0.7}\",\"modalityBudget\":\"{\\\"image\\\":50}\","
            + "\"dailyTokens\":200000,\"maxOutputTokens\":8192,\"probeMaxPerDay\":5,\"bindings\"")
    CustomModelRegistry(cmFile).upsert(draft, -1)
    let rec = CustomModelRegistry(cmFile).describe().models[0]
    // 原文无损：核心不拍平参数键、不重新序列化，否则 B2/B3 读到的已经不是用户写的那份
    @Expect(rec.params, "{\"temperature\":0.7}")
    @Expect(rec.modalityBudget, "{\"image\":50}")
    @Expect(rec.dailyTokens, Int64(200000))
    @Expect(rec.maxOutputTokens, Int64(8192))
    @Expect(rec.probeMaxPerDay, Int64(5))
    cmCleanup()
}

@Test
func unsetBudgetReplaysAsMinusOneNotZero() {
    cmCleanup()
    // 普通草稿里根本没有预算列——缺省只能是「未设置」，不能是 0
    CustomModelRegistry(cmFile).upsert(cmDraft("code", cmBinding("step", "m-a", 0, 1)), -1)
    let rec = CustomModelRegistry(cmFile).describe().models[0]
    @Expect(rec.dailyTokens, Int64(-1))
    @Expect(rec.monthlyTokens, Int64(-1))
    @Expect(rec.dailyAmountMicro, Int64(-1))
    @Expect(rec.monthlyAmountMicro, Int64(-1))
    @Expect(rec.maxOutputTokens, Int64(-1))
    @Expect(rec.params, "")
    @Expect(rec.probeEnabled, true)
    @Expect(rec.probeMaxPerDay, Int64(3))
    // 而「有意的零额度」是另一种值，两者必须在盘上区分得开
    CustomModelRegistry(cmFile).upsert(
        cmDraft("code", cmBinding("step", "m-a", 0, 1)).replace("\"bindings\"", "\"dailyTokens\":0,\"bindings\""), 1)
    @Expect(CustomModelRegistry(cmFile).describe().models[0].dailyTokens, Int64(0))
    cmCleanup()
}

@Test
func secretShapedKeyInsideParamsIsRejected() {
    cmCleanup()
    var thrown = ""
    try {
        // 借「自由格式参数」把明文写进第 3 层文档，正是 §8.1 拒绝清单要堵的那类绕行
        CustomModelRegistry(cmFile).upsert(
            cmDraft("code", cmBinding("step", "m-a", 0, 1))
                .replace("\"bindings\"", "\"params\":\"{\\\"api_key\\\":\\\"sk-abcdef\\\"}\",\"bindings\""), -1)
    } catch (e: Exception) {
        thrown = e.message
    }
    @Expect(thrown, "settings-rejected")
    @Expect(CustomModelRegistry(cmFile).describe().models.size, Int64(0))
    cmCleanup()
}

@Test
func twoCurrenciesInOneModelAreRejectedWithoutMerge() {
    cmCleanup()
    let cny = cmBinding("step", "m-a", 0, 1)
    let usd = cmBinding("step", "m-b", 1, 1).replace("\"currency\":\"CNY\"", "\"currency\":\"USD\"")
    var thrown = ""
    try {
        CustomModelRegistry(cmFile).upsert(cmDraft("code", cny + "," + usd), -1)
    } catch (e: Exception) {
        thrown = e.message
    }
    @Expect(thrown, "settings-rejected")
    @Expect(CustomModelRegistry(cmFile).describe().models.size, Int64(0))
    // 未定价（空串）不参与冲突判定，否则 Task 6 的「先导入再填价」立不住
    let free = cmBinding("step", "m-c", 2, 1).replace("\"currency\":\"CNY\"", "\"currency\":\"\"")
    CustomModelRegistry(cmFile).upsert(cmDraft("code", cny + "," + free), -1)
    @Expect(CustomModelRegistry(cmFile).describe().models[0].bindings.size, Int64(2))
    cmCleanup()
}
```

- [ ] **Step 2: 跑到红**

```bash
cd /d/Project/sa/saai/sa-code/core && cjpm test > ../target/b1-t3.log 2>&1; echo "rc=$?"
```

Expected：编译红在 `CustomModelRegistry` / `CustomModelRecord` / `BindingRecord` 未声明上。

- [ ] **Step 3: 写最小可用实现**

`core/src/custom_model_registry.cj` 的骨架，逐段照 `provider_registry.cj` 的形状（文件顶部保留同样的中文注释说明「为什么是事件文档而不是进程状态」）：

```cangjie
package core

import std.collection.*
import std.fs.*
import stdx.encoding.json.*

let customModes = ["round-robin", "weighted"]
let customCategories = ["coding", "general", "vision", "embedding", "other"]
let customRequires = ["tools", "text-output", "image-output", "structured-output", "stream"]

public class BindingRecord {
    public let providerId: String
    public let modelId: String
    public let enabled: Bool
    public let order: Int64
    public let weight: Int64
    public let priceMicro: Int64
    public let priceVersion: Int64
    public let currency: String
    public init(providerId: String, modelId: String, enabled: Bool, order: Int64, weight: Int64,
        priceMicro: Int64, priceVersion: Int64, currency: String) {
        this.providerId = providerId
        this.modelId = modelId
        this.enabled = enabled
        this.order = order
        this.weight = weight
        this.priceMicro = priceMicro
        this.priceVersion = priceVersion
        this.currency = currency
    }
    public func toJson(): String {
        return "{\"providerId\":\"${jsonEscapeText(providerId)}\",\"modelId\":\"${jsonEscapeText(modelId)}\","
            + "\"enabled\":${if (enabled) { "true" } else { "false" }},\"order\":${order},\"weight\":${weight},"
            + "\"priceMicro\":${priceMicro},\"priceVersion\":${priceVersion},\"currency\":\"${jsonEscapeText(currency)}\"}"
    }
}

public class CustomModelRecord {
    public let id: String
    public let name: String
    public let description: String
    public let enabled: Bool
    public let category: String
    public let requires: Array<String>
    public let bindings: Array<BindingRecord>
    public let mode: String
    public let sortOrder: Int64
    // 参数与模态预算是自由格式原文：核心不拍平键名，因为协议间叫法不同（§2.3）
    public let params: String
    public let modalityBudget: String
    // -1 = 未设置，0 = 有意的零额度。这两个值绝不能合并（断言 46）
    public let dailyTokens: Int64
    public let monthlyTokens: Int64
    public let dailyAmountMicro: Int64
    public let monthlyAmountMicro: Int64
    public let maxOutputTokens: Int64
    public let probeEnabled: Bool
    public let probeMaxPerDay: Int64
    public init(id: String, name: String, description: String, enabled: Bool, category: String,
        requires: Array<String>, bindings: Array<BindingRecord>, mode: String,
        sortOrder!: Int64 = 0, params!: String = "", modalityBudget!: String = "",
        dailyTokens!: Int64 = -1, monthlyTokens!: Int64 = -1, dailyAmountMicro!: Int64 = -1,
        monthlyAmountMicro!: Int64 = -1, maxOutputTokens!: Int64 = -1,
        probeEnabled!: Bool = true, probeMaxPerDay!: Int64 = 3) {
        this.id = id
        this.name = name
        this.description = description
        this.enabled = enabled
        this.category = category
        this.requires = requires
        this.bindings = bindings
        this.mode = mode
        this.sortOrder = sortOrder
        this.params = params
        this.modalityBudget = modalityBudget
        this.dailyTokens = dailyTokens
        this.monthlyTokens = monthlyTokens
        this.dailyAmountMicro = dailyAmountMicro
        this.monthlyAmountMicro = monthlyAmountMicro
        this.maxOutputTokens = maxOutputTokens
        this.probeEnabled = probeEnabled
        this.probeMaxPerDay = probeMaxPerDay
    }
    // 逐字段拼回：落盘形态与解析形态必须成对，否则回放一次就丢字段
    public func toJson(): String { /* 十八个字段逐个写出；bindings 用 for + 逗号拼接，形态与 BindingRecord.toJson 逐字一致 */ }
}

public class CustomModelView {
    public let models: Array<CustomModelRecord>
    public let revision: Int64
    public let writable: Bool
    public init(models: Array<CustomModelRecord>, revision: Int64, writable: Bool) {
        this.models = models
        this.revision = revision
        this.writable = writable
    }
    public func asJson(): String {
        return "{\"models\":[${modelsOf(models)}],\"revision\":${revision},\"writable\":${if (writable) { "true" } else { "false" }}}"
    }
}
```

> `CustomModelRecord.toJson()` 与 `modelsOf(...)` 的函数体就是「十八个字段逐个拼 + 数组用逗号串」这一件事，照同文件上方 `BindingRecord.toJson()` 与 `provider_registry.cj:74-77`、`:91-99` 的现成写法逐字同构（含 `jsonEscapeText` 转义）。**这两处是本批唯一允许照抄而不是重写的地方**，因为它们是纯机械序列化，任何 deviation 都会被回放测试当场抓到。

注册表本体：

```cangjie
public class CustomModelRegistry {
    let file: String
    var entries = ArrayList<CustomModelRecord>()
    var revision: Int64 = 0

    public init(file: String) { this.file = file }

    // 与 providers.log 同目录：两个入口解析到同一份文档
    public static func forUser(): CustomModelRegistry {
        let dir = Path(GlobalAppearanceSettings.forUser().settingsPath()).parent.toString()
        return CustomModelRegistry("${dir}/custom-models.log")
    }

    private func reload(): Unit {
        entries = ArrayList<CustomModelRecord>()
        revision = Int64(0)
        if (!exists(file)) { return }
        let log = SessionLog(file)
        if (!log.load()) { throw Exception("custom-replay-rejected") }
        for (ev in log.snapshotEvents()) {
            revision += 1
            if (ev.eventType == "custom/upsert") {
                let rec = parseRecord(ev.data)
                var replaced = false
                var i = Int64(0)
                while (i < Int64(entries.size)) {
                    if (entries[i].id == rec.id) { entries[i] = rec; replaced = true }
                    i += 1
                }
                if (!replaced) { entries.add(rec) }
            } else if (ev.eventType == "custom/remove") {
                let kept = ArrayList<CustomModelRecord>()
                for (rec in entries) {
                    if (rec.id != ev.data) { kept.add(rec) }
                }
                entries = kept
            }
        }
    }

    public func describe(): CustomModelView {
        reload()
        return CustomModelView(entries.toArray(), revision, true)
    }

    public func upsert(draft: String, expectedRevision: Int64): Unit {
        reload()
        guardRevision(expectedRevision)
        let rec = parseRecord(draft)
        commit("custom/upsert", rec.toJson())
    }

    public func remove(id: String, expectedRevision: Int64): Unit {
        reload()
        guardRevision(expectedRevision)
        if (find(id).id.size == 0) { throw Exception("settings-rejected") }
        commit("custom/remove", id)
    }
}
```

`parseRecord` 的校验清单（顺序固定，任一不过 `settings-rejected`）：

1. 禁明文槽位：沿用 `provider_registry.cj:330-336` 那份名单逐个查。
2. `id` 走 `checkId` 同规则（小写字母开头 + `[a-z0-9-]`，≤64）——**把 `checkId` 从 `ProviderRegistry` 的 `private static` 提成文件级 `func checkStableId`，两处共用**；这是本批唯一允许的抽取，因为它不改变行为，只消除「两份实现漂移」的风险。
3. `name` ≤100、`description` ≤500，且都过 `checkText`（拒控制字符）。
4. `category ∈ customCategories`，缺席即拒（第 3 层是新文档，**没有向后兼容负担，一律必填**）。
5. `requires` 走 `stringArrayField` 同规则（闭集、去重），且至少 1 项。
6. `mode ∈ customModes`，缺省 `weighted`。
7. `bindings` 必填、可为空数组（空数组意味着「不可调度」，见 Task 4 的保存即拒），上限 32。
8. 每条绑定：`providerId`/`modelId` 非空、`weight` ∈ 1..1000、`priceMicro >= 0`、`enabled` 缺省 `true`。**`currency` 允许空串，语义是「未定价」；给了就必须是 3 位大写字母。`priceVersion: 0` 同义「未定价」**——这两个缺省是 Task 6 的导入操作能成立的前提：从上游清单导入时用户还没填价，若此处强制必填币种，导入就只能凭空造一个假单价（§7 明令禁止「用统一单价把金额算错」，账本侧对应用 `待核算` 状态承接）。
9. **同一模型内非空 `currency` 至多一种**（断言 41）。空串（未定价）不计入这个「至多一种」。规则不是「禁止混币」而是「禁止用统一单价把金额算错」：真要跨币得由 §2.3 的显式换算登记来承载，那是 B5/B6 的面，本批先按保存即拒守住，**绝不静默折算**。
10. `params` 与 `modalityBudget` 是**自由格式 JSON 原文**，本批只做三件事：长度上限（各 ≤4000 字符）、过 §1 那份明文字段名单的逐个查（`api_key`/`token`/`secret`/`value` 之类出现在参数文本里就 `settings-rejected`，断言 46 第三条用例）、**逐字无损回读**（解析成 JSON 只为校验能解析，落盘写的还是用户给的那串；重新序列化会重排键序，B2/B3 读到的就不是用户写的那份）。**不拆成固定字段**——三种协议参数叫法不同，核心不发明上游没有的键（§2.3）。
11. 预算与探测列：新增文件级私有助手 `intFieldDefault(obj, key, dflt)`（照 Task 2 的 `boolFieldDefault` 同一形态——**缺字段返回缺省值，而不是返回 0**，这是断言 46 第二条用例的立足点）。预算列合法域是 `-1 | >= 0`（`-1` = 未设置，`0` = 有意的零额度，其它负数 `settings-rejected`）；`probeMaxPerDay ∈ 0..100`（`0` 表示不排定时探测，`route/probe/run` 的手动通道仍可用，与 §5.3「软件全关时不继续产生探测费用」同一口径）；`probeEnabled` 缺省 `true`。

- [ ] **Step 3b: 把本地身份缝进写入（§2.4 要求「现在就缝好，但不建设账号」）**

自检规格覆盖时发现这条原本漏了，现补进本任务。新建 `core/src/principal.cj`：

```cangjie
package core

import std.fs.*
import std.collection.*
import stdx.crypto.crypto.*
import stdx.encoding.hex.*

// 本地身份只是「归属标签」，不是登录态：它回答「这条记录属于本机哪个安装」，
// 不回答「谁能读写」。未来接入账号体系时，绑定账号是一次显式的 owner 重映射，
// 绝不按名称合并，也不因登录把本地数据自动上云。
public class Principal {
    public let kind: String               // 本批恒为 "local"
    public let installationId: String

    public init(kind: String, installationId: String) {
        this.kind = kind
        this.installationId = installationId
    }

    // 安装 ID 落设置目录里一个独立小文件，不进任何文档日志：它是归属依据，
    // 不该跟着 custom-models.log 一起被导出/导入（§8.4 同一条纪律）。
    public static func forUser(): Principal {
        let dir = Path(GlobalAppearanceSettings.forUser().settingsPath()).parent.toString()
        let file = "${dir}/installation-id"
        if (exists(file)) {
            let log = SessionLog(file)
            if (log.load()) {
                let events = log.snapshotEvents()
                if (Int64(events.size) > 0) {
                    return Principal("local", events[Int64(0)].data)
                }
            }
        }
        let generated = randomInstallationId()
        let fresh = SessionLog(file)
        fresh.append("principal/install", generated)
        if (!fresh.flush()) { throw Exception("principal-write-failed") }
        return Principal("local", generated)
    }
}

func randomInstallationId(): String {
    let r = SecureRandom()
    let bytes = Array<Byte>(16, repeat: 0)
    r.nextBytes(bytes)
    return toHexString(bytes)    // 32 位十六进制；B0 已实测 SecureRandom 与 hex 都可用（规格 §15）
}
```

`CustomModelRegistry` 的读写都带 principal 作用域：

- `init(file: String, owner!: String = "")`；`forUser()` 传 `Principal.forUser().installationId`。
- `commit` 的事件 data 外层多写一个 `"ownerId":"${owner}"` 字段。**只有新文档面带它**——`providers.log` 是既有的第 1/2 层文档，本批不动它的落盘形态，否则会把别人已有的历史盘读坏。
- `reload()` 的事件循环开头加：`if (owner.size > 0 && fieldOfText(ev.data, "ownerId") != owner) { continue }`——**别人的条目当不存在，不报错也不合并**。

用例追加到 `custom_model_registry_test.cj`（本任务计数因此从 4 条变 5 条，Step 4 期望值随之 +1）：

```cangjie
@Test
func entriesOfAnotherOwnerAreInvisibleButNotDestroyed() {
    cmCleanup()
    // 同一份日志、两个 owner 各写一条：各自只看得见自己那条
    CustomModelRegistry(cmFile, owner: "inst-a").upsert(cmDraft("code", ""), -1)
    CustomModelRegistry(cmFile, owner: "inst-b").upsert(cmDraft("other", ""), -1)
    let a = CustomModelRegistry(cmFile, owner: "inst-a").describe()
    @Expect(a.models.size, Int64(1))
    @Expect(a.models[0].id, "code")
    // 第二个 owner 的写入没抹掉第一条：日志仍是两条事件，revision 跨 owner 一起涨
    @Expect(CustomModelRegistry(cmFile, owner: "inst-b").describe().revision, a.revision)
    cmCleanup()
}
```

> `revision` 的语义要如实：它是**日志事件条数**，跨 owner 也一起涨（乐观并发认的是文档版本，不是可见条目数）。两个入口并发写同一份 `custom-models.log` 时后写者拿 `settings-conflict` 是**正确行为**，实现时别把它「优化」成按 owner 分别计版本。

- [ ] **Step 4: 跑绿**

```bash
cd /d/Project/sa/saai/sa-code/core && cjpm test > ../target/b1-t3b.log 2>&1; echo "rc=$?"
```

Expected：`TOTAL: 479`（+9）、`FAILED: 0`、`rc=0`。

- [ ] **Step 5: 提交**

```bash
cd /d/Project/sa/saai/sa-code
git add core/src/custom_model_registry.cj core/src/principal.cj core/src/custom_model_registry_test.cj core/src/provider_registry.cj
git show --stat --cached
git commit -m "feat(core): 自定义模型文档面，绑定只认 providerId 与 modelId"
```

---

## Task 4: 绑定校验——重复绑定拒、能力不适配拒、dangling 可见

**Files:**
- Modify: `core/src/custom_model_registry.cj`（新增 `binding/upsert|remove|reorder` 与跨文档校验）
- Test: `core/src/custom_binding_test.cj`（新建）

**Interfaces:**
- Consumes: `ProviderRegistry.describe(): ProviderView`（含 Task 1 的 `hasCapability` 与 Task 2 的 `enabled`）、`CustomModelRegistry`（Task 3）。
- Produces: `public func upsertBinding(customId: String, bindingJson: String, providers: ProviderView, expectedRevision: Int64): Unit`、`public func removeBinding(customId: String, providerId: String, modelId: String, expectedRevision: Int64): Unit`、`public func reorderBindings(customId: String, orderedKeys: Array<String>, expectedRevision: Int64): Unit`、`public func isDangling(b: BindingRecord, providers: ProviderView): Bool`。绑定唯一键 `providerId + "/" + modelId`。

- [ ] **Step 1: 写失败测试**

```cangjie
package core

import std.fs.*
import std.unittest.*

let bdFile = "core-test-binding-providers.log"
let bcFile = "core-test-binding-customs.log"

func bdCleanup(): Unit {
    for (f in [bdFile, bcFile]) {
        if (exists(f)) {
            try { removeIfExists(f, recursive: false) } catch (e: Exception) {}
        }
    }
}

// 三条上游：m-a 能 tools 且明确 available；m-img 只会出图；m-old 能力字段整段缺席（= unknown）
func bdSpec(id: String, caps: String): String {
    return "{\"id\":\"${id}\",\"name\":\"${id}\",\"contextWindow\":\"128k\",\"maxTokens\":\"4k\",\"image\":false${caps}}"
}

func bdSeedProviders(): Unit {
    let m = bdSpec("m-a", ",\"inputModalities\":[\"text\"],\"outputModalities\":[\"text\"],"
        + "\"supports\":[\"tools\",\"stream\"],\"meterUnit\":\"token\",\"provenance\":\"human-confirmed\","
        + "\"availability\":\"available\"")
        + "," + bdSpec("m-img", ",\"inputModalities\":[\"text\"],\"outputModalities\":[\"image\"],"
        + "\"supports\":[\"image-output\"],\"meterUnit\":\"image\",\"provenance\":\"human-confirmed\","
        + "\"availability\":\"available\"")
        + "," + bdSpec("m-old", "")
    ProviderRegistry(bdFile).update(
        "{\"id\":\"step\",\"name\":\"显示名\",\"baseUrl\":\"https://api.example.com/v1\","
        + "\"protocol\":\"openai-completions\",\"credentialRef\":\"SA_KEY\",\"models\":[${m}]}", -1)
}

@Test
func sameUpstreamModelCannotBindTwice() {
    bdCleanup()
    bdSeedProviders()
    let r = CustomModelRegistry(bcFile)
    r.upsert(cmDraft("code", cmBinding("step", "m-a", 0, 1)), -1)
    var thrown = ""
    try {
        r.upsertBinding("code", cmBinding("step", "m-a", 1, 1), ProviderRegistry(bdFile).describe(), r.describe().revision)
    } catch (e: Exception) {
        thrown = e.message
    }
    @Expect(thrown, "settings-rejected")
    @Expect(CustomModelRegistry(bcFile).describe().models[0].bindings.size, Int64(1))
    bdCleanup()
}

@Test
func imageOnlyModelCannotEnterAToolsModel() {
    bdCleanup()
    bdSeedProviders()
    let r = CustomModelRegistry(bcFile)
    r.upsert(cmDraft("code", ""), -1)
    var thrown = ""
    try {
        r.upsertBinding("code", cmBinding("step", "m-img", 0, 1), ProviderRegistry(bdFile).describe(), r.describe().revision)
    } catch (e: Exception) {
        thrown = e.message
    }
    @Expect(thrown, "settings-rejected")
    bdCleanup()
}

@Test
func unknownCapabilityOnUpstreamIsNotSufficient() {
    bdCleanup()
    bdSeedProviders()
    let r = CustomModelRegistry(bcFile)
    r.upsert(cmDraft("code", ""), -1)
    // m-old 的 availability 是 unknown：不认识不等于支持
    var thrown = ""
    try {
        r.upsertBinding("code", cmBinding("step", "m-old", 0, 1), ProviderRegistry(bdFile).describe(), r.describe().revision)
    } catch (e: Exception) {
        thrown = e.message
    }
    @Expect(thrown, "settings-rejected")
    bdCleanup()
}

@Test
func bindingToRemovedProviderStaysVisibleButDangling() {
    bdCleanup()
    bdSeedProviders()
    let pr = ProviderRegistry(bdFile)
    let r = CustomModelRegistry(bcFile)
    r.upsert(cmDraft("code", cmBinding("step", "m-a", 0, 1)), -1)
    pr.remove("step", pr.describe().revision)
    let view = CustomModelRegistry(bcFile).describe().models[0]
    @Expect(view.bindings.size, Int64(1))        // 配置不丢
    @Expect(r.isDangling(view.bindings[0], ProviderRegistry(bdFile).describe()), true)
    bdCleanup()
}

@Test
func reorderRequiresTheExactSameKeySet() {
    bdCleanup()
    bdSeedProviders()
    let r = CustomModelRegistry(bcFile)
    r.upsert(cmDraft("code", cmBinding("step", "m-a", 0, 1) + "," + cmBinding("step", "m-old", 1, 1)), -1)
    // 少给一段：半途重排比不重排更糟，必须整条拒
    var thrown = ""
    try {
        r.reorderBindings("code", ["step/m-a"], r.describe().revision)
    } catch (e: Exception) {
        thrown = e.message
    }
    @Expect(thrown, "settings-rejected")
    bdCleanup()
}

// 与 Task 3 的测试文件同名同形：std.unittest 的用例文件各自独立编译，
// 跨文件共享 helper 会撞符号名，所以这里自带一份副本（三行，不值得为它建 helper 模块）。
func cmDraft(id: String, bindings: String): String {
    return "{\"id\":\"${id}\",\"name\":\"编程模型\",\"description\":\"\",\"enabled\":true,"
        + "\"category\":\"coding\",\"requires\":[\"tools\",\"text-output\"],\"mode\":\"weighted\","
        + "\"bindings\":[${bindings}]}"
}

func cmBinding(provider: String, model: String, order: Int64, weight: Int64): String {
    return "{\"providerId\":\"${provider}\",\"modelId\":\"${model}\",\"enabled\":true,"
        + "\"order\":${order},\"weight\":${weight},\"priceMicro\":1000,\"priceVersion\":1,"
        + "\"currency\":\"CNY\"}"
}
```

> `imageOnlyModelCannotEnterAToolsModel` 里 `m-img` 之所以必须被拒：`requires` 含 `tools`，而它的 `supports` 只有 `image-output`。**别把这条改成「名字里带 img 就拒」**——那是 §2.2 明令禁止的名称推断。

- [ ] **Step 2: 跑到红**

```bash
cd /d/Project/sa/saai/sa-code/core && cjpm test > ../target/b1-t4.log 2>&1; echo "rc=$?"
```

Expected：编译红在 `upsertBinding` / `removeBinding` / `reorderBindings` / `isDangling` 四个未声明符号上。

- [ ] **Step 3: 实现能力适配判据（这是断言 3 的保存侧对应物）**

```cangjie
    // 保存时就拒，而不是等调度器在运行时静默跳过：
    // 用户配错了要当场知道，不该等到任务失败。
    private func fitsRequirements(rec: CustomModelRecord, b: BindingRecord, providers: ProviderView): Bool {
        if (isDangling(b, providers)) { return false }
        let spec = providerModel(b.providerId, b.modelId, providers)
        if (spec.availability != "available") { return false }
        for (need in rec.requires) {
            if (!spec.hasCapability(need)) { return false }
        }
        if (rec.requires.contains("image-output") && !spec.outputModalities.contains("image")) {
            return false
        }
        return true
    }
```

`providerModel` 在 `providers` 里按 `id` 找记录、再按 `modelId` 找 `ModelSpec`，找不到返回一个 `availability == "unknown"` 的空 spec（**空值不特殊放行**，与 §2.2「unknown 不等于满足」同一条纪律）。

- [ ] **Step 4: 实现三个绑定写方法**

`upsertBinding`：`reload()` → `guardRevision` → 找到 `customId`（不存在即 `settings-rejected`）→ 唯一键查重（存在即 `settings-rejected`）→ `fitsRequirements`（不过即 `settings-rejected`）→ 用「原绑定数组 + 新绑定」重建记录 → `commit("custom/upsert", rec.toJson())`（**落一条事件而不是新事件类型**：自定义模型的绑定属于同一条文档记录，一次改动一条事实）。

`removeBinding` / `reorderBindings` 同形；`reorderBindings` 的 `orderedKeys` 必须与现存键集**逐一对应**，多一个少一个都 `settings-rejected`（半途重排比不重排更糟）。

`isDangling` 只看 `providers` 里有无该 `providerId`——注意**它不做拒绝**，供读面与后续 B2 的过滤链用（供应商删了要显示，不要静默丢配置）。

- [ ] **Step 5: 跑绿**

```bash
cd /d/Project/sa/saai/sa-code/core && cjpm test > ../target/b1-t5b.log 2>&1; echo "rc=$?"
```

Expected：`TOTAL: 484`（463 + Task1 4 + Task2 3 + Task3 9 + 本任务 5）、`FAILED: 0`、`rc=0`。

- [ ] **Step 6: 变异反证（本任务的核心不变量不能是假绿）**

依次施加四处变异，每次跑 `cjpm test` 并要求**指定用例名转红**，改回后复跑回绿：

| 变异 | 期望转红的用例 |
| --- | --- |
| `fitsRequirements` 里把 `spec.availability != "available"` 改成 `== "unsupported"` | `unknownCapabilityOnUpstreamIsNotSufficient` |
| 唯一键查重循环整段注释掉 | `sameUpstreamModelCannotBindTwice` |
| `isDangling` 直接 `return false` | `bindingToRemovedProviderStaysVisibleButDangling` |
| `reorderBindings` 的键集相等校验改成只比长度 | `reorderRequiresTheExactSameKeySet` |

```bash
cd /d/Project/sa/saai/sa-code/core && cjpm test > ../target/b1-t5-mut1.log 2>&1; echo "rc=$?"
# 只认剥码后 Summary 里 FAILED 的那一个用例名；红了才说明这条不变量真被钉住
```

任一变异**照样全绿 = 该断言是假绿**，必须补一条能直接控制输入的白盒用例再继续，别把这条当通过。

- [ ] **Step 7: 提交**

```bash
cd /d/Project/sa/saai/sa-code
git add core/src/custom_model_registry.cj core/src/custom_binding_test.cj
git show --stat --cached
git commit -m "feat(core): 绑定唯一键去重与能力适配保存即拒，供应商删除转 dangling"
```

---

## Task 5: 拉取候选去重与手动添加上游模型

**Files:**
- Create: `core/src/upstream_pull.cj`
- Test: `core/src/upstream_pull_test.cj`（新建）
- Modify: `core/src/provider_registry.cj`（新增 `mergePulled` / `addUpstreamModel` 两个写方法）

**Interfaces:**
- Consumes: `ModelCatalog.fetch(baseUrl, apiKey, readTimeout!): Array<String>`（`model_catalog.cj:101`，坏响应抛 `bad-model-catalog` / `http-status:*` / `model-catalog-request-failed`）、Task 1 的 `ModelSpec`。
- Produces: `public func mergePulledIds(existing: Array<ModelSpec>, ids: Array<String>): Array<ModelSpec>`（纯函数）、`public func mergeManualIds(existing: Array<ModelSpec>, ids: Array<String>): Array<ModelSpec>`、`public func addUpstreamModel(providerId: String, modelId: String, expectedRevision: Int64): Unit`。

- [ ] **Step 1: 写失败测试**

```cangjie
package core

import std.fs.*
import std.unittest.*

// 拉取通道的两条硬规矩：重复拉不增条数；坏响应一条都不写。
let upFile = "core-test-pull-providers.log"

func upCleanup(): Unit {
    if (exists(upFile)) {
        try { removeIfExists(upFile, recursive: false) } catch (e: Exception) {}
    }
}

func upDraft(modelIds: String): String {
    var models = ""
    for (m in modelIds.split(",")) {
        if (models.size > 0) { models += "," }
        models += "{\"id\":\"${m}\",\"name\":\"${m}\",\"contextWindow\":\"128k\",\"maxTokens\":\"4k\",\"image\":false}"
    }
    return "{\"id\":\"step\",\"name\":\"显示名\",\"baseUrl\":\"https://api.example.com/v1\","
        + "\"protocol\":\"openai-completions\",\"credentialRef\":\"SA_KEY\",\"models\":[${models}]}"
}

@Test
func mergePulledIsIdempotentAndKeepsExistingMetadata() {
    // 在册条目：人工确认过能力的 m-a
    let existing: Array<ModelSpec> = [ModelSpec("m-a", "已改名", "128k", "4k", false,
        outputModalities: ["text"], provenance: "human-confirmed")]
    let twice = mergePulledIds(mergePulledIds(existing, ["m-a", "m-b"]), ["m-a", "m-b", "m-c"])
    @Expect(twice.size, Int64(3))
    // 已在册的条目必须原样保留：人工确认过的能力面不能被一次拉取冲掉
    @Expect(twice[0].name, "已改名")
    @Expect(twice[0].provenance, "human-confirmed")
    // 新拉到的条目一律 unknown 且 provenance=provider-listed，不许自动启用
    @Expect(twice[1].provenance, "provider-listed")
    @Expect(twice[1].availability, "unknown")
    @Expect(twice[1].meterUnit, "unknown")
    @Expect(twice[2].id, "m-c")
}

@Test
func mergePulledIgnoresBlankAndDuplicateEntriesInOneResponse() {
    let none: Array<ModelSpec> = []
    let out = mergePulledIds(none, ["m-a", "m-a", "", "  "])
    @Expect(out.size, Int64(1))
}

@Test
func manualAddUsesUserEnteredProvenanceAndSameDedupe() {
    let none: Array<ModelSpec> = []
    let one = mergeManualIds(none, ["m-x"])
    @Expect(one[0].provenance, "user-entered")
    @Expect(mergeManualIds(one, ["m-x"]).size, Int64(1))
}
```

> 空数组字面量必须显式标注成 `Array<ModelSpec>`：`mergePulledIds([], ...)` 让推断器没有落点，会报类型推断失败。`upCleanup` 之外这三条用例都是纯函数用例，不碰盘，所以不写清理调用。

- [ ] **Step 2: 跑到红**

```bash
cd /d/Project/sa/saai/sa-code/core && cjpm test > ../target/b1-t5.log 2>&1; echo "rc=$?"
```

Expected：编译红在 `mergePulledIds` / `mergeManualIds` 未声明。

- [ ] **Step 3: 实现纯函数**

`core/src/upstream_pull.cj`：

```cangjie
package core

import std.collection.*

func specsOf(arr: Array<ModelSpec>): ArrayList<ModelSpec> {
    let out = ArrayList<ModelSpec>()
    for (s in arr) { out.add(s) }
    return out
}

func knownId(list: ArrayList<ModelSpec>, id: String): Bool {
    for (s in list) {
        if (s.id == id) { return true }
    }
    return false
}

// trim 后为空、或在册的一律跳过：拉取是「补候选」，不是「覆盖人工确认」。
func appendIds(list: ArrayList<ModelSpec>, ids: Array<String>, provenance: String): Unit {
    for (raw in ids) {
        let id = raw.trim()
        if (id.size == 0 || id.size > 200 || knownId(list, id)) { continue }
        list.add(ModelSpec(id, id, "", "", false, provenance: provenance))
    }
}

public func mergePulledIds(existing: Array<ModelSpec>, ids: Array<String>): Array<ModelSpec> {
    let list = specsOf(existing)
    appendIds(list, ids, "provider-listed")
    return list.toArray()
}

public func mergeManualIds(existing: Array<ModelSpec>, ids: Array<String>): Array<ModelSpec> {
    let list = specsOf(existing)
    appendIds(list, ids, "user-entered")
    return list.toArray()
}
```

> `contextWindow`/`maxTokens` 留空串是合法的：`checkCapacity`（`provider_registry.cj:451-480`）对空串直接 `return`，语义是「用提供商默认值」。

- [ ] **Step 4: 加注册表写方法，把「坏响应不写目录」钉在动词层**

```cangjie
    // 拉取失败由调用方（宿主动词）负责捕获；这里只在拿到好清单后才落盘。
    public func applyPulledModels(providerId: String, ids: Array<String>, expectedRevision: Int64): Unit {
        reload()
        guardRevision(expectedRevision)
        let rec = find(providerId)
        if (rec.id.size == 0) { throw Exception("settings-rejected") }
        let merged = mergePulledIds(rec.models, ids)
        if (Int64(merged.size) > 128) { throw Exception("settings-rejected") }
        commit("provider/upsert", rec.withModels(merged).toJson())
    }

    public func addUpstreamModel(providerId: String, modelId: String, expectedRevision: Int64): Unit {
        reload()
        guardRevision(expectedRevision)
        let rec = find(providerId)
        if (rec.id.size == 0) { throw Exception("settings-rejected") }
        let merged = mergeManualIds(rec.models, [modelId])
        if (Int64(merged.size) == Int64(rec.models.size)) { throw Exception("settings-rejected") }  // 已在册不是成功，是没发生
        commit("provider/upsert", rec.withModels(merged).toJson())
    }
```

- [ ] **Step 5: 补一条「坏响应一条不写」的用例并跑绿**

`ModelCatalog.ids(body)` 是纯解析入口（`model_catalog.cj` 内），直接喂非 JSON：

```cangjie
@Test
func badCatalogBodyThrowsInsteadOfReportingZeroModels() {
    var thrown = ""
    var count = Int64(-1)
    try {
        count = Int64(ModelCatalog.ids("{\"data\":null}").size)
    } catch (e: Exception) {
        thrown = e.message
    }
    // 「0 个模型」和「读不出模型」是两件事：后者必须抛，不能报空
    @Expect(thrown, "bad-model-catalog")
    @Expect(count, Int64(-1))
}
```

```bash
cd /d/Project/sa/saai/sa-code/core && cjpm test > ../target/b1-t5c.log 2>&1; echo "rc=$?"
```

Expected：`TOTAL: 488`（+4）、`FAILED: 0`、`rc=0`。（若 `ModelCatalog.ids` 当前是私有的，就把它提为 `public`，这是本任务唯一允许的可见性放宽，且必须只放宽这一个方法。）

- [ ] **Step 6: 提交**

```bash
cd /d/Project/sa/saai/sa-code
git add core/src/upstream_pull.cj core/src/upstream_pull_test.cj core/src/provider_registry.cj core/src/model_catalog.cj
git show --stat --cached
git commit -m "feat(core): 拉取上游模型按 ID 去重且不冲人工确认，手动添加另记 provenance"
```

---

## Task 6: 两种导入操作——各建一个新模型 vs 加入已有模型

**Files:**
- Modify: `core/src/custom_model_registry.cj`
- Test: `core/src/custom_import_test.cj`（新建）

**Interfaces:**
- Consumes: `Task 4` 的 `fitsRequirements`/`upsertBinding` 判据、`Task 3` 的 `upsert`、`ProviderView`。
- Produces: `public func importNewModels(items: Array<String>, providers: ProviderView, expectedRevision: Int64): Array<String>`（返回新建的自定义模型 id，一条输入一个条目）、`public func importInto(customId: String, items: Array<String>, providers: ProviderView, expectedRevision: Int64): Int64`（返回**实际新增**的绑定条数）。`items` 每项是 `providerId/modelId`。

- [ ] **Step 1: 写失败测试**

```cangjie
package core

import std.fs.*
import std.unittest.*

let imFile = "core-test-import-customs.log"
let imP = "core-test-import-providers.log"

func imCleanup(): Unit {
    for (f in [imFile, imP]) {
        if (exists(f)) {
            try { removeIfExists(f, recursive: false) } catch (e: Exception) {}
        }
    }
}

@Test
func importNewMakesOneModelPerItem() {
    imCleanup()
    let ids = CustomModelRegistry(imFile).importNewModels(["step/m-a", "step/m-b"], ProviderRegistry(imP).describe(), -1)
    @Expect(ids.size, Int64(2))
    @Expect(CustomModelRegistry(imFile).describe().models.size, Int64(2))
    @Expect(CustomModelRegistry(imFile).describe().models[0].bindings.size, Int64(1))
    imCleanup()
}

@Test
func repeatedImportOfSameBundleAddsNothing() {
    imCleanup()
    let r = CustomModelRegistry(imFile)
    r.importNewModels(["step/m-a"], ProviderRegistry(imP).describe(), -1)
    let again = r.importNewModels(["step/m-a"], ProviderRegistry(imP).describe(), r.describe().revision)
    @Expect(again.size, Int64(0))                       // 幂等：不重复创建
    @Expect(CustomModelRegistry(imFile).describe().models.size, Int64(1))
    imCleanup()
}

@Test
func importIntoSkipsExistingAndCountsOnlyNewOnes() {
    imCleanup()
    let r = CustomModelRegistry(imFile)
    r.upsert(cmDraft("code", cmBinding("step", "m-a", 0, 1)), -1)
    let added = r.importInto("code", ["step/m-a", "step/m-c"], ProviderRegistry(imP).describe(), r.describe().revision)
    @Expect(added, Int64(1))
    @Expect(CustomModelRegistry(imFile).describe().models[0].bindings.size, Int64(2))
    imCleanup()
}

@Test
func importIntoRejectsMismatchedCapabilityAtomically() {
    imCleanup()
    let r = CustomModelRegistry(imFile)
    r.upsert(cmDraft("code", cmBinding("step", "m-a", 0, 1)), -1)
    var thrown = ""
    try {
        // m-img 不适配 → 整批拒，不能只成功一半
        r.importInto("code", ["step/m-ok", "step/m-img"], ProviderRegistry(imP).describe(), r.describe().revision)
    } catch (e: Exception) {
        thrown = e.message
    }
    @Expect(thrown, "settings-rejected")
    @Expect(CustomModelRegistry(imFile).describe().models[0].bindings.size, Int64(1))
    imCleanup()
}
```

- [ ] **Step 2: 跑到红**

```bash
cd /d/Project/sa/saai/sa-code/core && cjpm test > ../target/b1-t6.log 2>&1; echo "rc=$?"
```

Expected：编译红在 `importNewModels` / `importInto`。

- [ ] **Step 3: 实现——原子性靠「先在内存算完整份，再一次落盘」**

```cangjie
    // 两个导入操作都必须整批原子：半途失败留下「一半已导入」会让用户重试时撞唯一键。
    public func importInto(customId: String, items: Array<String>, providers: ProviderView, expectedRevision: Int64): Int64 {
        reload()
        guardRevision(expectedRevision)
        let rec = find(customId)
        if (rec.id.size == 0) { throw Exception("settings-rejected") }
        var built = rec
        var added: Int64 = 0
        for (key in items) {
            let parts = splitKey(key)              // 只按第一个 '/' 切；切不出两段即 settings-rejected
            if (hasBinding(built, parts[0], parts[1])) { continue }
            let b = parseBinding(importedBindingJson(parts[0], parts[1], nextOrder(built)))
            if (!fitsRequirements(built, b, providers)) { throw Exception("settings-rejected") }
            built = built.withBinding(b)
            added += 1
        }
        if (added == 0) { return 0 }               // 一条都没加：成功，但不落事件（revision 不该因此前进）
        commit("custom/upsert", built.toJson())
        return added
    }
```

导入生成的绑定用「未定价」形态，绝不凭空造单价（与 Task 3 规则 8 对应）：

```cangjie
    private func nextOrder(rec: CustomModelRecord): Int64 {
        var top: Int64 = -1
        for (b in rec.bindings) {
            if (b.order > top) { top = b.order }
        }
        return top + 1
    }

    // 导入 = 「候选进入调度」，不是「替用户决定价格」：币种留空=未定价，账本侧走 待核算
    private func importedBindingJson(providerId: String, modelId: String, order: Int64): String {
        return "{\"providerId\":\"${jsonEscapeText(providerId)}\",\"modelId\":\"${jsonEscapeText(modelId)}\","
            + "\"enabled\":true,\"order\":${order},\"weight\":1,\"priceMicro\":0,"
            + "\"priceVersion\":0,\"currency\":\"\"}"
    }
```

`importNewModels` 同形，但每个**不在册**的 `providerId/modelId` 生成一个新的自定义模型（`id` 由 `(providerId, modelId)` 稳定派生：`"<providerId>-<modelId>"` 再过 `checkStableId`；派生不出合法 id 就整批拒），默认 `category: "general"`、`requires: ["text-output"]`、`mode: "weighted"`、`weight: 1`。返回**本次真正新建**的 id 列表；`revision` 只在有新建时前进。

> `splitKey` 必须拒掉 `step/`、`/m-a`、`a/b/c` 三种形态（`settings-rejected`）。别用 `split("/")` 的结果长度直接判——`"a/b/c"` 切出三段而前两段仍是合法形状，会静默吃掉第三段。

- [ ] **Step 4: 跑绿**

```bash
cd /d/Project/sa/saai/sa-code/core && cjpm test > ../target/b1-t6b.log 2>&1; echo "rc=$?"
```

Expected：`TOTAL: 492`（+4）、`FAILED: 0`、`rc=0`。

- [ ] **Step 5: 提交**

```bash
cd /d/Project/sa/saai/sa-code
git add core/src/custom_model_registry.cj core/src/custom_import_test.cj
git show --stat --cached
git commit -m "feat(core): 上游模型两种导入入口，重复导入幂等且整批原子"
```

---

## Task 7: 宿主动词与 `initialize.capabilities` 同步

**Files:**
- Modify: `apps/host/src/main.cj`（HEAD 实测：`configReadSide` 白名单在 `:593-594`、`providerSurfaceRequest` 分发在 `:355` 起；**登记时记的 601-605 / 362-435 已漂过一轮**）、`:630`（`initialize.capabilities`）
- Test: `apps/desktop/test/host-verbs.test.mjs`（新建，Node 子进程驱动宿主 NDJSON）

**Interfaces:**
- Consumes: Task 2–6 的 `ProviderRegistry` / `CustomModelRegistry` / `addUpstreamModel` / `applyPulledModels` API。
- Produces: 新动词 `custom/describe`、`custom/upsert`、`custom/remove`、`binding/upsert`、`binding/remove`、`binding/reorder`、`model/pull`、`model/upstream/upsert`、`custom/import/new`、`custom/import/into`；每个写动词入参必带 `expectedRevision`；`initialize.capabilities` 数组同步这十个串。

- [ ] **Step 1: 写失败测试（协议面，不是实现面）**

`apps/desktop/test/` 现有用例**没有驱动过宿主子进程**（`bridge.test.mjs` 打的是 preload/host-bridge 那层的 mock），所以这里要自建一个最小的 NDJSON 客户端。两个约束照 AGENTS：宿主 stdout 只有协议帧、诊断走 stderr；从 Electron 里起 Node 子进程必须带 `ELECTRON_RUN_AS_NODE`。

```javascript
// apps/desktop/test/host-verbs.test.mjs
// 宿主只提供有限动词：能力声明与实现必须一致，未知名必须 -32601，写侧缺 expectedRevision 必须拒。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';

const HOST = resolve(import.meta.dirname, '../dist/host/bin/dsh-host.exe');
const NEW = ['custom/describe', 'custom/upsert', 'custom/remove', 'binding/upsert', 'binding/remove',
  'binding/reorder', 'model/pull', 'model/upstream/upsert', 'custom/import/new', 'custom/import/into'];

const child = spawn(HOST, [], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
const pending = new Map();
let seq = 0;
createInterface({ input: child.stdout }).on('line', (line) => {
  if (!line.trim()) return;
  const frame = JSON.parse(line);
  const wait = frame.id !== undefined && pending.get(frame.id);
  if (wait) { pending.delete(frame.id); frame.error ? wait.reject(frame.error) : wait.resolve(frame.result); }
});
after(() => child.kill());

const rpc = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq;
  pending.set(id, { resolve: res, reject: rej });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});

const draft = { id: 'code', name: '编程模型', description: '', enabled: true, category: 'coding',
  requires: ['tools', 'text-output'], mode: 'weighted', bindings: [] };
const binding = { providerId: 'step', modelId: 'm-a', enabled: true, order: 0, weight: 1,
  priceMicro: 1000, priceVersion: 1, currency: 'CNY' };

test('capabilities 声明了本批新增的每个动词', async () => {
  const cap = await rpc('initialize');
  for (const m of NEW) assert.ok(cap.capabilities.includes(m), `未声明: ${m}`);
});

test('custom/describe 空目录返回零条目且 revision 为 0', async () => {
  const r = await rpc('custom/describe');
  assert.equal(r.models.length, 0);
  assert.equal(r.revision, 0);
  assert.equal(r.writable, true);
});

test('binding/upsert 缺 expectedRevision 一律拒', async () => {
  await rpc('custom/upsert', { draft, expectedRevision: 0 });
  await assert.rejects(rpc('binding/upsert', { customId: 'code', binding }),
    (e) => e.message.includes('missing-revision'));
});

test('未知动词不被当作通用通道', async () => {
  await assert.rejects(rpc('custom/whatever'), (e) => e.code === -32601);
});
```

> 用例必须在**干净的设置目录**里跑，否则 `custom/describe` 的「空目录」断言会读到上一批留下的 `custom-models.log` 而假红/假绿。给 spawn 传一个 `SACODE_SETTINGS_DIR=<仓库内 gitignore 目录>` 环境变量，并确认 `CustomModelRegistry.forUser()` 认这个变量——**若当前 `forUser()` 只认 `GlobalAppearanceSettings` 的路径，本任务的 Step 3 必须先补这个覆盖点**，这是新增能力，不是重构。

- [ ] **Step 2: 跑到红**

```bash
cd /d/Project/sa/saai/sa-code/apps/host && cjpm build > ../../target/b1-t7-host-build.log 2>&1; echo "build rc=$?"
cd /d/Project/sa/saai/sa-code
node scripts/pack-host.mjs apps/host/target/release/bin/main.exe apps/desktop/dist/host \
  "C:/Users/jingg/stdx-work/stdx-1.1.3.1/windows_x86_64_cjnative/dynamic/stdx" \
  "D:/Program Files/HuaWei/Cangjie/runtime/lib/windows_x86_64_cjnative" \
  > target/b1-t7-pack.log 2>&1; echo "pack rc=$?"
ls -la apps/desktop/dist/host/bin/dsh-host.exe   # 必核 mtime/体积：pack 静默失败时会拿上一轮旧宿主跑出假象
cd apps/desktop && node --test test/host-verbs.test.mjs > ../../target/b1-t7.log 2>&1; echo "rc=$?"
```

Expected：三个 rc 全 0，且 exe 的 mtime 落在本轮。**先核 mtime 再信结果**——`pack-host.mjs` 失败时不会清空旧产物，旧宿主能跑出一堆「看起来合理」的红。红集合应是 `not ok` 条数 = 4（本任务新增用例数）。

- [ ] **Step 3: 接动词**

新动词组放进 `providerSurfaceRequest`（HEAD 实测 `apps/host/src/main.cj:355` 的那个函数。**动手前先重定位再改**：`grep -n "func providerSurfaceRequest" apps/host/src/main.cj`——这是本仓改动最频繁的文件，行号会随别的批次漂移，只有符号名是稳的）里，**照 `model/registry/update` 的既有形态取对象**（HEAD 实测 `:361-372`：`JsonValue.fromStr(body).asObject()` → `params.draft` → `registry.updateObject(draft, jsonNum(body, "expectedRevision"))`）。自定义模型侧复用同一形状：

```cangjie
        if (method == "custom/describe") {
            emit(okFrame(idText, CustomModelRegistry.forUser().describe().asJson()))
            return
        }
        if (method == "custom/upsert") {
            let request = JsonValue.fromStr(body).asObject()
            var draft: Option<JsonObject> = None
            if (let Some(p) <- request.get("params")) {
                if (let Some(d) <- p.asObject().get("draft")) {
                    draft = Some(d.asObject())
                }
            }
            if (draft.isNone()) {
                emit(errFrame(idText, -32020, "settings-rejected"))
                return
            }
            CustomModelRegistry.forUser().upsertObject(draft.getOrThrow(), jsonNum(body, "expectedRevision"))
            emit(okFrame(idText, CustomModelRegistry.forUser().describe().asJson()))
            return
        }
```

**不要在函数里自己 try/catch**：`providerSurfaceRequest` 整体已被外层 `catch (e: Exception) { emit(errFrame(idText, -32020, e.message)) }`（`:438-440`）包住，`settings-conflict` / `settings-rejected` 的区分**靠 message 原文**（`bridge`/渲染层按 `code === 'model-conflict'` 分诊的是宿主回显的这条 message）。新增独立的 `-32012/-32013` 数值码等于把同一份文档面拆成两套错误约定，**禁止**。

`model/pull` 直接沿用 `model/list` 已经跑通的取参 + 抓取形态（`:401-435`：遍历 `describe().providers` 找 `baseUrl`/`credentialRef`，`secret = resolveCredentialKey(reference)`，`ModelCatalog().fetch(baseUrl, secret)`），只在成功后多落一步：

```cangjie
        if (method == "model/pull") {
            let registry = ProviderRegistry.forUser()
            let wanted = jsonStr(body, "providerId")
            var baseUrl = ""
            var reference = ""
            for (p in registry.describe().providers) {
                if (p.id == wanted) {
                    baseUrl = p.baseUrl
                    reference = p.credentialRef
                }
            }
            if (baseUrl.size == 0) {
                emit(errFrame(idText, -32020, "provider-not-found"))
                return
            }
            // 不 catch：坏响应必须由外层抛出去变成帧错误，绝不能报「0 个模型」
            let ids = ModelCatalog().fetch(baseUrl, resolveCredentialKey(reference))
            registry.applyPulledModels(wanted, ids, jsonNum(body, "expectedRevision"))
            emit(okFrame(idText, providerViewJson(registry.describe(), creds)))
            return
        }
        if (method == "model/upstream/upsert") {
            ProviderRegistry.forUser().addUpstreamModel(
                jsonStr(body, "providerId"), jsonStr(body, "modelId"), jsonNum(body, "expectedRevision"))
            emit(okFrame(idText, providerViewJson(ProviderRegistry.forUser().describe(), creds)))
            return
        }
```

本任务需要新写的核心侧入口只有一个：`CustomModelRegistry.upsertObject(obj: JsonObject, expectedRevision: Int64)`（Task 3 的 `upsert(draft: String, ...)` 已在，`upsertObject` 与它同形、只省一次 JSON 解析——这与 `provider_registry.cj:272-279` 的 `update`/`updateObject` 成对关系逐字一致）。

最后一个必须补的入口护栏：**新写动词的 `expectedRevision` 必须显式在场**。核心侧的 `-1 = 无条件写` 是给 CLI 自测与测试用的，不能变成协议面的默认——协议面上「没给版本」和「不在乎版本」是两件事。每个新写动词的分支开头统一走一个助手：

```cangjie
    // 协议面不接受「没点名修订号」的写：缺失就拒，而不是静默当成无条件写
    private func revisionOrReject(body: String, idText: String): Option<Int64> {
        let params = JsonValue.fromStr(body).asObject()
        if (let Some(p) <- params.get("params")) {
            if (let Some(r) <- p.asObject().get("expectedRevision")) {
                return Some(r.asInt64().getValue())
            }
        }
        emit(errFrame(idText, -32020, "missing-revision"))
        return None
    }
```

调用形态：`if (let Some(rev) <- revisionOrReject(body, idText)) { ... 写 ... } else { return }`。这条助手是本任务唯一新增的宿主侧公共设施，`custom/upsert`、`custom/remove`、`binding/*`、`model/upstream/upsert`、`custom/import/*` 全部走它；`model/pull` 也走（它会落 `provider/upsert` 事件）。

剩下七个动词不再有新概念，只有一张参数→核心调用→回执的对照表（`registry` / `creds` 沿用 `providerSurfaceRequest` 函数体内已有的那两个局部，别在分支里重新 `forUser()` 造实例——同一个请求里造两次会得到两份视图）：

| 动词 | 核心调用 | 成功回执 |
| --- | --- | --- |
| `custom/remove` | `CustomModelRegistry.forUser().remove(jsonStr(body, "customId"), rev)` | `describe().asJson()` |
| `binding/upsert` | `upsertBinding(jsonStr(body,"customId"), draftTextOf(body,"binding"), registry.describe(), rev)` | `describe().asJson()` |
| `binding/remove` | `removeBinding(jsonStr(body,"customId"), jsonStr(body,"providerId"), jsonStr(body,"modelId"), rev)` | `describe().asJson()` |
| `binding/reorder` | `reorderBindings(jsonStr(body,"customId"), stringArrayFrom(body,"keys"), rev)` | `describe().asJson()` |
| `custom/import/new` | `importNewModels(stringArrayFrom(body,"items"), registry.describe(), rev)` | `{"created":[...]}` + `describe().asJson()` |
| `custom/import/into` | `importInto(jsonStr(body,"customId"), stringArrayFrom(body,"items"), registry.describe(), rev)` | `{"added":N}` |
| `model/upstream/upsert` | `registry.addUpstreamModel(jsonStr(body,"providerId"), jsonStr(body,"modelId"), rev)` | `providerViewJson(registry.describe(), creds)` |

> `draftTextOf(body, key)` / `stringArrayFrom(body, key)` / `binding/upsert` 三处需要对象或数组入参：宿主现有 `jsonStr` 只回字符串。做法照 `:363-370` 抽 `params.draft` 的同一条路——取 `JsonObject`/`JsonArray` 后用 `upsertObject` 那类对象入口，或在宿主侧把该子对象 `toString()` 成文本再交给字符串入口。**两种都必须在 Task 4/5 的核心侧留下对应的对象入口**，选哪一种由实现时 `stdx.encoding.json` 的序列化能力决定，但**不允许**在宿主里手写字符串拼接来造 JSON。

- [ ] **Step 4: 更新在途轮次的放行白名单**

`apps/host/src/main.cj:593` 那个 `configReadSide` 布尔式（先 `grep -n "let configReadSide" apps/host/src/main.cj` 重定位）决定「流式轮次里允许哪些配置面请求」。把 `custom/describe` 加进**读面**（与 `model/registry/describe` 同档），其余写动词留在「在途即 `turn-in-flight`」那一侧：

```cangjie
            let configReadSide = method == "model/registry/describe" || method == "model/registry/catalog"
                || method == "credential/describe" || method == "custom/describe"
```

漏了这行会得到「任务跑着就打不开模型页」的真实缺陷；写侧漏了则等于允许在途改路由，两个都要测。

- [ ] **Step 5: 同步 capabilities 并跑绿**

`:620` 的 `capabilities` 数组尾部追加十个动词串（先 `grep -n capabilities apps/host/src/main.cj` 重定位）（**逐字与 Step 1 的 `NEW` 数组一致**）。然后：

```bash
cd /d/Project/sa/saai/sa-code/apps/host && cjpm build > ../../target/b1-t7-build.log 2>&1; echo "build rc=$?"
cd /d/Project/sa/saai/sa-code
node scripts/pack-host.mjs apps/host/target/release/bin/main.exe apps/desktop/dist/host \
  "C:/Users/jingg/stdx-work/stdx-1.1.3.1/windows_x86_64_cjnative/dynamic/stdx" \
  "D:/Program Files/HuaWei/Cangjie/runtime/lib/windows_x86_64_cjnative" \
  > target/b1-t7-pack2.log 2>&1; echo "pack rc=$?"
cd apps/desktop && node --test test/host-verbs.test.mjs > ../../target/b1-t7b.log 2>&1; echo "rc=$?"
```

Expected：三个 rc 全 0（**构建 rc 必须单独取，别让 `| tail` 把它换成 0**——上一批就踩过「编译失败但跑了旧 exe」的假绿）；`node --test` rc=0、`# pass 4`、`# fail 0`。

- [ ] **Step 6: 提交**

```bash
cd /d/Project/sa/saai/sa-code
git add apps/host/src/main.cj apps/desktop/test/host-verbs.test.mjs
git show --stat --cached
git commit -m "feat(host): 模型目录十个动词上宿主，能力声明与实现同步"
```

---

## Task 8: 模型页对齐——前端校验收紧为核心的真子集

**Files:**
- Modify: `apps/desktop/renderer/pages/models-page.ts:29`（`validateDraft` 的 URL 判据）、`apps/desktop/renderer/pages/models-page.ts:10-16`（`Provider`/`Model` 类型补 Task 2 的新字段）
- Modify: `apps/desktop/preload.cjs`（新 IPC 通道）、`apps/desktop/test/bridge.test.mjs`
- Test: `apps/desktop/test/models-validate.test.mjs`（新建）

**Interfaces:**
- Consumes: 宿主 `models/*` 现有通道 + Task 7 的 `custom/*` 动词。
- Produces: 前端 `validateDraft` 与核心 `checkBaseUrl`（`provider_registry.cj:436-448`）判据一致；IPC 通道集新增有限条目，且仍不提供「发任意方法」通路。

- [ ] **Step 1: 写失败测试（断言 31）**

桌面测试栈是 `node --test`，**没有 jsdom/vitest，`node --test` 也直接吃不了 `.ts`**。用仓库现成的 `esbuild`（`apps/desktop` 的 devDependency）把被测模块**只转译不打包**到 gitignore 的 `dist/ts/` 下，再让 Node 原生解析 `'vue'`（`dist/ts/modules/` 往上走就是 `apps/desktop/node_modules`）：

```javascript
// apps/desktop/test/models-validate.test.mjs
// 断言 31：前端只能比核心更严，不能更宽。现状 validateDraft 放行任意 http:// 主机，是真缺陷。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
buildSync({
  entryPoints: [resolve(here, '../renderer/pages/models-page.ts')],
  outfile: resolve(here, '../dist/ts/modules/models-page.mjs'),
  format: 'esm', target: 'es2022', bundle: false,
});
const { validateDraft } = await import(pathToFileURL(resolve(here, '../dist/ts/modules/models-page.mjs')).href);

const base = { id: 'p', name: 'P', protocol: 'openai-completions', key: '', declared: true,
  models: [{ id: 'm', name: '', contextWindow: '', maxTokens: '', image: false }] };

test('非回环 http 地址在前端就被拒', () => {
  assert.notEqual(validateDraft({ ...base, baseUrl: 'http://api.example.com/v1' }, [], false), '');
  assert.notEqual(validateDraft({ ...base, baseUrl: 'http://10.0.0.5:8080/v1' }, [], false), '');
});

test('本机回环 http 与 https 被接受', () => {
  assert.equal(validateDraft({ ...base, baseUrl: 'http://127.0.0.1:8000/v1' }, [], false), '');
  assert.equal(validateDraft({ ...base, baseUrl: 'http://localhost:8000/v1' }, [], false), '');
  assert.equal(validateDraft({ ...base, baseUrl: 'https://api.example.com/v1' }, [], false), '');
});

test('带凭据/查询/片段的地址被拒（与核心同判据）', () => {
  for (const u of ['https://u:p@api.example.com/v1', 'https://api.example.com/v1?x=1', 'https://api.example.com/v1#f']) {
    assert.notEqual(validateDraft({ ...base, baseUrl: u }, [], false), '', u);
  }
});

test('非回环 http 的拒法与核心一致：https 或 127.0.0.1/localhost 才活', () => {
  // 这条钉的是「子集」方向：核心 provider_registry.cj:436-448 拒的形态，前端必须也拒
  for (const u of ['http://example.com', 'ftp://a.example.com/v1', 'https://a.example.com/v1/x?y=1#z']) {
    assert.notEqual(validateDraft({ ...base, baseUrl: u }, [], false), '', u);
  }
});
```

> `bundle: false` 是硬要求：打包会把 `vue` 折进来，得到第二份 Vue runtime，与运行时 vendor 的那一份不是同一套响应式系统（AGENTS 红线）。这里只借 `validateDraft` 这个纯函数，模块顶层的 `defineComponent` 只求能求值即可。

- [ ] **Step 2: 跑到红**

```bash
cd /d/Project/sa/saai/sa-code/apps/desktop && node --test test/models-validate.test.mjs > ../../target/b1-t8.log 2>&1; echo "rc=$?"
```

Expected：`# fail 2` —— 只有「非回环 http 地址在前端就被拒」和「拒法与核心一致」这两条红。另两条（回环放行、带 `?`/`#` 被拒）现状已经正确，**它们红就说明测试写错了**，先修测试别改实现。根因：`validateDraft` 现在判的是 `!['http:','https:'].includes(u.protocol)`（`models-page.ts:29`），任意主机的 `http://` 都能过。记下降级前的 `# pass` 数，Step 3 之后必须是 `# pass 4 / # fail 0`。

- [ ] **Step 3: 收紧判据为核心规则的子集**

把 `models-page.ts:29` 那行的 `!['http:', 'https:'].includes(u.protocol)` 换成：

```typescript
const secure = u.protocol === 'https:' && u.host.length > 0;
const local = (u.hostname === '127.0.0.1' || u.hostname === 'localhost') && u.protocol === 'http:';
if (!secure && !local) return '请输入有效的 HTTP 或 HTTPS 地址。';
```

保留原有的 `u.username || u.password || u.search || u.hash` 检查不动。**不要**在前端新增核心没有的规则（比如限制端口段）——口径是「前端接受形态 ⊆ 核心接受形态」。

- [ ] **Step 4: 类型面补新字段并接自定义模型页签**

`Provider` 接口加 `sortOrder?: number; enabled?: boolean; transport?: 'direct' | 'relay'`（可选，避免宿主未升级时渲染崩）。本任务**只做类型与呈现字段透传**，自定义模型编辑 UI 属 B6 面板批次；若在这里就想加页签，先回来确认它不属于本批出口判据。

- [ ] **Step 5: 同步 IPC 面并跑绿**

`preload.cjs` 按动作加通道（`customsDescribe`、`customsUpsert`、`customsRemove`、`bindingUpsert`、`bindingRemove`、`modelPull`、`modelUpstreamUpsert`、`customImportNew`、`customImportInto`），逐字段校验，**不提供「发任意方法」通路**。`bridge.test.mjs` 的基线从 **32 通道 / 41 用例** 变成 **41 通道 / 41+N 用例**（N = 新增用例数，写进 commit body）。

```bash
cd /d/Project/sa/saai/sa-code/apps/desktop && node --test test/models-validate.test.mjs test/bridge.test.mjs > ../../target/b1-t8b.log 2>&1; echo "rc=$?"
```

Expected：两个文件都 rc=0；`bridge.test.mjs` 的 `# pass` ≥ 41。跑之前确认 `dualtest/` 无异常残留（有则先 `rm -rf dualtest`）。

- [ ] **Step 6: 桌面冒烟复验（UI 改动必须真跑起来）**

```bash
cd /d/Project/sa/saai/sa-code/apps/desktop && npm run ui-smoke > ../../target/b1-t8-smoke.log 2>&1; echo "rc=$?"
```

Expected：日志末行 `UI SMOKE PASS`，且 UI FAIL 行名不含模型页。**若无法在浏览器里真的点开模型页确认，就如实标 BLOCKED 并写缺什么**，不许用 `npm test` 通过代替 UI 通过。

- [ ] **Step 7: 提交**

```bash
cd /d/Project/sa/saai/sa-code
git add apps/desktop/renderer/pages/models-page.ts apps/desktop/preload.cjs apps/desktop/test/bridge.test.mjs apps/desktop/test/models-validate.test.mjs
git show --stat --cached
git commit -m "feat(desktop): 模型页地址校验收紧为核心的子集，自定义模型动词上 IPC 面"
```

---

## 批次出口判据（B1 完成的定义）

全部满足才算 B1 出口，任一不满足就写清卡点继续开着，**不缩范围凑绿**：

1. `cd core && cjpm test` → `TOTAL: 492`（基线 463 + 本批 29 条：Task1 4、Task2 3、Task3 9、Task4 5、Task5 4、Task6 4）、`FAILED: 0`、`ERROR: 0`、`SKIPPED: 1`，`rc=0` 且打印 `cjpm test success`。
2. 六处变异全部转红且各自归因到指定用例名：Task 4 Step 6 的四处（`unknown 不等于满足`、`绑定唯一键`、`dangling 可见`、`重排键集必须相等`），加 Task 3 的两处——(a) 把 `intFieldDefault` 的预算列缺省从 `-1` 改成 `0`，必须只让 `unsetBudgetReplaysAsMinusOneNotZero` 变红（这条杀的正是「未设置被读成额度耗尽」）；(b) 把规则 9 的币种一致性检查改成恒真，必须只让 `twoCurrenciesInOneModelAreRejectedWithoutMerge` 变红。任一变异照样全绿，就该条不变量补白盒用例，不许带着假绿过出口。
3. `cd apps/desktop && node --test`（全量）rc=0；`bridge.test.mjs` 通道基线已按实际数字更新。
4. `npm run ui-smoke` 输出 `UI SMOKE PASS`，或明确记 BLOCKED 及其解锁动作。
5. 宿主 `initialize.capabilities` 里的十个新动词与实现逐字一致，`host-verbs.test.mjs` 对未知名返回 `-32601`。
6. 断言 1、2、3、4、31、41、46 各自有对应绿色用例（1、2→Task 5；3→Task 4；4→Task 2 的 `enabled` 与 B2 的过滤链——**本批只钉住「读得到 enabled」，过滤链那条留 B2**，出口判据里如实标注这条是部分的）；31→Task 8；41→Task 3 的 `twoCurrenciesInOneModelAreRejectedWithoutMerge`；46→Task 3 的 `paramsBudgetAndProbePolicySurviveReplay` + `unsetBudgetReplaysAsMinusOneNotZero` + `secretShapedKeyInsideParamsIsRejected` 三条（46 的三个侧面各一条，任一缺失都算部分）。
7. `git log --oneline` 有本批 8 个提交，且每个提交的 `git show --stat` 只含本批路径（并发会话的改动没被吞）。
