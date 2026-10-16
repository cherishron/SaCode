package core

import std.collection.ArrayList
import std.fs.*
import std.env.getVariable

// Linux 初始策略：仅暴露系统运行库与获准工作区，禁止网络，临时 HOME/TMP。
// bwrap 启动失败（含禁用 user namespace）不会回退裸运行；不是完整资源配额沙箱。
@When[os == "Linux" && env != "ohos"]
public func platformSandbox(directory: String): SandboxRuntime {
    return SandboxRuntime(provider: { argv, mode =>
        if (!isConfinedMode(mode) || directory.size == 0) { throw Exception("SANDBOX_UNAVAILABLE") }
        let root = canonicalize(directory).toString()
        if (root == "/" || !FileInfo(root).isDirectory()) { throw Exception("SANDBOX_UNSAFE_WORKSPACE") }
        let home = getVariable("HOME") ?? ""
        if (home.size > 0 && root == canonicalize(home).toString()) { throw Exception("SANDBOX_UNSAFE_WORKSPACE") }
        for (system in ["/usr", "/bin", "/lib", "/lib64", "/etc", "/dev", "/proc", "/run"]) {
            if (root == system || root.startsWith("${system}/")) { throw Exception("SANDBOX_UNSAFE_WORKSPACE") }
        }
        let bwrap = if (exists("/usr/bin/bwrap")) { "/usr/bin/bwrap" } else { "/bin/bwrap" }
        if (!exists(bwrap)) { throw Exception("SANDBOX_UNAVAILABLE:bubblewrap-required") }
        let args = ArrayList<String>()
        for (a in [bwrap, "--die-with-parent", "--new-session", "--unshare-all", "--cap-drop", "ALL",
            "--clearenv", "--setenv", "PATH", "/usr/local/bin:/usr/bin:/bin", "--setenv", "HOME", "/tmp/home",
            "--setenv", "TMPDIR", "/tmp", "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--dir", "/tmp/home"]) { args.add(a) }
        for (system in ["/usr", "/bin", "/lib", "/lib64"]) {
            if (exists(system)) {
                let actual = canonicalize(system).toString()
                // usr-merge 下保持绝对软链接，目标 /usr 已被只读挂载。
                if (actual != system) { args.add("--symlink"); args.add(actual); args.add(system) }
                else { args.add("--ro-bind"); args.add(system); args.add(system) }
            }
        }
        // bwrap --bind 会创建目标父目录，工作区仍使用真实绝对路径。
        if (exists("/etc")) { args.add("--dir"); args.add("/etc") }
        for (file in ["/etc/ld.so.cache", "/etc/ssl", "/etc/alternatives"]) {
            if (exists(file)) { args.add("--ro-bind"); args.add(file); args.add(file) }
        }
        // 不挂 /home、/run、宿主根、DBus socket，工作区才是唯一可写宿主目录。
        args.add(if (mode == "read-only") { "--ro-bind" } else { "--bind" })
        args.add(root); args.add(root)
        args.add("--chdir"); args.add(root); args.add("--")
        for (a in argv) { args.add(a) }
        return args.toArray()
    })
}

@When[os != "Linux" || env == "ohos"]
public func platformSandbox(directory: String): SandboxRuntime {
    // macOS/OHOS/Windows enforcing 提供者尚未在该入口接入，不能声明具备隔离。
    return SandboxRuntime()
}

// 返回固定、脱敏的阻断原因；空串表示同策略探针通过。
// 具体异常文本不穿过 Host 协议，避免泄露路径或底层实现细节。
public func platformExecutionBlockReason(directory: String): String {
    if (directory.size == 0) {
        return "workspace-unavailable"
    }
    try {
        let root = canonicalize(directory).toString()
        if (!FileInfo(root).isDirectory()) {
            return "workspace-unavailable"
        }
    } catch (_: Exception) {
        return "workspace-unavailable"
    }
    try {
        let args = platformSandbox(directory).confine(["/usr/bin/true"], "workspace-write")
        let result = runOwnedProcess(args[0], args[1..], None, 3000, 1024, { => false }, { _ => })
        if (let Some(r) <- result) {
            if (r.exitObserved && r.exitCode == 0 && r.outputComplete && r.error.size == 0) {
                return ""
            }
        }
    } catch (e: Exception) {
        if (e.message == "SANDBOX_UNAVAILABLE:bubblewrap-required") {
            return "bubblewrap-required"
        }
        if (e.message == "SANDBOX_UNSAFE_WORKSPACE") {
            return "unsafe-workspace"
        }
        if (e.message == "SANDBOX_UNAVAILABLE" || e.message == "SANDBOX_MODE_NOT_CONFINED") {
            return "platform-sandbox-unavailable"
        }
    }
    return "sandbox-probe-failed"
}

// 就绪仅用同策略的固定命令探测；用户命令仍经核心工单准入。
public func platformExecutionReady(directory: String): Bool {
    return platformExecutionBlockReason(directory).size == 0
}
