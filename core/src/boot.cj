package core
import std.collection.*

// 启动装配序列：上游 §M0 `ctx.boot` 窄化。`register(name)` 按序落名、重名拒；
// `run()` 冻结注册表并按序回放；`isRun()` 供外部查询；`run()` 幂等（多次调用
// 只按第一次生效）。history() 从「已注册且已 run」的有序列表返回。
public class BootSequence {
    let stages = ArrayList<String>()
    let ran = ArrayList<String>()
    let actions = ArrayList<() -> Unit>()
    var executed = false
    var running = false
    var failed = false

    public init() {}

    public func register(name: String): Unit {
        register(name, { => })
    }

    // 显式阶段初始化；执行期冻结注册表，失败阶段不记作成功且不允许盲目重试。
    public func register(name: String, action: () -> Unit): Unit {
        if (executed || running || failed) {
            throw Exception("boot-already-run")
        }
        if (name.size == 0) {
            throw Exception("boot-empty-stage")
        }
        for (s in stages) {
            if (s == name) {
                throw Exception("boot-duplicate-stage")
            }
        }
        stages.add(name)
        actions.add(action)
    }

    public func run(): Unit {
        if (executed) {
            return
        }
        if (running) { throw Exception("boot-reentrant-run") }
        if (failed) { throw Exception("boot-previously-failed") }
        running = true
        try {
            for (i in 0..stages.size) {
                actions[i]()
                ran.add(stages[i])
            }
            executed = true
        } catch (e: Exception) {
            failed = true
            throw e
        } finally {
            running = false
        }
    }

    public func isRun(): Bool {
        return executed
    }

    public func history(): ArrayList<String> {
        let snapshot = ArrayList<String>()
        for (stage in ran) { snapshot.add(stage) }
        return snapshot
    }
}
