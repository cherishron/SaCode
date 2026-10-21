package core

import std.collection.{ArrayList, HashMap, HashSet}
import std.fs.{FileInfo, Path}
import std.sort.sort
import std.sync.{AtomicBool, Mutex}

// 本对象是进程所有者，不是 Host 的“关闭视图”。调用方必须先完成终端创建授权。
// 只实现 Windows ConPTY；不把用户终端用作 Agent 沙箱，不连接 Host/桌面。
public class PtyOutput {
    public let data: Array<Byte>
    public let truncated: Bool
    public let eof: Bool
    public let failure: String
    public let exitCode: ?Int64
    public init(data: Array<Byte>, truncated: Bool, eof: Bool, failure: String, exitCode: ?Int64) {
        this.data = data
        this.truncated = truncated
        this.eof = eof
        this.failure = failure
        this.exitCode = exitCode
    }
}

// 私有协议用于合成 pipe 夹具，不导出可绕过 open 授权的公开构造器。
// read: 0=暂时无数据，-1=EOF，正数=字节数；不允许阻塞等输出。
interface PtyPipeDriver {
    func read(buffer: Array<Byte>): Int64
    func write(data: Array<Byte>): Int64
    func resize(cols: Int64, rows: Int64): Unit
    func stopTree(): Bool
    func release(): Unit
    func exitCode(): ?Int64
}

class PtyByteRing {
    let bytes: Array<Byte>
    var head: Int64 = 0
    var count: Int64 = 0
    var lost = false
    init(capacity: Int64) {
        if (capacity < 1 || capacity > 262144) {
            throw Exception("pty-invalid-capacity")
        }
        bytes = Array<Byte>(capacity, repeat: 0)
    }
    func append(data: Array<Byte>, size: Int64): Unit {
        if (size < 0 || size > data.size) {
            throw Exception("pty-invalid-read-count")
        }
        for (i in 0..size) {
            if (count == bytes.size) {
                head = (head + 1) % bytes.size
                count -= 1
                lost = true
            }
            bytes[(head + count) % bytes.size] = data[i]
            count += 1
        }
    }
    func take(limit: Int64): Array<Byte> {
        let size = min(count, limit)
        let out = Array<Byte>(size, repeat: 0)
        for (i in 0..size) {
            out[i] = bytes[(head + i) % bytes.size]
        }
        head = (head + size) % bytes.size
        count -= size
        return out
    }
}

func ptyCheckSize(cols: Int64, rows: Int64): Unit {
    if (cols < 1 || cols > 32767 || rows < 1 || rows > 32767) {
        throw Exception("pty-invalid-size")
    }
}

func ptyWide(text: String): Array<UInt16> {
    if (text.contains("\u{0}")) {
        throw Exception("pty-invalid-nul")
    }
    let units = ArrayList<UInt16>()
    for (r in text.runes()) {
        let code = UInt32(r)
        if (code < 65536) {
            units.add(UInt16(code))
        } else {
            units.add(UInt16(55296 + (code - 65536) / 1024))
            units.add(UInt16(56320 + (code - 65536) % 1024))
        }
    }
    units.add(0)
    return units.toArray()
}

// 显式 Unicode 环境块；不传 NULL，不继承父进程密钥。拒绝大小写冲突键。
// 安全预算按UTF-8输入字节累计32767（保守限制），而非宣称Win32最大码元数。
func ptyEnvironment(env: HashMap<String, String>): Array<UInt16> {
    let names = ArrayList<String>()
    let seen = HashSet<String>()
    var budget: Int64 = 1
    for ((name, value) in env) {
        if (name.size == 0 || name.contains("=") || name.contains("\u{0}") || value.contains("\u{0}")) {
            throw Exception("pty-invalid-environment")
        }
        // Windows环境键大小写规则超出ASCII；本接口显式拒绝非ASCII键，
        // 不用ASCII折叠冒充Windows Unicode ordinal排序。值仍支持完整Unicode。
        for (byte in name.toArray()) {
            if (byte > 127 || byte < 32) {
                throw Exception("pty-invalid-environment-key")
            }
        }
        let folded = name.toAsciiLower()
        if (seen.contains(folded)) {
            throw Exception("pty-duplicate-environment")
        }
        seen.add(folded)
        budget += name.size + value.size + 2
        if (budget > 32767) {
            throw Exception("pty-environment-too-large")
        }
        names.add(name)
    }
    let ordered = names.toArray()
    sort(ordered, lessThan: {a: String, b: String => a.toAsciiUpper() < b.toAsciiUpper()})
    let units = ArrayList<UInt16>()
    for (name in ordered) {
        for (unit in ptyWide(name + "=" + env.get(name).getOrThrow())) {
            units.add(unit)
        }
    }
    // 空环境也必须是双 NUL。
    if (units.size == 0) {
        units.add(0)
    }
    units.add(0)
    return units.toArray()
}

public class PtySession {
    let driver: PtyPipeDriver
    let mutex = Mutex()
    let operation = Mutex()
    let closing = Mutex()
    let stopped = AtomicBool(false)
    let ring: PtyByteRing
    var reader: ?Future<Unit> = None
    var ended = false
    var closed = false
    var treeConfirmed = false
    var failure = ""

    init(driver: PtyPipeDriver, capacity: Int64) {
        this.driver = driver
        ring = PtyByteRing(capacity)
    }

    public static func open(cwd: String, env: HashMap<String, String>, cols: Int64, rows: Int64): PtySession {
        ptyCheckSize(cols, rows)
        if (cwd.size == 0 || cwd.contains("\u{0}") || !Path(cwd).isAbsolute() || !FileInfo(cwd).isDirectory()) {
            throw Exception("pty-invalid-cwd")
        }
        let block = ptyEnvironment(env)
        return ptyOpenNative(cwd, block, cols, rows)
    }

    func startReader(): Unit {
        reader = Some(spawn {
            => try {
                while (true) {
                    if (stopped.load()) {
                        break
                    }
                    let count = pumpOnce()
                    if (count < 0) {
                        break
                    }
                    if (count == 0) {
                        sleep(5 * Duration.millisecond)
                    }
                }
            } catch (_: Exception) {
                synchronized(mutex) {
                    failure = "pty-output-io-error"
                    ended = true
                }
            }
        })
    }

    // 每次最多读8KiB，后台持续排空，消费者慢时丢最旧数据而不是阻塞子进程。
    func pumpOnce(): Int64 {
        let buffer = Array<Byte>(8192, repeat: 0)
        let count = driver.read(buffer)
        synchronized(mutex) {
            if (count < 0) {
                ended = true
            } else {
                ring.append(buffer, count)
            }
        }
        return count
    }

    // 异常可能发生在部分前缀已写入之后；异常不代表零字节输入。
    // 调用者禁止整帧自动重试，否则可能重复执行已经送入终端的前缀。
    public func write(input: Array<Byte>): Int64 {
        if (input.size > 4096) {
            throw Exception("pty-input-too-large")
        }
        return synchronized(operation) {
            if (stopped.load()) {
                throw Exception("pty-closed")
            }
            var offset: Int64 = 0
            while (offset < input.size) {
                if (stopped.load()) {
                    throw Exception("pty-closed")
                }
                let count = driver.write(input[offset..input.size])
                if (count <= 0 || count > input.size - offset) {
                    throw Exception("pty-input-io-error")
                }
                offset += count
            }
            return offset
        }
    }

    public func write(input: String): Int64 {
        return write(input.toArray())
    }

    public func resize(cols: Int64, rows: Int64): Unit {
        ptyCheckSize(cols, rows)
        synchronized(operation) {
            if (stopped.load()) {
                throw Exception("pty-closed")
            }
            driver.resize(cols, rows)
        }
    }

    public func readOutput(limit: Int64): PtyOutput {
        if (limit < 1 || limit > 262144) {
            throw Exception("pty-invalid-output-limit")
        }
        let code = driver.exitCode()
        return synchronized(mutex) {
            return PtyOutput(ring.take(limit), ring.lost, ended && ring.count == 0, failure, code)
        }
    }

    // ConPTY 的输入流以 ETX 请求前台控制处理。返回仅代表请求已写入，
    // 不是“前台程序已经收到/退出”的证明，真实 DV07 须另做进程级验收。
    public func interrupt(): Unit {
        write([UInt8(3)])
    }

    public func close(): Unit {
        synchronized(closing) {
            if (closed) {
                if (!treeConfirmed) {
                    throw Exception("pty-tree-stop-unconfirmed")
                }
                return
            }
            stopped.store(true)
            var confirmed = false
            var closeFailure = ""
            try {
                confirmed = driver.stopTree()
            } catch (e: Exception) {
                closeFailure = e.message
            }
            // 无论stop/release哪个失败，都收束状态并等待reader，不让异常跳过清理。
            try {
                driver.release()
            } catch (e: Exception) {
                confirmed = false
                if (closeFailure.size == 0) {
                    closeFailure = e.message
                }
            }
            synchronized(operation) {
                ()
            }
            synchronized(mutex) {
                closed = true
                ended = true
                treeConfirmed = confirmed
                if (closeFailure.size > 0) {
                    failure = "pty-close-failed"
                }
            }
            if (let Some(worker) <- reader) {
                try {
                    worker.get(2 * Duration.second)
                } catch (_: Exception) {
                    synchronized(mutex) {
                        treeConfirmed = false
                        failure = "pty-close-failed"
                    }
                    if (closeFailure.size == 0) {
                        closeFailure = "pty-reader-stop-unconfirmed"
                    }
                }
            }
            if (closeFailure.size > 0) {
                throw Exception(closeFailure)
            }
            if (!confirmed) {
                throw Exception("pty-tree-stop-unconfirmed")
            }
        }
    }
}

@When[os != "Windows"]
func ptyOpenNative(_: String, _: Array<UInt16>, _: Int64, _: Int64): PtySession {
    throw Exception("pty-unavailable")
}

// 与 procwin 一致：BOOL=Int32、HANDLE=CPointer<Unit>、出参调用处inout。
// GetProcAddress复用appcontainer_win.cj现有声明，不重复声明共享外部符号。
@When[os == "Windows"]
foreign func GetModuleHandleA(name: CString): CPointer<Unit>

@When[os == "Windows"]
@C
struct PtyCoord {
    var x: Int16 = 0
    var y: Int16 = 0
}

@When[os == "Windows"]
@C
struct PtyStartup {
    var cb: UInt32 = 0
    var reserved: CPointer<UInt16> = CPointer<UInt16>()
    var desktop: CPointer<UInt16> = CPointer<UInt16>()
    var title: CPointer<UInt16> = CPointer<UInt16>()
    var x: UInt32 = 0
    var y: UInt32 = 0
    var width: UInt32 = 0
    var height: UInt32 = 0
    var charsX: UInt32 = 0
    var charsY: UInt32 = 0
    var fill: UInt32 = 0
    var flags: UInt32 = 0
    var show: UInt16 = 0
    var reservedSize: UInt16 = 0
    var reservedBytes: CPointer<Byte> = CPointer<Byte>()
    var input: CPointer<Unit> = CPointer<Unit>()
    var output: CPointer<Unit> = CPointer<Unit>()
    var error: CPointer<Unit> = CPointer<Unit>()
}

@When[os == "Windows"]
@C
struct PtyStartupEx {
    var startup: PtyStartup = PtyStartup()
    var attributes: CPointer<Unit> = CPointer<Unit>()
}

@When[os == "Windows"]
@C
struct PtyProcessInfo {
    var process: CPointer<Unit> = CPointer<Unit>()
    var thread: CPointer<Unit> = CPointer<Unit>()
    var pid: UInt32 = 0
    var tid: UInt32 = 0
}

@When[os == "Windows"]
@C
struct PtyJobLimits {
    var processTime: Int64 = 0
    var jobTime: Int64 = 0
    var flags: UInt32 = 8192 // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    var minWorking: UIntNative = 0
    var maxWorking: UIntNative = 0
    var activeLimit: UInt32 = 0
    var affinity: UIntNative = 0
    var priority: UInt32 = 0
    var scheduling: UInt32 = 0
    var readOps: UInt64 = 0
    var writeOps: UInt64 = 0
    var otherOps: UInt64 = 0
    var readBytes: UInt64 = 0
    var writeBytes: UInt64 = 0
    var otherBytes: UInt64 = 0
    var processMemory: UIntNative = 0
    var jobMemory: UIntNative = 0
    var peakProcessMemory: UIntNative = 0
    var peakJobMemory: UIntNative = 0
}

@When[os == "Windows"]
@C
struct PtyJobAccounting {
    var userTime: Int64 = 0
    var kernelTime: Int64 = 0
    var periodUser: Int64 = 0
    var periodKernel: Int64 = 0
    var faults: UInt32 = 0
    var total: UInt32 = 0
    var active: UInt32 = 0
    var terminated: UInt32 = 0
}

@When[os == "Windows"]
@C
struct PtySecurityAttributes {
    var length: UInt32 = 0
    var descriptor: CPointer<Unit> = CPointer<Unit>()
    var inherit: Int32 = 0
}

@When[os == "Windows"]
@C
struct PtyOverlapped {
    var internal: UIntNative = 0
    var internalHigh: UIntNative = 0
    var offset: UInt32 = 0
    var offsetHigh: UInt32 = 0
    var event: CPointer<Unit> = CPointer<Unit>()
}

@When[os == "Windows"]
class PtyWinApi {
    let module: CPointer<Unit>
    init() {
        let name = unsafe { LibC.mallocCString("kernel32.dll") }
        try {
            module = unsafe { GetModuleHandleA(name) }
        } finally {
            unsafe { LibC.free(name) }
        }
        if (module.isNull()) {
            throw Exception("pty-kernel32-unavailable")
        }
    }
    func address(name: String): CPointer<Unit> {
        let text = unsafe { acquireArrayRawData((name + "\u{0}").toArray()) }
        var result = CPointer<Unit>()
        try {
            result = unsafe { GetProcAddress(module, text.pointer) }
        } finally {
            unsafe { releaseArrayRawData(text) }
        }
        if (result.isNull()) {
            throw Exception("pty-api-unavailable:" + name)
        }
        return result
    }
    func close(handle: CPointer<Unit>): Unit {
        if (!handle.isNull()) {
            let call = CFunc<(CPointer<Unit>) -> Int32>(address("CloseHandle"))
            unsafe { call(handle) }
        }
    }
}

@When[os == "Windows"]
class PtyWindowsPipe <: PtyPipeDriver {
    let api = PtyWinApi()
    let inputMutex = Mutex()
    let outputMutex = Mutex()
    let lifeMutex = Mutex()
    let cancelled = AtomicBool(false)
    var input = CPointer<Unit>()
    var output = CPointer<Unit>()
    var console = CPointer<Unit>()
    var process = CPointer<Unit>()
    var job = CPointer<Unit>()
    var released = false
    var finalExit: ?Int64 = None

    public func read(buffer: Array<Byte>): Int64 {
        return synchronized(outputMutex) {
            if (cancelled.load() || output.isNull()) {
                return Int64(-1)
            }
            let peek = CFunc<(CPointer<Unit>, CPointer<Unit>, UInt32, CPointer<UInt32>, CPointer<UInt32>, CPointer<UInt32>) -> Int32>(
                api.address("PeekNamedPipe"))
            var available: UInt32 = 0
            if (unsafe { peek(output, CPointer<Unit>(), 0, CPointer<UInt32>(), inout available, CPointer<UInt32>()) } ==
                0) {
                if (activeCount() == 0) {
                    return Int64(-1)
                }
                throw Exception("pty-output-peek-failed")
            }
            // Job客户端退出不代表ConPTY尾帧已排空，只有管道断开才是EOF。
            if (available == 0) {
                return Int64(0)
            }
            let call = CFunc<(CPointer<Unit>, CPointer<Byte>, UInt32, CPointer<UInt32>, CPointer<Unit>) -> Int32>(
                api.address("ReadFile"))
            let memory = unsafe { acquireArrayRawData(buffer) }
            var count: UInt32 = 0
            var ok: Int32 = 0
            try {
                ok = unsafe { call(output, memory.pointer, UInt32(min(Int64(available), buffer.size)), inout count,
                    CPointer<Unit>()) }
            } finally {
                unsafe { releaseArrayRawData(memory) }
            }
            if (ok == 0) {
                throw Exception("pty-output-read-failed")
            }
            return Int64(count)
        }
    }

    // 父端用OVERLAPPED命名pipe，ConPTY端仍是同步读句柄；取消不等待读者消费输入。
    public func write(data: Array<Byte>): Int64 {
        return synchronized(inputMutex) {
            if (cancelled.load()) {
                throw Exception("pty-closed")
            }
            let createEvent = CFunc<(CPointer<Unit>, Int32, Int32, CPointer<UInt16>) -> CPointer<Unit>>(
                api.address("CreateEventW"))
            let event = unsafe { createEvent(CPointer<Unit>(), 1, 0, CPointer<UInt16>()) }
            if (event.isNull()) {
                throw Exception("pty-input-event-failed")
            }
            var overlapped = PtyOverlapped()
            overlapped.event = event
            let memory = unsafe { acquireArrayRawData(data) }
            let call = CFunc<(CPointer<Unit>, CPointer<Byte>, UInt32, CPointer<UInt32>, CPointer<PtyOverlapped>) -> Int32>(
                api.address("WriteFile"))
            let wait = CFunc<(CPointer<Unit>, UInt32) -> UInt32>(api.address("WaitForSingleObject"))
            let result = CFunc<(CPointer<Unit>, CPointer<PtyOverlapped>, CPointer<UInt32>, Int32) -> Int32>(
                api.address("GetOverlappedResult"))
            let cancel = CFunc<(CPointer<Unit>, CPointer<PtyOverlapped>) -> Int32>(api.address("CancelIoEx"))
            var count: UInt32 = 0
            try {
                let immediate = unsafe { call(input, memory.pointer, UInt32(data.size), CPointer<UInt32>(),
                    inout overlapped) }
                var status: UInt32 = 0
                if (immediate == 0) {
                    // 不依赖跨FFI的LastError；event完成/超时后统一收割OVERLAPPED。
                    status = unsafe { wait(event, 1000) }
                    if (status != 0) {
                        unsafe { cancel(input, inout overlapped) }
                    }
                }
                // OVERLAPPED即使同步完成也从GetOverlappedResult取真实写入字节数。
                let ok = unsafe { result(input, inout overlapped, inout count, 1) }
                if (status != 0 || ok == 0) {
                    throw Exception("pty-input-cancelled-or-failed")
                }
            } finally {
                unsafe { releaseArrayRawData(memory) }
                api.close(event)
            }
            return Int64(count)
        }
    }

    public func resize(cols: Int64, rows: Int64): Unit {
        synchronized(lifeMutex) {
            if (cancelled.load()) {
                throw Exception("pty-closed")
            }
            var size = PtyCoord()
            size.x = Int16(cols)
            size.y = Int16(rows)
            let call = CFunc<(CPointer<Unit>, PtyCoord) -> Int32>(api.address("ResizePseudoConsole"))
            let status = unsafe { call(console, size) }
            if (status < 0) {
                throw Exception("pty-resize-failed:${status}")
            }
        }
    }

    func activeCount(): Int64 {
        if (job.isNull()) {
            return 0
        }
        var info = PtyJobAccounting()
        let call = CFunc<(CPointer<Unit>, Int32, CPointer<PtyJobAccounting>, UInt32, CPointer<UInt32>) -> Int32>(
            api.address("QueryInformationJobObject"))
        if (unsafe { call(job, 1, inout info, UInt32(sizeOf<PtyJobAccounting>()), CPointer<UInt32>()) } == 0) {
            return -1
        }
        return Int64(info.active)
    }

    public func stopTree(): Bool {
        return synchronized(lifeMutex) {
            cancelled.store(true)
            if (job.isNull()) {
                return true
            }
            let call = CFunc<(CPointer<Unit>, UInt32) -> Int32>(api.address("TerminateJobObject"))
            // 终止请求成功不等于退出，必须查询ActiveProcesses为0。
            unsafe { call(job, 1) }
            var confirmed = false
            for (_ in 0..500) {
                if (activeCount() == 0) {
                    confirmed = true
                    break
                }
                sleep(10 * Duration.millisecond)
            }
            return confirmed
        }
    }

    public func exitCode(): ?Int64 {
        return synchronized(lifeMutex) {
            if (!process.isNull()) {
                let wait = CFunc<(CPointer<Unit>, UInt32) -> UInt32>(api.address("WaitForSingleObject"))
                if (unsafe { wait(process, 0) } == 0) {
                    let get = CFunc<(CPointer<Unit>, CPointer<UInt32>) -> Int32>(api.address("GetExitCodeProcess"))
                    var code: UInt32 = 0
                    if (unsafe { get(process, inout code) } != 0) {
                        finalExit = Some(Int64(code))
                    }
                }
            }
            return finalExit
        }
    }

    public func release(): Unit {
        synchronized(lifeMutex) {
            if (released) {
                return
            }
            cancelled.store(true)
            // KILL_ON_JOB_CLOSE保底；拒绝BREAKAWAY，子树从恢复执行前就纳入Job。
            if (!input.isNull()) {
                let cancel = CFunc<(CPointer<Unit>, CPointer<PtyOverlapped>) -> Int32>(api.address("CancelIoEx"))
                unsafe { cancel(input, CPointer<PtyOverlapped>()) }
            }
            synchronized(inputMutex) {
                api.close(input);
                input = CPointer<Unit>()
            }
            synchronized(outputMutex) {
                api.close(output);
                output = CPointer<Unit>()
            }
            if (!console.isNull()) {
                let call = CFunc<(CPointer<Unit>) -> Unit>(api.address("ClosePseudoConsole"))
                unsafe { call(console) }
                console = CPointer<Unit>()
            }
            api.close(job);
            job = CPointer<Unit>()
            if (!process.isNull()) {
                let wait = CFunc<(CPointer<Unit>, UInt32) -> UInt32>(api.address("WaitForSingleObject"))
                let get = CFunc<(CPointer<Unit>, CPointer<UInt32>) -> Int32>(api.address("GetExitCodeProcess"))
                var code: UInt32 = 0
                if (unsafe { wait(process, 0) } == 0 && unsafe { get(process, inout code) } != 0) {
                    finalExit = Some(Int64(code))
                }
            }
            api.close(process);
            process = CPointer<Unit>()
            released = true
        }
    }
}

@When[os == "Windows"]
func ptyCreateInputPipe(pipe: PtyWindowsPipe): CPointer<Unit> {
    let api = pipe.api
    var inputRead = CPointer<Unit>()
    var securityDescriptor = CPointer<Unit>()
    var succeeded = false
    try {
        let currentPid = CFunc<() -> UInt32>(api.address("GetCurrentProcessId"))
        let securityName = unsafe { LibC.mallocCString("advapi32.dll") }
        let load = CFunc<(CString, CPointer<Unit>, UInt32) -> CPointer<Unit>>(api.address("LoadLibraryExA"))
        var securityModule = CPointer<Unit>()
        try {
            securityModule = unsafe { load(securityName, CPointer<Unit>(), 2048) }
        } finally {
            unsafe { LibC.free(securityName) }
        }
        if (securityModule.isNull()) {
            throw Exception("pty-security-unavailable")
        }
        let nonceBytes = Array<Byte>(16, repeat: 0)
        try {
            let randomName = unsafe { acquireArrayRawData(("SystemFunction036\u{0}").toArray()) }
            var randomAddress = CPointer<Unit>()
            try {
                randomAddress = unsafe { GetProcAddress(securityModule, randomName.pointer) }
            } finally {
                unsafe { releaseArrayRawData(randomName) }
            }
            if (randomAddress.isNull()) {
                throw Exception("pty-random-unavailable")
            }
            let random = CFunc<(CPointer<Byte>, UInt32) -> UInt8>(randomAddress)
            let randomMemory = unsafe { acquireArrayRawData(nonceBytes) }
            try {
                if (unsafe { random(randomMemory.pointer, 16) } == 0) {
                    throw Exception("pty-random-failed")
                }
            } finally {
                unsafe { releaseArrayRawData(randomMemory) }
            }
            let convertName = unsafe { acquireArrayRawData(
                ("ConvertStringSecurityDescriptorToSecurityDescriptorW\u{0}").toArray()) }
            var convertAddress = CPointer<Unit>()
            try {
                convertAddress = unsafe { GetProcAddress(securityModule, convertName.pointer) }
            } finally {
                unsafe { releaseArrayRawData(convertName) }
            }
            if (convertAddress.isNull()) {
                throw Exception("pty-security-api-unavailable")
            }
            let convert = CFunc<(CPointer<UInt16>, UInt32, CPointer<CPointer<Unit>>, CPointer<UInt32>) -> Int32>(
                convertAddress)
            let descriptor = unsafe { acquireArrayRawData(ptyWide("D:P(A;;GA;;;OW)(A;;GA;;;SY)")) }
            try {
                if (unsafe { convert(descriptor.pointer, 1, inout securityDescriptor, CPointer<UInt32>()) } == 0) {
                    throw Exception("pty-security-descriptor-failed")
                }
            } finally {
                unsafe { releaseArrayRawData(descriptor) }
            }
        } finally {
            let freeModule = CFunc<(CPointer<Unit>) -> Int32>(api.address("FreeLibrary"))
            unsafe { freeModule(securityModule) }
        }
        let randomDigits = ArrayList<Byte>()
        let hex = "0123456789abcdef".toArray()
        for (b in nonceBytes) {
            randomDigits.add(hex[Int64(b / 16)]);
            randomDigits.add(hex[Int64(b % 16)])
        }
        let randomPart = String.fromUtf8(randomDigits.toArray())
        // 不使用用户输入构造pipe名；随机nonce配合受保护DACL防止其他用户抢接。
        let createEvent = CFunc<(CPointer<Unit>, Int32, Int32, CPointer<UInt16>) -> CPointer<Unit>>(
            api.address("CreateEventW"))
        let nonce = unsafe { createEvent(CPointer<Unit>(), 1, 0, CPointer<UInt16>()) }
        if (nonce.isNull()) {
            throw Exception("pty-input-event-failed")
        }
        try {
            let name = unsafe { acquireArrayRawData(
                ptyWide("\\\\.\\pipe\\sacode-pty-${unsafe { currentPid() }}-${randomPart}")) }
            try {
                // FIRST_PIPE_INSTANCE防止碰撞劫持；父端异步、子端同步。
                var security = PtySecurityAttributes()
                security.length = UInt32(sizeOf<PtySecurityAttributes>())
                security.descriptor = securityDescriptor
                let namedSecure = CFunc<(CPointer<UInt16>, UInt32, UInt32, UInt32, UInt32, UInt32, UInt32, CPointer<PtySecurityAttributes>) -> CPointer<Unit>>(
                    api.address("CreateNamedPipeW"))
                pipe.input = unsafe { namedSecure(name.pointer, 1074266114, 8, 1, 4096, 4096, 0, inout security) }
                if (pipe.input.toUIntNative() == UIntNative.Max) {
                    pipe.input = CPointer<Unit>()
                    throw Exception("pty-input-pipe-failed")
                }
                let file = CFunc<(CPointer<UInt16>, UInt32, UInt32, CPointer<Unit>, UInt32, UInt32, CPointer<Unit>) -> CPointer<Unit>>(
                    api.address("CreateFileW"))
                inputRead = unsafe { file(name.pointer, 2147483648, 0, CPointer<Unit>(), 3, 0, CPointer<Unit>()) }
                if (inputRead.toUIntNative() == UIntNative.Max) {
                    inputRead = CPointer<Unit>()
                    throw Exception("pty-input-connect-failed")
                }
                var connect = PtyOverlapped()
                connect.event = nonce
                let connectPipe = CFunc<(CPointer<Unit>, CPointer<PtyOverlapped>) -> Int32>(
                    api.address("ConnectNamedPipe"))
                unsafe { connectPipe(pipe.input, inout connect) }
                let clientPid = CFunc<(CPointer<Unit>, CPointer<UInt32>) -> Int32>(
                    api.address("GetNamedPipeClientProcessId"))
                var connectedPid: UInt32 = 0
                if (unsafe { clientPid(pipe.input, inout connectedPid) } == 0 || connectedPid != unsafe { currentPid() }) {
                    let cancel = CFunc<(CPointer<Unit>, CPointer<PtyOverlapped>) -> Int32>(api.address("CancelIoEx"))
                    unsafe { cancel(pipe.input, inout connect) }
                    throw Exception("pty-input-peer-mismatch")
                }
            } finally {
                unsafe { releaseArrayRawData(name) }
            }
        } finally {
            api.close(nonce)
        }
        succeeded = true
        return inputRead
    } finally {
        if (!securityDescriptor.isNull()) {
            let free = CFunc<(CPointer<Unit>) -> CPointer<Unit>>(api.address("LocalFree"))
            unsafe { free(securityDescriptor) }
        }
        if (!succeeded) {
            api.close(inputRead)
            api.close(pipe.input)
            pipe.input = CPointer<Unit>()
        }
    }
}

@When[os == "Windows"]
func ptyOpenNative(cwd: String, environment: Array<UInt16>, cols: Int64, rows: Int64): PtySession {
    if (sizeOf<PtyCoord>() != 4 || sizeOf<PtyStartupEx>() != 112 || sizeOf<PtyProcessInfo>() != 24 ||
        sizeOf<PtyJobLimits>() != 144 || sizeOf<PtyOverlapped>() != 32 || sizeOf<PtyJobAccounting>() != 48 ||
        sizeOf<PtySecurityAttributes>() != 24) {
        throw Exception("pty-unsupported-abi")
    }
    let pipe = PtyWindowsPipe()
    let api = pipe.api
    // 缺少ConPTY时明确失败，不回退winpty/普通pipe执行。
    let create = CFunc<(PtyCoord, CPointer<Unit>, CPointer<Unit>, UInt32, CPointer<CPointer<Unit>>) -> Int32>(
        api.address("CreatePseudoConsole"))
    let _ = api.address("ResizePseudoConsole")
    let _ = api.address("ClosePseudoConsole")
    var inputRead = CPointer<Unit>()
    var outputWrite = CPointer<Unit>()
    var thread = CPointer<Unit>()
    var attrs = CPointer<UIntNative>()
    var attrsReady = false
    var succeeded = false
    try {
        inputRead = ptyCreateInputPipe(pipe)
        let makePipe = CFunc<(CPointer<CPointer<Unit>>, CPointer<CPointer<Unit>>, CPointer<Unit>, UInt32) -> Int32>(
            api.address("CreatePipe"))
        var outputRead = CPointer<Unit>()
        let pipeOk = unsafe { makePipe(inout outputRead, inout outputWrite, CPointer<Unit>(), 8192) }
        pipe.output = outputRead
        if (pipeOk == 0) {
            throw Exception("pty-output-pipe-failed")
        }
        var coord = PtyCoord()
        coord.x = Int16(cols)
        coord.y = Int16(rows)
        var console = CPointer<Unit>()
        let hr = unsafe { create(coord, inputRead, outputWrite, 0, inout console) }
        pipe.console = console
        if (hr < 0) {
            throw Exception("pty-create-failed:${hr}")
        }

        let makeJob = CFunc<(CPointer<Unit>, CPointer<UInt16>) -> CPointer<Unit>>(api.address("CreateJobObjectW"))
        pipe.job = unsafe { makeJob(CPointer<Unit>(), CPointer<UInt16>()) }
        if (pipe.job.isNull()) {
            throw Exception("pty-job-create-failed")
        }
        var limits = PtyJobLimits()
        let setLimits = CFunc<(CPointer<Unit>, Int32, CPointer<PtyJobLimits>, UInt32) -> Int32>(
            api.address("SetInformationJobObject"))
        if (unsafe { setLimits(pipe.job, 9, inout limits, UInt32(sizeOf<PtyJobLimits>())) } == 0) {
            throw Exception("pty-job-limit-failed")
        }

        let initialize = CFunc<(CPointer<Unit>, UInt32, UInt32, CPointer<UIntNative>) -> Int32>(
            api.address("InitializeProcThreadAttributeList"))
        var bytes: UIntNative = 0
        unsafe { initialize(CPointer<Unit>(), 1, 0, inout bytes) }
        if (bytes == 0 || bytes > 1048576) {
            throw Exception("pty-attribute-size-failed")
        }
        attrs = LibC.malloc<UIntNative>(count: Int64((bytes + 7) / 8))
        if (attrs.isNull()) {
            throw Exception("pty-allocation-failed")
        }
        let list = CPointer<Unit>(attrs)
        if (unsafe { initialize(list, 1, 0, inout bytes) } == 0) {
            throw Exception("pty-attribute-init-failed")
        }
        attrsReady = true
        let update = CFunc<(CPointer<Unit>, UInt32, UIntNative, CPointer<Unit>, UIntNative, CPointer<Unit>, CPointer<UIntNative>) -> Int32>(
            api.address("UpdateProcThreadAttribute"))
        // 此属性按微软契约传HPCON本身，不是&HPCON。
        if (unsafe { update(list, 0, 131094, pipe.console, UIntNative(sizeOf<CPointer<Unit>>()), CPointer<Unit>(),
            CPointer<UIntNative>()) } == 0) {
            throw Exception("pty-attribute-update-failed")
        }
        var startup = PtyStartupEx()
        startup.startup.cb = UInt32(sizeOf<PtyStartupEx>())
        startup.attributes = list
        var info = PtyProcessInfo()
        let system = Array<UInt16>(32768, repeat: 0)
        let systemMemory = unsafe { acquireArrayRawData(system) }
        let getSystem = CFunc<(CPointer<UInt16>, UInt32) -> UInt32>(api.address("GetSystemDirectoryW"))
        var size: UInt32 = 0
        try {
            size = unsafe { getSystem(systemMemory.pointer, 32768) }
        } finally {
            unsafe { releaseArrayRawData(systemMemory) }
        }
        if (size == 0 || size >= 32760) {
            throw Exception("pty-shell-unavailable")
        }
        let suffix = ptyWide("\\cmd.exe")
        let shell = Array<UInt16>(Int64(size) + suffix.size, repeat: 0)
        for (i in 0..Int64(size)) {
            shell[i] = system[i]
        }
        for (i in 0..suffix.size) {
            shell[Int64(size) + i] = suffix[i]
        }
        // 固定System32 cmd.exe /D，禁用AutoRun；不消费COMSPEC和任意命令行。
        let command = ArrayList<UInt16>()
        command.add(34)
        for (i in 0..shell.size - 1) {
            command.add(shell[i])
        }
        command.add(34)
        for (unit in ptyWide(" /D")) {
            command.add(unit)
        }
        let app = unsafe { acquireArrayRawData(shell) }
        let cmd = unsafe { acquireArrayRawData(command.toArray()) }
        let dir = unsafe { acquireArrayRawData(ptyWide(cwd)) }
        let env = unsafe { acquireArrayRawData(environment) }
        let launch = CFunc<(CPointer<UInt16>, CPointer<UInt16>, CPointer<Unit>, CPointer<Unit>, Int32, UInt32, CPointer<Unit>,
                CPointer<UInt16>, CPointer<PtyStartupEx>, CPointer<PtyProcessInfo>) -> Int32>(
            api.address("CreateProcessW"))
        var ok: Int32 = 0
        try {
            // EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT | CREATE_SUSPENDED
            ok = unsafe { launch(app.pointer, cmd.pointer, CPointer<Unit>(), CPointer<Unit>(), 0, 525316,
                CPointer<Unit>(env.pointer), dir.pointer, inout startup, inout info) }
        } finally {
            unsafe {
                releaseArrayRawData(env);
                releaseArrayRawData(dir);
                releaseArrayRawData(cmd);
                releaseArrayRawData(app)
            }
        }
        if (ok == 0) {
            throw Exception("pty-process-create-failed")
        }
        pipe.process = info.process
        thread = info.thread
        let assign = CFunc<(CPointer<Unit>, CPointer<Unit>) -> Int32>(api.address("AssignProcessToJobObject"))
        if (unsafe { assign(pipe.job, pipe.process) } == 0) {
            throw Exception("pty-job-assign-failed")
        }
        let session = PtySession(pipe, 262144)
        session.startReader()
        let resume = CFunc<(CPointer<Unit>) -> UInt32>(api.address("ResumeThread"))
        if (unsafe { resume(thread) } == UInt32.Max) {
            session.close();
            throw Exception("pty-process-resume-failed")
        }
        succeeded = true
        return session
    } finally {
        api.close(thread)
        api.close(inputRead)
        api.close(outputWrite)
        if (attrsReady) {
            let delete = CFunc<(CPointer<Unit>) -> Unit>(api.address("DeleteProcThreadAttributeList"))
            unsafe { delete(CPointer<Unit>(attrs)) }
        }
        if (!attrs.isNull()) {
            unsafe { LibC.free(attrs) }
        }
        if (!succeeded) {
            // Assign失败时子进程仍挂起、未派生；显式终止未入Job的根进程。
            if (!pipe.process.isNull()) {
                let terminate = CFunc<(CPointer<Unit>, UInt32) -> Int32>(api.address("TerminateProcess"))
                unsafe { terminate(pipe.process, 1) }
                let wait = CFunc<(CPointer<Unit>, UInt32) -> UInt32>(api.address("WaitForSingleObject"))
                unsafe { wait(pipe.process, 5000) }
            }
            try {
                pipe.stopTree()
            } finally {
                pipe.release()
            }
        }
    }
}
