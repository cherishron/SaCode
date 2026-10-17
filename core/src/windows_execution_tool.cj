package core

@When[os == "Windows"]
import std.fs.*
@When[os == "Windows"]
import std.env.getVariable
@When[os == "Windows"]
import stdx.crypto.digest.SHA256
@When[os == "Windows"]
import stdx.encoding.hex.toHexString
@When[os == "Windows"]
import stdx.encoding.json.*

// 在准备阶段固定真实程序；不把父进程环境或PATH传入隔离任务。
@When[os == "Windows"]
class WindowsExecutionTool {
    let requested: String
    let executable: String
    let digest: String
    init(requested: String) {
        if (requested.size == 0 || requested.contains("\u{0}")) {
            throw Exception("execution-tool-invalid")
        }
        var resolved = ""
        if (Path(requested).isAbsolute()) {
            resolved = canonicalize(requested).toString()
        } else {
            if (requested.contains("/") || requested.contains("\\") || requested.contains(":")) {
                throw Exception("execution-tool-relative-path-rejected")
            }
            let name = if (requested.toAsciiLower().endsWith(".exe")) {
                requested
            } else {
                requested + ".exe"
            }
            for (entry in (getVariable("PATH") ?? getVariable("Path") ?? "").split(";", removeEmpty: true)) {
                let directory = Path(entry.trimAscii())
                if (!directory.isAbsolute()) {
                    continue
                }
                let candidate = directory.join(name)
                if (exists(candidate) && FileInfo(candidate).isRegular()) {
                    resolved = canonicalize(candidate).toString()
                    break
                }
            }
        }
        if (resolved.size == 0 || !FileInfo(resolved).isRegular()) {
            throw Exception("execution-tool-not-found")
        }
        this.requested = requested
        this.executable = resolved
        this.digest = windowsExecutionToolDigest(resolved)
    }
    func binding(): String {
        let value = JsonObject();
        value.put("version", JsonInt(1))
        value.put("requested", JsonString(requested));
        value.put("executable", JsonString(executable))
        value.put("sha256", JsonString(digest));
        return value.toString()
    }
    func assertFresh(): Unit {
        if (windowsExecutionToolDigest(executable) != digest) {
            throw Exception("execution-tool-changed")
        }
    }
}

@When[os == "Windows"]
func windowsExecutionToolDigest(path: String): String {
    let file = File(path, OpenMode.Read)
    try {
        if (file.length < 1 || file.length > 268435456) {
            throw Exception("execution-tool-size-limit")
        }
        let hash = SHA256();
        let buffer = Array<Byte>(65536, repeat: 0)
        var total: Int64 = 0
        while (true) {
            let count = file.read(buffer)
            if (count == 0) {
                break
            }
            total += count
            if (total > 268435456) {
                throw Exception("execution-tool-size-limit")
            }
            hash.write(buffer[0..count])
        }
        return toHexString(hash.finish()).toAsciiLower()
    } finally {
        file.close()
    }
}
