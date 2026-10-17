package core
import std.unittest.*

// 类型注册表上游契约（M0 基座）：`ctx.typer` 提供命名类型的注册与解析，
// 供工具参数 Schema、消息负载结构等复用。本切片以纯进程内 `TypeRegistry`
// 承接「按名注册 + 按名解析 + 未知名拒绝 + 重复注册拒绝」四件核心；上游
// 的 branded type / 泛型型变 / 结构比较等留待后续批次。

@Test
func typertLookupByRegisteredName() {
    let reg = TypeRegistry()
    reg.register(TypeSpec("Message", Int64(1)))
    let got = reg.lookup("Message")
    @Expect(got.name, "Message")
    @Expect(got.version, Int64(1))
}

@Test
func typertUnknownNameRejected() {
    let reg = TypeRegistry()
    var threw = false
    try {
        reg.lookup("Nope")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
}

@Test
func typertDuplicateNameRejected() {
    let reg = TypeRegistry()
    reg.register(TypeSpec("Message", Int64(1)))
    var threw = false
    try {
        reg.register(TypeSpec("Message", Int64(2)))
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    // 拒后原版本仍在，不能被覆盖。
    @Expect(reg.lookup("Message").version, Int64(1))
}

@Test
func typertListReflectsRegistrations() {
    let reg = TypeRegistry()
    reg.register(TypeSpec("Alpha", Int64(1)))
    reg.register(TypeSpec("Beta", Int64(1)))
    @Expect(reg.size(), Int64(2))
}
