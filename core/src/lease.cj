package core
import std.collection.ArrayList
import std.fs.*

// 会话写者租约：同一会话同时只允许一个写者；读侧（投影/回放）不受限。
//
// 获取走「独占临时文件 + rename(overwrite:false)」：目标已存在时 rename 抛异常，
// 于是不再存在 exists→writeTo 之间的竞态窗口（std.fs 没暴露 O_EXCL，而这是文档化
// API 里唯一在 Windows 上也算原子的独占落位手段）。
// 盘上写的是归属凭据而不是一个裸标志：release 只认自己那份，抢写失败的一方
// 无权清掉持有者的租约。
//
// 仍未做：崩溃持有者的自动接管。Windows 下 std 取不到自身 pid
// （std.process 只有 findProcess(pid)，std.posix 又非跨平台），判活需要 CFFI 绑
// GetCurrentProcessId + OpenProcess；接管落地前的行为是「明确拒绝」而非「悄悄抢走」。
public class WriteLease {
    let leasePath: String
    var token = ""
    var staging = ""

    public init(sessionPath: String) {
        this.leasePath = "${sessionPath}.lease"
    }

    public func held(): Bool {
        return exists(leasePath)
    }

    public func ownerToken(): String {
        return token
    }

    // 失败获取用的中转文件；成功或清理后都应为空，留给测试盯「没留垃圾」
    public func stagingArtifact(): String {
        return staging
    }

    // 盘上的归属；文件不存在或读不出都返回空串，调用方据此判「没人拿着」
    public func currentOwner(): String {
        try {
            return String.fromUtf8(File.readFrom(leasePath)).trimEnd()
        } catch (e: Exception) {
            return ""
        }
    }

    public func acquire(): Bool {
        // 每次尝试都重新生成凭据：同一实例重试不得复用上一轮的归属
        token = ""
        staging = ""
        let dir = dirOf(leasePath)
        try {
            let tmp = File.createTemp(Path(dir))
            let tmpPath = tmp.info.path.toString()
            staging = tmpPath
            let mark = "writer=${tmp.info.path.fileName}"
            tmp.write(mark.toArray())
            tmp.close()
            rename(tmpPath, to: leasePath, overwrite: false)
            // 只有落位成功才算拿到，凭据以盘上那份为准
            token = mark
            staging = ""
            return true
        } catch (e: Exception) {
            if (staging.size > 0) {
                try {
                    removeIfExists(staging, recursive: false)
                } catch (e2: Exception) {
                    // 清理失败不改变结论：这次获取已经失败了
                }
                staging = ""
            }
            return false
        }
    }

    // 只归还自己拿到的那份：凭据不匹配就什么都不动
    public func release(): Bool {
        if (token.size == 0) {
            return false
        }
        if (currentOwner() != token) {
            return false
        }
        try {
            let gone = removeIfExists(leasePath, recursive: false)
            if (gone) {
                token = ""
            }
            return gone
        } catch (e: Exception) {
            return false
        }
    }

    // 取父目录前缀：只用字节扫描，不依赖分隔符相关的切片写法
    private func dirOf(p: String): String {
        let bytes = p.toArray()
        var lastSeen: Int64 = -1
        var i: Int64 = 0
        while (i < Int64(bytes.size)) {
            let n = Int64(bytes[i])
            if (n == 47 || n == 92) {
                lastSeen = i
            }
            i += 1
        }
        if (lastSeen < 0) {
            return "./"
        }
        let out = ArrayList<Byte>()
        var k: Int64 = 0
        while (k <= lastSeen) {
            out.add(bytes[k])
            k += 1
        }
        return String.fromUtf8(out.toArray())
    }
}
