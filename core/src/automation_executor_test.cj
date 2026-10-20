package core

import std.collection.*
import std.fs.*
import std.time.*
import std.unittest.*

// 全部使用独占合成目录、可控时钟与独立运行日志，不读HOME/settings，不接Host。
// 此文件仅交付测试源码；由统一窗口编译运行，不以假runner结果冒充生产进程验收。
class AutomationExecutorFixture {
    let root: String
    let path: String
    var now: Int64 = 1704067200 // 2024-01-01 00:00 UTC，周一
    var approvalNow: Int64 = 0
    init() {
        Directory.create("target/tmp/automation-executor-tests", recursive: true)
        root = canonicalize(Directory.createTemp("target/tmp/automation-executor-tests")).toString()
        path = root + "/runs.log"
    }
    func executor(runner!: ?AutomationHookRunner = None): AutomationExecutor {
        return AutomationExecutor(path, runner: runner, clock: {=> now}, approvalClock: {=> approvalNow})
    }
    func definition(command!: String = "合成命令", cron!: String = "* * * * *", taskId!: String = "task-1",
        preset!: String = "preset-test", timezone!: String = "UTC"): AutomationHookDefinition {
        return AutomationHookDefinition(taskId, "synthetic-project", preset, "合成settings声明", cron, root, command, timezone: timezone)
    }
    func mount(executor: AutomationExecutor, definition: AutomationHookDefinition): Unit {
        executor.declare(definition); executor.load(definition.taskId, definition.digest)
    }
    func fire(executor: AutomationExecutor, taskId!: String = "task-1"): AutomationExecutionView {
        now += 60; executor.tick(); return executor.describe(taskId)
    }
    func tidy(): Unit { coreTestTidy(root) }
}

class AutomationFixtureRunner <: AutomationHookRunner {
    var calls: Int64 = 0
    var throwOnRun = false
    var freezeJournal: ?SessionLog = None
    var observedStarted = false
    var input: String = ""
    var result: ?ShellResult = Some(ShellResult(0, "{\"decision\":\"allow\"}", "", false, ""))
    public func execute(invocation: AutomationHookInvocation, token: TurnToken): ?ShellResult {
        calls += 1; input = hookInputJson(invocation.input)
        // 核对真实磁盘上已有running，不能只看内存append。
        let disk = SessionLog(invocation.input.transcriptPath)
        if (disk.load()) {
            for (event in disk.snapshotEvents()) {
                if (event.eventType == "automation-executor/fire" && event.data.contains("\"running\"")) { observedStarted = true }
            }
        }
        if (let Some(log) <- freezeJournal) { log.freezeAfterDurableFailure() }
        if (throwOnRun) { throw Exception("不能回显的secret-token") }
        return result
    }
}

// 真进程对照仅执行固定合成输出命令，不执行外部输入、真实用户脚本或收费请求。
class AutomationFixedProcessRunner <: AutomationHookRunner {
    var calls: Int64 = 0
    public func execute(invocation: AutomationHookInvocation, token: TurnToken): ?ShellResult {
        calls += 1
        if (invocation.definition.command != "fixed-synthetic-command") { throw Exception("fixture-command-not-allowed") }
        if (hookRunsOnWindows()) {
            return runOwnedProcess("cmd.exe", ["/d", "/c", "echo {\"decision\":\"deny\"}"],
                Some(Path(invocation.definition.directory)), 5000, 4096, {=> token.cancelled()}, { _ => }, startToken: Some(token))
        }
        return runOwnedProcess("/bin/sh", ["-c", "printf '%s' '{\"decision\":\"deny\"}'"],
            Some(Path(invocation.definition.directory)), 5000, 4096, {=> token.cancelled()}, { _ => }, startToken: Some(token))
    }
}

func automationExecutorTestError(action: () -> Unit): String {
    try { action(); return "" } catch (e: Exception) { return e.message }
}

@Test
func automationExecutorDeclarationLoadExecutionAreSeparate() {
    let f = AutomationExecutorFixture(); let runner = AutomationFixtureRunner(); let executor = f.executor(runner: Some(runner))
    try {
        @Expect(executor.open(), true)
        let d = f.definition(); let declared = executor.declare(d)
        @Expect(declared.declarationStatus, "valid"); @Expect(declared.loadStatus, "not-loaded")
        @Expect(declared.executionStatus, "not-started"); @Expect(runner.calls, Int64(0))
        let loaded = executor.load(d.taskId, d.digest)
        @Expect(loaded.loadStatus, "loaded"); @Expect(loaded.executionStatus, "not-started")
        @Expect(loaded.agentPresetId, "preset-test"); @Expect(runner.calls, Int64(0))
    } finally { executor.close(); f.tidy() }
}

@Test
func automationExecutorRequiresOwnedJournalAndSingleOwner() {
    let f = AutomationExecutorFixture(); let first = f.executor(); let second = f.executor()
    try {
        @Expect(automationExecutorTestError({=> first.declare(f.definition()); () }), "automation-executor-not-owned")
        @Expect(first.open(), true); @Expect(second.open(), false)
        @Expect(first.close(), true)
        @Expect(second.open(), true)
    } finally { first.close(); second.close(); f.tidy() }
}

@Test
func automationExecutorNoRunnerIsBlockedNotSuccessful() {
    let f = AutomationExecutorFixture(); let executor = f.executor()
    try {
        @Expect(executor.open(), true); f.mount(executor, f.definition())
        let fire = f.fire(executor)
        @Expect(fire.executorAvailable, false); @Expect(fire.executionStatus, "blocked")
        @Expect(fire.reason, "automation-executor-unavailable"); @Expect(fire.exitObserved, false)
    } finally { executor.close(); f.tidy() }
}

@Test
func automationExecutorUnattendedOnlyWaitsForApproval() {
    let f = AutomationExecutorFixture(); let runner = AutomationFixtureRunner(); let executor = f.executor(runner: Some(runner))
    try {
        @Expect(executor.open(), true); f.mount(executor, f.definition()); let fire = f.fire(executor)
        @Expect(fire.executionStatus, "waiting-approval"); @Expect(fire.approvalId > 0, true)
        @Expect(executor.execute(fire.fireId).executionStatus, "waiting-approval"); @Expect(runner.calls, Int64(0))
        f.now += 120; executor.tick()
        @Expect(executor.describe("task-1").fireId, fire.fireId); @Expect(runner.calls, Int64(0))
    } finally { executor.close(); f.tidy() }
}

@Test
func automationExecutorApprovedFireRunsAfterDurableAdmissionOnce() {
    let f = AutomationExecutorFixture(); let runner = AutomationFixtureRunner(); let executor = f.executor(runner: Some(runner))
    try {
        @Expect(executor.open(), true); let d = f.definition(); f.mount(executor, d)
        let fire = f.fire(executor); @Expect(executor.approvals.answer(fire.approvalId, "allowed-once"), true)
        let result = executor.execute(fire.fireId)
        @Expect(result.executionStatus, "succeeded"); @Expect(result.hookDecision, "allow")
        @Expect(result.exitObserved, true); @Expect(result.exitCode, Int64(0)); @Expect(runner.observedStarted, true)
        @Expect(runner.input.contains("ScheduleFire"), true); @Expect(runner.input.contains(d.agentPresetId), true)
        executor.execute(fire.fireId); executor.tick()
        @Expect(runner.calls, Int64(1)); @Expect(executor.describe(d.taskId).fireId, fire.fireId)
    } finally { executor.close(); f.tidy() }
}

@Test
func automationExecutorDeniedApprovalNeverCallsRunner() {
    let f = AutomationExecutorFixture(); let runner = AutomationFixtureRunner(); let executor = f.executor(runner: Some(runner))
    try {
        @Expect(executor.open(), true); f.mount(executor, f.definition()); let fire = f.fire(executor)
        @Expect(executor.approvals.answer(fire.approvalId, "denied"), true)
        let result = executor.execute(fire.fireId)
        @Expect(result.executionStatus, "blocked"); @Expect(result.reason, "automation-approval-denied")
        @Expect(runner.calls, Int64(0))
    } finally { executor.close(); f.tidy() }
}

@Test
func automationExecutorExpiredApprovalNeverAllows() {
    let f = AutomationExecutorFixture(); let runner = AutomationFixtureRunner(); let executor = f.executor(runner: Some(runner))
    try {
        @Expect(executor.open(), true); f.mount(executor, f.definition()); let fire = f.fire(executor)
        f.approvalNow = 301
        let result = executor.execute(fire.fireId)
        @Expect(result.executionStatus, "blocked"); @Expect(result.reason, "automation-approval-expired")
        @Expect(runner.calls, Int64(0))
    } finally { executor.close(); f.tidy() }
}

@Test
func automationExecutorWrongToolTicketCannotReplaceFireApproval() {
    let f = AutomationExecutorFixture(); let runner = AutomationFixtureRunner(); let executor = f.executor(runner: Some(runner))
    try {
        @Expect(executor.open(), true); f.mount(executor, f.definition()); let fire = f.fire(executor)
        let other = executor.approvals.askForCall("execution/start", "other-operation")
        executor.approvals.answer(other, "allowed-once")
        @Expect(executor.execute(fire.fireId).executionStatus, "waiting-approval"); @Expect(runner.calls, Int64(0))
    } finally { executor.close(); f.tidy() }
}

@Test
func automationExecutorDefaultSkipDoesNotCatchUpMissedMinutes() {
    let f = AutomationExecutorFixture(); let runner = AutomationFixtureRunner(); let executor = f.executor(runner: Some(runner))
    try {
        @Expect(executor.open(), true); f.mount(executor, f.definition())
        executor.tick(); @Expect(executor.describe("task-1").executionStatus, "not-started")
        f.now += 600; executor.tick(); let fire = executor.describe("task-1")
        @Expect(fire.missedMinutes, Int64(9)); @Expect(executor.approvals.pendingCount(), Int64(1))
        @Expect(runner.calls, Int64(0))
    } finally { executor.close(); f.tidy() }
}

@Test
func automationExecutorCronMismatchDoesNotAdmit() {
    let f = AutomationExecutorFixture(); let runner = AutomationFixtureRunner(); let executor = f.executor(runner: Some(runner))
    try {
        @Expect(executor.open(), true); f.mount(executor, f.definition(cron: "0 9 * * *"))
        f.now += 60; executor.tick()
        @Expect(executor.describe("task-1").executionStatus, "not-started"); @Expect(runner.calls, Int64(0))
        f.now = 1704099600 // 同日09:00 UTC，只评估这一分钟，旧分钟不补发。
        executor.tick(); @Expect(executor.describe("task-1").executionStatus, "waiting-approval")
    } finally { executor.close(); f.tidy() }
}

@Test
func automationExecutorRejectsUnsupportedCronWithoutChangingSharedParser() {
    let f = AutomationExecutorFixture()
    try {
        for (cron in ["* * * *", "* * * * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "*/0 * * * *",
            "5/2 * * * *", "5-1 * * * *", "* * * JAN *", "* * * * 8", "*,,2 * * * *"]) {
            @Expect(automationExecutorTestError({=> f.definition(cron: cron); () }), "automation-bad-cron")
        }
        let accepted = f.definition(cron: "*/15 0-23 * * 0,7")
        @Expect(accepted.cron, "*/15 0-23 * * 0,7")
    } finally { f.tidy() }
}

@Test
func automationExecutorClockRollbackDoesNotRefire() {
    let f = AutomationExecutorFixture(); let runner = AutomationFixtureRunner(); let executor = f.executor(runner: Some(runner))
    try {
        @Expect(executor.open(), true); f.mount(executor, f.definition()); let fire = f.fire(executor)
        executor.approvals.answer(fire.approvalId, "allowed-once"); executor.execute(fire.fireId)
        f.now -= 60; executor.tick(); f.now += 60; executor.tick()
        @Expect(executor.describe("task-1").fireId, fire.fireId); @Expect(runner.calls, Int64(1))
    } finally { executor.close(); f.tidy() }
}

@Test
func automationExecutorContentChangeMakesLoadStaleAndOldApprovalBlocked() {
    let f = AutomationExecutorFixture(); let runner = AutomationFixtureRunner(); let executor = f.executor(runner: Some(runner))
    try {
        @Expect(executor.open(), true); f.mount(executor, f.definition()); let fire = f.fire(executor)
        executor.approvals.answer(fire.approvalId, "allowed-once")
        let revised = f.definition(command: "修改后的另一命令")
        @Expect(executor.declare(revised).loadStatus, "stale")
        @Expect(executor.execute(fire.fireId).reason, "automation-definition-stale")
        executor.load(revised.taskId, revised.digest); executor.tick()
        @Expect(runner.calls, Int64(0)); @Expect(executor.describe(revised.taskId).fireId, fire.fireId)
    } finally { executor.close(); f.tidy() }
}

@Test
func automationExecutorCancellationAndUnloadBlockBeforeStart() {
    let f = AutomationExecutorFixture(); let runner = AutomationFixtureRunner(); let executor = f.executor(runner: Some(runner))
    try {
        @Expect(executor.open(), true); f.mount(executor, f.definition()); let fire = f.fire(executor)
        executor.approvals.answer(fire.approvalId, "allowed-once"); executor.cancel(fire.fireId)
        @Expect(executor.execute(fire.fireId).executionStatus, "blocked"); @Expect(runner.calls, Int64(0))
        let next = f.fire(executor); executor.unload("task-1")
        @Expect(executor.execute(next.fireId).loadStatus, "not-loaded"); @Expect(runner.calls, Int64(0))
    } finally { executor.close(); f.tidy() }
}

@Test
func automationExecutorNonzeroTimeoutAndAllowDecisionNeverFakeSuccess() {
    let f = AutomationExecutorFixture(); let runner = AutomationFixtureRunner(); let executor = f.executor(runner: Some(runner))
    try {
        @Expect(executor.open(), true); f.mount(executor, f.definition())
        runner.result = Some(ShellResult(7, "{\"decision\":\"allow\"}", "", false, ""))
        let fire = f.fire(executor); executor.approvals.answer(fire.approvalId, "allowed-once")
        @Expect(executor.execute(fire.fireId).executionStatus, "failed")
        runner.result = Some(ShellResult(0, "{\"decision\":\"allow\"}", "", true, ""))
        let second = f.fire(executor); executor.approvals.answer(second.approvalId, "allowed-once")
        @Expect(executor.execute(second.fireId).executionStatus, "timed-out")
    } finally { executor.close(); f.tidy() }
}

@Test
func automationExecutorHookDecisionSeparateFromProcessOutcome() {
    let f = AutomationExecutorFixture(); let runner = AutomationFixtureRunner(); let executor = f.executor(runner: Some(runner))
    try {
        @Expect(executor.open(), true); f.mount(executor, f.definition())
        runner.result = Some(ShellResult(0, "{\"decision\":\"deny\"}", "", false, ""))
        let fire = f.fire(executor); executor.approvals.answer(fire.approvalId, "allowed-once")
        let result = executor.execute(fire.fireId)
        @Expect(result.executionStatus, "succeeded"); @Expect(result.hookDecision, "deny")
    } finally { executor.close(); f.tidy() }
}

@Test
func automationExecutorBadOrTruncatedOutputIsNotSuccessful() {
    let f = AutomationExecutorFixture(); let runner = AutomationFixtureRunner(); let executor = f.executor(runner: Some(runner))
    try {
        @Expect(executor.open(), true); f.mount(executor, f.definition())
        runner.result = Some(ShellResult(0, "not-json", "", false, ""))
        let fire = f.fire(executor); executor.approvals.answer(fire.approvalId, "allowed-once")
        @Expect(executor.execute(fire.fireId).reason, "automation-hook-output-invalid")
        runner.result = Some(ShellResult(0, "{\"decision\":\"allow\"}", "", false, "", stdoutTruncated: true))
        let second = f.fire(executor); executor.approvals.answer(second.approvalId, "allowed-once")
        @Expect(executor.execute(second.fireId).reason, "automation-hook-output-limited")
    } finally { executor.close(); f.tidy() }
}

@Test
func automationExecutorExceptionUnknownDoesNotReplayOrLeakError() {
    let f = AutomationExecutorFixture(); let runner = AutomationFixtureRunner(); let executor = f.executor(runner: Some(runner))
    try {
        @Expect(executor.open(), true); f.mount(executor, f.definition()); runner.throwOnRun = true
        let fire = f.fire(executor); executor.approvals.answer(fire.approvalId, "allowed-once")
        let result = executor.execute(fire.fireId)
        @Expect(result.executionStatus, "unknown"); @Expect(result.reason.contains("secret"), false)
        executor.execute(fire.fireId); f.now += 60; executor.tick()
        @Expect(runner.calls, Int64(1)); @Expect(executor.describe("task-1").fireId, fire.fireId)
    } finally { executor.close(); f.tidy() }
}

@Test
func automationExecutorRestartNeverRestoresApprovalOrLoadedState() {
    let f = AutomationExecutorFixture(); let runner = AutomationFixtureRunner()
    let first = f.executor(runner: Some(runner)); let recovered = f.executor(runner: Some(runner))
    try {
        @Expect(first.open(), true); f.mount(first, f.definition()); let fire = f.fire(first)
        first.approvals.answer(fire.approvalId, "allowed-once"); first.journal.flush(); first.close()
        f.now += 600; @Expect(recovered.open(), true)
        let declared = recovered.declare(f.definition())
        @Expect(declared.loadStatus, "not-loaded"); @Expect(declared.executionStatus, "unknown")
        recovered.load("task-1", f.definition().digest); recovered.tick()
        @Expect(recovered.execute(fire.fireId).executionStatus, "unknown"); @Expect(runner.calls, Int64(0))
        f.now += 60; recovered.tick(); @Expect(runner.calls, Int64(0))
    } finally { first.close(); recovered.close(); f.tidy() }
}

@Test
func automationExecutorRestartSkipsElapsedScheduleNotCatchup() {
    let f = AutomationExecutorFixture(); let runner = AutomationFixtureRunner()
    let first = f.executor(runner: Some(runner)); let second = f.executor(runner: Some(runner))
    try {
        @Expect(first.open(), true); f.mount(first, f.definition()); first.close()
        f.now += 3600; @Expect(second.open(), true); f.mount(second, f.definition())
        second.tick(); @Expect(second.describe("task-1").executionStatus, "not-started")
        let fire = f.fire(second); @Expect(fire.executionStatus, "waiting-approval")
        @Expect(second.approvals.pendingCount(), Int64(1)); @Expect(runner.calls, Int64(0))
    } finally { first.close(); second.close(); f.tidy() }
}

@Test
func automationExecutorPersistenceFailureBeforeRunDoesNotExecute() {
    let f = AutomationExecutorFixture(); let runner = AutomationFixtureRunner(); let executor = f.executor(runner: Some(runner))
    try {
        @Expect(executor.open(), true); f.mount(executor, f.definition()); let fire = f.fire(executor)
        executor.approvals.answer(fire.approvalId, "allowed-once"); executor.journal.freezeAfterDurableFailure()
        @Expect(automationExecutorTestError({=> executor.execute(fire.fireId); () }), "automation-executor-not-owned")
        @Expect(runner.calls, Int64(0))
    } finally { executor.close(); f.tidy() }
}

@Test
func automationExecutorPersistenceFailureAfterRunReportsUnknown() {
    let f = AutomationExecutorFixture(); let runner = AutomationFixtureRunner(); let executor = f.executor(runner: Some(runner))
    try {
        @Expect(executor.open(), true); f.mount(executor, f.definition()); let fire = f.fire(executor)
        executor.approvals.answer(fire.approvalId, "allowed-once"); runner.freezeJournal = Some(executor.journal)
        let result = executor.execute(fire.fireId)
        @Expect(result.executionStatus, "unknown"); @Expect(result.reason, "automation-persistence-failed")
        @Expect(runner.calls, Int64(1))
    } finally { executor.close(); f.tidy() }
}

@Test
func automationExecutorRealFixedProcessAfterApproval() {
    let f = AutomationExecutorFixture(); let runner = AutomationFixedProcessRunner(); let executor = f.executor(runner: Some(runner))
    try {
        @Expect(executor.open(), true); f.mount(executor, f.definition(command: "fixed-synthetic-command"))
        let fire = f.fire(executor); @Expect(runner.calls, Int64(0))
        executor.approvals.answer(fire.approvalId, "allowed-once"); let result = executor.execute(fire.fireId)
        @Expect(result.exitObserved, true); @Expect(result.exitCode, Int64(0))
        @Expect(result.executionStatus, "succeeded"); @Expect(result.hookDecision, "deny")
        @Expect(runner.calls, Int64(1))
    } finally { executor.close(); f.tidy() }
}

@Test
func automationExecutorSharedShellHonorsPreCancelledToken() {
    let f = AutomationExecutorFixture()
    let shell = ShellExecutor(workingDirectory: f.root, sandboxRuntime: SandboxRuntime.withoutBackend())
    let runner = AutomationShellHookRunner(shell, f.root); let executor = f.executor(runner: Some(runner))
    try {
        @Expect(executor.open(), true)
        let definition = f.definition(command: "echo forbidden > must-not-exist")
        let invocation = AutomationHookInvocation("synthetic-pre-cancelled", definition, f.now / 60, f.path)
        let token = TurnToken(); token.cancel()
        @Expect(runner.execute(invocation, token).isNone(), true)
        @Expect(exists(f.root + "/must-not-exist"), false)
    } finally { executor.close(); f.tidy() }
}

@Test
func automationExecutorUnobservedExitDoesNotBecomeSuccess() {
    let f = AutomationExecutorFixture(); let runner = AutomationFixtureRunner(); let executor = f.executor(runner: Some(runner))
    try {
        @Expect(executor.open(), true); f.mount(executor, f.definition())
        runner.result = Some(ShellResult(0, "{\"decision\":\"allow\"}", "", false, "", exitObserved: false))
        let fire = f.fire(executor); executor.approvals.answer(fire.approvalId, "allowed-once")
        let result = executor.execute(fire.fireId)
        @Expect(result.executionStatus, "unknown"); @Expect(result.exitObserved, false)
        @Expect(executor.approvalArguments(fire.fireId).contains("合成命令"), true)
    } finally { executor.close(); f.tidy() }
}

@Test
func automationExecutorRejectsMixedConfigurationJournal() {
    let f = AutomationExecutorFixture(); let executor = f.executor()
    try {
        // 配置存储与运行存储必须独立；错误装配不改写或吞掉配置事实。
        let log = SessionLog(f.path); log.append("schedule/task", "register::foreign::* * * * *")
        @Expect(log.flush(), true)
        @Expect(executor.open(), false)
        let after = SessionLog(f.path); @Expect(after.load(), true)
        @Expect(after.snapshotEvents().size, Int64(1))
    } finally { executor.close(); f.tidy() }
}
