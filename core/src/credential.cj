package core

import std.fs.*
import std.env.*
import std.collection.*

// 凭证缝：配置面（提供商设置、会话日志）只携带**引用**，值由这里的分层 provider 持有。
// 上游 credentials 子系统的四条硬规约逐条落地：
//   1. 引用名就是 POSIX 环境变量名——brand 的作用是别让别的字符串冒充引用；
//   2. 每次操作重新解析，不跨操作缓存——这正是「旋转后下一次请求即生效」的机制；
//   3. 空值在所有层都算缺席，盘上不留「存在但为空」的条目；
//   4. 由活进程环境供值的引用不可写：写了会被环境影子继续压住，等于对用户撒谎，
//      所以当场拒绝，配置面据 describe().writable 提前把它渲染成只读。
//
// 层次：`env`（活进程环境）> `user-file`（用户设置目录下的 credentials.env）。
// 说明：user-file 层沿用上游 local provider 的 env-file 形态——值是明文存在用户自有文件里，
// 不是操作系统钥匙串。想再 Harden 成平台安全存储是另一件事，这里不假装已经做到。

public class CredentialValue {
    public let value: String
    public let source: String
    public init(value: String, source: String) {
        this.value = value
        this.source = source
    }
}

public class CredentialInfo {
    public let configured: Bool
    public let source: String
    public let writable: Bool
    public init(configured: Bool, source: String, writable: Bool) {
        this.configured = configured
        this.source = source
        this.writable = writable
    }

    // 给配置面的摘要：没有任何槽位能带值穿越这条读面
    public func safeSummary(): String {
        return "configured=${configured} source=${source} writable=${writable}"
    }
}

public class CredentialStore {
    let file: String
    let envLookup: (String) -> String

    public init(file: String, envLookup: (String) -> String) {
        this.file = file
        this.envLookup = envLookup
    }

    public static func forUser(): CredentialStore {
        let dir = Path(GlobalAppearanceSettings.forUser().settingsPath()).parent.toString()
        let lookup: (String) -> String = { name => getVariable(name) ?? "" }
        return CredentialStore("${dir}/credentials.env", lookup)
    }

    // 引用只接受 POSIX 环境变量语法：^[A-Za-z_][A-Za-z0-9_]*$
    private static func checkRef(ref: String): Unit {
        if (ref.size == 0) {
            throw Exception("bad-credential-ref")
        }
        let bs = ref.toArray()
        var i: Int64 = 0
        while (i < bs.size) {
            let b = bs[i]
            let letter = (b >= 65 && b <= 90) || (b >= 97 && b <= 122) || b == 95
            let digit = b >= 48 && b <= 57
            if (i == 0) {
                if (!letter) {
                    throw Exception("bad-credential-ref")
                }
            } else if (!letter && !digit) {
                throw Exception("bad-credential-ref")
            }
            i += 1
        }
    }

    // 值不允许换行与控制字符：文件层是逐行 KEY=VALUE，允许换行等于注入另一条凭证
    private static func checkValue(value: String): Unit {
        for (b in value.toArray()) {
            if (b < 32 || b == 127) {
                throw Exception("bad-credential-value")
            }
        }
    }

    // user-file 层每次现读：外部编辑或另一进程的写入要能立刻被看见
    private func readFile(ref: String): String {
        if (!exists(file)) {
            return ""
        }
        var text = ""
        try {
            text = String.fromUtf8(File.readFrom(file))
        } catch (e: Exception) {
            return ""
        }
        var found = ""
        for (line in text.split("\n")) {
            let trimmed = line.trimAscii()
            if (trimmed.size == 0 || trimmed.startsWith("#")) {
                continue
            }
            let eq = trimmed.indexOf("=") ?? Int64(-1)
            if (eq <= 0) {
                continue
            }
            if (trimmed[0..eq] == ref) {
                found = trimmed[(eq + 1)..]
            }
        }
        return found
    }

    // 读面只报事实，永不带值
    public func describe(ref: String): CredentialInfo {
        CredentialStore.checkRef(ref)
        let fromEnv = envLookup(ref)
        if (fromEnv.size > 0) {
            return CredentialInfo(true, "env", false)
        }
        if (readFile(ref).size > 0) {
            return CredentialInfo(true, "user-file", true)
        }
        return CredentialInfo(false, "", true)
    }

    public func resolve(ref: String): Option<CredentialValue> {
        CredentialStore.checkRef(ref)
        let fromEnv = envLookup(ref)
        if (fromEnv.size > 0) {
            return Some(CredentialValue(fromEnv, "env"))
        }
        let fromFile = readFile(ref)
        if (fromFile.size > 0) {
            return Some(CredentialValue(fromFile, "user-file"))
        }
        // 空值即缺席：即便盘上真有一行 KEY=（别人写的），也不当作已配置
        return None
    }

    public func set(ref: String, value: String): Unit {
        CredentialStore.checkRef(ref)
        if (envLookup(ref).size > 0) {
            throw Exception("credential-read-only")
        }
        if (value.size > 0) {
            CredentialStore.checkValue(value)
        }
        if (value.size == 0) {
            unset(ref)
            return
        }
        writeEntries(ref, value)
    }

    public func unset(ref: String): Unit {
        CredentialStore.checkRef(ref)
        if (envLookup(ref).size > 0) {
            throw Exception("credential-read-only")
        }
        writeEntries(ref, "")
    }

    // 整份重写但保留其它条目：同键只留最后一次写入，撤掉的键一行都不留
    private func writeEntries(ref: String, value: String): Unit {
        let out = ArrayList<String>()
        if (exists(file)) {
            var text = ""
            try {
                text = String.fromUtf8(File.readFrom(file))
            } catch (e: Exception) {
                throw Exception("credential-store-unreadable")
            }
            for (line in text.split("\n")) {
                let trimmed = line.trimAscii()
                if (trimmed.size == 0) {
                    continue
                }
                if (trimmed.startsWith("#")) {
                    out.add(trimmed)
                    continue
                }
                let eq = trimmed.indexOf("=") ?? Int64(-1)
                if (eq <= 0 || trimmed[0..eq] == ref) {
                    continue
                }
                let key = trimmed[0..eq]
                // 写入即收口：同一引用只留最后一次，别在盘上留互相矛盾的历史条目——
                // 读面按「最后一次为准」解析，写面若保留重复就等于两边口径不一致。
                var slot = Int64(-1)
                var i = Int64(0)
                while (i < Int64(out.size)) {
                    let oeq = out[i].indexOf("=") ?? Int64(-1)
                    if (oeq > 0 && out[i][0..oeq] == key) {
                        slot = i
                    }
                    i += 1
                }
                if (slot >= 0) {
                    out[slot] = trimmed
                } else {
                    out.add(trimmed)
                }
            }
        }
        if (value.size > 0) {
            out.add("${ref}=${value}")
        }
        var text = ""
        for (line in out) {
            text += "${line}\n"
        }
        File.writeTo(file, text.toArray())
    }
}
