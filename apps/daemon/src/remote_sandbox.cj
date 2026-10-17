package daemon

import core.*
import std.collection.*

// 远程执行门禁（任务 4 的 Windows 半）。
//
// 计划第 3 条要求：核验不出 Job Object 之外的文件/网络隔离能力时，**拒绝远程执行并
// 登记 BLOCKED，而不是只改 enforcement 字符串**。所以 enforcement 的值不写死，
// 由一个行为探针给：问 core 的 confine 到底改不改 argv。将来平台后端把启动形态包起来
// （sandbox-exec / bwrap / Job Object + 受限令牌那一类），探针自己翻成 true，
// 宣告位与门禁同时跟着变——这才叫「宣告与实际分派相交」，不是两处各自维护的字符串。

public const SANDBOX_ENFORCE_NONE: String = "none"
public const SANDBOX_ENFORCE_CONFINED: String = "confined"
public const SANDBOX_REASON_UNAVAILABLE: String = "sandbox-enforcement-unavailable"

// 拒绝只看权限类别，不看方法名：类别来自契约加载进 authorizer 的那张表
// （CapabilitySpec.permission），daemon 里没有第二份名单可以漂移。
public func refusalReason(permission: String, enforcing: Bool): String {
    if (permission == AUTHZ_PERM_EXECUTE && !enforcing) {
        return SANDBOX_REASON_UNAVAILABLE
    }
    return ""
}

// 探针：confine 原样返回 argv == 没有任何 OS 级约束生效。
// 模式串校验只证明「这个档位是我们认识的」，不证明进程被治理过。
public func confineRewritesArgv(): Bool {
    let rt = SandboxRuntime()
    let argv: Array<String> = ["sacode-probe", "--flag"]
    var confined: Option<Array<String>> = None
    try {
        confined = Some(rt.confine(argv, "workspace-write"))
    } catch (e: Exception) {
        // confine 自己声明「没有后端」——那同样是没有强制隔离，探针如实回 false。
        return false
    }
    if (let Some(out) <- confined) {
        if (out.size != argv.size) { return true }
        for (i in 0..out.size) {
            if (out[i] != argv[i]) { return true }
        }
        return false
    }
    return false
}

public class RemoteSandboxEnforcement {
    public let mode: String
    public let enforcing: Bool
    public let limitations: ArrayList<String>

    init(mode!: String, enforcing!: Bool, limitations!: ArrayList<String>) {
        this.mode = mode
        this.enforcing = enforcing
        this.limitations = limitations
    }

    // 限制清单在两种结局里都留着文件与网络两项：规格 §7 明写 seccomp/Job Object
    // 单独都不构成路径与网络隔离，所以就算将来接了进程/资源治理，这两条也不能被抹掉。
    public static func current(): RemoteSandboxEnforcement {
        let enforcing = confineRewritesArgv()
        let lim = ArrayList<String>()
        lim.add("no-file-system-isolation")
        lim.add("no-network-isolation")
        lim.add("no-namespace-or-seccomp-backend")
        let mode = if (enforcing) { SANDBOX_ENFORCE_CONFINED } else { SANDBOX_ENFORCE_NONE }
        return RemoteSandboxEnforcement(mode: mode, enforcing: enforcing, limitations: lim)
    }

    public func toJson(): String {
        var items = "["
        var comma = ""
        for (l in limitations) {
            items += comma + "\"${jsonEscapeText(l)}\""
            comma = ","
        }
        items += "]"
        let flag = if (enforcing) { "true" } else { "false" }
        return "{\"mode\":\"${jsonEscapeText(mode)}\",\"enforcing\":${flag},\"limitations\":${items}}"
    }
}
