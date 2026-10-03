package core
import std.collection.ArrayList
import std.fs.*

// 会话写者租约：同一会话同时只允许一个写者；读侧（投影/回放）不受限。
//
// 获取走「独占临时文件 + rename(overwrite:false)」：目标已存在时 rename 抛异常，
// 于是不再存在 exists→writeTo 之间的竞态窗口（std.fs 没暴露 O_EXCL，而这是文档化
// API 里唯一在 Windows 上也算原子的独占落位手段）。
// 盘上写的是「谁的进程 + 哪一次获取」组成的归属凭据：release 只认自己那份，
// 抢写失败的一方无权清掉持有者的租约；接管前也能从凭据里认出写者 pid。
//
// 崩溃持有者的接管走 takeoverIfStale()：只有盘上 pid 被 CFFI 判为「确认已死」才清重取。
// pid 会被系统回收复用，因此两类误判都朝安全方向收敛——
// 死者 pid 被别的活进程复用 → 判活为真 → 不接管（留着残留租约，宁可让人手工清）；
// 持有者还活着却打不开句柄 → 判活为假 → 理论上可能被抢走，但本机自己的进程恒可打开，
// 跨机共享盘不在本实现的取舍范围内（真要跨机得换带 fcntl 的锁服务）。
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

    // 凭据形如 writer=<pid>-<临时文件名>；取不到 pid（旧格式、空文件）一律回 0，
    // 调用方把 0 当「不认识格式」处理，绝不据此接管。
    public func holderPid(): Int64 {
        let owner = currentOwner().toArray()
        let head = "writer=".toArray()
        let hlen = Int64(owner.size)
        let plen = Int64(head.size)
        if (hlen <= plen) {
            return Int64(0)
        }
        var k: Int64 = 0
        while (k < plen) {
            if (owner[k] != head[k]) {
                return Int64(0)
            }
            k += 1
        }
        var v: Int64 = 0
        var seen = false
        var i = plen
        while (i < hlen) {
            let n = Int64(owner[i])
            if (n >= 48 && n <= 57) {
                v = v * 10 + (n - 48)
                seen = true
            } else {
                break
            }
            i += 1
        }
        if (!seen) {
            return Int64(0)
        }
        return v
    }

    // 崩溃持有者的接管入口：没被占就直接拿；被占且能确认持有者已死才清掉重拿。
    // 除此之外一律回 false——不删别人的租约，也不假装拿到。
    public func takeoverIfStale(): Bool {
        if (!held()) {
            return acquire()
        }
        let pid = holderPid()
        if (pid <= 0) {
            return false
        }
        if (isProcessAlive(pid)) {
            return false
        }
        try {
            if (!removeIfExists(leasePath, recursive: false)) {
                return false
            }
        } catch (e: Exception) {
            return false
        }
        return acquire()
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
            let mark = "writer=${ownProcessId()}-${tmp.info.path.fileName}"
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
