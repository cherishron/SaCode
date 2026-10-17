package core

import std.env.*
import std.fs.*
import std.process.*
import std.convert.*
import std.sync.*

// 只接受操作者显式指定的可信绝对路径，不从工作区或 PATH 发现可执行代码。
func computerRuntimePath(key: String): Path {
    let value = getVariable(key) ?? ""
    if (value.size == 0) { throw Exception("computer-use-missing:${key}") }
    let path = Path(value)
    if (!path.isAbsolute()) { throw Exception("computer-use-path-not-absolute:${key}") }
    if (!exists(path) || !FileInfo(path).isRegular()) { throw Exception("computer-use-path-not-file:${key}") }
    return canonicalize(path)
}

func computerRuntimeSupportsNode(raw: String): Bool {
    let version = raw.trimAscii()
    if (!version.startsWith("v")) { return false }
    let parts = version[1..].split(".")
    if (parts.size != 3) { return false }
    try {
        for (part in parts) {
            if (part.size == 0) { return false }
            for (byte in part.toArray()) { if (byte < 48 || byte > 57) { return false } }
        }
        return Int64.parse(parts[0]) >= 22
    } catch (_: Exception) { return false }
}

public class ComputerRuntime {
    public let executor: ComputerToolExecutor
    let client: ComputerProviderClient
    let closed = AtomicBool(false)

    private init(log: SessionLog, client: ComputerProviderClient) {
        this.client = client
        this.executor = ComputerToolExecutor(log, { verb, args, token => client.invoke(verb, args, token: token) })
    }

    public static func openFromEnvironment(log: SessionLog): ?ComputerRuntime {
        let enabled = getVariable("SACODE_COMPUTER_USE") ?? ""
        if (enabled == "" || enabled == "0") { return None }
        if (enabled != "1") { throw Exception("computer-use-invalid-switch:SACODE_COMPUTER_USE") }
        let node = computerRuntimePath("SACODE_COMPUTER_NODE")
        let provider = computerRuntimePath("SACODE_COMPUTER_PROVIDER")
        // 版本探测只执行已由操作者选定的 Node；不加载 provider 或 SDK。
        let (code, output, _) = executeWithOutput(node.toString(), ["--version"], workingDirectory: Some(provider.parent))
        if (code != 0 || !computerRuntimeSupportsNode(String.fromUtf8(output))) {
            throw Exception("computer-use-node-version-required:22")
        }
        let client = ComputerProviderClient(node.toString(), [provider.toString()], workingDirectory: provider.parent)
        try {
            if (!client.start()) { throw Exception("computer-use-provider-start-failed") }
            return Some(ComputerRuntime(log, client))
        } catch (e: Exception) { client.close(); throw e }
    }

    // 入口工作线程在 finally 关闭：不用等待客户端 poll，也不保留跨目标的桌面进程。
    public func close(): Unit {
        if (!closed.swap(true)) { client.close() }
    }
}
