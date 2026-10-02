package core
import std.fs.*
import std.io.*

// 会话写者租约：同一会话同时只允许一个写者；读侧（投影/回放）不受限。
// 已知缺陷：exists + writeTo 之间有 TOCTOU 窗口，std.fs 未暴露 O_EXCL 独占创建，
// 需要真正的原子获取时改走 CFFI（std.interop）或临时文件 + 原子重命名。
public class WriteLease {
    let leasePath: String

    public init(sessionPath: String) {
        this.leasePath = "${sessionPath}.lease"
    }

    public func held(): Bool {
        return exists(leasePath)
    }

    public func acquire(): Bool {
        if (exists(leasePath)) {
            return false
        }
        try {
            File.writeTo(leasePath, "held".toArray())
            return true
        } catch (e: IOException) {
            return false
        }
    }

    public func release(): Bool {
        try {
            return removeIfExists(leasePath, recursive: false)
        } catch (e: IOException) {
            return false
        }
    }
}
