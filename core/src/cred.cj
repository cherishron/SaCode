package core
import std.collection.*

// 凭证登记（**不含明文密钥**）：log-only `credentials/register` 事件承载
// `<ref>::<kind>::<label>`；`credentials/rotate` 承载 `<ref>`；
// `credentials/revoke` 承载 `<ref>`；`revision(ref)` 从事件流回放：1 + 该 ref
// 的 rotate 事件数；未登记或已 revoke 者 revision 抛。
//
// 本切片假设 ref/kind/label 不含 `::`。

class CredEntry {
    let ref: String
    var rotates: Int64
    var active: Bool
    init(ref: String, rotates: Int64, active: Bool) {
        this.ref = ref
        this.rotates = rotates
        this.active = active
    }
}

public class CredentialRegistry {
    let log: SessionLog
    let entries = ArrayList<CredEntry>()

    public init(log: SessionLog) {
        this.log = log
        for (event in log.snapshotEvents()) {
            if (event.eventType != "credentials/register" && event.eventType != "credentials/rotate" && event.eventType != "credentials/revoke") {
                continue
            }
            if (event.eventType == "credentials/register") {
                let body = event.data
                let idx = body.indexOf("::") ?? Int64(-1)
                let ref = if (idx < 0) { body } else { body[0..idx] }
                if (indexOf(ref) < 0) {
                    entries.add(CredEntry(ref, Int64(0), true))
                }
            } else if (event.eventType == "credentials/rotate") {
                let i = indexOf(event.data)
                if (i >= 0) {
                    entries[i].rotates = entries[i].rotates + 1
                }
            } else if (event.eventType == "credentials/revoke") {
                let i = indexOf(event.data)
                if (i >= 0) {
                    entries[i].active = false
                }
            }
        }
    }

    public func register(ref: String, kind: String, label: String): Unit {
        if (ref.size == 0) {
            throw Exception("cred-empty-ref")
        }
        if (kind.size == 0) {
            throw Exception("cred-empty-kind")
        }
        if (label.size == 0) {
            throw Exception("cred-empty-label")
        }
        if (indexOf(ref) >= 0) {
            return
        }
        log.append("credentials/register", "${ref}::${kind}::${label}")
        entries.add(CredEntry(ref, Int64(0), true))
    }

    public func rotate(ref: String): Unit {
        let i = indexOf(ref)
        if (i < 0) {
            throw Exception("cred-unknown-ref")
        }
        if (!entries[i].active) {
            throw Exception("cred-revoked")
        }
        log.append("credentials/rotate", ref)
        entries[i].rotates = entries[i].rotates + 1
    }

    public func revoke(ref: String): Unit {
        let i = indexOf(ref)
        if (i < 0) {
            return
        }
        log.append("credentials/revoke", ref)
        entries[i].active = false
    }

    public func revision(ref: String): Int64 {
        let i = indexOf(ref)
        if (i < 0) {
            throw Exception("cred-unknown-ref")
        }
        return Int64(1) + entries[i].rotates
    }

    public func list(): ArrayList<String> {
        let out = ArrayList<String>()
        for (e in entries) {
            if (e.active) {
                out.add(e.ref)
            }
        }
        return out
    }

    private func indexOf(ref: String): Int64 {
        var i: Int64 = 0
        while (i < Int64(entries.size)) {
            if (entries[i].ref == ref) {
                return i
            }
            i = i + 1
        }
        return Int64(-1)
    }
}
