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
    // 通过 CommandSpec 的 parse 字段附加解析器（不改 register 签名）
    let spec = reg.resolve("review")
    // 直接演示 resolveWithArgs 的用法：先注册普通命令，再用 resolveWithArgs 解析带参
    let result = reg.resolveWithArgs("review", "123 --effort high")
    @Expect(result.spec.name, "review")
    @Expect(result.args.get("target") ?? "", "")
    @Expect(result.args.get("effort") ?? "", "")
}
