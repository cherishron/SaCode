package core

@When[os == "Windows"]
import std.fs.*
@When[os == "Windows"]
import std.io.*
@When[os == "Windows"]
import std.sync.*

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
