package core

import std.collection.ArrayList

// 贡献面 SPI：五类贡献（工具/模型/服务/界面/预设）的统一登记与撤销接口。
// 编排器只调 register/revoke/has，各实现翻译成各自注册表的操作。
// 重名拒绝、撤销幂等、归属到插件包名。

public class ContributionDecl {
    public let kind: String
    public let name: String
    public let spec: String
    public let needsApproval: Bool
    public init(kind: String, name: String, spec: String, needsApproval: Bool) {
        this.kind = kind; this.name = name; this.spec = spec; this.needsApproval = needsApproval
    }
}

public class ContributionHandle {
    public let plugin: String
    public let kind: String
    public let name: String
    public init(plugin: String, kind: String, name: String) {
        this.plugin = plugin; this.kind = kind; this.name = name
    }
}

public class SurfaceResult {
    public let ok: Bool
    public let handle: Option<ContributionHandle>
    public let refused: Bool
    public let error: String
    public init(ok: Bool, handle: Option<ContributionHandle>, refused: Bool, error: String) {
        this.ok = ok; this.handle = handle; this.refused = refused; this.error = error
    }
    public static func success(h: ContributionHandle): SurfaceResult { return SurfaceResult(true, Some(h), false, "") }
    public static func refusedResult(): SurfaceResult { return SurfaceResult(false, None, true, "") }
    public static func errored(code: String): SurfaceResult { return SurfaceResult(false, None, false, code) }
}

public class RevokeOutcome {
    public let ok: Bool
    public let wasPresent: Bool
    public let error: String
    public init(ok: Bool, wasPresent: Bool, error: String) {
        this.ok = ok; this.wasPresent = wasPresent; this.error = error
    }
    public static func removed(): RevokeOutcome { return RevokeOutcome(true, true, "") }
    public static func noop(): RevokeOutcome { return RevokeOutcome(true, false, "") }
}

public interface ContributionSurface {
    func kind(): String
    func register(plugin: String, decl: ContributionDecl): SurfaceResult
    func revoke(handle: ContributionHandle): RevokeOutcome
    func has(name: String): Bool
}

// ─── 工具面：封装 ToolRegistry ───
public class ToolSurface <: ContributionSurface {
    let registry: ToolRegistry
    public init(registry: ToolRegistry) { this.registry = registry }
    public func kind(): String { return "tool" }
    public func register(plugin: String, decl: ContributionDecl): SurfaceResult {
        if (registry.has(decl.name)) { return SurfaceResult.refusedResult() }
        let spec = ToolSpec(decl.name, "plugin:" + plugin, decl.spec, decl.needsApproval)
        if (registry.register(spec)) { return SurfaceResult.success(ContributionHandle(plugin, "tool", decl.name)) }
        return SurfaceResult.errored("plugin-surface-unavailable")
    }
    public func revoke(handle: ContributionHandle): RevokeOutcome {
        if (registry.has(handle.name)) { registry.unregister(handle.name); return RevokeOutcome.removed() }
        return RevokeOutcome.noop()
    }
    public func has(name: String): Bool { return registry.has(name) }
}

// ─── 服务面 ───
class ServiceEntry {
    let plugin: String
    let name: String
    var active: Bool
    init(plugin: String, name: String) { this.plugin = plugin; this.name = name; this.active = true }
}

public class ServiceRegistry {
    var entries = ArrayList<ServiceEntry>()
    public func register(plugin: String, name: String): Bool {
        if (has(name)) { return false }
        entries.add(ServiceEntry(plugin, name)); return true
    }
    public func unregister(name: String): Bool {
        let keep = ArrayList<ServiceEntry>()
        var found = false
        for (e in entries) { if (e.name == name && !found) { found = true } else { keep.add(e) } }
        if (found) { entries = keep }
        return found
    }
    public func has(name: String): Bool {
        for (e in entries) { if (e.name == name && e.active) { return true } }
        return false
    }
    public func count(): Int64 { return Int64(entries.size) }
}

public class ServiceSurface <: ContributionSurface {
    let registry: ServiceRegistry
    public init(registry: ServiceRegistry) { this.registry = registry }
    public func kind(): String { return "service" }
    public func register(plugin: String, decl: ContributionDecl): SurfaceResult {
        if (registry.has(decl.name)) { return SurfaceResult.refusedResult() }
        if (registry.register(plugin, decl.name)) { return SurfaceResult.success(ContributionHandle(plugin, "service", decl.name)) }
        return SurfaceResult.errored("plugin-surface-unavailable")
    }
    public func revoke(handle: ContributionHandle): RevokeOutcome {
        if (registry.has(handle.name)) { registry.unregister(handle.name); return RevokeOutcome.removed() }
        return RevokeOutcome.noop()
    }
    public func has(name: String): Bool { return registry.has(name) }
}

// ─── 预设面 ───
class PresetEntry {
    let plugin: String
    let name: String
    let spec: String
    init(plugin: String, name: String, spec: String) { this.plugin = plugin; this.name = name; this.spec = spec }
}

public class PresetRegistry {
    var entries = ArrayList<PresetEntry>()
    public func register(plugin: String, name: String, spec: String): Bool {
        if (has(name)) { return false }
        entries.add(PresetEntry(plugin, name, spec)); return true
    }
    public func unregister(name: String): Bool {
        let keep = ArrayList<PresetEntry>()
        var found = false
        for (e in entries) { if (e.name == name && !found) { found = true } else { keep.add(e) } }
        if (found) { entries = keep }
        return found
    }
    public func has(name: String): Bool {
        for (e in entries) { if (e.name == name) { return true } }
        return false
    }
    public func count(): Int64 { return Int64(entries.size) }
}

public class PresetSurface <: ContributionSurface {
    let registry: PresetRegistry
    public init(registry: PresetRegistry) { this.registry = registry }
    public func kind(): String { return "preset" }
    public func register(plugin: String, decl: ContributionDecl): SurfaceResult {
        if (registry.has(decl.name)) { return SurfaceResult.refusedResult() }
        if (registry.register(plugin, decl.name, decl.spec)) { return SurfaceResult.success(ContributionHandle(plugin, "preset", decl.name)) }
        return SurfaceResult.errored("plugin-surface-unavailable")
    }
    public func revoke(handle: ContributionHandle): RevokeOutcome {
        if (registry.has(handle.name)) { registry.unregister(handle.name); return RevokeOutcome.removed() }
        return RevokeOutcome.noop()
    }
    public func has(name: String): Bool { return registry.has(name) }
}

// ─── 模型面 ───
class ModelEntry {
    let plugin: String
    let name: String
    let spec: String
    init(plugin: String, name: String, spec: String) { this.plugin = plugin; this.name = name; this.spec = spec }
}

public class ModelRegistry {
    var entries = ArrayList<ModelEntry>()
    public func register(plugin: String, name: String, spec: String): Bool {
        if (has(name)) { return false }
        entries.add(ModelEntry(plugin, name, spec)); return true
    }
    public func unregister(name: String): Bool {
        let keep = ArrayList<ModelEntry>()
        var found = false
        for (e in entries) { if (e.name == name && !found) { found = true } else { keep.add(e) } }
        if (found) { entries = keep }
        return found
    }
    public func has(name: String): Bool {
        for (e in entries) { if (e.name == name) { return true } }
        return false
    }
    public func count(): Int64 { return Int64(entries.size) }
}

public class ModelSurface <: ContributionSurface {
    let registry: ModelRegistry
    public init(registry: ModelRegistry) { this.registry = registry }
    public func kind(): String { return "model" }
    public func register(plugin: String, decl: ContributionDecl): SurfaceResult {
        if (registry.has(decl.name)) { return SurfaceResult.refusedResult() }
        if (registry.register(plugin, decl.name, decl.spec)) { return SurfaceResult.success(ContributionHandle(plugin, "model", decl.name)) }
        return SurfaceResult.errored("plugin-surface-unavailable")
    }
    public func revoke(handle: ContributionHandle): RevokeOutcome {
        if (registry.has(handle.name)) { registry.unregister(handle.name); return RevokeOutcome.removed() }
        return RevokeOutcome.noop()
    }
    public func has(name: String): Bool { return registry.has(name) }
}

// ─── 界面面：渲染层受 CSP 约束，依赖运行时动态编译的一律拒 ───
class UiEntry {
    let plugin: String
    let name: String
    let slot: String
    init(plugin: String, name: String, slot: String) { this.plugin = plugin; this.name = name; this.slot = slot }
}

public class UiRegistry {
    var entries = ArrayList<UiEntry>()
    public func register(plugin: String, name: String, slot: String): Bool {
        if (has(name)) { return false }
        entries.add(UiEntry(plugin, name, slot)); return true
    }
    public func unregister(name: String): Bool {
        let keep = ArrayList<UiEntry>()
        var found = false
        for (e in entries) { if (e.name == name && !found) { found = true } else { keep.add(e) } }
        if (found) { entries = keep }
        return found
    }
    public func has(name: String): Bool {
        for (e in entries) { if (e.name == name) { return true } }
        return false
    }
    public func count(): Int64 { return Int64(entries.size) }
}

public class UiSurface <: ContributionSurface {
    let registry: UiRegistry
    public init(registry: UiRegistry) { this.registry = registry }
    public func kind(): String { return "ui" }
    public func register(plugin: String, decl: ContributionDecl): SurfaceResult {
        if (registry.has(decl.name)) { return SurfaceResult.refusedResult() }
        if (registry.register(plugin, decl.name, decl.spec)) { return SurfaceResult.success(ContributionHandle(plugin, "ui", decl.name)) }
        return SurfaceResult.errored("plugin-surface-unavailable")
    }
    public func revoke(handle: ContributionHandle): RevokeOutcome {
        if (registry.has(handle.name)) { registry.unregister(handle.name); return RevokeOutcome.removed() }
        return RevokeOutcome.noop()
    }
    public func has(name: String): Bool { return registry.has(name) }
}
