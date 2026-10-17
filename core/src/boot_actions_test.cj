package core
import std.collection.*
import std.unittest.*

@Test
func bootActionsExecuteExactlyOnceInOrder() {
    let observed = ArrayList<String>()
    let boot = BootSequence()
    boot.register("config", { => observed.add("config") })
    boot.register("plugins", { => observed.add("plugins") })
    boot.run()
    boot.run()
    @Expect(observed.size, Int64(2))
    @Expect(observed[0], "config")
    @Expect(observed[1], "plugins")
    @Expect(boot.isRun(), true)
}

@Test
func bootFailureStopsLaterActionsAndCannotReplaySideEffects() {
    let observed = ArrayList<String>()
    let boot = BootSequence()
    boot.register("first", { => observed.add("first") })
    boot.register("broken", { => throw Exception("fixture-init-failed") })
    boot.register("late", { => observed.add("late") })
    var failed = false
    try { boot.run() } catch (e: Exception) { failed = true }
    @Expect(failed, true)
    @Expect(boot.isRun(), false)
    @Expect(boot.history().size, Int64(1))
    @Expect(boot.history()[0], "first")
    failed = false
    try { boot.run() } catch (e: Exception) { failed = true }
    @Expect(failed, true)
    @Expect(observed.size, Int64(1))
}

@Test
func bootActionCannotRegisterStagesOrReenterRun() {
    let boot = BootSequence()
    let rejected = ArrayList<String>()
    boot.register("guard", { =>
        try { boot.register("late") } catch (e: Exception) { rejected.add("register") }
        try { boot.run() } catch (e: Exception) { rejected.add("reentry") }
    })
    boot.run()
    @Expect(rejected.size, Int64(2))
    @Expect(rejected[0], "register")
    @Expect(rejected[1], "reentry")
    @Expect(boot.history().size, Int64(1))
}

@Test
func bootHistoryDoesNotExposeMutableAuthority() {
    let boot = BootSequence()
    boot.register("only")
    boot.run()
    let view = boot.history()
    view.add("forged")
    @Expect(boot.history().size, Int64(1))
}
