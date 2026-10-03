package core

import std.interop.*

// Windows 进程判活与自身 pid。std 里没有这两件事：`std.process` 只有
// `findProcess(pid)`（要能打开进程才有对象），`std.posix` 又非跨平台，
// 所以这里直接 CFFI 绑 kernel32——实测默认链接面就能解析，不需要额外链接参数。
//
// 类型口径按 CFFI 文档的映射表来：C 的 `BOOL` 是 4 字节，映射成 Int32 而不是 Bool
// （仓颉 `Bool` 对应 C 的 1 字节 `bool`）；`HANDLE` 用 `CPointer<Unit>`；
// `LPDWORD` 出参在**调用处**用 `inout` 取地址，声明里只写 `CPointer<UInt32>`。
foreign func GetCurrentProcessId(): UInt32
foreign func OpenProcess(access: UInt32, inherit: Int32, pid: UInt32): CPointer<Unit>
foreign func GetExitCodeProcess(handle: CPointer<Unit>, code: CPointer<UInt32>): Int32
foreign func CloseHandle(handle: CPointer<Unit>): Int32

// PROCESS_QUERY_LIMITED_INFORMATION：只要「能不能问它的退出码」，不需要更多权限
let QUERY_LIMITED: UInt32 = 4096
// STILL_ACTIVE：还在跑时 GetExitCodeProcess 给出的哨兵值
let STILL_ACTIVE: UInt32 = 259

public func ownProcessId(): Int64 {
    return Int64(unsafe { GetCurrentProcessId() })
}

// 判活只回答「这个 pid 现在是不是活的」。打不开句柄（不存在、或没权限打开）
// 一律回 false；问不到退出码也回 false——调用方（写租约接管）据此选择「不动它」，
// 宁可留着残留租约让人手工清，也不悄悄抢走别人的写权。
public func isProcessAlive(pid: Int64): Bool {
    if (pid <= 0) {
        return false
    }
    if (pid >= Int64(4294967296)) {
        return false
    }
    let h = unsafe { OpenProcess(QUERY_LIMITED, 0, UInt32(pid)) }
    if (h.isNull()) {
        return false
    }
    var code: UInt32 = 0
    let ok = unsafe { GetExitCodeProcess(h, inout code) }
    unsafe { CloseHandle(h) }
    if (ok == 0) {
        return false
    }
    return code == STILL_ACTIVE
}
