# 自动化与定时任务实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补全 SaCode 的自动化与定时任务功能，持久任务由 daemon 调度。

**Architecture:** core 提供 cron 匹配器、任务账本与 fire 去重；daemon 持有唯一持久调度循环（tick + 重启恢复）；Host 提供 task/start 执行通道；CLI/桌面/Agent 工具共用核心 API。临时任务进程内调度，持久任务 daemon 唯一调度。

**Tech Stack:** 仓颉 core + daemon HTTP/SSE + Host NDJSON + Electron + Node CLI

**Spec:** Qwen scheduled-tasks 文档 + PRD F13 + 用户批准的完整范围

## Global Constraints
- 仓颉 1.1.3，cjpm workspace（core/apps/cli/apps/host/apps/daemon）
- 会话日志是唯一真源，append 仅实例内可见，flush 才跨进程持久
- stdout 只走协议/机器输出，诊断走 stderr
- 审批凭据只能是工单号
- 注释/文档/commit 一律中文，commit 形如 `feat(core,daemon): 描述`
- 不提交构建产物
- 测试先红后绿，不接受回执当执行成功
- 无提示词自主循环只能推进既有已授权目标

## File Structure

- `core/src/cron.cj` — 五段 cron 字段解析与时间匹配
- `core/src/cron_test.cj` — cron 解析/匹配测试
- `core/src/schedule.cj` — 扩展：TaskDefinition、TaskLedger、FireRecord、ScheduleService
- `core/src/schedule_test.cj` — 扩展：任务账本、fire 去重、调度服务测试
- `apps/daemon/src/scheduler.cj` — daemon 调度循环（tick + 重启恢复 + 执行转发）
- `apps/daemon/src/daemon.cj` — 扩展：schedule/* RPC 端点
- `apps/daemon/test/scheduler.test.mjs` — daemon 调度集成测试
- `apps/cli/src/loop_command.cj` — /loop 解析与命令
- `apps/cli/src/main.cj` — 扩展：schedule 子命令
- `apps/desktop/preload.cjs` — 扩展：自动化 IPC 通道
- `apps/desktop/main.cjs` — 扩展：自动化 IPC handler
- `apps/desktop/renderer/pages/automation.ts` — 自动化管理页面

---

### Task 1: Core cron 字段解析器

**Files:**
- Create: `core/src/cron.cj`
- Test: `core/src/cron_test.cj`

**Interfaces:**
- Produces: `public class CronSpec { public static func parse(spec: String): CronSpec; public func matches(minute, hour, dom, month, dow): Bool }`

- [ ] **Step 1: Write failing test — 字段解析**

```cangjie
package core
import std.unittest.*

@Test
func cronParseStarMatchesAll() {
    let spec = CronSpec.parse("* * * * *")
    @Expect(spec.matchesMinute(0), true)
    @Expect(spec.matchesMinute(30), true)
    @Expect(spec.matchesMinute(59), true)
    @Expect(spec.matchesHour(0), true)
    @Expect(spec.matchesHour(23), true)
}

@Test
func cronParseNumberMatchesExact() {
    let spec = CronSpec.parse("5 3 * * *")
    @Expect(spec.matchesMinute(5), true)
    @Expect(spec.matchesMinute(6), false)
    @Expect(spec.matchesHour(3), true)
    @Expect(spec.matchesHour(4), false)
}

@Test
func cronParseRangeMatchesInclusive() {
    let spec = CronSpec.parse("1-5 * * * *")
    @Expect(spec.matchesMinute(1), true)
    @Expect(spec.matchesMinute(3), true)
    @Expect(spec.matchesMinute(5), true)
    @Expect(spec.matchesMinute(6), false)
    @Expect(spec.matchesMinute(0), false)
}

@Test
func cronParseStepMatchesInterval() {
    let spec = CronSpec.parse("*/15 * * * *")
    @Expect(spec.matchesMinute(0), true)
    @Expect(spec.matchesMinute(15), true)
    @Expect(spec.matchesMinute(30), true)
    @Expect(spec.matchesMinute(45), true)
    @Expect(spec.matchesMinute(7), false)
}

@Test
func cronParseListMatchesMembers() {
    let spec = CronSpec.parse("0,15,30,45 * * * *")
    @Expect(spec.matchesMinute(0), true)
    @Expect(spec.matchesMinute(15), true)
    @Expect(spec.matchesMinute(30), true)
    @Expect(spec.matchesMinute(45), true)
    @Expect(spec.matchesMinute(10), false)
}

@Test
func cronParseRangeStepMatches() {
    let spec = CronSpec.parse("10-50/10 * * * *")
    @Expect(spec.matchesMinute(10), true)
    @Expect(spec.matchesMinute(20), true)
    @Expect(spec.matchesMinute(50), true)
    @Expect(spec.matchesMinute(5), false)
    @Expect(spec.matchesMinute(0), false)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd core && cjpm test --filter="*cron*"`
Expected: FAIL — CronSpec undeclared

- [ ] **Step 3: Write minimal implementation**

```cangjie
package core
import std.collection.*

public class CronSpec {
    let minutes = HashSet<Int64>()
    let hours = HashSet<Int64>()
    let doms = HashSet<Int64>()
    let months = HashSet<Int64>()
    let dows = HashSet<Int64>()

    init() {}

    public static func parse(spec: String): CronSpec {
        let parts = spec.split(" ")
        if (parts.size < 5) {
            throw Exception("cron-parse-too-few-fields")
        }
        let c = CronSpec()
        c.parseField(parts[0], 0, 59, c.minutes)
        c.parseField(parts[1], 0, 23, c.hours)
        c.parseField(parts[2], 1, 31, c.doms)
        c.parseField(parts[3], 1, 12, c.months)
        c.parseField(parts[4], 0, 7, c.dows)
        // Sunday=7 与 Sunday=0 合并
        if (c.dows.contains(7)) {
            c.dows.put(0)
        }
        return c
    }

    public func matchesMinute(v: Int64): Bool { return minutes.contains(v) }
    public func matchesHour(v: Int64): Bool { return hours.contains(v) }
    public func matchesDom(v: Int64): Bool { return doms.contains(v) }
    public func matchesMonth(v: Int64): Bool { return months.contains(v) }
    public func matchesDow(v: Int64): Bool { return dows.contains(v) || dows.contains(0) && v == 7 }

    func parseField(field: String, min: Int64, max: Int64, set: HashSet<Int64>): Unit {
        for (item in field.split(",")) {
            parseItem(item, min, max, set)
        }
    }

    func parseItem(item: String, min: Int64, max: Int64, set: HashSet<Int64>): Unit {
        if (item == "*") {
            var i = min
            while (i <= max) { set.put(i); i += 1 }
            return
        }
        // step: */N or range/N
        let slashIdx = item.indexOf("/")
        if (let Some(idx) <- slashIdx) {
            let base = item[0..idx]
            let stepStr = item[(idx + 1)..item.size]
            let step = Int64.parse(stepStr) ?? Int64(1)
            if (step <= 0) { throw Exception("cron-parse-bad-step") }
            if (base == "*") {
                var i = min
                while (i <= max) { set.put(i); i += step }
            } else {
                let dashIdx = base.indexOf("-")
                if (let Some(d) <- dashIdx) {
                    let lo = Int64.parse(base[0..d]) ?? min
                    let hi = Int64.parse(base[(d + 1)..base.size]) ?? max
                    var i = lo
                    while (i <= hi) { set.put(i); i += step }
                }
            }
            return
        }
        // range: N-M
        let dashIdx = item.indexOf("-")
        if (let Some(d) <- dashIdx) {
            let lo = Int64.parse(item[0..d]) ?? min
            let hi = Int64.parse(item[(d + 1)..item.size]) ?? max
            var i = lo
            while (i <= hi) { set.put(i); i += 1 }
            return
        }
        // single number
        let v = Int64.parse(item)
        if (let Some(n) <- v) {
            set.put(n)
        } else {
            throw Exception("cron-parse-bad-number: ${item}")
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd core && cjpm test --filter="*cron*"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add core/src/cron.cj core/src/cron_test.cj
git commit -m "feat(core): cron 五段字段解析器"
```

---

### Task 2: Core cron 时间匹配与 dom/dow OR 语义

**Files:**
- Modify: `core/src/cron.cj`
- Test: `core/src/cron_test.cj`

**Interfaces:**
- Produces: `public func matches(minute, hour, dom, month, dow): Bool` — 当 dom 和 dow 都非 * 时按 OR 匹配

- [ ] **Step 1: Write failing test — 完整时间匹配 + dom/dow OR**

```cangjie
@Test
func cronMatchFullTime() {
    let spec = CronSpec.parse("30 14 * * *")
    @Expect(spec.matches(30, 14, 15, 6, 2), true)
    @Expect(spec.matches(31, 14, 15, 6, 2), false)
    @Expect(spec.matches(30, 15, 15, 6, 2), false)
}

@Test
func cronDomDowOrSemantics() {
    // 0 0 1 * 1 = 每月1号 OR 每周一
    let spec = CronSpec.parse("0 0 1 * 1")
    @Expect(spec.matches(0, 0, 1, 6, 1), true)   // dom=1 命中
    @Expect(spec.matches(0, 0, 15, 6, 1), true)   // dow=1 命中
    @Expect(spec.matches(0, 0, 15, 6, 2), false)   // 都不命中
}

@Test
func cronDomDowAndWhenOneIsStar() {
    // 0 0 1 * * = 只看 dom
    let spec1 = CronSpec.parse("0 0 1 * *")
    @Expect(spec1.matches(0, 0, 1, 6, 2), true)
    @Expect(spec1.matches(0, 0, 2, 6, 2), false)
    // 0 0 * * 1 = 只看 dow
    let spec2 = CronSpec.parse("0 0 * * 1")
    @Expect(spec2.matches(0, 0, 15, 6, 1), true)
    @Expect(spec2.matches(0, 0, 15, 6, 2), false)
}

@Test
func cronSundayIsZeroOrSeven() {
    let spec1 = CronSpec.parse("0 0 * * 0")
    @Expect(spec1.matches(0, 0, 15, 6, 0), true)
    @Expect(spec1.matches(0, 0, 15, 6, 7), true) // 7 也匹配 Sunday
    let spec2 = CronSpec.parse("0 0 * * 7")
    @Expect(spec2.matches(0, 0, 15, 6, 0), true)
    @Expect(spec2.matches(0, 0, 15, 6, 7), true)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd core && cjpm test --filter="*cron*"`
Expected: FAIL — matches 方法不存在

- [ ] **Step 3: Add matches method with dom/dow OR logic**

```cangjie
// 在 CronSpec 中添加
let domIsStar: Bool
let dowIsStar: Bool

// parse 中记录
// parseField 前设 domIsStar = (parts[2] == "*")
// parseField 前设 dowIsStar = (parts[4] == "*")

public func matches(minute: Int64, hour: Int64, dom: Int64, month: Int64, dow: Int64): Bool {
    if (!matchesMinute(minute)) { return false }
    if (!matchesHour(hour)) { return false }
    if (!matchesMonth(month)) { return false }
    let domMatch = matchesDom(dom)
    let dowMatch = matchesDow(dow)
    if (domIsStar && dowIsStar) {
        return true
    } else if (!domIsStar && !dowIsStar) {
        return domMatch || dowMatch
    } else {
        return domMatch && dowMatch
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

---

### Task 3: Core 任务定义与账本（register/list/delete/pause/resume）

**Files:**
- Modify: `core/src/schedule.cj`
- Test: `core/src/schedule_test.cj`

**Interfaces:**
- Produces:
  - `public class TaskDefinition { id, cron, prompt, oneShot, maxAgeSec, workspaceDir, sessionLogPath, modelConfig, active, revision }`
  - `public func register(id, cron, prompt, ...): Unit`
  - `public func list(): ArrayList<TaskDefinition>`
  - `public func delete(id): Unit`
  - `public func resume(id): Unit`

---

### Task 4: Core fire 记录与去重

**Files:**
- Modify: `core/src/schedule.cj`
- Test: `core/src/schedule_test.cj`

**Interfaces:**
- Produces:
  - `public func recordFire(fireId, taskId, firedAt): Unit`
  - `public func hasPendingFire(taskId): Bool` — 去重判据
  - `public func updateFireResult(fireId, status, detail): Unit`
  - `public func fireHistory(taskId): ArrayList<FireRecord>`

---

### Task 5: Core 调度服务（dueTasks + 合并漏执行）

**Files:**
- Modify: `core/src/schedule.cj`
- Test: `core/src/schedule_test.cj`

**Interfaces:**
- Produces:
  - `public func dueTasks(nowMin, nowHour, nowDom, nowMonth, nowDow): ArrayList<String>` — 返回到期且无 pending fire 的任务 id
  - 漏执行合并：多个周期错过只返回一次

---

### Task 6: Daemon 调度循环与重启恢复

**Files:**
- Create: `apps/daemon/src/scheduler.cj`
- Test: `apps/daemon/test/scheduler.test.mjs`

---

### Task 7: Daemon schedule/* RPC 端点

**Files:**
- Modify: `apps/daemon/src/daemon.cj`

---

### Task 8: Host 定时执行通道（daemon → task/start → poll → result）

**Files:**
- Modify: `apps/host/src/main.cj`

---

### Task 9: CLI /loop 命令

**Files:**
- Create: `apps/cli/src/loop_command.cj`
- Modify: `apps/cli/src/main.cj`

---

### Task 10: CLI schedule 管理命令

**Files:**
- Modify: `apps/cli/src/main.cj`

---

### Task 11: 桌面自动化页面

**Files:**
- Create: `apps/desktop/renderer/pages/automation.ts`
- Modify: `apps/desktop/preload.cjs`, `apps/desktop/main.cjs`

---

### Task 12: Agent 工具（cron_create/cron_list/cron_delete）

**Files:**
- Modify: `core/src/model_tools.cj`

---

### Task 13: 端到端集成测试

**Files:**
- Test: `apps/daemon/test/scheduler.test.mjs`
