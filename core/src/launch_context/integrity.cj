package core.launch_context

// 只读当前进程令牌；不授予权限、不修改 ACL、不改变启动策略。
@When[os == "Windows"]
foreign func LoadLibraryExW(name: CPointer<UInt16>, file: CPointer<Unit>, flags: UInt32): CPointer<Unit>

@When[os == "Windows"]
foreign func GetProcAddress(module: CPointer<Unit>, name: CPointer<Byte>): CPointer<Unit>

@When[os == "Windows"]
foreign func FreeLibrary(module: CPointer<Unit>): Int32

@When[os == "Windows"]
foreign func GetCurrentProcess(): CPointer<Unit>

@When[os == "Windows"]
foreign func CloseHandle(handle: CPointer<Unit>): Int32

@When[os == "Windows"]
func exportAddress(module: CPointer<Unit>, name: String): CPointer<Unit> {
    let bytes = unsafe { acquireArrayRawData((name + "\u{0}").toArray()) }
    try {
        return unsafe { GetProcAddress(module, bytes.pointer) }
    } finally {
        unsafe { releaseArrayRawData(bytes) }
    }
}

@When[os == "Windows"]
public func currentProcessIntegrity(): String {
    if (sizeOf<UIntNative>() != 8) {
        return "unknown"
    }
    let name = "advapi32.dll\u{0}".toArray()
    let wide = unsafe { acquireArrayRawData(Array<UInt16>(name.size, {i => UInt16(name[i])})) }
    let module = try {
        unsafe { LoadLibraryExW(wide.pointer, CPointer<Unit>(), 2048) }
    } finally {
        unsafe { releaseArrayRawData(wide) }
    }
    if (module.isNull()) {
        return "unknown"
    }
    var token = CPointer<Unit>()
    try {
        let openAddress = exportAddress(module, "OpenProcessToken")
        let infoAddress = exportAddress(module, "GetTokenInformation")
        let validAddress = exportAddress(module, "IsValidSid")
        let countAddress = exportAddress(module, "GetSidSubAuthorityCount")
        let ridAddress = exportAddress(module, "GetSidSubAuthority")
        if (openAddress.isNull() || infoAddress.isNull() || validAddress.isNull() || countAddress.isNull() ||
            ridAddress.isNull()) {
            return "unknown"
        }
        let openToken = CFunc<(CPointer<Unit>, UInt32, CPointer<CPointer<Unit>>) -> Int32>(openAddress)
        let tokenInfo = CFunc<(CPointer<Unit>, UInt32, CPointer<Unit>, UInt32, CPointer<UInt32>) -> Int32>(infoAddress)
        let validSid = CFunc<(CPointer<Unit>) -> Int32>(validAddress)
        let countSid = CFunc<(CPointer<Unit>) -> CPointer<UInt8>>(countAddress)
        let ridSid = CFunc<(CPointer<Unit>, UInt32) -> CPointer<UInt32>>(ridAddress)
        if (unsafe { openToken(GetCurrentProcess(), 8, inout token) } == 0) {
            return "unknown"
        }
        let storage = unsafe { acquireArrayRawData(Array<UIntNative>(128, repeat: 0)) }
        try {
            var returned: UInt32 = 0
            if (unsafe { tokenInfo(token, 25, CPointer<Unit>(storage.pointer), 1024, inout returned) } == 0 ||
                returned < 16 || returned > 1024) {
                return "unknown"
            }
            let sid = unsafe { CPointer<CPointer<Unit>>(storage.pointer).read() }
            if (sid.isNull() || unsafe { validSid(sid) } == 0) {
                return "unknown"
            }
            let count = unsafe { countSid(sid).read() }
            if (count == 0) {
                return "unknown"
            }
            let rid = unsafe { ridSid(sid, UInt32(count - 1)).read() }
            if (rid < 4096) {
                return "untrusted"
            }
            if (rid < 8192) {
                return "low"
            }
            if (rid < 12288) {
                return "medium"
            }
            if (rid < 16384) {
                return "high"
            }
            if (rid == 16384) {
                return "system"
            }
            return "unknown"
        } finally {
            unsafe { releaseArrayRawData(storage) }
        }
    } catch (_: Exception) {
        return "unknown"
    } finally {
        if (!token.isNull()) {
            unsafe { CloseHandle(token) }
        }
        unsafe { FreeLibrary(module) }
    }
}

@When[os != "Windows"]
public func currentProcessIntegrity(): String {
    return "not-windows"
}
