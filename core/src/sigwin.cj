package core

import std.collection.ArrayList
import std.interop.*
import std.sync.*

// Ctrl+C / 控制台关闭事件的中断接线。
//
// std 没有信号 API（std.process 只有进程管理，std.posix 非跨平台），所以「谁按了
// Ctrl+C」这一事实只能经 kernel32 的 SetConsoleCtrlHandler 拿到。
//
// 两条约束决定了这张表的形状：
// 1) 回调由系统在新线程上调用，且 CFunc 不得捕获环境——被取消的对象不能"闭包带走"，
//    只能放进一张进程级在册表，由回调自己去遍历取消；
// 2) 处理器返回 true 表示「本进程已自行处理」，进程不会按默认方式被就地终止——
//    这正是协作式取消要的：turn 在检查点收束、未 flush 的写入结算、写租约归还，
//    都发生在同一个进程里，而不是把半写状态留在盘上。
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

public class ConsoleSignals {
    static let mtx = Mutex()
    static let listed = ArrayList<AttachedToken>()
    static let ids = AtomicInt64(0)
    static let hits = AtomicInt64(0)
    static let kind = AtomicInt64(-1)
    static let installs = AtomicInt64(0)
    static var bound = false

    // 只注册一次：重复挂载会让一次 Ctrl+C 把同一批令牌取消多次，
    // 也就说不清「这一轮是被第几次中断取消的」。
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
}

// 系统回调进来的那一端：必须是顶层 @C 函数，且做的事尽量薄——
// 只转给 fire()，不在回调线程里做日志或分配以外的逻辑。
@C
func ctrlHandler(evKind: UInt32): Int32 {
    ConsoleSignals.fire(evKind)
    return 1
}
