package core
import std.collection.*
import std.unittest.*

// 启动装配序列上游契约（M0 基座）：`ctx.boot` 提供按序注册 stage、run() 依次
// 执行；重复 stage 名与 run 之后再加 stage 都应拒绝。本切片以纯进程内
// `BootSequence` 承接四件核心：按序注册、按序执行、执行历史可查询、run 幂等。

@Test
func bootRunsStagesInRegistrationOrder() {
    let boot = BootSequence()
    boot.register("config")
    boot.register("workspace")
    boot.register("providers")
    boot.run()
    let h = boot.history()
    @Expect(h.size, Int64(3))
    @Expect(h[0], "config")
    @Expect(h[1], "workspace")
    @Expect(h[2], "providers")
}

@Test
func bootDuplicateStageNameRejected() {
    let boot = BootSequence()
    boot.register("config")
    var threw = false
    try {
        boot.register("config")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    boot.run()
    // 重复名拒后 history 只有一条 config。
    @Expect(boot.history().size, Int64(1))
}

@Test
func bootRegisterAfterRunRejected() {
    let boot = BootSequence()
    boot.run()
    var threw = false
    try {
        boot.register("late")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    @Expect(boot.isRun(), true)
    @Expect(boot.history().size, Int64(0))
}

@Test
func bootRunIsIdempotent() {
    let boot = BootSequence()
    boot.register("only")
    boot.run()
    boot.run()
    @Expect(boot.history().size, Int64(1))
}
