package core
import std.collection.*

// 命令注册表：纯进程内 `CommandRegistry`——按名注册 (name, help)、按名解析、
// 未知名与重名都抛异常，空名也拒。slash 语法糖与参数校验留待后续批次。

public class CommandSpec {
    public let name: String
    public let help: String
    public let parse: Option<((Array<String>) -> HashMap<String, String>)>
    public init(name: String, help: String, parse!: Option<((Array<String>) -> HashMap<String, String>)> = None) {
        this.name = name
        this.help = help
        this.parse = parse
    }
}

public struct CommandResolveResult {
    public let spec: CommandSpec
    public let args: HashMap<String, String>
    public init(spec: CommandSpec, args: HashMap<String, String>) {
        this.spec = spec
        this.args = args
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

    public func register(name: String, help: String, parse!: Option<((Array<String>) -> HashMap<String, String>)> = None): Unit {
        if (name.size == 0) {
            throw Exception("command-empty-name")
        }
        for (e in entries) {
            if (e.spec.name == name) {
                throw Exception("command-duplicate-name")
            }
        }
        entries.add(CommandEntry(CommandSpec(name, help, parse: parse)))
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

    public func parseSimpleArgs(raw: String): Array<String> {
        if (raw.isEmpty()) { return Array<String>() }
        return raw.split(' ').filter { s => s.size > 0 }
    }

    public func resolveWithArgs(name: String, rawArgs: String): CommandResolveResult {
        let spec = resolve(name)
        let tokens = parseSimpleArgs(rawArgs)
        var parsed = HashMap<String, String>()
        if (let Some(parseFn) <- spec.parse) {
            parsed = parseFn(tokens)
        }
        return CommandResolveResult(spec, parsed)
    }
}

// Agent 与注册表测试共用登记入口；这里只登记和解析，不声称命令执行已接通。
public func registerBuiltinCommands(reg: CommandRegistry): Unit {
    reg.register("review", "代码审查（支持 PR/diff）", parse: Some(parseReviewCommandArgs))
    reg.register("compress", "手动压缩上下文")
    reg.register("init", "初始化项目配置")
}

func parseReviewCommandArgs(tokens: Array<String>): HashMap<String, String> {
    let args = HashMap<String, String>()
    var i: Int64 = 0
    while (i < tokens.size) {
        let token = tokens[i]
        if (token == "--effort") {
            if (i + 1 >= tokens.size || args.contains("effort")) {
                throw Exception("command-invalid-effort")
            }
            i += 1
            let value = tokens[i]
            if (value != "low" && value != "medium" && value != "high") {
                throw Exception("command-invalid-effort")
            }
            args.add("effort", value)
        } else if (token == "--comment" || token == "--fix" || token == "--resume") {
            let name = token[2..]
            if (args.contains(name)) { throw Exception("command-invalid-review-arguments") }
            args.add(name, "true")
        } else if (token.startsWith("--") || args.contains("target")) {
            throw Exception("command-invalid-review-arguments")
        } else {
            args.add("target", token)
        }
        i += 1
    }
    return args
}
