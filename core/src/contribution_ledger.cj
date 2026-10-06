package core

import std.collection.ArrayList

// 统一贡献归属账本：记录「插件包名 → 贡献句柄」的映射。
// 激活时登记、撤销时按插件整包移除，支持按插件包名查询。
// 撤销幂等：重复撤销为 no-op。

class LedgerEntry {
    let plugin: String
    let handle: ContributionHandle
    let surfaceKind: String
    init(plugin: String, handle: ContributionHandle, surfaceKind: String) {
        this.plugin = plugin
        this.handle = handle
        this.surfaceKind = surfaceKind
    }
}

public class ContributionLedger {
    var entries = ArrayList<LedgerEntry>()

    // 登记一条贡献归属。幂等：同一 plugin+handle 不重复登记。
    public func record(plugin: String, handle: ContributionHandle, surfaceKind: String): Unit {
        for (e in entries) {
            if (e.plugin == plugin && e.handle.name == handle.name && e.surfaceKind == surfaceKind) {
                return
            }
        }
        entries.add(LedgerEntry(plugin, handle, surfaceKind))
    }

    // 查询某插件的所有贡献句柄。
    public func handlesOf(plugin: String): Array<ContributionHandle> {
        let out = ArrayList<ContributionHandle>()
        for (e in entries) {
            if (e.plugin == plugin) {
                out.add(e.handle)
            }
        }
        return out.toArray()
    }

    // 移除某插件的所有贡献归属，返回被移除的句柄列表。
    public func removeAll(plugin: String): Array<ContributionHandle> {
        let removed = ArrayList<ContributionHandle>()
        let keep = ArrayList<LedgerEntry>()
        for (e in entries) {
            if (e.plugin == plugin) {
                removed.add(e.handle)
            } else {
                keep.add(e)
            }
        }
        entries = keep
        return removed.toArray()
    }

    // 是否有某插件的贡献。
    public func hasContributions(plugin: String): Bool {
        for (e in entries) {
            if (e.plugin == plugin) { return true }
        }
        return false
    }

    // 总条数。
    public func count(): Int64 {
        return Int64(entries.size)
    }
}
