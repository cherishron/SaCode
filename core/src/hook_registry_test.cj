package core

import std.unittest.*
import std.collection.HashMap

@Test
public func testHookEventEnumExists() {
    let e = HookEvent.PreToolUse
    @Expect(e, HookEvent.PreToolUse)
}

@Test
public func testHookInputStructExists() {
    let input = HookInput(
        sessionId: "s1",
        transcriptPath: "/tmp/s1.jsonl",
        cwd: "/tmp",
        hookEventName: "PreToolUse",
        timestamp: 1000,
        eventSpecific: HookEventData.Tool("run_shell_command", "{}")
    )
    @Expect(input.sessionId, "s1")
    @Expect(input.agentId, None<String>)
    @Expect(input.agentType, None<String>)
}

@Test
public func testHookResultStructExists() {
    let result = HookResult(
        decision: HookDecision.Allow,
        continueFlag: true,
        suppressOutput: false
    )
    @Expect(result.decision, HookDecision.Allow)
    @Expect(result.continueFlag, true)
    @Expect(result.suppressOutput, false)
}

@Test
public func testExecuteCommandExit2ReturnsDeny() {
    let result = HookExecutor.executeCommand(
        "exit 2",
        None,
        HashMap<String, String>(),
        HookInput(
            sessionId: "s1",
            transcriptPath: "/tmp/s1.jsonl",
            cwd: "/tmp",
            hookEventName: "PreToolUse",
            timestamp: 1000,
            eventSpecific: HookEventData.Tool("run_shell_command", "{}")
        ),
        30000
    )
    @Assert(result.decision == HookDecision.Deny)
}

@Test
public func testExecuteHttpPrivateIpDenied() {
    let result = HookExecutor.executeHttp(
        "http://10.0.0.1/hook",
        HashMap<String, String>(),
        Array<String>(),
        HookInput(
            sessionId: "s1",
            transcriptPath: "/tmp/s1.jsonl",
            cwd: "/tmp",
            hookEventName: "PreToolUse",
            timestamp: 1000,
            eventSpecific: HookEventData.Tool("run_shell_command", "{}")
        ),
        5000
    )
    @Assert(result.decision == HookDecision.Deny)
}

@Test
public func testExecuteHttpCloudMetadataBlocked() {
    let result = HookExecutor.executeHttp(
        "http://169.254.169.254/latest/meta-data/",
        HashMap<String, String>(),
        Array<String>(),
        HookInput(
            sessionId: "s1",
            transcriptPath: "/tmp/s1.jsonl",
            cwd: "/tmp",
            hookEventName: "PreToolUse",
            timestamp: 1000,
            eventSpecific: HookEventData.Tool("run_shell_command", "{}")
        ),
        5000
    )
    @Assert(result.decision == HookDecision.Deny)
}

@Test
public func testRegisterDuplicateIdThrows() {
    let reg = HookRegistry()
    let r1 = HookRule(
        id: "r1",
        event: HookEvent.PreToolUse,
        matcher: "*",
        executor: HookExecutorConfig.Command("echo", None, HashMap<String, String>()),
        timeout: 30000,
        asyncExecute: false
    )
    reg.register(r1)
    try {
        reg.register(r1)
        @Assert(false)
    } catch (e: Exception) {
        @Assert(e.message == "duplicate-hook-rule-id")
    }
}

@Test
public func testMatchWildcardReturnsAllActive() {
    let reg = HookRegistry()
    let r1 = HookRule(
        id: "r1",
        event: HookEvent.PreToolUse,
        matcher: "*",
        executor: HookExecutorConfig.Command("echo", None, HashMap<String, String>()),
        timeout: 60000,
        asyncExecute: false
    )
    let r2 = HookRule(
        id: "r2",
        event: HookEvent.PreToolUse,
        matcher: "run_.*",
        executor: HookExecutorConfig.Command("echo", None, HashMap<String, String>()),
        timeout: 60000,
        asyncExecute: false
    )
    reg.register(r1)
    reg.register(r2)
    let matched = reg.findMatchingRules(HookEvent.PreToolUse, "run_shell_command")
    @Assert(matched.size == 2)
}

@Test
public func testDispatchDenyPriority() {
    let reg = HookRegistry()
    let allowRule = HookRule(
        id: "r1",
        event: HookEvent.PreToolUse,
        matcher: "*",
        executor: HookExecutorConfig.Command("echo", None, HashMap<String, String>()),
        timeout: 30000,
        asyncExecute: false
    )
    let denyRule = HookRule(
        id: "r2",
        event: HookEvent.PreToolUse,
        matcher: "*",
        executor: HookExecutorConfig.Command("exit 2", None, HashMap<String, String>()),
        timeout: 30000,
        asyncExecute: false
    )
    reg.register(allowRule)
    reg.register(denyRule)
    let input = HookInput(
        sessionId: "s1",
        transcriptPath: "/tmp/s1.jsonl",
        cwd: "/tmp",
        hookEventName: "PreToolUse",
        timestamp: 1000,
        eventSpecific: HookEventData.Tool("run_shell_command", "{}")
    )
    let result = reg.dispatch(HookEvent.PreToolUse, input, "run_shell_command")
    @Assert(result.decision == HookDecision.Deny)
}

@Test
public func testUnregisterSoftDelete() {
    let reg = HookRegistry()
    let r1 = HookRule(
        id: "r1",
        event: HookEvent.PreToolUse,
        matcher: "*",
        executor: HookExecutorConfig.Command("echo", None, HashMap<String, String>()),
        timeout: 30000,
        asyncExecute: false
    )
    reg.register(r1)
    reg.unregister("r1")
    let matched = reg.findMatchingRules(HookEvent.PreToolUse, "run_shell_command")
    @Assert(matched.size == 0)
}
