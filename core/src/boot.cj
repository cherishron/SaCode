package core
import std.collection.*

// 启动装配序列：上游 §M0 `ctx.boot` 窄化。`register(name)` 按序落名、重名拒；
// `run()` 冻结注册表并按序回放；`isRun()` 供外部查询；`run()` 幂等（多次调用
// 只按第一次生效）。history() 从「已注册且已 run」的有序列表返回。
public class BootSequence {
    let stages = ArrayList<String>()
    let ran = ArrayList<String>()
    var executed = false

    public init() {}

    public func register(name: String): Unit {
        if (executed) {
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
    }

    public func run(): Unit {
        if (executed) {
            return
        }
        for (s in stages) {
            ran.add(s)
        }
        executed = true
    }

    public func isRun(): Bool {
        return executed
    }

    public func history(): ArrayList<String> {
        return ran
    }
}
