package core

@When[os != "Windows"]
import std.env.getProcessId

@When[os != "Windows"]
foreign func sacode_process_liveness(pid: Int64): Int32

// Windows 判活使用 kernel32；非 Windows 的 PID 使用 std.env.getProcessId。
// POSIX 判活薄层在一次 C 调用内检查 kill(pid,0) 与 errno；只有 ESRCH 证明不存在。
//
// 类型口径按 CFFI 文档的映射表来：C 的 `BOOL` 是 4 字节，映射成 Int32 而不是 Bool
// （仓颉 `Bool` 对应 C 的 1 字节 `bool`）；`HANDLE` 用 `CPointer<Unit>`；
// `LPDWORD` 出参在**调用处**用 `inout` 取地址，声明里只写 `CPointer<UInt32>`。
@When[os == "Windows"]
foreign func GetCurrentProcessId(): UInt32

@When[os == "Windows"]
foreign func OpenProcess(access: UInt32, inherit: Int32, pid: UInt32): CPointer<Unit>

@When[os == "Windows"]
foreign func GetExitCodeProcess(handle: CPointer<Unit>, code: CPointer<UInt32>): Int32

@When[os == "Windows"]
foreign func CloseHandle(handle: CPointer<Unit>): Int32

@When[os == "Windows"]
foreign func GetLastError(): UInt32

@When[os == "Windows"]
foreign func K32EnumProcesses(pids: CPointer<UInt32>, bytes: UInt32, used: CPointer<UInt32>): Int32

// LastError是本机线程局部状态，不能依赖两次仓颉FFI调用之间保留它。
// 只有成功且未填满的完整进程列表才能证明PID不存在；截断/失败始终保守拒绝。
@When[os == "Windows"]
func processEnumerationProvesAbsent(pid: UInt32): Bool {
    var capacity: Int64 = 1024
    while (capacity <= 262144) {
        let pids = Array<UInt32>(capacity, repeat: 0)
        let memory = unsafe { acquireArrayRawData(pids) }
        var used: UInt32 = 0
        var ok: Int32 = 0
        let bytes = UInt32(capacity * 4)
        try {
            ok = unsafe { K32EnumProcesses(memory.pointer, bytes, inout used) }
        } finally {
            unsafe { releaseArrayRawData(memory) }
        }
        if (ok == 0 || used > bytes || used % 4 != 0) {
            return false
        }
        for (index in 0..Int64(used / 4)) {
            if (pids[index] == pid) {
                return false
            }
        }
        if (used < bytes) {
            return true
        }
        capacity *= 2
    }
    return false
}

// PROCESS_QUERY_LIMITED_INFORMATION：只要「能不能问它的退出码」，不需要更多权限
@When[os == "Windows"]
let QUERY_LIMITED: UInt32 = 4096
// STILL_ACTIVE：还在跑时 GetExitCodeProcess 给出的哨兵值
@When[os == "Windows"]
let STILL_ACTIVE: UInt32 = 259

@When[os == "Windows"]
public func ownProcessId(): Int64 {
    return Int64(unsafe { GetCurrentProcessId() })
}

// 租约接管必须区分「确认已死」与「查询被拒绝／无法确认」。
// 旧 Bool 接口保留供既有调用方使用，写租约只消费这个三态结果。
@When[os == "Windows"]
public func processLiveness(pid: Int64): String {
    if (pid <= 0 || pid >= Int64(4294967296)) {
        return "unknown"
    }
    let handle = unsafe { OpenProcess(QUERY_LIMITED, 0, UInt32(pid)) }
    if (handle.isNull()) {
        return if (processEnumerationProvesAbsent(UInt32(pid))) {
            "dead"
        } else {
            "unknown"
        }
    }
    var code: UInt32 = 0
    let ok = unsafe { GetExitCodeProcess(handle, inout code) }
    unsafe { CloseHandle(handle) }
    if (ok == 0) {
        return "unknown"
    }
    return if (code == STILL_ACTIVE) {
        "alive"
    } else {
        "dead"
    }
}

// Bool 仅用于兼容旧调用；租约接管必须使用上面的三态结果。
@When[os == "Windows"]
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

@When[os != "Windows"]
public func ownProcessId(): Int64 {
    return getProcessId()
}

@When[os != "Windows"]
public func processLiveness(pid: Int64): String {
    let result = unsafe { sacode_process_liveness(pid) }
    return if (result == 0) {
        "alive"
    } else if (result == 1) {
        "dead"
    } else {
        "unknown"
    }
}

@When[os != "Windows"]
public func isProcessAlive(pid: Int64): Bool {
    return processLiveness(pid) == "alive"
}
