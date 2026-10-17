package core

@When[os == "Windows"]
import std.fs.*
@When[os == "Windows"]
import std.io.*
@When[os == "Windows"]
import std.sync.*
@When[os == "Windows"]
import std.time.MonoTime
@When[os == "Windows"]
import std.collection.ArrayList

// CreateProcessW 命令行的逐参数编码；不把参数拼成另一条 shell 脚本。
@When[os == "Windows"]
func windowsProcessArgument(text: String): String {
    if (text.contains("\u{0}")) {
        throw Exception("windows-process-invalid-argument")
    }
    let output = ArrayList<Byte>()
    output.add(34)
    var slashes: Int64 = 0
    for (byte in text.toArray()) {
        if (byte == 92) {
            slashes += 1
            continue
        }
        let count = if (byte == 34) {
            slashes * 2 + 1
        } else {
            slashes
        }
        for (_ in 0..count) {
            output.add(92)
        }
        slashes = 0
        output.add(byte)
    }
    for (_ in 0..slashes * 2) {
        output.add(92)
    }
    output.add(34)
    return String.fromUtf8(output.toArray())
}

// 每个已核准提案装配一个实例；外层持有 library/profile，未确认清理的句柄仍归此实例。
// 目前只在显式集成驱动使用，默认 Host/CLI 不装配，也不授予工作区 ACL。
@When[os == "Windows"]
class WindowsExecutionProcessProvider <: ExecutionProcessProvider {
    let library: WindowsProcessLibrary
    let profile: WindowsOwnedProfile
    let environment: Array<UInt16>
    let executable: String
    let directory: String
    let gate = Mutex()
    var used = false
    var retained: ?WindowsNativeProcess = None
    init(library: WindowsProcessLibrary, profile: WindowsOwnedProfile, environment: Array<UInt16>, executable: String,
        directory: String) {
        this.library = library
        this.profile = profile
        this.environment = environment
        this.executable = executable
        this.directory = directory
    }
    public func execute(request: ExecutionProcessRequest): ?ShellResult {
        gate.lock()
        try {
            if (used) {
                throw Exception("windows-process-provider-consumed")
            }
            used = true
        } finally {
            gate.unlock()
        }
        if (request.executable != executable || request.directory != directory) {
            throw Exception("windows-process-proposal-mismatch")
        }
        if (request.token.cancelled()) {
            return None
        }
        var command = windowsProcessArgument(request.executable)
        let image = request.executable.replace("\\", "/").toAsciiLower()
        if (image.endsWith("/cmd.exe")) {
            // cmd /s /c 使用自己的引号规则，不接受 CRT 的反斜杠转义。
            if (request.arguments.size != 4 || request.arguments[0] != "/d" || request.arguments[1] != "/s" ||
                request.arguments[2] != "/c" || request.arguments[3].contains("\u{0}")) {
                throw Exception("windows-process-unsupported-shell-arguments")
            }
            command += " /d /s /c \"" + request.arguments[3] + "\""
        } else {
            for (argument in request.arguments) {
                command += " " + windowsProcessArgument(argument)
            }
        }
        let creation = library.create(executable, command, directory, environment, profile)
        retained = creation.process
        try {
            if (creation.error != 0) {
                throw Exception("windows-process-create:${creation.error}")
            }
            return Some(
                collectWindowsProcess(retained.getOrThrow(), request.token, request.timeoutMs, request.outputLimit,
                    request.onCreated, request.onStarted))
        } finally {
            cleanup()
        }
    }
    func cleanup(): Unit {
        if (let Some(process) <- retained) {
            process.stop()
            let deadline = MonoTime.now()
            while (process.active() != 0 && (MonoTime.now() - deadline).toMilliseconds() < 3000) {
                sleep(10 * Duration.millisecond)
            }
            // close 拒绝存活树和在途读者；失败时保留句柄供显式重试。
            process.close()
            retained = None
        }
    }
}

// 将已创建的受监督进程转换为共享执行结果。调用方始终持有句柄，负责最终 close；
// 即使停止或读取无法确认，也不能丢弃句柄后伪报成功。此处不创建授权或开放产品入口。
@When[os == "Windows"]
func collectWindowsProcess(process: WindowsNativeProcess, token: TurnToken, timeoutMs: Int64, outputLimit: Int64,
    onCreated: (Int64) -> Unit, onStarted: (Int64) -> Unit): ShellResult {
    if (timeoutMs < 1 || timeoutMs > 300000 || outputLimit < 1 || outputLimit > 65536) {
        throw Exception("windows-process-invalid-limits")
    }
    let stdout = spawn {=> readShellBounded(process.pipe(1), limit: outputLimit)}
    let stderr = spawn {=> readShellBounded(process.pipe(2), limit: outputLimit)}
    var code: Int64 = -1
    var observed = false
    var timedOut = false
    var cancelled = false
    var failure = ""
    try {
        // 创建事实回执失败时不得恢复挂起线程。
        onCreated(process.pid)
        let resumed = process.resume(token)
        cancelled = !resumed
        if (resumed) {
            onStarted(process.pid)
        }
        let started = MonoTime.now()
        while (true) {
            if (let Some(exit) <- process.poll(timeoutMs: 50)) {
                code = Int64(exit)
                observed = true
            }
            // 根进程退出并不表示后代已退出或继承的管道已关闭。
            if (observed && process.active() == 0) {
                break
            }
            cancelled = token.cancelled()
            timedOut = !cancelled && (MonoTime.now() - started).toMilliseconds() >= timeoutMs
            if (cancelled || timedOut) {
                process.stop()
                let stopping = MonoTime.now()
                while ((MonoTime.now() - stopping).toMilliseconds() < 3000) {
                    if (let Some(exit) <- process.poll(timeoutMs: 50)) {
                        code = Int64(exit)
                        observed = true
                    }
                    if (observed && process.active() == 0) {
                        break
                    }
                    if (observed) {
                        sleep(10 * Duration.millisecond)
                    }
                }
                if (!observed || process.active() != 0) {
                    failure = "process-termination-unconfirmed"
                    // 根退出不足以证明整棵受监督任务结束，交给共享服务结算为 unknown。
                    observed = false
                }
                break
            }
            if (observed) {
                sleep(10 * Duration.millisecond)
            }
        }
    } catch (e: Exception) {
        // 不隐藏持久化回执或启动异常；停止失败由原始句柄的所有者继续处理。
        try {
            process.stop()
        } catch (_: Exception) {}
        try {
            stdout.get(3000 * Duration.millisecond)
        } catch (_: Exception) {}
        try {
            stderr.get(3000 * Duration.millisecond)
        } catch (_: Exception) {}
        throw e
    }
    var out = ShellCapture("", false, false)
    var err = ShellCapture("", false, false)
    try {
        out = stdout.get(3000 * Duration.millisecond)
    } catch (_: Exception) {}
    try {
        err = stderr.get(3000 * Duration.millisecond)
    } catch (_: Exception) {}
    let complete = out.complete && err.complete
    if (!complete && failure.size == 0) {
        failure = "output-incomplete"
    }
    return ShellResult(code, out.text, err.text, timedOut, failure, cancelled: cancelled, stdoutTruncated: out.truncated,
        stderrTruncated: err.truncated, outputComplete: complete, exitObserved: observed)
}

@When[os == "Windows"]
let windowsOwnedProfileSequence = AtomicInt64(0)

// 内部 OS 组件，不对模型或 RPC 暴露。未装配到默认执行器。
@When[os == "Windows"]
class WindowsOwnedProfile {
    let userenv: CPointer<Unit>
    let security: CPointer<Unit>
    let sid: CPointer<Unit>
    let removeCall: CFunc<(CPointer<UInt16>) -> Int32>
    let freeCall: CFunc<(CPointer<Unit>) -> CPointer<Unit>>
    let name: String
    let gate = Mutex()
    var children: Int64 = 0
    var closed = false
    init() {
        let envModule = acSystemModule("userenv.dll")
        let securityModule = acSystemModule("advapi32.dll")
        var ownedSid = CPointer<Unit>()
        var created = false
        let profileName = "sacode.owned.${ownProcessId()}.${windowsOwnedProfileSequence.fetchAdd(1)}.${unsafe { GetTickCount64() }}"
        try {
            if (envModule.isNull() || securityModule.isNull()) {
                throw Exception("windows-profile-api-unavailable")
            }
            let createAddress = windowsRequiredExport(envModule, "CreateAppContainerProfile")
            let deleteAddress = windowsRequiredExport(envModule, "DeleteAppContainerProfile")
            let freeAddress = windowsRequiredExport(securityModule, "FreeSid")
            let createCall = CFunc<(CPointer<UInt16>, CPointer<UInt16>, CPointer<UInt16>, CPointer<Unit>, UInt32,
                    CPointer<CPointer<Unit>>) -> Int32>(createAddress)
            let text = unsafe { acquireArrayRawData(fileWidePath(profileName)) }
            let status = try {
                unsafe { createCall(text.pointer, text.pointer, text.pointer, CPointer<Unit>(), 0, inout ownedSid) }
            } finally {
                unsafe { releaseArrayRawData(text) }
            }
            if (status != 0 || ownedSid.isNull()) {
                throw Exception("windows-profile-create:${status}")
            }
            created = true
            this.userenv = envModule
            this.security = securityModule
            this.sid = ownedSid
            this.name = profileName
            this.removeCall = CFunc<(CPointer<UInt16>) -> Int32>(deleteAddress)
            this.freeCall = CFunc<(CPointer<Unit>) -> CPointer<Unit>>(freeAddress)
        } catch (e: Exception) {
            // 正常成功后资源由实例拥有；创建前失败不删除其他调用的 profile。
            if (!created) {
                if (!securityModule.isNull()) {
                    unsafe { FreeLibrary(securityModule) }
                }
                if (!envModule.isNull()) {
                    unsafe { FreeLibrary(envModule) }
                }
            }
            throw e
        }
    }
    func acquire(): CPointer<Unit> {
        gate.lock()
        try {
            if (closed) {
                throw Exception("windows-profile-closed")
            }
            children += 1
            return sid
        } finally {
            gate.unlock()
        }
    }
    func release(): Unit {
        gate.lock()
        try {
            children -= 1
        } finally {
            gate.unlock()
        }
    }
    func close(): Unit {
        gate.lock()
        try {
            if (closed) {
                return
            }
            if (children != 0) {
                throw Exception("windows-profile-in-use")
            }
            let text = unsafe { acquireArrayRawData(fileWidePath(name)) }
            let status = try {
                unsafe { removeCall(text.pointer) }
            } finally {
                unsafe { releaseArrayRawData(text) }
            }
            if (status != 0) {
                throw Exception("windows-profile-delete:${status}")
            }
            unsafe {
                freeCall(sid);
                FreeLibrary(security);
                FreeLibrary(userenv)
            }
            closed = true
        } finally {
            gate.unlock()
        }
    }
}

@When[os == "Windows"]
func windowsRequiredExport(module: CPointer<Unit>, name: String): CPointer<Unit> {
    let address = acExport(module, name)
    if (address.isNull()) {
        throw Exception("windows-process-export-missing:${name}")
    }
    return address
}

@When[os == "Windows"]
class WindowsProcessLibrary {
    let module: CPointer<Unit>
    let createCall: CFunc<(CPointer<UInt16>, CPointer<UInt16>, CPointer<UInt16>, CPointer<UInt16>, CPointer<Unit>,
        CPointer<CPointer<Unit>>, CPointer<UInt32>) -> UInt32>
    let resumeCall: CFunc<(CPointer<Unit>) -> UInt32>
    let readCall: CFunc<(CPointer<Unit>, UInt32, CPointer<Byte>, UInt32, CPointer<UInt32>, CPointer<UInt32>) -> UInt32>
    let waitCall: CFunc<(CPointer<Unit>, UInt32, CPointer<UInt32>, CPointer<UInt32>) -> UInt32>
    let activeCall: CFunc<(CPointer<Unit>, CPointer<UInt32>) -> UInt32>
    let stopCall: CFunc<(CPointer<Unit>) -> UInt32>
    let closeCall: CFunc<(CPointer<Unit>) -> UInt32>
    let gate = Mutex()
    var processes: Int64 = 0
    var closed = false
    init(path: String) {
        if (!Path(path).isAbsolute()) {
            throw Exception("windows-process-library-path")
        }
        let text = unsafe { acquireArrayRawData(fileWidePath(path)) }
        let loaded = try {
            unsafe { LoadLibraryExW(text.pointer, CPointer<Unit>(), 2304) }
        } finally {
            unsafe { releaseArrayRawData(text) }
        }
        if (loaded.isNull()) {
            throw Exception("windows-process-library-unavailable")
        }
        try {
            let version = CFunc<() -> UInt32>(windowsRequiredExport(loaded, "sacode_windows_process_version"))
            if (unsafe { version() } != 1) {
                throw Exception("windows-process-abi-version")
            }
            this.createCall = CFunc<(CPointer<UInt16>, CPointer<UInt16>, CPointer<UInt16>, CPointer<UInt16>, CPointer<Unit>,
                    CPointer<CPointer<Unit>>, CPointer<UInt32>) -> UInt32>(
                windowsRequiredExport(loaded, "sacode_windows_process_create"))
            this.resumeCall = CFunc<(CPointer<Unit>) -> UInt32>(
                windowsRequiredExport(loaded, "sacode_windows_process_resume"))
            this.readCall = CFunc<(CPointer<Unit>, UInt32, CPointer<Byte>, UInt32, CPointer<UInt32>, CPointer<UInt32>) -> UInt32>(
                windowsRequiredExport(loaded, "sacode_windows_process_read"))
            this.waitCall = CFunc<(CPointer<Unit>, UInt32, CPointer<UInt32>, CPointer<UInt32>) -> UInt32>(
                windowsRequiredExport(loaded, "sacode_windows_process_wait"))
            this.activeCall = CFunc<(CPointer<Unit>, CPointer<UInt32>) -> UInt32>(
                windowsRequiredExport(loaded, "sacode_windows_process_active"))
            this.stopCall = CFunc<(CPointer<Unit>) -> UInt32>(
                windowsRequiredExport(loaded, "sacode_windows_process_stop"))
            this.closeCall = CFunc<(CPointer<Unit>) -> UInt32>(
                windowsRequiredExport(loaded, "sacode_windows_process_close"))
            this.module = loaded
        } catch (e: Exception) {
            unsafe { FreeLibrary(loaded) };
            throw e
        }
    }
    func retain(): Unit {
        gate.lock()
        try {
            if (closed) {
                throw Exception("windows-process-library-closed")
            }
            processes += 1
        } finally {
            gate.unlock()
        }
    }
    func release(): Unit {
        gate.lock()
        try {
            processes -= 1
        } finally {
            gate.unlock()
        }
    }
    func create(application: String, commandLine: String, directory: String, environment: Array<UInt16>,
        profile: WindowsOwnedProfile): WindowsProcessCreation {
        if (!Path(application).isAbsolute() || !Path(directory).isAbsolute() || environment.size < 2 ||
            environment[environment.size - 1] != 0 || environment[environment.size - 2] != 0) {
            throw Exception("windows-process-bad-args")
        }
        // 先验证所有文本，尚未取得原生资源或 profile 引用。
        let appBytes = fileWidePath(application)
        let commandBytes = fileWidePath(commandLine)
        let directoryBytes = fileWidePath(directory)
        if (commandBytes.size > 32768) {
            throw Exception("windows-process-command-too-long")
        }
        gate.lock()
        try {
            if (closed) {
                throw Exception("windows-process-library-closed")
            }
            processes += 1
        } finally {
            gate.unlock()
        }
        var acquiredProfile = false
        var acquiredLibrary = true
        try {
            let sid = profile.acquire()
            acquiredProfile = true
            var owned = CPointer<Unit>()
            var pid: UInt32 = 0
            let app = unsafe { acquireArrayRawData(appBytes) }
            let command = unsafe { acquireArrayRawData(commandBytes) }
            let cwd = unsafe { acquireArrayRawData(directoryBytes) }
            let env = unsafe { acquireArrayRawData(environment) }
            let error = try {
                unsafe { createCall(app.pointer, command.pointer, cwd.pointer, env.pointer, sid, inout owned, inout pid) }
            } finally {
                unsafe {
                    releaseArrayRawData(env);
                    releaseArrayRawData(cwd);
                    releaseArrayRawData(command);
                    releaseArrayRawData(app)
                }
            }
            if (!owned.isNull()) {
                return WindowsProcessCreation(error, Some(WindowsNativeProcess(this, profile, owned, Int64(pid),
                    error == 0)))
            }
            profile.release();
            acquiredProfile = false
            release();
            acquiredLibrary = false
            if (error == 0) {
                throw Exception("windows-process-invalid-create-reply")
            }
            return WindowsProcessCreation(error, None)
        } catch (e: Exception) {
            if (acquiredProfile) {
                profile.release()
            }
            if (acquiredLibrary) {
                release()
            }
            throw e
        }
    }
    func close(): Unit {
        gate.lock()
        try {
            if (closed) {
                return
            }
            if (processes != 0) {
                throw Exception("windows-process-library-in-use")
            }
            unsafe { FreeLibrary(module) }
            closed = true
        } finally {
            gate.unlock()
        }
    }
}

@When[os == "Windows"]
class WindowsProcessCreation {
    let error: UInt32
    let process: ?WindowsNativeProcess
    init(error: UInt32, process: ?WindowsNativeProcess) {
        this.error = error
        this.process = process
    }
}

@When[os == "Windows"]
class WindowsResumeAction <: CancellationStartAction {
    let process: WindowsNativeProcess
    init(process: WindowsNativeProcess) {
        this.process = process
    }
    public func start(): Bool {
        process.resumeNative();
        return true
    }
}

@When[os == "Windows"]
class WindowsProcessPipe <: InputStream {
    let process: WindowsNativeProcess
    let channel: UInt32
    init(process: WindowsNativeProcess, channel: UInt32) {
        this.process = process
        this.channel = channel
    }
    public func read(buffer: Array<Byte>): Int64 {
        return process.read(channel, buffer)
    }
}

@When[os == "Windows"]
class WindowsNativeProcess {
    let library: WindowsProcessLibrary
    let profile: WindowsOwnedProfile
    let owned: CPointer<Unit>
    let pid: Int64
    let ready: Bool
    let gate = Mutex()
    var readers: Int64 = 0
    var closed = false
    init(library: WindowsProcessLibrary, profile: WindowsOwnedProfile, owned: CPointer<Unit>, pid: Int64, ready: Bool) {
        this.library = library
        this.profile = profile
        this.owned = owned
        this.pid = pid
        this.ready = ready
    }
    func requireOpen(): Unit {
        if (closed) {
            throw Exception("windows-process-closed")
        }
    }
    func resumeNative(): Unit {
        gate.lock()
        try {
            requireOpen()
            if (!ready) {
                throw Exception("windows-process-cleanup-only")
            }
            let error = unsafe { library.resumeCall(owned) }
            if (error != 0) {
                throw Exception("windows-process-resume:${error}")
            }
        } finally {
            gate.unlock()
        }
    }
    func resume(token: TurnToken): Bool {
        if (token.runStartIfNotCancelled(WindowsResumeAction(this))) {
            return true
        }
        stop()
        return false
    }
    func stop(): Unit {
        gate.lock()
        try {
            requireOpen()
            let error = unsafe { library.stopCall(owned) }
            if (error != 0) {
                throw Exception("windows-process-stop:${error}")
            }
        } finally {
            gate.unlock()
        }
    }
    // 小步等待使取消线程不被长时间等待锁阻挡。
    func poll(timeoutMs!: UInt32 = 0): ?UInt32 {
        if (timeoutMs > 50) {
            throw Exception("windows-process-poll-timeout")
        }
        gate.lock()
        try {
            requireOpen()
            var exited: UInt32 = 0;
            var code: UInt32 = 0
            let error = unsafe { library.waitCall(owned, timeoutMs, inout exited, inout code) }
            if (error != 0 || exited > 1) {
                throw Exception("windows-process-wait:${error}")
            }
            return if (exited == 1) {
                Some(code)
            } else {
                None
            }
        } finally {
            gate.unlock()
        }
    }
    func active(): UInt32 {
        gate.lock()
        try {
            requireOpen()
            var count: UInt32 = 0
            let error = unsafe { library.activeCall(owned, inout count) }
            if (error != 0) {
                throw Exception("windows-process-active:${error}")
            }
            return count
        } finally {
            gate.unlock()
        }
    }
    func pipe(channel: UInt32): InputStream {
        if (channel != 1 && channel != 2) {
            throw Exception("windows-process-channel")
        }
        return WindowsProcessPipe(this, channel)
    }
    func read(channel: UInt32, buffer: Array<Byte>): Int64 {
        if (buffer.size == 0) {
            return 0
        }
        gate.lock()
        try {
            requireOpen();
            readers += 1
        } finally {
            gate.unlock()
        }
        try {
            let memory = unsafe { acquireArrayRawData(buffer) }
            try {
                var count: UInt32 = 0;
                var eof: UInt32 = 0
                let capacity = UInt32(if (buffer.size > 65536) {
                    65536
                } else {
                    buffer.size
                })
                let error = unsafe { library.readCall(owned, channel, memory.pointer, capacity, inout count, inout eof) }
                if (error != 0 || count > capacity || eof > 1 || (count == 0 && eof == 0)) {
                    throw Exception("windows-process-read:${error}")
                }
                return Int64(count)
            } finally {
                unsafe { releaseArrayRawData(memory) }
            }
        } finally {
            gate.lock()
            try {
                readers -= 1
            } finally {
                gate.unlock()
            }
        }
    }
    func close(): Unit {
        gate.lock()
        try {
            if (closed) {
                return
            }
            if (readers != 0) {
                throw Exception("windows-process-readers-active")
            }
            let error = unsafe { library.closeCall(owned) }
            if (error != 0) {
                throw Exception("windows-process-close:${error}")
            }
            closed = true
            profile.release();
            library.release()
        } finally {
            gate.unlock()
        }
    }
}
