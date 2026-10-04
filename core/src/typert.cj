package core
import std.collection.*

// 类型注册表：上游 §M0 基座 typert 模块的窄化实现——按名注册 TypeSpec、按名
// 解析；未知名与重名注册都抛异常。branded/泛型/结构比较留待后续批次。

public class TypeSpec {
    public let name: String
    public let version: Int64
    public init(name: String, version: Int64) {
        this.name = name
        this.version = version
    }
}

class TypeEntry {
    let spec: TypeSpec
    init(spec: TypeSpec) {
        this.spec = spec
    }
}

public class TypeRegistry {
    let entries = ArrayList<TypeEntry>()

    public init() {}

    public func register(spec: TypeSpec): Unit {
        for (e in entries) {
            if (e.spec.name == spec.name) {
                throw Exception("typert-duplicate-name")
            }
        }
        entries.add(TypeEntry(spec))
    }

    public func lookup(name: String): TypeSpec {
        for (e in entries) {
            if (e.spec.name == name) {
                return e.spec
            }
        }
        throw Exception("typert-unknown-name")
    }

    public func size(): Int64 {
        return Int64(entries.size)
    }
}
