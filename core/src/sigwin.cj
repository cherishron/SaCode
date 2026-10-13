package core

import std.collection.ArrayList
import std.sync.*
@When[os != "Windows"]
import std.runtime.*

// Ctrl+C / 控制台关闭事件的中断接线。
//
// Windows 使用 kernel32；POSIX 使用 std.runtime 的受支持信号注册，回调只记标记，
// 普通任务中消费并取消。目标平台实际投递与收束仍需运行验证。
//
// 两条约束决定了这张表的形状：
// 1) 回调由系统在新线程上调用，且 CFunc 不得捕获环境——被取消的对象不能"闭包带走"，
//    只能放进一张进程级在册表，由回调自己去遍历取消；
// 2) 处理器返回 true 表示「本进程已自行处理」，进程不会按默认方式被就地终止——
//    这正是协作式取消要的：turn 在检查点收束、未 flush 的写入结算、写租约归还，
//    都发生在同一个进程里，而不是把半写状态留在盘上。
@When[os == "Windows"]
foreign func SetConsoleCtrlHandler(handler: CFunc<(UInt32) -> Int32>, add: Int32): Int32

// 事件类型（wincon.h）：0=Ctrl+C，1=Ctrl+Break，2=关窗口，5=注销，6=关机
public class ConsoleSignalKinds {
    public static let CTRL_C: UInt32 = UInt32(0)
    public static let CTRL_BREAK: UInt32 = UInt32(1)
    public static let CTRL_CLOSE: UInt32 = UInt32(2)
}

class AttachedToken {
    let id: Int64
    let token: TurnToken
    var live = true

    public init(id: Int64, token: TurnToken) {
        this.id = id
        this.token = token
    }
}

@When[os != "Windows"]
let pendingPosixSignal = AtomicInt64(-1)

public class ConsoleSignals {
    static let mtx = Mutex()
    static let listed = ArrayList<AttachedToken>()
    static let ids = AtomicInt64(0)
    static let hits = AtomicInt64(0)
    static let kind = AtomicInt64(-1)
    static let installs = AtomicInt64(0)
    static var bound = false
    @When[os != "Windows"]
    static var watching = false

    // 只注册一次：重复挂载会让一次 Ctrl+C 把同一批令牌取消多次，
    // 也就说不清「这一轮是被第几次中断取消的」。
    @When[os == "Windows"]
    public static func install(): Bool {
        mtx.lock()
        var ok = bound
        if (!bound) {
            let ret = unsafe { SetConsoleCtrlHandler(ctrlHandler, 1) }
            if (ret != 0) {
                bound = true
                installs.fetchAdd(1)
                ok = true
            }
        }
        mtx.unlock()
        return ok
    }

    @When[os != "Windows"]
    public static func install(): Bool {
        return synchronized(mtx) {
            if (bound) { return true }
            try {
                registerSignalHandler(Signal.SIGINT, posixInterrupt)
                try { registerSignalHandler(Signal.SIGTERM, posixInterrupt) }
                catch (e: Exception) {
                    unregisterSignalHandler(Signal.SIGINT, posixInterrupt)
                    throw e
                }
                // handler 只写原子标记；普通仓颉任务中消费后才能加锁取消令牌。
                bound = true
                installs.fetchAdd(1)
                return true
            } catch (_: Exception) { return false }
        }
    }

    public static func installed(): Bool {
        mtx.lock()
        let v = bound
        mtx.unlock()
        return v
    }

    public static func installCount(): Int64 {
        return installs.load()
    }

    // 把一轮在跑的 turn 挂上；返回句柄，用完必须摘。
    public static func attach(token: TurnToken): Int64 {
        let id = ids.fetchAdd(1) + Int64(1)
        mtx.lock()
        listed.add(AttachedToken(id, token))
        clearPendingBeforeFirstToken()
        startWatcher()
        mtx.unlock()
        return id
    }

    public static func detach(id: Int64): Bool {
        mtx.lock()
        var found = false
        for (a in listed) {
            if (a.id == id && a.live) {
                a.live = false
                found = true
                break
            }
        }
        if (found) {
            var i = Int64(listed.size) - Int64(1)
            while (i >= Int64(0)) {
                if (!listed[i].live) {
                    listed.remove(at: i)
                }
                i -= Int64(1)
            }
        }
        mtx.unlock()
        return found
    }

    public static func attached(): Int64 {
        mtx.lock()
        let n = Int64(listed.size)
        mtx.unlock()
        return n
    }

    public static func signalCount(): Int64 {
        return hits.load()
    }

    public static func lastKind(): Int64 {
        return kind.load()
    }

    // 处理器体：先记账，再逐个取消在册令牌。
    // 取消只是「发请求」（协作式），真正的收束发生在 turn 自己的检查点上。
    public static func fire(evKind: UInt32) {
        hits.fetchAdd(1)
        kind.store(Int64(evKind))
        mtx.lock()
        for (a in listed) {
            a.token.cancel()
        }
        mtx.unlock()
    }

    @When[os == "Windows"]
    static func startWatcher(): Unit {}

    @When[os == "Windows"]
    static func clearPendingBeforeFirstToken(): Unit {}

    @When[os != "Windows"]
    static func clearPendingBeforeFirstToken(): Unit {
        // 没有任务时接收的中断不能取消下一轮任务。
        if (listed.size == 1) { pendingPosixSignal.swap(-1) }
    }

    // 调用方持有 mtx。最后一个 token 摘除后线程退出，不能让后台轮询阻止 CLI 正常退出。
    @When[os != "Windows"]
    static func startWatcher(): Unit {
        if (!bound || watching) { return }
        watching = true
        spawn { =>
            while (true) {
                let keep = synchronized(mtx) {
                    let live = listed.size > 0
                    if (!live) { watching = false }
                    live
                }
                if (!keep) { break }
                let signal = pendingPosixSignal.swap(-1)
                if (signal >= 0) { fire(if (signal == Int64(Signal.SIGINT.value)) { ConsoleSignalKinds.CTRL_C } else { ConsoleSignalKinds.CTRL_CLOSE }) }
                sleep(20 * Duration.millisecond)
            }
        }
    }
}

// 系统回调进来的那一端：必须是顶层 @C 函数，且做的事尽量薄——
// 只转给 fire()，不在回调线程里做日志或分配以外的逻辑。
@When[os == "Windows"]
@C
func ctrlHandler(evKind: UInt32): Int32 {
    ConsoleSignals.fire(evKind)
    return 1
}

@When[os != "Windows"]
func posixInterrupt(signal: Int32): Bool {
    pendingPosixSignal.store(Int64(signal))
    return true
}
