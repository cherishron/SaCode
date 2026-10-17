package daemon
import core.*

import std.collection.*
import std.fs.*
import std.sync.*
import stdx.encoding.json.*

// 服务端幂等账（设计 §5）：写操作按
//   instanceId / principalId / workspaceId / sessionId / method / operationId
// 六元组建账，同键同规范化内容返回原回执，同键不同内容拒绝。
//
// 这一层不执行任何副作用：调用方只在 kind == "execute" 时才真做，做完把回执交回账本。
// 超时按 §5「返回结果未知及查询标识，不当作业务失败，不自动再次执行」记成 unknown，
// 之后同键同内容重试拿到的仍是那份 unknown 回执。
//
// 账本必须有界：每个写请求留一条记录，长跑 daemon 就是内存泄漏。超限按插入序淘汰最早的
// 一条——被淘汰的键会重新执行。这是有界账本明写的代价，不是「幂等」的破口被忽略。

public let LEDGER_KIND_EXECUTE: String = "execute"
public let LEDGER_KIND_REPLAY: String = "replay"
public let LEDGER_KIND_CONFLICT: String = "conflict"

// unknown 回执是账本自己的记录形态，不是 JSON-RPC 信封：分派层靠它决定
// 「重试时仍然只给结果未知 + 查询标识」，而不是把它当原回执重放给客户端。
public func ledgerUnknownReceipt(queryId: String): String {
    return "{\"idempotency\":\"unknown\",\"queryId\":\"${jsonEscapeText(queryId)}\"}"
}

public func ledgerIsUnknown(receipt: String): Bool {
    // 整段读值都在 try 里：fromStr 与 asObject 对非 JSON / 非对象都抛，
    // 不能先把 node 取出来再判「解析成没成」，那一步自己就是抛点。
    let hit = try {
        var found = false
        if (let Some(v) <- JsonValue.fromStr(receipt).asObject().get("idempotency")) {
            found = v.asString().getValue() == "unknown"
        }
        found
    } catch (_: Exception) { false }
    return hit
}

// 只在 ledgerIsUnknown 已判真之后调用：那时 receipt 必然是本模块写出的对象。
public func ledgerUnknownQueryId(receipt: String): String {
    var out = ""
    if (let Some(v) <- JsonValue.fromStr(receipt).asObject().get("queryId")) {
        out = v.asString().getValue()
    }
    return out
}

public class LedgerOutcome {
    public let kind: String
    public let receipt: String
    public init(kind!: String, receipt!: String) {
        this.kind = kind
        this.receipt = receipt
    }
}

class LedgerEntry {
    let digest: String
    let receipt: String
    init(digest!: String, receipt!: String) {
        this.digest = digest
        this.receipt = receipt
    }
}

// 盘上一行 = 一条记录。三个字段都过 jsonEscapeText，键里出现引号也拼不出第二条记录。
class JournalRecord {
    let key: String
    let digest: String
    let receipt: String
    init(key!: String, digest!: String, receipt!: String) {
        this.key = key
        this.digest = digest
        this.receipt = receipt
    }
}

public class IdempotencyLedger {
    let lock = Mutex()
    let entries = HashMap<String, LedgerEntry>()
    // 插入序按 key 记一份，淘汰只动头部；head 之前的空洞靠重建列表回收。
    var order = ArrayList<String>()
    var head: Int64 = 0
    let cap: Int64
    // 空串 = 纯内存。给了路径就一写一条追加（与审计日志同一个 appendTo），
    // 重启后同一条 operationId 仍认得出「做过」。§5 明写幂等账不能仅靠内存锁：
    // 内存里的账活着进程换了就归零，客户端一次重试就是一次真副作用。
    var storePath: String
    var journalLines: Int64 = 0
    var writeFailures: Int64 = 0

    public init(cap!: Int64 = 4096, storePath!: String = "") {
        this.cap = if (cap > Int64(0)) { cap } else { Int64(4096) }
        this.storePath = storePath
        if (storePath.size > Int64(0)) { loadFromStore() }
    }

    // daemon 装配层解析完配置才有路径，而进程级账本先于配置存在，所以这条路
    // 只能后接。已经接过的不重复接：一份盘只载入一次，别把历史读两遍弄乱插入序。
    public func attachStore(path!: String): Unit {
        lock.lock()
        if (storePath.size == Int64(0) && path.size > Int64(0)) {
            storePath = path
            loadFromStore()
        }
        lock.unlock()
    }

    static public func journalLine(key!: String, digest!: String, receipt!: String): String {
        return "{\"key\":\"${jsonEscapeText(key)}\",\"digest\":\"${jsonEscapeText(digest)}\"," +
            "\"receipt\":\"${jsonEscapeText(receipt)}\"}"
    }

    // 落盘失败不能冒充「已提交」：内存这条照记（本进程内不会再执行第二次），
    // 但失败计数要能读出来，别把「没写进盘」说成「写好了」。
    public func persistedFailureCount(): Int64 {
        lock.lock()
        let n = writeFailures
        lock.unlock()
        return n
    }

    // 长度前缀编码：直接 join 分隔符会让 ("a|b","c") 与 ("a","b|c") 撞成同一条键，
    // 于是一条请求能拿到另一条的回执。
    static func field(v: String): String { return "${v.size}:${v}" }

    static func keyOf(instanceId!: String, principalId!: String, workspaceId!: String,
                      sessionId!: String, method!: String, operationId!: String): String {
        return "${IdempotencyLedger.field(instanceId)}|${IdempotencyLedger.field(principalId)}|" +
            "${IdempotencyLedger.field(workspaceId)}|${IdempotencyLedger.field(sessionId)}|" +
            "${IdempotencyLedger.field(method)}|${IdempotencyLedger.field(operationId)}"
    }

    // 空 operationId 不建账：否则所有缺字段的写请求会共享同一条回执。
    public func acceptsKey(operationId!: String): Bool {
        return operationId.size > Int64(0)
    }

    public func consult(instanceId!: String, principalId!: String, workspaceId!: String,
                        sessionId!: String, method!: String, operationId!: String,
                        contentDigest!: String): LedgerOutcome {
        let key = IdempotencyLedger.keyOf(instanceId: instanceId, principalId: principalId,
            workspaceId: workspaceId, sessionId: sessionId, method: method, operationId: operationId)
        lock.lock()
        var outcome = LedgerOutcome(kind: LEDGER_KIND_EXECUTE, receipt: "")
        if (let Some(entry) <- entries.get(key)) {
            outcome = if (entry.digest == contentDigest) {
                LedgerOutcome(kind: LEDGER_KIND_REPLAY, receipt: entry.receipt)
            } else {
                // 同 operationId 换内容必须拒：静默返回旧回执会把两次不同意图合成一次。
                LedgerOutcome(kind: LEDGER_KIND_CONFLICT, receipt: "")
            }
        }
        lock.unlock()
        return outcome
    }

    public func recordDone(instanceId!: String, principalId!: String, workspaceId!: String,
                           sessionId!: String, method!: String, operationId!: String,
                           contentDigest!: String, receipt!: String): Unit {
        this.store(instanceId, principalId, workspaceId, sessionId, method, operationId,
            contentDigest, receipt)
    }

    public func recordUnknown(instanceId!: String, principalId!: String, workspaceId!: String,
                              sessionId!: String, method!: String, operationId!: String,
                              contentDigest!: String, queryId!: String): Unit {
        this.store(instanceId, principalId, workspaceId, sessionId, method, operationId,
            contentDigest, ledgerUnknownReceipt(queryId))
    }

    func store(instanceId: String, principalId: String, workspaceId: String, sessionId: String,
               method: String, operationId: String, contentDigest: String, receipt: String): Unit {
        let key = IdempotencyLedger.keyOf(instanceId: instanceId, principalId: principalId,
            workspaceId: workspaceId, sessionId: sessionId, method: method, operationId: operationId)
        lock.lock()
        if (!entries.contains(key)) {
            evictToMakeRoomLocked()
            order.add(key)
        }
        let entry = LedgerEntry(digest: contentDigest, receipt: receipt)
        entries.add(key, entry)
        persistLocked(key, entry)
        lock.unlock()
    }

    // 须持锁调用。追加失败不撤回内存里那条（本进程内仍不会再执行第二次副作用），
    // 但计数要留下来——「没写进盘」不能被说成「写好了」。
    func persistLocked(key: String, entry: LedgerEntry): Unit {
        if (storePath.size == Int64(0)) { return }
        let p = Path(storePath)
        if (journalLines > cap * Int64(2)) {
            // 整写压实：残行与已被淘汰的键一起清掉，盘上规模和内存一样有界。
            var text = ""
            for (k in order) {
                if (let Some(live) <- entries.get(k)) {
                    text += "${IdempotencyLedger.journalLine(key: k, digest: live.digest, receipt: live.receipt)}\n"
                }
            }
            let rewrote = try { File.writeTo(p, text.toArray()); true } catch (_: Exception) { false }
            if (rewrote) { journalLines = Int64(entries.size) } else { writeFailures += 1 }
            return
        }
        let line = IdempotencyLedger.journalLine(key: key, digest: entry.digest, receipt: entry.receipt)
        let ok = try { File.appendTo(p, "${line}\n".toArray()); true } catch (_: Exception) { false }
        if (ok) { journalLines += 1 } else { writeFailures += 1 }
    }

    static func recordFromLine(line: String): Option<JournalRecord> {
        var rec: Option<JournalRecord> = None
        // 整段都在 try 里：坏行、残行、被手改成非对象的那一行都只算「跳过」，
        // 不能把整个 daemon 的启动押在一行历史上。
        let read = try {
            let obj = JsonValue.fromStr(line).asObject()
            let key = obj.get("key").getOrThrow().asString().getValue()
            let digest = obj.get("digest").getOrThrow().asString().getValue()
            let receipt = obj.get("receipt").getOrThrow().asString().getValue()
            rec = Some(JournalRecord(key: key, digest: digest, receipt: receipt))
            true
        } catch (_: Exception) { false }
        if (read) { return rec }
        return None
    }

    func loadFromStore(): Unit {
        let p = Path(storePath)
        if (!exists(p)) { return }
        var text = ""
        let readable = try { text = String.fromUtf8(File.readFrom(p)); true }
            catch (_: Exception) { false }
        if (!readable) { return }
        var rest = text
        while (rest.size > Int64(0)) {
            let idx = rest.indexOf("\n") ?? Int64(-1)
            var line = rest
            if (idx >= Int64(0)) {
                line = rest[0..idx]
                rest = rest[(idx + 1)..rest.size]
            } else {
                // 没有结尾换行的那一段是写一半的残行：丢掉，不猜它原本是什么。
                line = ""
                rest = ""
            }
            if (line.size == Int64(0)) { continue }
            if (let Some(rec) <- IdempotencyLedger.recordFromLine(line)) {
                if (!entries.contains(rec.key)) { order.add(rec.key) }
                // 同键后写覆盖先写：盘上就是 append-only 的日志序。
                entries.add(rec.key, LedgerEntry(digest: rec.digest, receipt: rec.receipt))
            }
        }
        journalLines = Int64(entries.size)
        // 载入后仍要按 cap 收口（比如历史里留着淘汰前的旧行）：按插入序从头部裁。
        while (Int64(entries.size) > cap) {
            if (head >= Int64(order.size)) { break }
            let stale = order[head]
            head += 1
            if (entries.contains(stale)) { entries.remove(stale) }
        }
        compactLocked()
    }

    // 须持锁调用。entries 的每个键都来自 order，所以走到尽头一定能腾出位；
    // 真腾不出时宁可保留旧账并拒收新账，也不让 size 越过 cap。
    func evictToMakeRoomLocked(): Unit {
        if (Int64(entries.size) < cap) { return }
        var removed = false
        while (!removed && head < Int64(order.size)) {
            let key = order[head]
            head += 1
            if (entries.contains(key)) {
                entries.remove(key)
                removed = true
            }
        }
        compactLocked()
    }

    func compactLocked(): Unit {
        if (head < cap * Int64(2)) { return }
        var i = head
        let rebuilt = ArrayList<String>()
        while (i < Int64(order.size)) { rebuilt.add(order[i]); i += 1 }
        order = rebuilt
        head = Int64(0)
    }

    public func size(): Int64 {
        lock.lock()
        let n = Int64(entries.size)
        lock.unlock()
        return n
    }
}
