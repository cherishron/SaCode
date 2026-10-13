package core

import std.collection.ArrayList

// 文件提供方仅接收路径和字节，不借 shell 执行用户输入。BOOL/DWORD/HANDLE
// 与 procwin 使用同一 ABI；所有数组指针都在同步调用结束后配对释放。
@When[os == "Windows"]
foreign func CreateFileW(name: CPointer<UInt16>, access: UInt32, share: UInt32, security: CPointer<Unit>,
    creation: UInt32, flags: UInt32, template: CPointer<Unit>): CPointer<Unit>

@When[os == "Windows"]
foreign func GetFileSizeEx(handle: CPointer<Unit>, size: CPointer<Int64>): Int32

@When[os == "Windows"]
foreign func ReadFile(handle: CPointer<Unit>, buffer: CPointer<Byte>, count: UInt32, read: CPointer<UInt32>,
    overlapped: CPointer<Unit>): Int32

@When[os == "Windows"]
foreign func WriteFile(handle: CPointer<Unit>, buffer: CPointer<Byte>, count: UInt32, written: CPointer<UInt32>,
    overlapped: CPointer<Unit>): Int32

@When[os == "Windows"]
foreign func SetFilePointerEx(handle: CPointer<Unit>, distance: Int64, position: CPointer<Int64>, method: UInt32): Int32

@When[os == "Windows"]
foreign func SetEndOfFile(handle: CPointer<Unit>): Int32

@When[os == "Windows"]
foreign func FlushFileBuffers(handle: CPointer<Unit>): Int32

@When[os == "Windows"]
foreign func MoveFileExW(source: CPointer<UInt16>, target: CPointer<UInt16>, flags: UInt32): Int32

func fileWidePath(path: String): Array<UInt16> {
    if (path.size == 0 || path.contains("\u{0}")) {
        throw Exception("invalid-file-path")
    }
    let out = ArrayList<UInt16>()
    for (r in path.runes()) {
        let code = UInt32(r)
        if (code < 65536) {
            out.add(UInt16(code))
        } else {
            out.add(UInt16(55296 + (code - 65536) / 1024))
            out.add(UInt16(56320 + (code - 65536) % 1024))
        }
    }
    out.add(0)
    return out.toArray()
}

func fileHandleValid(handle: CPointer<Unit>): Bool {
    return !handle.isNull() && handle.toUIntNative() != UIntNative.Max
}

// 同一文件句柄：拒绝并发写/删除，核对完整旧字节，仅修掉已验证的物理坏尾，
// 追加全部待提交字节后执行 FlushFileBuffers。绝不截断已确认的完整前缀。
@When[os == "Windows"]
func nativeAppendDurableStatus(path: String, prefix: Array<Byte>, pending: Array<Byte>, retained: Int64): String {
    if (retained < 0 || retained > prefix.size) {
        return "failed"
    }
    let name = unsafe { acquireArrayRawData(fileWidePath(path)) }
    let handle = unsafe { CreateFileW(name.pointer, 3221225472, 1, CPointer<Unit>(), 4, 128, CPointer<Unit>()) }
    unsafe { releaseArrayRawData(name) }
    if (!fileHandleValid(handle)) {
        // 没拿到句柄，未调用任何写入 API。只声明阶段，不跨 CFFI 调用猜线程错误码。
        return "not-opened"
    }
    try {
        var size: Int64 = 0
        if (unsafe { GetFileSizeEx(handle, inout size) } == 0 || size != prefix.size) {
            return "failed"
        }
        let buffer = Array<Byte>(4096, repeat: 0)
        let memory = unsafe { acquireArrayRawData(buffer) }
        try {
            var offset: Int64 = 0
            while (offset < prefix.size) {
                let count = UInt32(min(Int64(4096), prefix.size - offset))
                var read: UInt32 = 0
                if (unsafe { ReadFile(handle, memory.pointer, count, inout read, CPointer<Unit>()) } == 0 || read == 0) {
                    return "failed"
                }
                for (i in 0..Int64(read)) {
                    if (buffer[i] != prefix[offset + i]) {
                        return "failed"
                    }
                }
                offset += Int64(read)
            }
        } finally {
            unsafe { releaseArrayRawData(memory) }
        }
        if (unsafe { SetFilePointerEx(handle, retained, CPointer<Int64>(), 0) } == 0) {
            return "failed"
        }
        if (retained != prefix.size && unsafe { SetEndOfFile(handle) } == 0) {
            return "failed"
        }
        if (pending.size > 0) {
            let memory = unsafe { acquireArrayRawData(pending) }
            try {
                var offset: Int64 = 0
                while (offset < pending.size) {
                    let count = UInt32(min(Int64(1048576), pending.size - offset))
                    var written: UInt32 = 0
                    let ok = unsafe { WriteFile(handle, memory.pointer + offset, count, inout written, CPointer<Unit>()) }
                    if (ok == 0 || written == 0 || written > count) {
                        return "failed"
                    }
                    offset += Int64(written)
                }
            } finally {
                unsafe { releaseArrayRawData(memory) }
            }
        }
        return if (unsafe { FlushFileBuffers(handle) } != 0) {
            "ok"
        } else {
            "failed"
        }
    } finally {
        unsafe { CloseHandle(handle) }
    }
}

// 同目录替换，不允许跨卷 copy/delete，也不预先删除目标。目标目录由 OS 拒绝。
@When[os == "Windows"]
func nativeReplaceFile(staging: String, path: String): Unit {
    let source = unsafe { acquireArrayRawData(fileWidePath(staging)) }
    let target = unsafe { acquireArrayRawData(fileWidePath(path)) }
    try {
        if (unsafe { MoveFileExW(source.pointer, target.pointer, 9) } == 0) {
            throw Exception("file-replace-failed")
        }
    } finally {
        unsafe {
            releaseArrayRawData(source);
            releaseArrayRawData(target)
        }
    }
}

@When[os != "Windows"]
func nativeAppendDurableStatus(path: String, prefix: Array<Byte>, pending: Array<Byte>, retained: Int64): String {
    return "unavailable"
}

func nativeAppendDurable(path: String, prefix: Array<Byte>, pending: Array<Byte>, retained: Int64): Bool {
    return nativeAppendDurableStatus(path, prefix, pending, retained) == "ok"
}

@When[os != "Windows"]
func nativeReplaceFile(staging: String, path: String): Unit {
    throw Exception("file-replace-unavailable")
}
