package core

import std.collection.*
import std.env.getVariables
import std.env.getVariable
import std.fs.*
import std.io.*
import std.process.*
import stdx.encoding.json.*

// Host 与 CLI 共用可信启动位置解析；模型或页面参数没有此入口。
func openCodeFromWindowsSearchPath(searchPath: String): String {
    for (entry in searchPath.split(";", removeEmpty: true)) {
        try {
            let directory = Path(entry.trimAscii())
            if (!directory.isAbsolute()) {
                continue
            }
            let native = directory.join("opencode.exe")
            if (exists(native) && !FileInfo(native).isDirectory()) {
                return canonicalize(native).toString()
            }
            let shim = directory.join("opencode.cmd")
            if (!exists(shim)) {
                continue
            }
            let packageRoot = directory.join("node_modules").join("@opencode").join("cli")
            let manifestPath = packageRoot.join("package.json")
            if (FileInfo(shim).size > 65536 || FileInfo(manifestPath).size > 65536) {
                continue
            }
            let manifest = JsonValue.fromStr(String.fromUtf8(File.readFrom(manifestPath))).asObject()
            if (manifest.get("name").getOrThrow().asString().getValue() != "@opencode/cli" ||
                manifest.get("bin").getOrThrow().asObject().get("opencode").getOrThrow().asString().getValue() !=
                "./bin/opencode.exe") {
                continue
            }
            let script = String.fromUtf8(File.readFrom(shim))
            if (!script.contains("\\node_modules\\@opencode\\cli\\bin\\opencode.exe")) {
                continue
            }
            let executable = packageRoot.join("bin").join("opencode.exe")
            if (exists(executable) && !FileInfo(executable).isDirectory()) {
                return canonicalize(executable).toString()
            }
        } catch (_: Exception) {
            continue
        }
    }
    throw Exception("provider-unavailable:opencode-executable-not-configured")
}

public func configuredOpenCodeExecutable(): String {
    let configured = getVariable("SACODE_ACP_OPENCODE_EXECUTABLE") ?? ""
    if (configured.size > 0) {
        return canonicalize(configured).toString()
    }
    // Windows 只看显式 PATH 绝对目录；不搜索当前目录，不经 shell 执行 --version。
    return openCodeFromWindowsSearchPath(getVariable("PATH") ?? getVariable("Path") ?? "")
}

public func openCodeReadinessJson(report: AcpProviderReadiness): String {
    let result = JsonObject()
    result.put("peerId", JsonString("opencode"));
    result.put("environment", JsonString(report.environment))
    result.put("localCredentialPrecondition", JsonBool(report.authenticated));
    result.put("verdict", JsonString(report.verdict))
    result.put("protocolVersion", JsonInt(report.protocolVersion));
    result.put("evidence", JsonString(report.evidence))
    result.put("modelTaskTested", JsonBool(false))
    return result.toString()
}

// auth list 只作本地配置前提检查；不把存在记录宣称为远端凭据有效或模型任务已通过。
func openCodeLocalCredentialRecords(raw: String): Bool {
    let records = JsonValue.fromStr(raw).asArray()
    if (records.size() == 0) {
        return false
    }
    if (records.size() > 256) {
        throw Exception("opencode-auth-list-too-large")
    }
    for (i in 0..records.size()) {
        if (records.get(i).getOrThrow().asObject().size() == 0) {
            throw Exception("opencode-auth-list-invalid-record")
        }
    }
    return true
}

// 达到留存上限后仍排空双流，不让子进程因管道反压卡死；从不回显认证列表。
func openCodeProbeOutput(input: InputStream, keep: Bool): String {
    let retained = ArrayList<Byte>()
    let buffer = Array<Byte>(4096, repeat: 0)
    var total: Int64 = 0
    while (true) {
        let n = input.read(buffer)
        if (n == 0) {
            break
        }
        total += n
        if (keep && total <= 65536) {
            for (i in 0..n) {
                retained.add(buffer[i])
            }
        }
    }
    if (keep && total > 65536) {
        throw Exception("opencode-auth-list-too-large")
    }
    return String.fromUtf8(retained.toArray())
}

// 内置 OpenCode 插件适配器；只有可信装配代码能指定二进制和环境，RPC 不接受它们。
public class OpenCodeAcpProvider <: AcpProvider {
    let command: String
    let environment: Array<(String, String)>
    public init(command: String, environment!: Array<(String, String)> = []) {
        this.command = canonicalize(command).toString()
        this.environment = Array<(String, String)>(environment.size, {i => environment[i]})
    }
    public func peerId(): String {
        return "opencode"
    }
    public func open(workspace: String): AcpProcess {
        return AcpProcess(command, ["acp", "--log-level", "none"], workingDirectory: canonicalize(workspace),
            environment: environment)
    }
    public func probe(workspace: String): AcpProviderReadiness {
        var stage = "launch"
        try {
            let inherited = HashMap<String, String>(getVariables())
            for ((key, value) in environment) {
                inherited[key] = value
            }
            let childEnvironment: Map<String, String> = inherited
            let child = launch(command, ["auth", "list", "--format", "json", "--standalone", "--log-level", "none"],
                workingDirectory: Some(canonicalize(workspace)), environment: Some(childEnvironment),
                stdIn: ProcessRedirect.Discard, stdOut: ProcessRedirect.Pipe, stdErr: ProcessRedirect.Pipe)
            let output = spawn {=> openCodeProbeOutput(child.stdOutPipe, true)}
            let errors = spawn {=> openCodeProbeOutput(child.stdErrPipe, true)}
            stage = "wait"
            var exit: Int64 = -1
            try {
                exit = child.wait(timeout: 10000 * Duration.millisecond)
            } catch (_: Exception) {
                child.terminate(force: true)
                child.wait(timeout: 2000 * Duration.millisecond)
            }
            stage = "drain"
            let raw = output.get(2000 * Duration.millisecond)
            let diagnostic = errors.get(2000 * Duration.millisecond)
            stage = "exit-${exit}"
            if (diagnostic.contains("EPERM") || diagnostic.contains("Permission denied") || diagnostic.contains(
                "Access is denied")) {
                let logFile = diagnostic.contains(".log") && (diagnostic.contains("\\log\\") || diagnostic.contains(
                    "/log/"))
                stage += if (logFile) {
                    "-log-file-permission-denied"
                } else {
                    "-permission-denied"
                }
            }
            if (exit != 0) {
                throw Exception("opencode-auth-list-failed")
            }
            stage = "json-shape"
            if (!openCodeLocalCredentialRecords(raw)) {
                return AcpProviderReadiness("installed-auth-missing", false, "pending-verification", 0,
                    "opencode-auth-list-empty:no-task")
            }
        } catch (_: Exception) {
            return AcpProviderReadiness("probe-failed-unknown", false, "pending-verification", 0,
                "opencode-local-auth-${stage}-unconfirmed:no-task")
        }
        let protocol = AcpProtocolProvider("opencode", command, ["acp", "--log-level", "none"],
            authentication: {=> true}, environment: environment)
        let report = protocol.probe(workspace)
        return AcpProviderReadiness(report.environment, report.authenticated, report.verdict, report.protocolVersion,
            report.evidence + ";local-credential-records-present;remote-model-not-tested")
    }
}
