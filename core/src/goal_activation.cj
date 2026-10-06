package core
import std.sync.*

// 持续目标的**进程内续跑授权**（上游 goal 包的 activation）。durable 的 phase 与
// armed/disarmed 是两件独立的事：`goal/change` 只落 phase，授权永不落盘。于是
// 「重启后 active 目标仍在」与「重启后它不会自己继续」可以同时成立——这正是恢复授权
// 的全部含义（上游 packages/goal/goal/README.md「What survives and what does not」：
// 任何 session 起始边沿都 disarm，即便回放出 active phase，驱动也不自己复活工作）。
//
// 四条口径：
//   - pause / complete / blocked / clear 一律 disarm（phase 变了，续跑授权随之收回）；
//   - resume 重新 arm，包括「active 但 disarmed」这种从恢复里回来的目标；
//   - edit 不动 phase，也不该动授权（上游把 disarm 限定在会停掉工作的四个动词上）；
//   - create 之后即 armed：那是人显式下的目标，不是回放出来的。
//
// 只有一个进程内布尔 + 一把锁：写侧在宿主协议线程，读侧在驱动线程。
// 刻意不做成可持久化状态——一旦落盘，「重启后自动续跑」就成了默认行为，
// 而用户对「重开一个会话」的全部预期是不请自来地烧 token。
public class GoalActivation {
    private let lock = Mutex()
    private var armed: Bool

    public init(armed!: Bool = false) {
        this.armed = armed
    }

    public func arm(): Unit {
        lock.lock()
        armed = true
        lock.unlock()
    }

    public func disarm(): Unit {
        lock.lock()
        armed = false
        lock.unlock()
    }

    public func isArmed(): Bool {
        lock.lock()
        let value = armed
        lock.unlock()
        return value
    }

    // 投影、模型工具输出与前端共用这一个词表；别处不再另写一份大小写不同的字符串。
    public func label(): String {
        return if (isArmed()) { "armed" } else { "disarmed" }
    }
}