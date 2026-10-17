package core
import std.collection.*
import std.unittest.*

// 命令注册表上游契约（M7）：`ctx.commands` 提供 slash 命令的注册/解析/列举。
// 本切片以纯进程内 `CommandRegistry` 承接：按名注册 (name, help)、按名解析、
// 未知名拒、重名拒。slash 语法糖与参数校验留待后续批次。

@Test
func commandRegisterAndResolve() {
    let reg = CommandRegistry()
    reg.register("help", "显示帮助")
    reg.register("clear", "清空当前对话")
    let h = reg.resolve("help")
    @Expect(h.name, "help")
    @Expect(h.help, "显示帮助")
    @Expect(reg.list().size, Int64(2))
}

@Test
func commandUnknownResolveRejected() {
    let reg = CommandRegistry()
    var threw = false
    try {
        reg.resolve("ghost")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
}

@Test
func commandDuplicateRegisterRejected() {
    let reg = CommandRegistry()
    reg.register("help", "first")
    var threw = false
    try {
        reg.register("help", "second")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    // 拒后原 help 文本保留。
    @Expect(reg.resolve("help").help, "first")
}

@Test
func commandEmptyNameRejected() {
    let reg = CommandRegistry()
    var threw = false
    try {
        reg.register("", "x")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    @Expect(reg.list().size, Int64(0))
}

@Test
func commandResolveWithArgs() {
    let reg = CommandRegistry()
    reg.register("review", "代码审查")
    // 没有提供解析器的普通命令不自行推断参数。
    let result = reg.resolveWithArgs("review", "123 --effort high")
    @Expect(result.spec.name, "review")
    @Expect(result.args.get("target") ?? "", "")
    @Expect(result.args.get("effort") ?? "", "")
}

@Test
func builtinCommandsRegistered() {
    let reg = CommandRegistry()
    registerBuiltinCommands(reg)
    let names = reg.list().map { spec => spec.name }
    @Expect(names.contains("review"), true)
    @Expect(names.contains("compress"), true)
    @Expect(names.contains("init"), true)
}

@Test
func reviewCommandDispatched() {
    let reg = CommandRegistry()
    registerBuiltinCommands(reg)
    let result = reg.resolveWithArgs("review", "src/main.cj --effort high --comment --fix --resume")
    @Expect(result.spec.name, "review")
    @Expect(result.args.get("target") ?? "", "src/main.cj")
    @Expect(result.args.get("effort") ?? "", "high")
    @Expect(result.args.get("comment") ?? "", "true")
    @Expect(result.args.get("fix") ?? "", "true")
    @Expect(result.args.get("resume") ?? "", "true")
}

@Test
func reviewCommandRejectsMalformedOptions() {
    let reg = CommandRegistry()
    registerBuiltinCommands(reg)
    for (raw in ["--effort", "--effort unknown", "--unknown", "one two", "--effort low --effort high"]) {
        var rejected = false
        try {
            reg.resolveWithArgs("review", raw)
        } catch (_: Exception) {
            rejected = true
        }
        @Expect(rejected, true)
    }
}

@Test
func builtinCommandParsingRejectsUnknownNames() {
    let reg = CommandRegistry()
    registerBuiltinCommands(reg)

    // 验证 3 个命令全部已注册
    @Expect(reg.list().size, Int64(3))

    // 验证 review 带参解析
    let reviewResult = reg.resolveWithArgs("review", "src/main.cj --effort high")
    @Expect(reviewResult.spec.name, "review")

    // 验证 compress 无参解析
    let compressResult = reg.resolveWithArgs("compress", "")
    @Expect(compressResult.spec.name, "compress")
    @Expect(compressResult.args.size, Int64(0))

    // 验证 init 无参解析
    let initResult = reg.resolveWithArgs("init", "")
    @Expect(initResult.spec.name, "init")

    // 验证未注册命令被拒
    var threw = false
    try {
        reg.resolve("ghost")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
}
