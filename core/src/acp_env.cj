package core

import std.collection.ArrayList
import std.collection.HashMap
import std.sync.*
import std.fs.*
import std.io.*
import std.process.*
import std.env.getVariable

// ACP 环境探测：只读逐产品探测"存在性/路径/版本/ACP 启动方式/认证前提"。
// 不写文件、不安装、不改配置（REQ-E-01~05）。
// 探测失败标"环境未知"而非"未安装"（REQ-E-07）。
// 状态闭集（REQ-E-06）：not-installed / installed-usable / installed-auth-missing /
// entry-unsupported / probe-failed-unknown / pending-verification
// 秘密不回显：只报"认证前提是否满足"，不回显 KEY 值（REQ-E-08）。

public class AcpEnvReport {
    public let product: String
    public let state: String
    public let path: String
    public let version: String
    public let launch: String
    public let authPrecondition: String
    public let evidence: String
    public let probedAt: Int64

    public init(product: String, state: String, path: String, version: String,
        launch: String, authPrecondition: String, evidence: String, probedAt: Int64) {
        this.product = product
        this.state = state
        this.path = path
        this.version = version
        this.launch = launch
        this.authPrecondition = authPrecondition
        this.evidence = evidence
        this.probedAt = probedAt
    }
}

class AcpProductMeta {
    let productId: String
    let command: String
    let authEnvVar: String
    let launchSpec: String
    init(productId: String, command: String, authEnvVar: String, launchSpec: String) {
        this.productId = productId
        this.command = command
        this.authEnvVar = authEnvVar
        this.launchSpec = launchSpec
    }
}

public class AcpEnvProbe {
    let productTable = HashMap<String, AcpProductMeta>()
    let cache = HashMap<String, AcpEnvReport>()
    let mtx = Mutex()

    public init() {
        productTable["opencode"] = AcpProductMeta("opencode", "opencode", "", "opencode acp")
        productTable["codebuddy"] = AcpProductMeta("codebuddy", "codebuddy", "CODEBUDDY_API_KEY", "codebuddy --acp")
        productTable["qoder"] = AcpProductMeta("qoder", "qoder", "QODER_PERSONAL_ACCESS_TOKEN", "qoder --acp")
    }

    public func probe(products: ArrayList<String>, refresh!: Bool = false): ArrayList<AcpEnvReport> {
        let out = ArrayList<AcpEnvReport>()
        for (product in products) {
            out.add(probeOne(product, refresh: refresh))
        }
        return out
    }

    public func probeOne(product: String, refresh!: Bool = false): AcpEnvReport {
        mtx.lock()
        if (!refresh) {
            if (let Some(cached) <- cache.get(product)) {
                mtx.unlock()
                return cached
            }
        }
        mtx.unlock()

        let report = doProbe(product)
        mtx.lock()
        cache[product] = report
        mtx.unlock()
        return report
    }

    private func doProbe(product: String): AcpEnvReport {
        let now = monotonicSeconds()()
        let metaOpt = productTable.get(product)
        if (metaOpt.isNone()) {
            return AcpEnvReport(product, "pending-verification", "", "", "",
                "未知产品:无元信息", "product-not-in-table", now)
        }
        let meta = metaOpt.getOrThrow()

        let pathResult = runCommand("cmd", ["/c", "where", meta.command])
        if (pathResult[0] != Int64(0)) {
            return AcpEnvReport(product, "not-installed", "", "", meta.launchSpec,
                "未安装", "where-exit-${pathResult[0]}", now)
        }
        let pathStr = trimStr(pathResult[1])

        let versionResult = runCommand("cmd", ["/c", meta.command, "--version"])
        let versionStr = trimStr(versionResult[1])
        if (versionResult[0] != Int64(0) && versionStr.size == 0) {
            return AcpEnvReport(product, "probe-failed-unknown", pathStr, "", meta.launchSpec,
                "版本获取失败", "version-exit-${versionResult[0]}", now)
        }

        var authState = "installed-usable"
        var authPrecondition = "无需认证"
        if (meta.authEnvVar.size > 0) {
            let envVal = getVariable(meta.authEnvVar) ?? ""
            if (envVal.size == 0) {
                authState = "installed-auth-missing"
                authPrecondition = "缺少环境变量 ${meta.authEnvVar}"
            } else {
                authPrecondition = "认证前提满足"
            }
        }

        return AcpEnvReport(product, authState, pathStr, versionStr, meta.launchSpec,
            authPrecondition, "probe-ok", now)
    }

    private func runCommand(cmd: String, args: Array<String>): (Int64, String) {
        try {
            let p = launch(cmd, args, workingDirectory: Some(Path(".")),
                           stdIn: ProcessRedirect.Discard, stdOut: ProcessRedirect.Pipe,
                           stdErr: ProcessRedirect.Pipe)
            let outFuture = spawn { => readAllStream(p.stdOutPipe) }
            let errFuture = spawn { => readAllStream(p.stdErrPipe) }
            let exitCode = p.wait(timeout: 10000 * Duration.millisecond)
            let outStr = outFuture.get()
            let _ = errFuture.get()
            return (exitCode, outStr)
        } catch (e: Exception) {
            return (Int64(-1), "")
        }
    }

    public func clearCache() {
        mtx.lock()
        cache.clear()
        mtx.unlock()
    }
}

func trimStr(s: String): String {
    let arr = s.toArray()
    var start = Int64(0)
    var end = Int64(arr.size)
    while (start < end && (arr[start] == 32 || arr[start] == 13 || arr[start] == 10 || arr[start] == 9)) {
        start += 1
    }
    while (end > start && (arr[end - 1] == 32 || arr[end - 1] == 13 || arr[end - 1] == 10 || arr[end - 1] == 9)) {
        end -= 1
    }
    let out = ArrayList<Byte>()
    var i = start
    while (i < end) {
        out.add(arr[i])
        i += 1
    }
    return String.fromUtf8(out.toArray())
}