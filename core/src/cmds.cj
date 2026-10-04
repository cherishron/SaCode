package core
import std.collection.*

// 命令注册表：纯进程内 `CommandRegistry`——按名注册 (name, help)、按名解析、
// 未知名与重名都抛异常，空名也拒。slash 语法糖与参数校验留待后续批次。

public class CommandSpec {
    public let name: String
    public let help: String
    public init(name: String, help: String) {
        this.name = name
        this.help = help
    }
}

class CommandEntry {
    let spec: CommandSpec
    init(spec: CommandSpec) {
        this.spec = spec
    }
}

public class CommandRegistry {
    let entries = ArrayList<CommandEntry>()

    public init() {}

    public func register(name: String, help: String): Unit {
        if (name.size == 0) {
            throw Exception("command-empty-name")
        }
        for (e in entries) {
            if (e.spec.name == name) {
                throw Exception("command-duplicate-name")
            }
        }
        entries.add(CommandEntry(CommandSpec(name, help)))
    }

    public func resolve(name: String): CommandSpec {
        for (e in entries) {
            if (e.spec.name == name) {
                return e.spec
            }
        }
        throw Exception("command-unknown-name")
    }

    public func list(): ArrayList<CommandSpec> {
        let out = ArrayList<CommandSpec>()
        for (e in entries) {
            out.add(e.spec)
        }
        return out
    }
}
