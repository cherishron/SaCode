package core

import std.unittest.*
import std.env.*

@When[os == "Windows"]
@Test
func appContainerEnvironmentContainsOnlyRequiredMetadataAndRejectsInjection() {
    let local = fileWidePath("LOCALAPPDATA=C:\\Users\\测试\\AppData\\Local")
    let root = fileWidePath("SystemRoot=C:\\Windows")
    let environment = acProbeEnvironment("C:\\Users\\测试\\AppData\\Local", "C:\\Windows")
    @Expect(environment.size, local.size + root.size + 1)
    for (index in 0..local.size) {
        @Expect(environment[index], local[index])
    }
    for (index in 0..root.size) {
        @Expect(environment[local.size + index], root[index])
    }
    @Expect(environment[environment.size - 1], UInt16(0))
    for (bad in ["", "C:\\Local\u{0}SECRET=not-allowed"]) {
        var rejected = false
        try {
            acProbeEnvironment(bad, "C:\\Windows")
        } catch (_: Exception) {
            rejected = true
        }
        @Expect(rejected, true)
        rejected = false
        try {
            acProbeEnvironment("C:\\Local", bad)
        } catch (_: Exception) {
            rejected = true
        }
        @Expect(rejected, true)
    }
}

@When[os == "Windows"]
@Test
func appContainerWindowsX64AbiMatchesDocumentedStructures() {
    @Expect(sizeOf<AcStartupInfo>(), UIntNative(104))
    @Expect(sizeOf<AcStartupInfoEx>(), UIntNative(112))
    @Expect(sizeOf<AcSecurityCapabilities>(), UIntNative(24))
    @Expect(sizeOf<AcProcessInformation>(), UIntNative(24))
}

@When[os == "Windows"]
@Test
func resolveWindowsExecutableSkipsMissingEntriesAndFailsClassified() {
    // 2026-10-22：FileInfo(p).isRegular() 在路径不存在时抛异常，PATH 解析会在第一个
    // 没有该 exe 的目录处中断，run_code 的 node 解析因此塌成 init-failed:resolve:unknown。
    let saved = getVariable("PATH")
    var root = "C:\\Windows"
    if (let Some(value) <- getVariable("SystemRoot")) {
        root = value
    }
    try {
        // 首项不存在：必须继续向后找到真实存在的 hostname.exe。
        setVariable("PATH", "C:\\__sacode_resolve_missing_dir__;${root}\\System32")
        @Expect(resolveWindowsExecutable("hostname", root), root + "\\System32\\hostname.exe")
        // 全都不存在时仍给出可归因的固定分类，而不是 FileInfo 的原始异常文本。
        var message = ""
        try {
            resolveWindowsExecutable("sacode-missing-tool", root)
        } catch (e: Exception) {
            message = e.message
        }
        @Expect(message, "windows-enforcing-resolve-not-found")
    } finally {
        if (let Some(value) <- saved) {
            setVariable("PATH", value)
        }
    }
}

@When[os == "Windows"]
@Test
func appContainerProbeCreatesAndDeletesUniqueProfileAndRemainsFailClosed() {
    let result = appContainerIdentityProbe()
    println(
        "APPCONTAINER available=${result.available} profileCreated=${result.profileCreated} profileCreateStatus=${result.profileCreateStatus} sidAvailable=${result.sidAvailable} created=${result.created} isAppContainer=${result.isAppContainer} sidMatches=${result.sidMatches} terminated=${result.terminated} profileDeleteAttempted=${result.profileDeleteAttempted} profileDeleted=${result.profileDeleted} profileDeleteStatus=${result.profileDeleteStatus} profileName=${result.profileName} pid=${result.pid} reason=${result.reason}")
    @Expect(result.available, true)
    @Expect(result.profileCreated, true)
    @Expect(result.profileCreateStatus, Int32(0))
    @Expect(result.sidAvailable, true)
    @Expect(result.created, true)
    @Expect(result.isAppContainer, true)
    @Expect(result.sidMatches, true)
    @Expect(result.terminated, true)
    @Expect(result.profileDeleteAttempted, true)
    @Expect(result.profileDeleted, true)
    @Expect(result.profileDeleteStatus, Int32(0))
    @Expect(result.pid != 0, true)
    let second = appContainerIdentityProbe()
    @Expect(second.profileCreated, true)
    @Expect(second.profileDeleted, true)
    @Expect(result.profileName != second.profileName, true)
}

@When[os == "Windows"]
@Test
func appContainerIdentityCapabilitiesDoNotGrantNetworkOrHandles() {
    let capabilities = AcSecurityCapabilities()
    @Expect(capabilities.count, UInt32(0))
    @Expect(capabilities.capabilities.isNull(), true)
    @Expect(capabilities.reserved, UInt32(0))
    let startup = AcStartupInfoEx()
    @Expect(startup.startup.input.isNull(), true)
    @Expect(startup.startup.output.isNull(), true)
    @Expect(startup.startup.error.isNull(), true)
}

@Test
func appContainerProbeDoesNotEnableDefaultSandbox() {
    // 即使模块已链接，默认沙箱仍无后端。模块存在和 API 可加载都不是执行授权。
    var reason = ""
    try {
        SandboxRuntime().confine(["cmd", "/c", "echo hi"], "workspace-write")
    } catch (e: Exception) {
        reason = e.message
    }
    @Expect(reason, "SANDBOX_UNAVAILABLE")
}
