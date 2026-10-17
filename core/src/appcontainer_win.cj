package core

@When[os == "Windows"]
import std.env.getVariable

// Windows x64 的 AppContainer 身份探针；只创建并清理本次唯一命名的临时 profile，
// 不恢复主线程、不执行用户命令、不授予工作区 ACL，不将身份验证冒充隔离验收。
// 可选 DLL 仅在显式探针调用时从 System32 加载，缺失不阻止 Host/CLI 启动。
@When[os == "Windows"]
foreign func LoadLibraryExW(name: CPointer<UInt16>, file: CPointer<Unit>, flags: UInt32): CPointer<Unit>

@When[os == "Windows"]
foreign func GetProcAddress(module: CPointer<Unit>, name: CPointer<Byte>): CPointer<Unit>

@When[os == "Windows"]
foreign func FreeLibrary(module: CPointer<Unit>): Int32

@When[os == "Windows"]
foreign func GetSystemDirectoryW(buffer: CPointer<UInt16>, size: UInt32): UInt32

@When[os == "Windows"]
foreign func GetTickCount64(): UInt64

@When[os == "Windows"]
foreign func InitializeProcThreadAttributeList(list: CPointer<Unit>, count: UInt32, flags: UInt32,
    size: CPointer<UIntNative>): Int32

@When[os == "Windows"]
foreign func DeleteProcThreadAttributeList(list: CPointer<Unit>): Unit

@When[os == "Windows"]
foreign func UpdateProcThreadAttribute(list: CPointer<Unit>, flags: UInt32, attribute: UIntNative,
    value: CPointer<AcSecurityCapabilities>, size: UIntNative, previous: CPointer<Unit>, returned: CPointer<UIntNative>): Int32

@When[os == "Windows"]
foreign func CreateProcessW(application: CPointer<UInt16>, command: CPointer<UInt16>, processSecurity: CPointer<Unit>,
    threadSecurity: CPointer<Unit>, inheritHandles: Int32, flags: UInt32, environment: CPointer<Unit>,
    directory: CPointer<UInt16>, startup: CPointer<AcStartupInfoEx>, process: CPointer<AcProcessInformation>): Int32

@When[os == "Windows"]
foreign func TerminateProcess(process: CPointer<Unit>, code: UInt32): Int32

@When[os == "Windows"]
foreign func WaitForSingleObject(handle: CPointer<Unit>, milliseconds: UInt32): UInt32

@When[os == "Windows"]
@C
struct AcSecurityCapabilities {
    var sid: CPointer<Unit> = CPointer<Unit>()
    var capabilities: CPointer<Unit> = CPointer<Unit>()
    var count: UInt32 = 0
    var reserved: UInt32 = 0
}

@When[os == "Windows"]
@C
struct AcStartupInfo {
    var cb: UInt32 = 0
    var reserved: CPointer<UInt16> = CPointer<UInt16>()
    var desktop: CPointer<UInt16> = CPointer<UInt16>()
    var title: CPointer<UInt16> = CPointer<UInt16>()
    var x: UInt32 = 0
    var y: UInt32 = 0
    var xSize: UInt32 = 0
    var ySize: UInt32 = 0
    var xChars: UInt32 = 0
    var yChars: UInt32 = 0
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
struct AcStartupInfoEx {
    var startup: AcStartupInfo = AcStartupInfo()
    var attributes: CPointer<Unit> = CPointer<Unit>()
}

@When[os == "Windows"]
@C
struct AcProcessInformation {
    var process: CPointer<Unit> = CPointer<Unit>()
    var thread: CPointer<Unit> = CPointer<Unit>()
    var pid: UInt32 = 0
    var tid: UInt32 = 0
}

// 只有观察到挂起子进程 token 及确认终止才返回成功；不携带放行凭据。
public class AppContainerIdentityResult {
    public let available: Bool
    public let profileCreated: Bool
    public let profileCreateStatus: Int32
    public let sidAvailable: Bool
    public let created: Bool
    public let isAppContainer: Bool
    public let sidMatches: Bool
    public let terminated: Bool
    public let profileDeleteAttempted: Bool
    public let profileDeleted: Bool
    public let profileDeleteStatus: Int32
    public let profileName: String
    public let pid: Int64
    public let reason: String
    public init(available: Bool, profileCreated: Bool, profileCreateStatus: Int32, sidAvailable: Bool, created: Bool,
        isAppContainer: Bool, sidMatches: Bool, terminated: Bool, profileDeleteAttempted: Bool, profileDeleted: Bool,
        profileDeleteStatus: Int32, profileName: String, pid: Int64, reason: String) {
        this.available = available
        this.profileCreated = profileCreated
        this.profileCreateStatus = profileCreateStatus
        this.sidAvailable = sidAvailable
        this.created = created
        this.isAppContainer = isAppContainer
        this.sidMatches = sidMatches
        this.terminated = terminated
        this.profileDeleteAttempted = profileDeleteAttempted
        this.profileDeleted = profileDeleted
        this.profileDeleteStatus = profileDeleteStatus
        this.profileName = profileName
        this.pid = pid
        this.reason = reason
    }
}

@When[os == "Windows"]
func acSystemModule(name: String): CPointer<Unit> {
    let text = unsafe { acquireArrayRawData(fileWidePath(name)) }
    try {
        return unsafe { LoadLibraryExW(text.pointer, CPointer<Unit>(), 2048) }
    } finally {
        unsafe { releaseArrayRawData(text) }
    }
}

@When[os == "Windows"]
func acExport(module: CPointer<Unit>, name: String): CPointer<Unit> {
    let text = unsafe { acquireArrayRawData((name + "\u{0}").toArray()) }
    try {
        return unsafe { GetProcAddress(module, text.pointer) }
    } finally {
        unsafe { releaseArrayRawData(text) }
    }
}

@When[os == "Windows"]
func acSystemCommand(): Array<UInt16> {
    let buffer = Array<UInt16>(32768, repeat: 0)
    let memory = unsafe { acquireArrayRawData(buffer) }
    var count: UInt32 = 0
    try {
        count = unsafe { GetSystemDirectoryW(memory.pointer, 32768) }
    } finally {
        unsafe { releaseArrayRawData(memory) }
    }
    if (count == 0 || count >= 32768) {
        throw Exception("appcontainer-system-path-unavailable")
    }
    let path = Array<UInt16>(Int64(count) + 9, repeat: 0)
    for (i in 0..Int64(count)) {
        path[i] = buffer[i]
    }
    let suffix = fileWidePath("\\cmd.exe")
    for (i in 0..suffix.size) {
        path[Int64(count) + i] = suffix[i]
    }
    return path
}

@When[os == "Windows"]
func acProbeEnvironment(localAppData: String, systemRoot: String): Array<UInt16> {
    if (localAppData.size == 0 || systemRoot.size == 0 || localAppData.contains("\u{0}") || systemRoot.contains("\u{0}")) {
        throw Exception("appcontainer-environment-unavailable")
    }
    // AppContainer 创建需要 LOCALAPPDATA；只传入两个定位字段，不继承模型密钥等父环境。
    // 按变量名排序，每条以 NUL 结束，整个 Unicode 环境块再追加一个 NUL。
    let local = fileWidePath("LOCALAPPDATA=${localAppData}")
    let root = fileWidePath("SystemRoot=${systemRoot}")
    let result = Array<UInt16>(local.size + root.size + 1, repeat: 0)
    for (index in 0..local.size) {
        result[index] = local[index]
    }
    for (index in 0..root.size) {
        result[local.size + index] = root[index]
    }
    return result
}

@When[os == "Windows"]
public func appContainerIdentityProbe(): AppContainerIdentityResult {
    // 本阶段明确只验 Windows x64 的布局，未确认布局不得调用原生函数。
    if (sizeOf<AcStartupInfo>() != 104 || sizeOf<AcStartupInfoEx>() != 112 || sizeOf<AcSecurityCapabilities>() != 24 ||
        sizeOf<AcProcessInformation>() != 24) {
        return AppContainerIdentityResult(false, false, -1, false, false, false, false, false, false, false, -1, "", 0,
            "unsupported-abi")
    }
    let userenv = acSystemModule("userenv.dll")
    if (userenv.isNull()) {
        return AppContainerIdentityResult(false, false, -1, false, false, false, false, false, false, false, -1, "", 0,
            "userenv-unavailable")
    }
    let security = acSystemModule("advapi32.dll")
    var sid = CPointer<Unit>()
    // 只有真实取得裸数组句柄后才记录所有权，不创建废弃的默认句柄。
    var attributes: ?CPointerHandle<UIntNative> = None
    var capabilitiesStorage: ?CPointerHandle<AcSecurityCapabilities> = None
    var attributeInitialized = false
    var process = AcProcessInformation()
    var appContainerName = ""
    var deleteProfileAddress = CPointer<Unit>()
    var profileCreated = false
    var profileCreateStatus: Int32 = -1
    var sidAvailable = false
    var created = false
    var identity = false
    var matched = false
    var terminated = false
    var available = false
    var profileDeleteAttempted = false
    var profileDeleted = false
    var profileDeleteStatus: Int32 = -1
    var reason = "api-unavailable"
    try {
        if (security.isNull()) {
            throw Exception(reason)
        }
        let createProfileAddress = acExport(userenv, "CreateAppContainerProfile")
        deleteProfileAddress = acExport(userenv, "DeleteAppContainerProfile")
        let freeAddress = acExport(security, "FreeSid")
        let openAddress = acExport(security, "OpenProcessToken")
        let infoAddress = acExport(security, "GetTokenInformation")
        let equalAddress = acExport(security, "EqualSid")
        if (createProfileAddress.isNull() || deleteProfileAddress.isNull() || freeAddress.isNull() ||
            openAddress.isNull() || infoAddress.isNull() || equalAddress.isNull()) {
            throw Exception(reason)
        }
        available = true
        let createProfile = CFunc<(CPointer<UInt16>, CPointer<UInt16>, CPointer<UInt16>, CPointer<Unit>, UInt32, CPointer<CPointer<Unit>>) -> Int32>(
            createProfileAddress)
        let openToken = CFunc<(CPointer<Unit>, UInt32, CPointer<CPointer<Unit>>) -> Int32>(openAddress)
        let tokenInfo = CFunc<(CPointer<Unit>, UInt32, CPointer<Unit>, UInt32, CPointer<UInt32>) -> Int32>(infoAddress)
        let equalSid = CFunc<(CPointer<Unit>, CPointer<Unit>) -> Int32>(equalAddress)
        let tick = unsafe { GetTickCount64() }
        let profileBaseName = "sacode.probe.${ownProcessId()}.${tick}"
        if (profileBaseName.size > 64) {
            throw Exception("appcontainer-profile-name-too-long")
        }
        // PID+tick 通常唯一；并发碰撞时只对 ERROR_ALREADY_EXISTS 有界换名，
        // 绝不派生或删除一个由其他调用创建的 profile。
        for (attempt in 0..8) {
            appContainerName = if (attempt == 0) {
                profileBaseName
            } else {
                "${profileBaseName}.${attempt}"
            }
            let name = unsafe { acquireArrayRawData(fileWidePath(appContainerName)) }
            try {
                let displayName = unsafe { acquireArrayRawData(fileWidePath("SaCode AppContainer probe")) }
                try {
                    let description = unsafe {
                        acquireArrayRawData(
                            fileWidePath("Temporary SaCode identity probe; no user command is resumed."))
                    }
                    try {
                        profileCreateStatus = unsafe {
                            createProfile(name.pointer, displayName.pointer, description.pointer, CPointer<Unit>(), 0,
                                inout sid)
                        }
                    } finally {
                        unsafe { releaseArrayRawData(description) }
                    }
                } finally {
                    unsafe { releaseArrayRawData(displayName) }
                }
            } finally {
                unsafe { releaseArrayRawData(name) }
            }
            if (profileCreateStatus == 0) {
                profileCreated = true
                break
            }
            if (profileCreateStatus != -2147024713) {
                break
            }
        }
        if (profileCreateStatus != 0) {
            throw Exception("appcontainer-profile-create-failed")
        }
        if (sid.isNull()) {
            throw Exception("appcontainer-profile-sid-missing")
        }
        sidAvailable = true
        var bytes: UIntNative = 0
        unsafe { InitializeProcThreadAttributeList(CPointer<Unit>(), 1, 0, inout bytes) }
        if (bytes == 0 || bytes > 65536) {
            throw Exception("attribute-size-unavailable")
        }
        // UIntNative 数组保证属性列表指针对齐，不把任意 Byte 数组当 struct。
        let acquired = unsafe { acquireArrayRawData(Array<UIntNative>(Int64((bytes + 7) / 8), repeat: 0)) }
        attributes = Some(acquired)
        let list = unsafe { CPointer<Unit>(acquired.pointer) }
        if (unsafe { InitializeProcThreadAttributeList(list, 1, 0, inout bytes) } == 0) {
            throw Exception("attribute-init-failed")
        }
        attributeInitialized = true
        var capabilities = AcSecurityCapabilities()
        capabilities.sid = sid
        // Windows 保留 lpValue 至属性列表销毁；inout 指针只在一次 FFI 调用内有效。
        let capabilityHandle = unsafe { acquireArrayRawData([capabilities]) }
        capabilitiesStorage = Some(capabilityHandle)
        // PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES = 0x20009；CapabilityCount=0。
        if (unsafe { UpdateProcThreadAttribute(list, 0, 131081, capabilityHandle.pointer,
            sizeOf<AcSecurityCapabilities>(), CPointer<Unit>(), CPointer<UIntNative>()) } == 0) {
            throw Exception("security-attribute-failed")
        }
        var startup = AcStartupInfoEx()
        startup.startup.cb = UInt32(sizeOf<AcStartupInfoEx>())
        startup.attributes = list
        let environmentBytes = acProbeEnvironment(getVariable("LOCALAPPDATA") ?? "", getVariable("SystemRoot") ?? "")
        let commandBytes = acSystemCommand()
        let command = unsafe { acquireArrayRawData(commandBytes) }
        // CreateProcessW may modify lpCommandLine. Use a separate writable buffer and quote
        // the fixed executable path instead of relying on its optional-null form.
        let commandLineBytes = Array<UInt16>(commandBytes.size + 2, repeat: 0)
        commandLineBytes[0] = 34
        for (index in 0..(commandBytes.size - 1)) {
            commandLineBytes[index + 1] = commandBytes[index]
        }
        commandLineBytes[commandLineBytes.size - 2] = 34
        let commandLine = unsafe { acquireArrayRawData(commandLineBytes) }
        let directoryBytes = Array<UInt16>(commandBytes.size - 8, repeat: 0)
        for (i in 0..(directoryBytes.size - 1)) {
            directoryBytes[i] = commandBytes[i]
        }
        let directory = unsafe { acquireArrayRawData(directoryBytes) }
        let environment = unsafe { acquireArrayRawData(environmentBytes) }
        var started: Int32 = 0
        try {
            // CREATE_SUSPENDED | CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT。
            // 不继承句柄，不恢复线程，不提供任意 argv/cwd/环境变量通道。
            started = unsafe {
                CreateProcessW(command.pointer, commandLine.pointer, CPointer<Unit>(), CPointer<Unit>(), 0, 134743044,
                    CPointer<Unit>(environment.pointer), directory.pointer, inout startup, inout process)
            }
        } finally {
            unsafe {
                releaseArrayRawData(command);
                releaseArrayRawData(commandLine);
                releaseArrayRawData(directory);
                releaseArrayRawData(environment)
            }
        }
        if (started == 0) {
            throw Exception("appcontainer-create-failed")
        }
        created = true
        var token = CPointer<Unit>()
        if (unsafe { openToken(process.process, 8, inout token) } == 0) {
            throw Exception("token-open-failed")
        }
        try {
            var returned: UInt32 = 0
            let flag = unsafe { acquireArrayRawData(Array<UInt32>(1, repeat: 0)) }
            try {
                if (unsafe { tokenInfo(token, 29, CPointer<Unit>(flag.pointer), 4, inout returned) } == 0 || returned !=
                    4) {
                    throw Exception("token-query-failed")
                }
                identity = unsafe { flag.pointer.read() } == 1
            } finally {
                unsafe { releaseArrayRawData(flag) }
            }
            let storage = unsafe { acquireArrayRawData(Array<UIntNative>(128, repeat: 0)) }
            try {
                if (unsafe { tokenInfo(token, 31, CPointer<Unit>(storage.pointer), 1024, inout returned) } == 0) {
                    throw Exception("token-sid-query-failed")
                }
                if (UIntNative(returned) < sizeOf<CPointer<Unit>>() || returned > 1024) {
                    throw Exception("token-sid-size-invalid")
                }
                let tokenSid = unsafe { CPointer<CPointer<Unit>>(storage.pointer).read() }
                if (tokenSid.isNull()) {
                    throw Exception("token-sid-missing")
                }
                matched = unsafe { equalSid(tokenSid, sid) } != 0
            } finally {
                unsafe { releaseArrayRawData(storage) }
            }
            if (!identity || !matched) {
                throw Exception("token-identity-mismatch")
            }
            reason = "identity-verified-not-resumed"
        } finally {
            unsafe { CloseHandle(token) }
        }
    } catch (e: Exception) {
        reason = e.message
    } finally {
        if (created) {
            unsafe { TerminateProcess(process.process, 143) }
            terminated = unsafe { WaitForSingleObject(process.process, 5000) } == 0
            unsafe {
                CloseHandle(process.thread);
                CloseHandle(process.process)
            }
            if (!terminated) {
                reason = "termination-unconfirmed"
            }
        }
        if (let Some(handle) <- attributes) {
            if (attributeInitialized) {
                unsafe { DeleteProcThreadAttributeList(CPointer<Unit>(handle.pointer)) }
            }
            unsafe { releaseArrayRawData(handle) }
        }
        if (let Some(handle) <- capabilitiesStorage) {
            unsafe { releaseArrayRawData(handle) }
        }
        if (!sid.isNull() && !security.isNull()) {
            let freeAddress = acExport(security, "FreeSid")
            if (!freeAddress.isNull()) {
                let freeSid = CFunc<(CPointer<Unit>) -> CPointer<Unit>>(freeAddress)
                unsafe { freeSid(sid) }
            }
        }
        if (profileCreated) {
            // 终止无法确认时保留 profile，避免销毁可能仍在运行的进程所依赖的状态。
            if (!created || terminated) {
                if (!deleteProfileAddress.isNull()) {
                    let deleteProfile = CFunc<(CPointer<UInt16>) -> Int32>(deleteProfileAddress)
                    let name = unsafe { acquireArrayRawData(fileWidePath(appContainerName)) }
                    try {
                        profileDeleteAttempted = true
                        profileDeleteStatus = unsafe { deleteProfile(name.pointer) }
                        if (profileDeleteStatus != 0) {
                            // Delete 失败时 Windows 将 profile 状态视为未知；子进程已确认结束，
                            // 对本次拥有的同一名称做一次有界重试。
                            profileDeleteStatus = unsafe { deleteProfile(name.pointer) }
                        }
                        profileDeleted = profileDeleteStatus == 0
                    } finally {
                        unsafe { releaseArrayRawData(name) }
                    }
                }
                if (!profileDeleted && reason == "identity-verified-not-resumed") {
                    reason = "profile-delete-unconfirmed"
                }
            }
        }
        if (!security.isNull()) {
            unsafe { FreeLibrary(security) }
        }
        unsafe { FreeLibrary(userenv) }
    }
    return AppContainerIdentityResult(available, profileCreated, profileCreateStatus, sidAvailable, created, identity,
        matched, terminated, profileDeleteAttempted, profileDeleted, profileDeleteStatus, appContainerName,
        Int64(process.pid), reason)
}

@When[os != "Windows"]
public func appContainerIdentityProbe(): AppContainerIdentityResult {
    return AppContainerIdentityResult(false, false, -1, false, false, false, false, false, false, false, -1, "", 0,
        "platform-unavailable")
}
