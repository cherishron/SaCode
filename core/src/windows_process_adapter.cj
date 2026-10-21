package core

import std.env.getVariable

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
@When[os == "Windows"]
import stdx.encoding.json.*

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
    let arguments: Array<String>
    let timeoutMs: Int64
    let outputLimit: Int64
    let beforeResume: () -> Unit
    let gate = Mutex()
    var used = false
    var retained: ?WindowsNativeProcess = None
    init(library: WindowsProcessLibrary, profile: WindowsOwnedProfile, environment: Array<UInt16>, proposal: String,
        beforeResume!: () -> Unit = {=>}) {
        let approved = JsonValue.fromStr(proposal).asObject()
        let argv = approved.get("argv").getOrThrow().asArray()
        let arguments = ArrayList<String>()
        for (index in 0..argv.size()) {
            arguments.add(argv.get(index).getOrThrow().asString().getValue())
        }
        this.library = library
        this.profile = profile
        this.environment = environment
        this.executable = approved.get("executable").getOrThrow().asString().getValue()
        this.directory = approved.get("cwd").getOrThrow().asString().getValue()
        this.arguments = arguments.toArray()
        this.timeoutMs = approved.get("timeoutMs").getOrThrow().asInt().getValue()
        this.outputLimit = approved.get("outputLimit").getOrThrow().asInt().getValue()
        this.beforeResume = beforeResume
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
        if (request.executable != executable || request.directory != directory || request.timeoutMs != timeoutMs ||
            request.outputLimit != outputLimit || request.arguments.size != arguments.size) {
            throw Exception("windows-process-proposal-mismatch")
        }
        for (index in 0..arguments.size) {
            if (request.arguments[index] != arguments[index]) {
                throw Exception("windows-process-proposal-mismatch")
            }
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
                collectWindowsProcess(
                    retained.getOrThrow(),
                    request.token,
                    request.timeoutMs,
                    request.outputLimit,
                    {
                        pid =>
                            request.onCreated(pid);
                            beforeResume()
                    },
                    request.onStarted
                )
            )
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

// 受监督运行事实桶：在 collectWindowsProcess 内部随观测进度同步写入；异常路径（S1/S2）抛出前
// 已保留最后已知事实，调用方据此区分"真实未观测"与"已观测退出但收束失败"，避免把后者误报成"未启动"。
// 默认不传（None）时 collectWindowsProcess 行为完全不变，Host 执行通路不受影响。
@When[os == "Windows"]
class WindowsRunFacts {
    var created = false
    var started = false
    var code: Int64 = -1
    var observed = false
    var timedOut = false
    var cancelled = false
    var stdout = ""
    var stderr = ""
    var stdoutTruncated = false
    var stderrTruncated = false
    var outputComplete = false
}

// 将已创建的受监督进程转换为共享执行结果。调用方始终持有句柄，负责最终 close；
// 即使停止或读取无法确认，也不能丢弃句柄后伪报成功。此处不创建授权或开放产品入口。
@When[os == "Windows"]
func collectWindowsProcess(process: WindowsNativeProcess, token: TurnToken, timeoutMs: Int64, outputLimit: Int64,
    onCreated: (Int64) -> Unit, onStarted: (Int64) -> Unit, facts!: ?WindowsRunFacts = None): ShellResult {
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
        if (let Some(f) <- facts) { f.created = true }
        let resumed = process.resume(token)
        cancelled = !resumed
        if (resumed) {
            onStarted(process.pid)
            if (let Some(f) <- facts) { f.started = true }
        }
        let started = MonoTime.now()
        while (true) {
            if (let Some(exit) <- process.poll(timeoutMs: 50)) {
                code = Int64(exit)
                observed = true
                if (let Some(f) <- facts) { f.code = code; f.observed = true }
            }
            // 根进程退出并不表示后代已退出或继承的管道已关闭。
            if (observed && process.active() == 0) {
                break
            }
            cancelled = token.cancelled()
            timedOut = !cancelled && (MonoTime.now() - started).toMilliseconds() >= timeoutMs
            if (let Some(f) <- facts) { f.cancelled = cancelled; f.timedOut = timedOut }
            if (cancelled || timedOut) {
                process.stop()
                let stopping = MonoTime.now()
                while ((MonoTime.now() - stopping).toMilliseconds() < 3000) {
                    if (let Some(exit) <- process.poll(timeoutMs: 50)) {
                        code = Int64(exit)
                        observed = true
                        if (let Some(f) <- facts) { f.code = code; f.observed = true }
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
        // 收束失败时已观测的退出事实已由 facts 保留；此处把已读取的输出同步进 facts，
        // 避免把"已观测退出但收束失败"误报成"从未运行/无输出"（缺口一）。
        try {
            process.stop()
        } catch (_: Exception) {}
        var soComplete = false
        var seComplete = false
        try {
            let so = stdout.get(3000 * Duration.millisecond)
            soComplete = so.complete
            if (let Some(f) <- facts) { f.stdout = so.text; f.stdoutTruncated = so.truncated }
        } catch (_: Exception) {}
        try {
            let se = stderr.get(3000 * Duration.millisecond)
            seComplete = se.complete
            if (let Some(f) <- facts) { f.stderr = se.text; f.stderrTruncated = se.truncated }
        } catch (_: Exception) {}
        if (let Some(f) <- facts) { f.outputComplete = soComplete && seComplete }
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
    if (let Some(f) <- facts) {
        f.code = code
        f.observed = observed
        f.cancelled = cancelled
        f.timedOut = timedOut
        f.stdout = out.text
        f.stderr = err.text
        f.stdoutTruncated = out.truncated
        f.stderrTruncated = err.truncated
        f.outputComplete = complete
    }
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
    // 未能安全关闭的进程/句柄计数：仅用于可观测（健康检查/日志），不改变 close 语义，
    // 也不影响 WindowsExecutionProcessProvider 自身的 retained 所有权模型（缺口二：不再静默失联）。
    let leaked = AtomicInt64(0)
    func leakedProcessCount(): Int64 { leaked.load() }
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
                // 在途读者占用句柄，无法安全关闭：计入泄漏计数，避免静默失联。
                library.leaked.fetchAdd(1)
                throw Exception("windows-process-readers-active")
            }
            let error = unsafe { library.closeCall(owned) }
            if (error != 0) {
                // 原生 close 失败，句柄未释放：计入泄漏计数，供健康检查与显式重试承接。
                library.leaked.fetchAdd(1)
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

// 跨平台入口：默认 false（fail-closed）。仅当显式选择加入 Windows 强制隔离，
// 且原生薄层 DLL 存在时才放行——不主动开启 AppContainer 执行提供方。
@When[os == "Windows"]
public func windowsExecutionEnforcingAvailable(directory: String): Bool {
    if (directory.size == 0) {
        return false
    }
    if (let Some(value) <- getVariable("SACODE_WINDOWS_ENFORCING")) {
        let normalized = value.toAsciiLower().trimAscii()
        if (normalized == "1" || normalized == "true" || normalized == "yes" || normalized == "on") {
            if (let Some(_) <- windowsProcessLibraryPath()) {
                return true
            }
        }
    }
    return false
}

@When[os != "Windows"]
public func windowsExecutionEnforcingAvailable(directory: String): Bool {
    return false
}

// 原生薄层 DLL 路径：优先 SACODE_WINDOWS_PROCESS_DLL，缺省不猜测运行时路径。
@When[os == "Windows"]
public func windowsProcessLibraryPath(): ?String {
    if (let Some(explicit) <- getVariable("SACODE_WINDOWS_PROCESS_DLL")) {
        if (explicit.size > 0 && FileInfo(explicit).isRegular()) {
            return Some(explicit)
        }
    }
    return None
}

@When[os != "Windows"]
public func windowsProcessLibraryPath(): ?String {
    return None
}

// 仅在 Windows 强制隔离开启时构造提供方；任一原生资源不可用则退回 None，
// 由监督器维持普通 shell 兜底。构造即创建 AppContainer 配置，属显式选择加入的副作用。
@When[os == "Windows"]
public func windowsEnforcingProcessProvider(proposal: String, directory: String): ?ExecutionProcessProvider {
    if (!windowsExecutionEnforcingAvailable(directory)) {
        return None
    }
    if (let Some(dll) <- windowsProcessLibraryPath()) {
        try {
            let library = WindowsProcessLibrary(dll)
            let profile = WindowsOwnedProfile()
            let environment = acProbeEnvironment(getVariable("LOCALAPPDATA").getOrThrow(), getVariable("SystemRoot").getOrThrow())
            return Some(WindowsExecutionProcessProvider(library, profile, environment, proposal))
        } catch (_: Exception) {
            return None
        }
    }
    return None
}

@When[os != "Windows"]
public func windowsEnforcingProcessProvider(proposal: String, directory: String): ?ExecutionProcessProvider {
    return None
}

// 模型 shell 复用的 AppContainer 启动入口：复用既有 Windows 强制隔离薄层（同一 library/profile/
// environment 装配与 collectWindowsProcess 结算），保持沙箱语义，不降级裸运行。
// 仅当显式选择加入（SACODE_WINDOWS_ENFORCING 且原生 DLL 齐备）时返回真实执行结果；
// 资源不可用或启动失败一律返回携带固定枚举原因（无密钥/路径）的 ShellResult，不抛给上层泛化 io-error。
// 注意：AppContainer 工作区 ACL 与撤销属独立后续工作，不在本入口内；未授予工作区访问时命令仍会真实启动，
// 但可能因访问控制失败——那是真实结算，不是被吞掉的 io-error。
@When[os == "Windows"]
func resolveWindowsExecutable(command: String, systemRoot: String): String {
    if (Path(command).isAbsolute()) {
        return command
    }
    let lower = command.toAsciiLower()
    if (lower == "powershell" || lower == "powershell.exe") {
        return systemRoot + "\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
    }
    if (lower == "cmd" || lower == "cmd.exe") {
        return systemRoot + "\\System32\\cmd.exe"
    }
    if (let Some(pathEnv) <- getVariable("PATH")) {
        for (dir in pathEnv.split(";")) {
            let trimmed = dir.trimAscii()
            if (trimmed.size == 0) {
                continue
            }
            let candidate = trimmed + "\\" + command + (if (lower.endsWith(".exe")) { "" } else { ".exe" })
            if (FileInfo(candidate).isRegular()) {
                return candidate
            }
        }
    }
    // 解析不出绝对路径就到此为止：相对名交给原生层只能换来笼统的 bad-args，
    // 无法区分"命令不存在"与"参数非法"，因此在此给出固定分类。
    throw Exception("windows-enforcing-resolve-not-found")
}

// ── 对外错误标识契约（稳定；前端与验收脚本按前缀匹配，不要等值匹配）──────────────
// appcontainer-init-failed:<stage>:<reason>     沙箱初始化/启动阶段失败，进程未创建
// appcontainer-command-invalid:<reason>         命令解析或参数错误（与沙箱环境无关）
// appcontainer-create-failed:<code|reason>      原生进程创建失败（<code> 为 Win32 码）
// appcontainer-supervision-failed:<reason>      进程已创建，创建后监督失败
// <primary>|appcontainer-cleanup-unconfirmed:<detail>  回收未确认，可与上述任一类组合
// <stage> 固定枚举：library|profile|environment|resolve|command|create|supervision
// <reason> 只取白名单 token；数字仅保留经校验的十进制 Win32/HRESULT 码。
// 任何原始异常文本（可能含本机路径、账户名、底层实现细节）一律不透传。

// 原生错误码校验：只接受完整十进制、0..4294967295，并归一化（00087 → 87）。
func windowsValidatedCode(text: String): ?String {
    if (text.size == 0 || text.size > 10) {
        return None
    }
    for (byte in text.toArray()) {
        if (byte < 48 || byte > 57) {
            return None
        }
    }
    var parsed: ?String = None
    // 此前已校验全为数字且长度 0..10，这里直接整数累加，不依赖 std.convert 的 parse 扩展，
    // 避免未导入 parsable 接口导致的 undeclared identifier 'parse' 编译错误。
    var value: Int64 = 0
    for (byte in text.toArray()) {
        value = value * 10 + Int64(byte - 48)
    }
    if (value >= 0 && value <= 4294967295) {
        parsed = Some(value.toString())
    }
    return parsed
}

// 只认 "<name>:<十进制码>" 这一种形态；多段、非数字、越界一律不保留数值。
func windowsCodedReason(message: String, name: String): ?String {
    let parts = message.split(":")
    if (parts.size != 2 || parts[0] != name) {
        return None
    }
    return windowsValidatedCode(parts[1])
}

// 初始化/启动阶段原因白名单：未列出的一律 unknown。
func appContainerInitReason(message: String): String {
    if (let Some(code) <- windowsCodedReason(message, "windows-profile-create")) {
        return "profile-create:${code}"
    }
    if (message.startsWith("windows-process-export-missing")) {
        return "library-export-missing"
    }
    if (message == "windows-process-library-path") {
        return "library-path"
    }
    if (message == "windows-process-library-unavailable") {
        return "library-unavailable"
    }
    if (message == "windows-process-abi-version") {
        return "library-abi-version"
    }
    if (message == "windows-process-library-closed") {
        return "library-closed"
    }
    if (message == "windows-profile-api-unavailable") {
        return "profile-api-unavailable"
    }
    if (message == "windows-profile-closed") {
        return "profile-closed"
    }
    if (message == "appcontainer-environment-unavailable") {
        return "environment-unavailable"
    }
    if (message == "windows-enforcing-environment-localappdata") {
        return "environment-localappdata"
    }
    if (message == "windows-enforcing-environment-systemroot") {
        return "environment-systemroot"
    }
    return "unknown"
}

// 创建后监督阶段原因白名单。该分类同时说明"进程已创建"，与初始化失败在语义上互斥。
func appContainerSupervisionReason(message: String): String {
    if (let Some(code) <- windowsCodedReason(message, "windows-process-resume")) {
        return "resume:${code}"
    }
    if (let Some(code) <- windowsCodedReason(message, "windows-process-wait")) {
        return "wait:${code}"
    }
    if (let Some(code) <- windowsCodedReason(message, "windows-process-read")) {
        return "read:${code}"
    }
    if (let Some(code) <- windowsCodedReason(message, "windows-process-active")) {
        return "active:${code}"
    }
    if (let Some(code) <- windowsCodedReason(message, "windows-process-stop")) {
        return "stop:${code}"
    }
    if (message == "windows-process-invalid-limits") {
        return "invalid-limits"
    }
    if (message == "windows-process-cleanup-only") {
        return "resume-after-failed-create"
    }
    if (message == "windows-process-closed") {
        return "closed"
    }
    if (message == "windows-process-poll-timeout") {
        return "poll-timeout"
    }
    if (message == "windows-process-channel") {
        return "channel"
    }
    return "unknown"
}

// 回收阶段原因白名单。observe: 前缀专门表示"存活状态都读不到"，不混同于 stop 失败。
func appContainerCleanupReason(message: String): String {
    if (let Some(code) <- windowsCodedReason(message, "windows-process-stop")) {
        return "stop:${code}"
    }
    if (let Some(code) <- windowsCodedReason(message, "windows-process-close")) {
        return "close:${code}"
    }
    if (let Some(code) <- windowsCodedReason(message, "windows-process-active")) {
        return "observe:${code}"
    }
    if (message == "windows-process-readers-active") {
        return "readers-active"
    }
    if (message == "windows-process-closed") {
        return "closed"
    }
    return "unknown"
}

func appContainerProfileCloseReason(message: String): String {
    if (let Some(code) <- windowsCodedReason(message, "windows-profile-delete")) {
        return "profile-delete:${code}"
    }
    if (message == "windows-profile-in-use") {
        return "profile-in-use"
    }
    if (message == "windows-profile-closed") {
        return "profile-closed"
    }
    return "profile-unknown"
}

func appContainerLibraryCloseReason(message: String): String {
    if (message == "windows-process-library-in-use") {
        return "library-in-use"
    }
    if (message == "windows-process-library-closed") {
        return "library-closed"
    }
    return "library-unknown"
}

// 阶段分类：命令解析/参数、进程创建、初始化三类互斥，不能统一报成"环境不支持沙箱"。
func appContainerFailureCategory(stage: String, message: String): String {
    // 原生层识别出 LPAC 形态（缺 ALL APPLICATION PACKAGES）时返回 ERROR_NOT_SUPPORTED。
    // 这是沙箱初始化失败，不是命令退出码；必须与 shell-exit-code 分开报。
    if (message == "windows-process-create:50") {
        return "SANDBOX_INIT_FAILED:token-missing-all-application-packages"
    }
    if (message == "windows-process-invalid-argument" || message == "windows-process-unsupported-shell-arguments") {
        return "appcontainer-command-invalid:arguments"
    }
    if (message == "windows-process-command-too-long") {
        return "appcontainer-command-invalid:too-long"
    }
    if (message == "windows-enforcing-resolve-not-found") {
        return "appcontainer-command-invalid:executable-not-found"
    }
    if (let Some(code) <- windowsCodedReason(message, "windows-process-create")) {
        return "appcontainer-create-failed:${code}"
    }
    if (message == "windows-process-invalid-create-reply") {
        return "appcontainer-create-failed:invalid-reply"
    }
    return "appcontainer-init-failed:${stage}:${appContainerInitReason(message)}"
}

// 未观测到退出的失败结果：退出码、输出、exitObserved 三者都不能伪造。
func appContainerFailure(error: String): ShellResult {
    return ShellResult(-1, "", "", false, error, outputComplete: false, exitObserved: false)
}

func appendWindowsCleanup(current: String, next: String): String {
    if (next.size == 0) {
        return current
    }
    if (current.size == 0) {
        return next
    }
    return "${current},${next}"
}

// 主分类与回收状态的唯一装配点：回收未确认必须作为独立段出现，不能被主分类掩盖。
func appContainerError(primary: String, cleanup: String): String {
    if (cleanup.size == 0) {
        return primary
    }
    if (primary.size == 0) {
        return "appcontainer-cleanup-unconfirmed:${cleanup}"
    }
    return "${primary}|appcontainer-cleanup-unconfirmed:${cleanup}"
}

@When[os == "Windows"]
func windowsRequiredVariable(name: String, reason: String): String {
    if (let Some(value) <- getVariable(name)) {
        return value
    }
    throw Exception(reason)
}

// 本入口的 argv 装配。cmd 使用自己的引号规则，只接受 /d /s /c <cmd> 一种形态；
// 其他可执行文件逐参数按 CRT 规则转义。参数不合法在此失败，不进入原生创建。
// 事实说明：Windows 上模型 shell 的两个入口（bash / pwsh）在 runShellCommand 里都已改写成
// powershell.exe -EncodedCommand，因此这条 cmd 分支在现有产品路径上不会被触发，
// 它只是 WindowsExecutionProcessProvider 同款命令形状的防御性复用；新增其他参数形态需先验证转义语义。
@When[os == "Windows"]
func windowsEnforcingCommandLine(executable: String, arguments: Array<String>): String {
    var command = windowsProcessArgument(executable)
    let image = executable.replace("\\", "/").toAsciiLower()
    if (image.endsWith("/cmd.exe")) {
        if (arguments.size != 4 || arguments[0] != "/d" || arguments[1] != "/s" ||
            arguments[2] != "/c" || arguments[3].contains("\u{0}")) {
            throw Exception("windows-process-unsupported-shell-arguments")
        }
        return command + " /d /s /c \"" + arguments[3] + "\""
    }
    for (argument in arguments) {
        command += " " + windowsProcessArgument(argument)
    }
    return command
}

// 回收本入口创建的原生进程。返回空串 = 已确认回收（进程树已退出且句柄已关闭）；
// 返回原因 token = 无法确认，必须随结果外传，不得吞掉 stop/close 失败后当成功。
// 依据原生契约（core/native/windows_process.c）：存活树时 close 返回 ERROR_BUSY 且不释放句柄；
// create 只有在"终止未确认"时才返回带句柄的错误（ready=false：只能清理，不能 resume）。
@When[os == "Windows"]
func releaseWindowsNativeProcess(process: WindowsNativeProcess): String {
    var reason = ""
    var alive = true
    try {
        alive = process.active() != 0
    } catch (e: Exception) {
        // 读不到存活状态时按存活处理：宁可报告未确认，也不宣称已回收。
        reason = appContainerCleanupReason(e.message)
        alive = true
    }
    if (alive) {
        try {
            process.stop()
        } catch (e: Exception) {
            if (reason.size == 0) {
                reason = appContainerCleanupReason(e.message)
            }
        }
        let deadline = MonoTime.now()
        var settled = false
        while (true) {
            try {
                if (process.active() == 0) {
                    settled = true
                }
            } catch (e: Exception) {
                if (reason.size == 0) {
                    reason = appContainerCleanupReason(e.message)
                }
                break
            }
            if (settled) {
                break
            }
            if ((MonoTime.now() - deadline).toMilliseconds() >= 3000) {
                break
            }
            sleep(10 * Duration.millisecond)
        }
        if (!settled && reason.size == 0) {
            reason = "tree-alive"
        }
    }
    try {
        process.close()
    } catch (e: Exception) {
        if (reason.size == 0) {
            reason = appContainerCleanupReason(e.message)
        }
    }
    return reason
}

@When[os == "Windows"]
public func windowsEnforcingExecute(workingDirectory: String, executable: String, arguments: Array<String>,
    cwd: String, timeoutMs: Int64, outputLimit: Int64, token: TurnToken, onCreated: (Int64) -> Unit,
    onStarted: (Int64) -> Unit): Option<ShellResult> {
    if (!windowsExecutionEnforcingAvailable(workingDirectory)) {
        return None
    }
    if (let Some(dll) <- windowsProcessLibraryPath()) {
        var library: ?WindowsProcessLibrary = None
        var profile: ?WindowsOwnedProfile = None
        var process: ?WindowsNativeProcess = None
        // 原生启动链的实际阶段；只有进程创建之前的失败才归初始化/启动失败。
        var stage = "library"
        var failure = ""
        var result: ?ShellResult = None
        var cleanup = ""
        // 监督阶段事实桶：进程已创建后若收束异常，据此保留已观测的退出码/输出/取消事实，
        // 不改写为"未启动/初始化失败"（缺口一）。默认不传 facts 的调用方（Host 提供方）不受影响。
        var supervisionReason = ""
        var facts: ?WindowsRunFacts = None
        try {
            library = Some(WindowsProcessLibrary(dll))
            stage = "profile"
            profile = Some(WindowsOwnedProfile())
            stage = "environment"
            let localAppData = windowsRequiredVariable("LOCALAPPDATA", "windows-enforcing-environment-localappdata")
            let systemRoot = windowsRequiredVariable("SystemRoot", "windows-enforcing-environment-systemroot")
            let environment = acProbeEnvironment(localAppData, systemRoot)
            stage = "resolve"
            let resolvedExecutable = resolveWindowsExecutable(executable, systemRoot)
            let directory = if (cwd.size > 0) { cwd } else { workingDirectory }
            stage = "command"
            let command = windowsEnforcingCommandLine(resolvedExecutable, arguments)
            stage = "create"
            let creation = library.getOrThrow().create(resolvedExecutable, command, directory, environment,
                profile.getOrThrow())
            // 本入口创建即本入口回收：原生 create 失败通常不返回句柄，唯独"终止未确认"会带回
            // 一个 ready=false 的句柄；两种形态都在下方 finally 交付回收结论。
            process = creation.process
            if (creation.error != 0) {
                throw Exception("windows-process-create:${creation.error}")
            }
            stage = "supervision"
            facts = Some(WindowsRunFacts())
            result = Some(collectWindowsProcess(creation.process.getOrThrow(), token, timeoutMs, outputLimit,
                { pid => onCreated(pid) }, onStarted, facts: facts))
        } catch (e: Exception) {
            // 分类只取固定白名单；原始 e.message 可能含本机路径/底层细节，不透传。
            // 退出码/输出/exitObserved 不在此编造；若监督阶段已通过 facts 观测到真实退出，
            // 事实由 facts 保留（见下方结果装配），此处只确定监督失败分类与原因。
            if (stage == "supervision") {
                supervisionReason = appContainerSupervisionReason(e.message)
                failure = "appcontainer-supervision-failed:${supervisionReason}"
            } else {
                failure = appContainerFailureCategory(stage, e.message)
            }
        } finally {
            // 回收结论必须外传：stop/close 失败或存活树未退出时明确标记未确认。
            try {
                if (let Some(p) <- process) {
                    cleanup = releaseWindowsNativeProcess(p)
                }
                if (let Some(pf) <- profile) {
                    try {
                        pf.close()
                    } catch (profileError: Exception) {
                        cleanup = appendWindowsCleanup(cleanup, appContainerProfileCloseReason(profileError.message))
                    }
                }
                if (let Some(lb) <- library) {
                    try {
                        lb.close()
                    } catch (libraryError: Exception) {
                        cleanup = appendWindowsCleanup(cleanup, appContainerLibraryCloseReason(libraryError.message))
                    }
                }
            } catch (_: Exception) {
                cleanup = appendWindowsCleanup(cleanup, "unknown")
            }
        }
        if (let Some(value) <- result) {
            if (cleanup.size == 0) {
                return Some(value)
            }
            // 命令已结算但资源未确认回收：保留真实退出码与输出，只把 error 标为未确认。
            return Some(ShellResult(value.exitCode, value.stdout, value.stderr, value.timedOut,
                "appcontainer-cleanup-unconfirmed:${cleanup}", cancelled: value.cancelled,
                stdoutTruncated: value.stdoutTruncated, stderrTruncated: value.stderrTruncated,
                outputComplete: false, exitObserved: value.exitObserved))
        }
        // 监督阶段收束异常但已观测到真实退出事实（S1/S2）：保留退出码、输出、取消与观测状态，
        // 不得改写成"未启动/初始化失败"；仅附加监督失败分类与未确认清理段。S3（onCreated 即抛、
        // 从未 resume）facts.observed 为 false，不进入此分支，保持与 init/create 分类互斥。
        if (stage == "supervision") {
            if (let Some(f) <- facts) {
                if (f.observed) {
                    return Some(ShellResult(f.code, f.stdout, f.stderr, f.timedOut,
                        appContainerError("appcontainer-supervision-failed:${supervisionReason}", cleanup),
                        cancelled: f.cancelled, stdoutTruncated: f.stdoutTruncated,
                        stderrTruncated: f.stderrTruncated, outputComplete: f.outputComplete,
                        exitObserved: f.observed))
                }
            }
        }
        if (failure.size == 0) {
            failure = "appcontainer-init-failed:${stage}:unknown"
        }
        return Some(appContainerFailure(appContainerError(failure, cleanup)))
    }
    return None
}

@When[os != "Windows"]
public func windowsEnforcingExecute(workingDirectory: String, executable: String, arguments: Array<String>,
    cwd: String, timeoutMs: Int64, outputLimit: Int64, token: TurnToken, onCreated: (Int64) -> Unit,
    onStarted: (Int64) -> Unit): Option<ShellResult> {
    return None
}
