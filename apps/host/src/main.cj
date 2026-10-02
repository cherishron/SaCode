package host
import core.*
import stdx.encoding.json.*
import std.collection.ArrayList
import std.env.*
import std.fs.*

// 帧：NDJSON，一行一条 JSON-RPC 2.0 报文（读侧用 readln，写侧补 LF）。
// stdout 只走协议帧，诊断走 stderr。只用已证实的 API：String.split / toArray() /
// Array.size / String.fromUtf8 / ArrayList，不用 String.find 与切片。
func emit(body: String) {
    getStdOut().write((body + String.fromUtf8(Array<Byte>(1, { _ => 10 }))).toArray())
}

func errFrame(id: String, code: Int64, message: String): String {
    return "{\"jsonrpc\":\"2.0\",\"id\":${id},\"error\":{\"code\":${code},\"message\":\"${message}\"}}"
}

func okFrame(id: String, result: String): String {
    return "{\"jsonrpc\":\"2.0\",\"id\":${id},\"result\":${result}}"
}

func bytesOf(s: String): Array<Byte> {
    return s.toArray()
}

func fromBytes(bs: ArrayList<Byte>): String {
    return String.fromUtf8(bs.toArray())
}

// 取 "key":"value" 的 value；value 不允许含转义引号（本端生成的报文满足此约束）。
func jsonStr(body: String, key: String): String {
    let hay = bytesOf(body)
    let pat = bytesOf("\"${key}\":\"")
    let plen = pat.size
    let hlen = hay.size
    if (plen > hlen) {
        return ""
    }
    var i: Int64 = 0
    while (i <= hlen - plen) {
        var same = true
        var k: Int64 = 0
        while (k < plen) {
            if (hay[i + k] != pat[k]) {
                same = false
                break
            }
            k += 1
        }
        if (same) {
            let out = ArrayList<Byte>()
            var j = i + plen
            while (j < hlen) {
                if (hay[j] == 34) {
                    return fromBytes(out)
                }
                out.add(hay[j])
                j += 1
            }
            return fromBytes(out)
        }
        i += 1
    }
    return ""
}

// 取 "id":<整数> 的 id；找不到或为 null 时返回 "null"。
func jsonId(body: String): String {
    let hay = bytesOf(body)
    let pat = bytesOf("\"id\":")
    let plen = pat.size
    let hlen = hay.size
    if (plen > hlen) {
        return "null"
    }
    var i: Int64 = 0
    while (i <= hlen - plen) {
        var same = true
        var k: Int64 = 0
        while (k < plen) {
            if (hay[i + k] != pat[k]) {
                same = false
                break
            }
            k += 1
        }
        if (same) {
            let num = ArrayList<Byte>()
            var j = i + plen
            while (j < hlen) {
                let b = hay[j]
                let n = Int64(b)
                if (n >= 48 && n <= 57) {
                    num.add(b)
                } else {
                    break
                }
                j += 1
            }
            if (num.size == 0) {
                return "null"
            }
            return fromBytes(num)
        }
        i += 1
    }
    return "null"
}

// 取 "key":<整数>，用于 cursor/limit 等数值参数。
func jsonNum(body: String, key: String): Int64 {
    let hay = bytesOf(body)
    let pat = bytesOf("\"${key}\":")
    let plen = pat.size
    let hlen = hay.size
    if (plen > hlen) {
        return -1
    }
    var i: Int64 = 0
    while (i <= hlen - plen) {
        var same = true
        var k: Int64 = 0
        while (k < plen) {
            if (hay[i + k] != pat[k]) {
                same = false
                break
            }
            k += 1
        }
        if (same) {
            var v: Int64 = 0
            var j = i + plen
            var seen = false
            while (j < hlen) {
                let n = Int64(hay[j])
                if (n >= 48 && n <= 57) {
                    v = v * 10 + (n - 48)
                    seen = true
                } else {
                    break
                }
                j += 1
            }
            if (!seen) {
                return -1
            }
            return v
        }
        i += 1
    }
    return -1
}

// 把请求原样转给 JS 子进程，并把子进程的真实应答嵌进 forwarded 字段：
// 桌面看到的能力表与工具结果只可能来自子进程，本端一律不替它编。
// 未 spawn 与「发了但没回」是两种失败，必须分开报，不能都糊成空表。
func forward(idText: String, spawned: Bool, frame: Option<String>) {
    if (!spawned) {
        emit(errFrame(idText, -32011, "js-host-not-spawned"))
        return
    }
    if (let Some(f) <- frame) {
        emit(okFrame(idText, "{\"forwarded\":${f}}"))
    } else {
        emit(errFrame(idText, -32013, "js-host-no-reply"))
    }
}

main(args: Array<String>) {
    let p = "session.log"
    let lease = WriteLease(p)
    let shared = SessionLog(p)
    var leaseHeld = false
    // 内置仓颉工具在此登记；extension/* 全部走同一个注册表与同一个 ToolRuntime，
    // 保证 CLI 与桌面看到的工具集与审批语义一致。
    let extReg = ToolRegistry()
    extReg.register(ToolSpec("write", "写临时文件", "path content", true))
    let extRt = ToolRuntime(shared, extReg)
    // JS 动态扩展宿主：由 core 的 ExtProcess 直接驱动的子进程，与内置仓颉工具共用
    // 同一套语义（未登记即拒、卸载残留归 0、退出必须结算）。
    var jsHost: Option<ExtProcess> = None
    var jsAlive = false
    // 流式 turn 跑在独立仓颉线程上：这样 stdin 上的 turn/cancel 能在「流中间」被读到，
    // 桌面 stop 才有落点。代价是并发写同一份日志不安全，所以在 turn 在途期间，
    // 所有会动日志（含读日志）的方法一律被拒；turn 线程是当时的唯一写者。
    var turnHandle: Option<TurnHandle> = None
    var turnBusy = false
    let turnSink = ThreadSafeDeliveryQueue(64)
    while (true) {
        var body = ""
        var eof = false
        try {
            body = readln()
        } catch (e: Exception) {
            // stdin EOF（父进程关闭管道）属于正常退出路径，不得抛异常终止
            eof = true
        }
        if (eof) {
            break
        }
        if (body.size == 0) {
            break
        }
        var valid = true
        try {
            JsonValue.fromStr(body)
        } catch (e: Exception) {
            valid = false
        }
        if (!valid) {
            emit(errFrame("null", -32700, "parse error"))
            continue
        }
        let method = jsonStr(body, "method")
        let idText = jsonId(body)
        // turn 在途期间日志只有那一个写者：其余读写都拒绝，结算后再来（下一步才把
        // SessionLog 的并发读写收进锁，这里不假装已经线程安全）。
        // turn 在途期间只拦「会动日志的写」；读侧（投影/订阅）走 core 的守护访问器与
        // 磁盘副本，因此桌面可以边流式边看状态，不再被一律 -32001 挡掉。
        if (turnBusy && method != "turn/poll" && method != "turn/cancel" && method != "initialize" && method != "session/projection" && method != "session/subscribe") {
            emit(errFrame(idText, -32001, "turn-in-flight"))
            continue
        }
        if (method == "initialize") {
            emit(okFrame(idText, "{\"protocolVersion\":\"0.1\",\"capabilities\":[\"initialize\",\"session/projection\",\"session/append\",\"session/submit\",\"session/flush\",\"session/subscribe\",\"extension/list\",\"extension/call\",\"extension/dispose\",\"turn/start\",\"turn/cancel\",\"turn/poll\",\"extension/host/spawn\",\"extension/host/load\",\"extension/host/list\",\"extension/host/call\",\"extension/host/dispose\",\"extension/host/close\"],\"core\":\"cangjie\",\"transport\":\"stdio-ndjson\"}"))
            continue
        }
        if (method == "session/projection") {
            // 实例内可见性：持有租约时投影未 flush 的内存态（DSH 中 append 即可见，
            // flush 只决定崩溃持久与跨进程可见），否则从磁盘重建。
            // 一律走守护访问器：turn 线程可能正在写，这里必须拿到一次自洽的快照，
            // 而不是边遍历共享列表边拼帧。
            var target = shared
            if (!leaseHeld) {
                let fresh = SessionLog(p)
                if (!fresh.load()) {
                    emit(errFrame(idText, -32002, "replay-rejected"))
                    continue
                }
                target = fresh
            }
            let tailFlag = if (target.isTruncatedTail()) { "true" } else { "false" }
            emit(okFrame(idText, "{\"projection\":${target.deriveMessages().size},\"events\":${target.eventCount()},\"durable\":${target.durableCount()},\"pending\":${target.pendingCount()},\"truncatedTail\":${tailFlag}}"))
            continue
        }
        if (method == "session/append") {
            if (!leaseHeld) {
                if (!lease.acquire()) {
                    emit(errFrame(idText, -32001, "already-owned"))
                    continue
                }
                if (!shared.load()) {
                    lease.release()
                    emit(errFrame(idText, -32002, "replay-rejected"))
                    continue
                }
                leaseHeld = true
            }
            shared.append(jsonStr(body, "eventType"), jsonStr(body, "data"))
            if (!shared.flush()) {
                // 未落盘则保留写租约与内存态，调用方可重试 flush，不得当作已提交
                emit(errFrame(idText, -32003, "flush-failed"))
                continue
            }
            leaseHeld = false
            lease.release()
            emit(okFrame(idText, "{\"events\":${shared.eventCount()},\"durable\":${shared.durableCount()}}"))
            continue
        }
        // 显式 durability 屏障：submit 只在内存可见，flush 才跨进程可见
        if (method == "session/submit") {
            if (!leaseHeld) {
                if (!lease.acquire()) {
                    emit(errFrame(idText, -32001, "already-owned"))
                    continue
                }
                if (!shared.load()) {
                    lease.release()
                    emit(errFrame(idText, -32002, "replay-rejected"))
                    continue
                }
                leaseHeld = true
            }
            shared.append(jsonStr(body, "eventType"), jsonStr(body, "data"))
            emit(okFrame(idText, "{\"events\":${shared.eventCount()},\"durable\":${shared.durableCount()}}"))
            continue
        }
        if (method == "session/flush") {
            if (!leaseHeld) {
                emit(errFrame(idText, -32004, "no-pending-writes"))
                continue
            }
            if (!shared.flush()) {
                emit(errFrame(idText, -32003, "flush-failed"))
                continue
            }
            leaseHeld = false
            lease.release()
            emit(okFrame(idText, "{\"events\":${shared.eventCount()},\"durable\":${shared.durableCount()}}"))
            continue
        }
        // 只回放**已落盘**事件：cursor 之后、limit 之内，more 表示还有
        if (method == "session/subscribe") {
            let fresh = SessionLog(p)
            if (!fresh.load()) {
                emit(errFrame(idText, -32002, "replay-rejected"))
                continue
            }
            var cursor = jsonNum(body, "cursor")
            var limit = jsonNum(body, "limit")
            if (cursor < 0) {
                cursor = 0
            }
            if (limit <= 0 || limit > 64) {
                limit = 64
            }
            let picked = ArrayList<String>()
            var next = cursor
            var more = false
            for (ev in fresh.snapshotEvents()) {
                if (ev.seq >= cursor) {
                    if (Int64(picked.size) < limit) {
                        picked.add("{\"seq\":${ev.seq},\"type\":\"${ev.eventType}\"}")
                        next = ev.seq + 1
                    } else {
                        more = true
                    }
                }
            }
            var arr = "["
            for (i2 in 0..picked.size) {
                if (i2 > 0) {
                    arr += ","
                }
                arr += picked[i2]
            }
            arr += "]"
            emit(okFrame(idText, "{\"events\":${arr},\"nextCursor\":${next},\"durable\":${fresh.durableCount()},\"more\":${more}}"))
            continue
        }
        if (method == "extension/list") {
            var arr = "["
            var idx: Int64 = 0
            for (n in extReg.list()) {
                if (idx > 0) {
                    arr += ","
                }
                let flag = if (extReg.requiresApproval(n)) { "true" } else { "false" }
                arr += "{\"name\":\"${n}\",\"description\":\"${extReg.describe(n)}\",\"needsApproval\":${flag}}"
                idx += 1
            }
            arr += "]"
            emit(okFrame(idText, "{\"tools\":${arr},\"misses\":${extRt.registryMisses},\"guardDenials\":${extRt.guardDenials}}"))
            continue
        }
        if (method == "extension/call") {
            // 工具事件与 session/submit 同一持久化档位：租约内内存可见，退出结算时落盘
            if (!leaseHeld) {
                if (!lease.acquire()) {
                    emit(errFrame(idText, -32001, "already-owned"))
                    continue
                }
                if (!shared.load()) {
                    lease.release()
                    emit(errFrame(idText, -32002, "replay-rejected"))
                    continue
                }
                leaseHeld = true
            }
            // 审批应答由调用方显式给出；未登记/无应答/guard 拒绝都在 core 内 fail-closed
            let out = extRt.execute(jsonStr(body, "name"), jsonStr(body, "args"), jsonStr(body, "approval"), true)
            if (!out.allowed) {
                emit(errFrame(idText, -32010, out.why))
                continue
            }
            emit(okFrame(idText, "{\"result\":\"${out.why}\"}"))
            continue
        }
        if (method == "extension/dispose") {
            let gone = extReg.unregister(jsonStr(body, "name"))
            let flag = if (gone) { "true" } else { "false" }
            emit(okFrame(idText, "{\"disposed\":${flag},\"tools\":${extReg.count()}}"))
            continue
        }
        if (method == "turn/start") {
            if (turnBusy) {
                emit(errFrame(idText, -32001, "turn-in-flight"))
                continue
            }
            // 与 session/submit 同一持久化档位：租约内内存可见，结算时落盘
            if (!leaseHeld) {
                if (!lease.acquire()) {
                    emit(errFrame(idText, -32001, "already-owned"))
                    continue
                }
                if (!shared.load()) {
                    lease.release()
                    emit(errFrame(idText, -32002, "replay-rejected"))
                    continue
                }
                leaseHeld = true
            }
            let limitN = jsonNum(body, "limit")
            let limit = if (limitN < 0) { Int64(2) } else { limitN }
            let tk = TurnToken()
            turnHandle = Some(TurnRunner().start(CancellableStreamProvider(tk, limit), tk, shared, turnSink))
            turnBusy = true
            emit(okFrame(idText, "{\"started\":true,\"limit\":${limit}}"))
            continue
        }
        if (method == "turn/cancel") {
            // 只是发出取消请求；终态由 turn/poll 结算，绝不在这里编一个结果
            var requested = "false"
            var wasRunning = "false"
            if (let Some(h) <- turnHandle) {
                if (h.isRunning()) {
                    wasRunning = "true"
                    h.cancel()
                    requested = "true"
                }
            }
            emit(okFrame(idText, "{\"cancelRequested\":${requested},\"wasRunning\":${wasRunning}}"))
            continue
        }
        if (method == "turn/poll") {
            let frames = turnSink.take(64)
            var arr = "["
            for (i2 in 0..frames.size) {
                if (i2 > 0) {
                    arr += ","
                }
                arr += "\"${frames[i2]}\""
            }
            arr += "]"
            var turnText = "false"
            var runningText = "false"
            var settledText = "false"
            var tail = ""
            if (let Some(h) <- turnHandle) {
                turnText = "true"
                if (h.isRunning()) {
                    runningText = "true"
                    tail = ",\"overflow\":${turnSink.overflow()}"
                } else {
                    // 线程已收束：join 之后才有终态可报，也才允许主线程动日志
                    let r = h.result()
                    runningText = "false"
                    settledText = "true"
                    let cFlag = if (r.cancelled) { "true" } else { "false" }
                    let iFlag = if (r.interrupted) { "true" } else { "false" }
                    tail = ",\"cancelled\":${cFlag},\"delivered\":${r.delivered},\"text\":\"${r.text}\",\"finishReason\":\"${r.finishReason}\",\"interrupted\":${iFlag},\"settledToolCalls\":${r.settledToolCalls},\"pendingToolCalls\":${r.pendingToolCalls},\"overflow\":${turnSink.overflow()},\"dropped\":${turnSink.dropped()}"
                    turnHandle = None
                    turnBusy = false
                    if (leaseHeld) {
                        if (shared.flush()) {
                            leaseHeld = false
                            lease.release()
                        } else {
                            getStdErr().writeln("turn-settle-flush-failed: lease retained")
                        }
                    }
                }
            }
            emit(okFrame(idText, "{\"frames\":${arr},\"turn\":${turnText},\"running\":${runningText},\"settled\":${settledText}${tail}}"))
            continue
        }
        if (method == "extension/host/spawn") {
            if (jsAlive) {
                emit(errFrame(idText, -32012, "js-host-already-running"))
                continue
            }
            let xp = ExtProcess(jsonStr(body, "node"), ["server.cjs"], workingDirectory: Path(jsonStr(body, "dir")))
            if (!xp.start()) {
                getStdErr().writeln("js-host-spawn-failed: ${xp.startFailure()}")
                emit(errFrame(idText, -32011, "js-host-spawn-failed"))
                continue
            }
            var hs = ""
            if (let Some(f) <- xp.initialize()) {
                hs = f
            }
            if (hs.size == 0) {
                // 握手拿不到应答：立刻强杀结算，绝不留一个没人管的子进程
                xp.kill()
                getStdErr().writeln("js-host-handshake-timeout: received=${xp.received()}")
                emit(errFrame(idText, -32011, "js-host-handshake-timeout"))
                continue
            }
            jsHost = Some(xp)
            jsAlive = true
            emit(okFrame(idText, "{\"spawned\":true,\"handshake\":${hs}}"))
            continue
        }
        if (method == "extension/host/list") {
            var f: Option<String> = None
            if (let Some(xp) <- jsHost) {
                f = xp.list()
            }
            forward(idText, jsAlive, f)
            continue
        }
        if (method == "extension/host/load") {
            var f: Option<String> = None
            if (let Some(xp) <- jsHost) {
                f = xp.load(jsonStr(body, "path"))
            }
            forward(idText, jsAlive, f)
            continue
        }
        if (method == "extension/host/call") {
            var f: Option<String> = None
            if (let Some(xp) <- jsHost) {
                f = xp.call(jsonStr(body, "name"), jsonStr(body, "text"))
            }
            forward(idText, jsAlive, f)
            continue
        }
        if (method == "extension/host/dispose") {
            var f: Option<String> = None
            if (let Some(xp) <- jsHost) {
                f = xp.dispose(jsonStr(body, "name"))
            }
            forward(idText, jsAlive, f)
            continue
        }
        if (method == "extension/host/close") {
            if (let Some(xp) <- jsHost) {
                let rc = xp.close()
                let flag = if (xp.forcedExit()) { "true" } else { "false" }
                jsHost = None
                jsAlive = false
                emit(okFrame(idText, "{\"exit\":${rc},\"forced\":${flag},\"received\":${xp.received()},\"unsolicited\":${xp.unsolicited()},\"late\":${xp.late()}}"))
            } else {
                emit(errFrame(idText, -32011, "js-host-not-spawned"))
            }
            continue
        }
        emit(errFrame(idText, -32601, "method not found"))
    }
    // stdin 关闭时若仍有在途 turn：先取消再 join，绝不留一个「没人回答的在途请求」，
    // 且必须在线程收束之后才落盘与归还租约。
    if (let Some(h) <- turnHandle) {
        h.cancel()
        let r = h.result()
        getStdErr().writeln("host-exit-settled-turn: cancelled=${r.cancelled} delivered=${r.delivered}")
        turnHandle = None
        turnBusy = false
    }
    // 父宿主退出前必须结算 JS 子进程：先发 host/shutdown 走优雅路径，超时才强杀——
    // 否则桌面关掉时机器上会留一个没人管的 node。
    if (let Some(xp) <- jsHost) {
        let rc = xp.close()
        getStdErr().writeln("host-exit-settled-js-host: exit=${rc} forced=${xp.forcedExit()}")
        jsHost = None
        jsAlive = false
    }
    // 干净退出前结算未 flush 的写入：落盘成功才归还租约；失败则保留租约并报警，
    // 绝不在内存态丢失后假装写提交过（fail-closed）。
    if (leaseHeld) {
        if (shared.flush()) {
            lease.release()
        } else {
            getStdErr().writeln("host-exit-with-unflushed-writes: lease retained")
        }
    }
    return 0
}
