package core

import std.unittest.*

@Test
public func testHookEventEnumExists() {
    let e = HookEvent.PreToolUse
    assert(e != null)
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
    assert(input != null)
}

@Test
public func testHookResultStructExists() {
    let result = HookResult(
        decision: HookDecision.Allow,
        continueFlag: true,
        suppressOutput: false
    )
    assert(result != null)
}

@Test
public func testExecuteCommandExit2ReturnsDeny() {
    let result = HookExecutor.executeCommand(
        "exit 2",
        Option.none<String>(),
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
    assert(result.decision == HookDecision.Deny)
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
    assert(result.decision == HookDecision.Deny)
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
    assert(result.decision == HookDecision.Deny)
}

@Test
public func testRegisterDuplicateIdThrows() {
    let reg = HookRegistry()
    let r1 = HookRule(
        id: "r1",
        event: HookEvent.PreToolUse,
        matcher: "*",
        executor: HookExecutorConfig.Command("echo", Option.none<String>(), HashMap<String, String>()),
        timeout: 30000,
        asyncExecute: false
    )
    reg.register(r1)
    try {
        reg.register(r1)
        assert(false)
    } catch (e: Exception) {
        assert(e.message == "duplicate-hook-rule-id")
    }
}

@Test
public func testMatchWildcardReturnsAllActive() {
    let reg = HookRegistry()
    let r1 = HookRule(
        id: "r1",
        event: HookEvent.PreToolUse,
        matcher: "*",
        executor: HookExecutorConfig.Command("echo", Option.none<String>(), HashMap<String, String>()),
        timeout: 60000,
        asyncExecute: false
    )
    let r2 = HookRule(
        id: "r2",
        event: HookEvent.PreToolUse,
        matcher: "run_.*",
        executor: HookExecutorConfig.Command("echo", Option.none<String>(), HashMap<String, String>()),
        timeout: 60000,
        asyncExecute: false
    )
    reg.register(r1)
    reg.register(r2)
    let matched = reg.match(HookEvent.PreToolUse, "run_shell_command")
    assert(matched.size == 2)
}

@Test
public func testDispatchDenyPriority() {
    let reg = HookRegistry()
    let allowRule = HookRule(
        id: "r1",
        event: HookEvent.PreToolUse,
        matcher: "*",
        executor: HookExecutorConfig.Command("echo", Option.none<String>(), HashMap<String, String>()),
        timeout: 30000,
        asyncExecute: false
    )
    let denyRule = HookRule(
        id: "r2",
        event: HookEvent.PreToolUse,
        matcher: "*",
        executor: HookExecutorConfig.Command("exit 2", Option.none<String>(), HashMap<String, String>()),
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
    assert(result.decision == HookDecision.Deny)
}

@Test
public func testUnregisterSoftDelete() {
    let reg = HookRegistry()
    let r1 = HookRule(
        id: "r1",
        event: HookEvent.PreToolUse,
        matcher: "*",
        executor: HookExecutorConfig.Command("echo", Option.none<String>(), HashMap<String, String>()),
        timeout: 30000,
        asyncExecute: false
    )
    reg.register(r1)
    reg.unregister("r1")
    let matched = reg.match(HookEvent.PreToolUse, "run_shell_command")
    assert(matched.size == 0)
}
