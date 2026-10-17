package core

import std.env.*
import std.fs.*
import std.unittest.*

// 环境是进程全局资源：本组串行执行并在 finally 逐项还原，不能污染其他用例。
@Test
func computerRuntimeEnvironmentBoundary() {
    let keys = ["SACODE_COMPUTER_USE", "SACODE_COMPUTER_NODE", "SACODE_COMPUTER_PROVIDER"]
    let saved = keys.map({ key => getVariable(key) })
    let log = SessionLog("computer-runtime-boundary.log")
    try {
        for (key in keys) { removeVariable(key) }
        @Expect(ComputerRuntime.openFromEnvironment(log).isNone(), true)
        setVariable("SACODE_COMPUTER_NODE", "node")
        setVariable("SACODE_COMPUTER_PROVIDER", "computer-use/provider.mjs")
        @Expect(ComputerRuntime.openFromEnvironment(log).isNone(), true)
        setVariable("SACODE_COMPUTER_USE", "true")
        @Expect(computerRuntimeOpenError(log), "computer-use-invalid-switch:SACODE_COMPUTER_USE")
        setVariable("SACODE_COMPUTER_USE", "1")
        removeVariable("SACODE_COMPUTER_NODE")
        @Expect(computerRuntimeOpenError(log), "computer-use-missing:SACODE_COMPUTER_NODE")
        setVariable("SACODE_COMPUTER_NODE", "node")
        @Expect(computerRuntimeOpenError(log), "computer-use-path-not-absolute:SACODE_COMPUTER_NODE")
        setVariable("SACODE_COMPUTER_NODE", getWorkingDirectory().join("missing-trusted-node.exe").toString())
        @Expect(computerRuntimeOpenError(log), "computer-use-path-not-file:SACODE_COMPUTER_NODE")
        setVariable("SACODE_COMPUTER_NODE", getWorkingDirectory().toString())
        @Expect(computerRuntimeOpenError(log), "computer-use-path-not-file:SACODE_COMPUTER_NODE")
        // 先验证两条路径再运行 Node；用本文件当已存在的普通文件，不执行它。
        let source = getWorkingDirectory().join("src/computer_runtime_test.cj").toString()
        setVariable("SACODE_COMPUTER_NODE", source)
        removeVariable("SACODE_COMPUTER_PROVIDER")
        @Expect(computerRuntimeOpenError(log), "computer-use-missing:SACODE_COMPUTER_PROVIDER")
        setVariable("SACODE_COMPUTER_PROVIDER", "computer-use/provider.mjs")
        @Expect(computerRuntimeOpenError(log), "computer-use-path-not-absolute:SACODE_COMPUTER_PROVIDER")
        setVariable("SACODE_COMPUTER_PROVIDER", getWorkingDirectory().join("missing-provider.mjs").toString())
        @Expect(computerRuntimeOpenError(log), "computer-use-path-not-file:SACODE_COMPUTER_PROVIDER")
        setVariable("SACODE_COMPUTER_PROVIDER", getWorkingDirectory().toString())
        @Expect(computerRuntimeOpenError(log), "computer-use-path-not-file:SACODE_COMPUTER_PROVIDER")
        @Expect(log.snapshotEvents().size, Int64(0))
    } finally {
        for (i in 0..keys.size) {
            if (let Some(value) <- saved[i]) { setVariable(keys[i], value) }
            else { removeVariable(keys[i]) }
        }
    }
}

func computerRuntimeOpenError(log: SessionLog): String {
    try {
        if (let Some(runtime) <- ComputerRuntime.openFromEnvironment(log)) { runtime.close() }
        return "unexpected-success"
    } catch (e: Exception) { return e.message }
}

@Test
func computerRuntimeNodeVersionGate() {
    @Expect(computerRuntimeSupportsNode("v22.0.0\n"), true)
    @Expect(computerRuntimeSupportsNode("v24.1.2\r\n"), true)
    for (version in ["v21.9.0", "v20.20.1", "22.0.0", "v22", "v22.x.1", "v22.1.0\nnoise"]) {
        @Expect(computerRuntimeSupportsNode(version), false)
    }
}
