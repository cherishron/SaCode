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
// 账本必须有界：终态按插入序淘汰，淘汰后的旧键可重执行。
// 执行中/未知占位不淘汰；容量全被未知占用时拒绝新执行。

public let LEDGER_KIND_EXECUTE: String = "execute"
public let LEDGER_KIND_REPLAY: String = "replay"
public let LEDGER_KIND_CONFLICT: String = "conflict"
public let LEDGER_KIND_UNAVAILABLE: String = "unavailable"
let LEDGER_RELEASED = "{\"idempotency\":\"released\"}"

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
    var storeReadable = true

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

    // 原子领取：持锁完成检查、占位和持久化，成功后才可执行副作用。
    public func claim(instanceId!: String, principalId!: String, workspaceId!: String,
                      sessionId!: String, method!: String, operationId!: String,
                      contentDigest!: String): LedgerOutcome {
        let key = IdempotencyLedger.keyOf(instanceId: instanceId, principalId: principalId,
            workspaceId: workspaceId, sessionId: sessionId, method: method, operationId: operationId)
        synchronized(lock) {
            if (operationId.size == 0) { return LedgerOutcome(kind: LEDGER_KIND_UNAVAILABLE, receipt: "") }
            if (!storeReadable) { return LedgerOutcome(kind: LEDGER_KIND_UNAVAILABLE, receipt: "") }
            if (let Some(entry) <- entries.get(key)) {
                return if (entry.digest == contentDigest) {
                    LedgerOutcome(kind: LEDGER_KIND_REPLAY, receipt: entry.receipt)
                } else { LedgerOutcome(kind: LEDGER_KIND_CONFLICT, receipt: "") }
            }
            if (!evictToMakeRoomLocked()) {
                return LedgerOutcome(kind: LEDGER_KIND_UNAVAILABLE, receipt: "")
            }
            let intent = LedgerEntry(digest: contentDigest, receipt: ledgerUnknownReceipt(operationId))
            entries.add(key, intent)
            order.add(key)
            let failures = writeFailures
            persistLocked(key, intent)
            if (failures != writeFailures) {
                // 盘写失败也保留内存未知占位，但绝不执行该请求。
                return LedgerOutcome(kind: LEDGER_KIND_UNAVAILABLE, receipt: "")
            }
            return LedgerOutcome(kind: LEDGER_KIND_EXECUTE, receipt: "")
        }
    }

    // 仅用于确证未到达业务端的请求；先持久化释放，再移除占位。
    public func release(instanceId!: String, principalId!: String, workspaceId!: String,
                        sessionId!: String, method!: String, operationId!: String,
                        contentDigest!: String): Unit {
        let key = IdempotencyLedger.keyOf(instanceId: instanceId, principalId: principalId,
            workspaceId: workspaceId, sessionId: sessionId, method: method, operationId: operationId)
        synchronized(lock) {
            if (let Some(entry) <- entries.get(key)) {
                if (entry.digest != contentDigest || !ledgerIsUnknown(entry.receipt)) { return }
                let failures = writeFailures
                persistLocked(key, LedgerEntry(digest: contentDigest, receipt: LEDGER_RELEASED))
                if (failures == writeFailures) { entries.remove(key); forgetOrderLocked(key) }
            }
        }
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
            if (!evictToMakeRoomLocked()) { lock.unlock(); return }
            order.add(key)
        }
        let previous = entries.get(key)
        let entry = LedgerEntry(digest: contentDigest, receipt: receipt)
        entries.add(key, entry)
        let failures = writeFailures
        persistLocked(key, entry)
        if (failures != writeFailures) {
            if (let Some(prior) <- previous) {
                // 终态落盘失败时仍保留不可淘汰的意图。
                if (ledgerIsUnknown(prior.receipt)) { entries.add(key, prior) }
            }
        }
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
                    let value = if (k == key) { entry } else { live }
                    text += "${IdempotencyLedger.journalLine(key: k, digest: value.digest, receipt: value.receipt)}\n"
                }
            }
            // 压实先写旁路文件再替换，失败不能截断仍在保护副作用的旧账。
            let staged = Path("${storePath}.staging")
            let rewrote = try {
                File.writeTo(staged, text.toArray())
                rename(staged, to: p, overwrite: true)
                true
            } catch (_: Exception) { false }
            if (rewrote) { journalLines = Int64(entries.size) } else { writeFailures += 1 }
            return
        }
        let line = IdempotencyLedger.journalLine(key: key, digest: entry.digest, receipt: entry.receipt)
        let ok = try { File.appendTo(p, "\n${line}\n".toArray()); true } catch (_: Exception) { false }
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
        if (!readable) { storeReadable = false; return }
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
                // 释放记录只用于确证未到达业务端的操作。
                if (rec.receipt == LEDGER_RELEASED) { entries.remove(rec.key); forgetOrderLocked(rec.key) }
                else { entries.add(rec.key, LedgerEntry(digest: rec.digest, receipt: rec.receipt)) }
            }
        }
        journalLines = Int64(entries.size)
        // 重启也不得丢弃未知占位；若旧账中的未知数已超限，保留并拒绝新执行。
        while (Int64(entries.size) > cap) {
            if (!evictToMakeRoomLocked()) { break }
        }
        compactLocked()
    }

    // 须持锁调用。只能淘汰确定终态，不能为新请求移走仍在保护副作用的占位。
    func evictToMakeRoomLocked(): Bool {
        if (Int64(entries.size) < cap) { return true }
        var removed = false
        let rebuilt = ArrayList<String>()
        for (i in head..Int64(order.size)) {
            let key = order[i]
            if (let Some(entry) <- entries.get(key)) {
                if (!removed && !ledgerIsUnknown(entry.receipt)) {
                    entries.remove(key)
                    removed = true
                } else { rebuilt.add(key) }
            }
        }
        order = rebuilt
        head = 0
        return removed
    }

    func forgetOrderLocked(key: String): Unit {
        let rebuilt = ArrayList<String>()
        for (i in head..Int64(order.size)) {
            if (order[i] != key) { rebuilt.add(order[i]) }
        }
        order = rebuilt
        head = 0
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
