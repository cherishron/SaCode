package core
import std.collection.HashMap
import std.sync.*

// ACP 设置服务：开关作用域、有效值与来源（design §2.6.2、§2.3.3）。
// 用户级默认关闭（REQ-G-01）；项目级覆盖用户级（REQ-G-02）；
// 返回 effective + source(user/project/default) + revision（REQ-G-04）。
// CAS 原子更新：expectedRevision 不符 → 抛 revision-conflict（REQ-G-03）。
// 变更只影响后续委派选择，不提升在途委派授权（REQ-W-08）。
public class AcpSettingsSnapshot {
    public let enabled: Bool
    public let effective: String   // "on" / "off"
    public let source: String      // "user" / "project" / "default"
    public let revision: Int64
    public let weights: HashMap<String, Int64>
    public let weightSource: String // "user" / "project" / "default"

    public init(enabled: Bool, effective: String, source: String, revision: Int64,
        weights: HashMap<String, Int64>, weightSource: String) {
        this.enabled = enabled
        this.effective = effective
        this.source = source
        this.revision = revision
        this.weights = weights
        this.weightSource = weightSource
    }
}

// 设置条目：作用域 + 值 + 修订号
class AcpSettingsEntry {
    var enabled: Bool
    var revision: Int64
    var weights: HashMap<String, Int64>

    init(enabled: Bool, revision: Int64) {
        this.enabled = enabled
        this.revision = revision
        this.weights = HashMap<String, Int64>()
    }
}

public class AcpSettingsService {
    // 两个作用域的设置条目
    let userEntry = AcpSettingsEntry(false, 0)     // 用户级默认关闭
    let projectEntry = AcpSettingsEntry(false, 0)  // 项目级默认关闭
    let mtx = Mutex()

    public init() {}

    // 描述有效设置：项目级覆盖用户级，用户级覆盖默认（关闭）
    public func describe(scope: String): AcpSettingsSnapshot {
        mtx.lock()
        // 作用域优先级：project > user > default
        // 但只有"project"作用域看项目级；其他作用域看用户级
        var entry = userEntry
        var src = "default"
        var wSrc = "default"
        if (scope == "project") {
            entry = projectEntry
            src = "project"
            wSrc = "project"
        } else if (scope == "user" || scope == "global" || scope == "") {
            entry = userEntry
            if (entry.revision > 0) { src = "user" }
            if (entry.revision > 0) { wSrc = "user" }
        }
        // 如果项目级没改过，回落到用户级
        if (scope == "project" && projectEntry.revision == 0) {
            entry = userEntry
            if (userEntry.revision > 0) {
                src = "user"
                wSrc = "user"
            } else {
                src = "default"
                wSrc = "default"
            }
        }
        var eff = "off"
        if (entry.enabled) { eff = "on" }
        // 复制权重表
        let wCopy = HashMap<String, Int64>()
        for ((k, v) in entry.weights) {
            wCopy[k] = v
        }
        let snap = AcpSettingsSnapshot(entry.enabled, eff, src, entry.revision, wCopy, wSrc)
        mtx.unlock()
        return snap
    }

    // CAS 设置开关：expectedRevision 不符 → 抛异常
    public func setEnabled(scope: String, value: Bool, expectedRevision: Int64): AcpSettingsSnapshot {
        mtx.lock()
        var entry = userEntry
        if (scope == "project") {
            entry = projectEntry
        }
        if (entry.revision != expectedRevision) {
            mtx.unlock()
            throw Exception("revision-conflict: expected ${expectedRevision}, actual ${entry.revision}")
        }
        entry.enabled = value
        entry.revision += 1
        let snap = describe(scope)
        mtx.unlock()
        return snap
    }

    // CAS 设置权重：expectedRevision 不符 → 抛异常
    public func setWeight(scope: String, peerId: String, weight: Int64, expectedRevision: Int64): AcpSettingsSnapshot {
        mtx.lock()
        var entry = userEntry
        if (scope == "project") {
            entry = projectEntry
        }
        if (entry.revision != expectedRevision) {
            mtx.unlock()
            throw Exception("revision-conflict: expected ${expectedRevision}, actual ${entry.revision}")
        }
        entry.weights[peerId] = weight
        entry.revision += 1
        let snap = describe(scope)
        mtx.unlock()
        return snap
    }

    // 取用户级开关有效值（便捷方法）
    public func isEffectiveEnabled(scope: String): Bool {
        return describe(scope).enabled
    }
}