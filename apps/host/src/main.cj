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
    // message 是外部可见文本（工具失败里带着调用方给的路径），不转义就会让
    // 一条含引号或换行的消息自己把协议帧撕开。
    return "{\"jsonrpc\":\"2.0\",\"id\":${id},\"error\":{\"code\":${code},\"message\":\"${jsonEscapeText(message)}\"}}"
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
                let c = hay[j]
                if (c == 34) {
                    return fromBytes(out)
                }
                // 入口就要还原 JSON 转义：否则 "a\"b" 会在 \" 处被当成结束引号而截断，
                // 聊天消息里的引号与换行都会被写坏（多行消息还会把日志一行事件劈成两行）。
                if (c == 92 && j + 1 < hlen) {
                    let e = hay[j + 1]
                    if (e == 34) {
                        out.add(34)
                        j += 2
                        continue
                    } else if (e == 92) {
                        out.add(92)
                        j += 2
                        continue
                    } else if (e == 110) {
                        out.add(10)
                        j += 2
                        continue
                    } else if (e == 114) {
                        out.add(13)
                        j += 2
                        continue
                    } else if (e == 116) {
                        out.add(9)
                        j += 2
                        continue
                    }
                    // \uXXXX 这类不支持的转义原样保留反斜杠，不做「猜一个字符」的降级
                    out.add(c)
                    j += 1
                    continue
                }
                out.add(c)
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

// turn 在途期间仍放行的方法：结算与读侧，外加工具调用的发起/收帧/取消。
// 少了后三类，桌面的 stop 就只能排在一次转调后面，取消永远追不上在途调用。
func allowedDuringTurn(method: String): Bool {
    let turnSide = method == "turn/poll" || method == "turn/cancel" || method == "initialize"
    let readSide = method == "session/projection" || method == "session/subscribe"
    let callSide = method == "extension/host/call" || method == "extension/host/poll" || method == "extension/host/cancel"
    // 审批是人在环：流式进行中也要能发号、应答、查状态，否则「边跑边批」做不到。
    // 不再有 approval/tick——过期改由真实单调钟决定，协议面上不该存在「推进时钟」这种动作。
    let approvalSide = method == "approval/ask" || method == "approval/answer" || method == "approval/status"
    // 计量读数与「收紧预算」都归读侧：预算只允许往下调，所以在途期间调它
    // 不会放宽任何放行条件，反而能让正在跑的这一轮更早被拦。
    let meterSide = method == "usage/status" || method == "usage/set-budget"
    return turnSide || readSide || callSide || approvalSide || meterSide
}

// 所有写入口加载会话时同时恢复计量，不能因租约先被审批或工具取得而绕过预算。
func loadForWrite(log: SessionLog, meter: TokenMeter): Bool {
    if (!log.load()) {
        return false
    }
    meter.rebuild()
    return true
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
    // 读侧工具与写侧共用同一条管线；它不改盘，所以默认不要审批，
    // 但它会留下版本标记，随后同一路径的 write 要按这份标记判是否已被第三方改过。
    extReg.register(ToolSpec("read", "读文件并记录版本标记", "path", false))
    let extRt = ToolRuntime(shared, extReg)
    // 审批工单与工具运行态共用同一份日志：asked/decided/expired 都是可回放的事件
    let approvalDesk = ApprovalDesk(shared)
    // token 计量与预算：账只认会话日志重算出来的那份，内存计数不是第二真源，
    // 所以每次接手日志都要 rebuild，崩溃重启后不会因为「失忆」而放行。
    let meter = TokenMeter(shared)
    // JS 动态扩展宿主：由 core 的 ExtProcess 直接驱动的子进程，与内置仓颉工具共用
    // 同一套语义（未登记即拒、卸载残留归 0、退出必须结算）。
    var jsHost: Option<ExtProcess> = None
    var jsAlive = false
    // 流式 turn 跑在独立仓颉线程上：这样 stdin 上的 turn/cancel 能在「流中间」被读到，
    // 桌面 stop 才有落点。日志侧的并发由 core 的 SessionLog 锁兜住，所以这里只把
    // 「会动日志的写」串行化，读侧（投影/订阅）在 turn 在途期间照常应答。
    var turnHandle: Option<TurnHandle> = None
    var turnBusy = false
    let turnSink = ThreadSafeDeliveryQueue(64)
    // 工具调用改成「立刻回执 + 独立线程收帧」：主循环因此能在转调期间继续读 stdin，
    // 桌面的 cancel/stop 才追得上在途调用。登记表只由主循环动，收帧线程只写 sink。
    let callSink = ThreadSafeDeliveryQueue(64)
    let inflight = InflightCalls()
    var callSeq: Int64 = 0
    // 每次 turn/start 递增：调用登记时记下自己属于哪一轮，
    // 取消一轮只结算它自己发起的那些（epoch 0 = 不在任何 turn 里）。
    var turnEpoch: Int64 = 0
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
        // turn 在途期间只拦「会动日志的写」：读侧走 core 的守护访问器，工具调用的
        // 发起/收帧/取消必须放得进来，否则取消永远追不上在途调用。
        if (turnBusy && !allowedDuringTurn(method)) {
            emit(errFrame(idText, -32001, "turn-in-flight"))
            continue
        }
        if (method == "initialize") {
            emit(okFrame(idText, "{\"protocolVersion\":\"0.1\",\"capabilities\":[\"initialize\",\"session/projection\",\"session/append\",\"session/submit\",\"session/flush\",\"session/subscribe\",\"extension/list\",\"extension/call\",\"extension/dispose\",\"turn/start\",\"turn/cancel\",\"turn/poll\",\"extension/host/spawn\",\"extension/host/load\",\"extension/host/list\",\"extension/host/call\",\"extension/host/dispose\",\"extension/host/poll\",\"extension/host/cancel\",\"extension/host/close\",\"approval/ask\",\"approval/answer\",\"approval/status\",\"usage/status\",\"usage/set-budget\"],\"core\":\"cangjie\",\"transport\":\"stdio-ndjson\"}"))
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
            // 消息正文一并交出：渲染层只能显示核心投影，不允许自己再拼一份历史。
            // 只给尾部 64 条，帧大小有界；计数仍是全量投影计数。
            let msgs = target.deriveMessages()
            let total = msgs.size
            let from = if (total > 64) { total - 64 } else { Int64(0) }
            var marr = "["
            var mi = from
            while (mi < total) {
                if (mi > from) {
                    marr += ","
                }
                marr += "\"${jsonEscapeText(msgs[mi])}\""
                mi += 1
            }
            marr += "]"
            emit(okFrame(idText, "{\"projection\":${total},\"events\":${target.eventCount()},\"durable\":${target.durableCount()},\"pending\":${target.pendingCount()},\"truncatedTail\":${tailFlag},\"messages\":${marr}}"))
            continue
        }
        if (method == "session/append") {
            if (!leaseHeld) {
                if (!lease.takeoverIfStale()) {
                    emit(errFrame(idText, -32001, "already-owned"))
                    continue
                }
                if (!loadForWrite(shared, meter)) {
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
                if (!lease.takeoverIfStale()) {
                    emit(errFrame(idText, -32001, "already-owned"))
                    continue
                }
                if (!loadForWrite(shared, meter)) {
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
                if (!lease.takeoverIfStale()) {
                    emit(errFrame(idText, -32001, "already-owned"))
                    continue
                }
                if (!loadForWrite(shared, meter)) {
                    lease.release()
                    emit(errFrame(idText, -32002, "replay-rejected"))
                    continue
                }
                leaseHeld = true
            }
            // 审批只认工单：需要审批的工具（含未登记名，注册表按拒绝默认取值）必须带 approvalId，
            // 由 core 侧一次性消费。调用方在请求里自报「allowed-once」在这条路上完全不起作用——
            // 谁批的、批没批、批过头没有，都只能从日志里的 asked/decided 回答。
            let ticketId = jsonNum(body, "approvalId")
            let toolName = jsonStr(body, "name")
            let out = if (extReg.requiresApproval(toolName)) {
                extRt.executeWithApproval(toolName, jsonStr(body, "args"), ticketId, true, approvalDesk)
            } else {
                extRt.execute(toolName, jsonStr(body, "args"), "", true)
            }
            if (!out.allowed) {
                emit(errFrame(idText, -32010, out.why))
                continue
            }
            // 工具的回执正文现在是真内容（read 交回盘上读到的字节），可能含引号与换行：
            // 不过一遍转义就会把协议帧自己撕开。
            emit(okFrame(idText, "{\"result\":\"${jsonEscapeText(out.why)}\"}"))
            continue
        }
        if (method == "extension/dispose") {
            let gone = extReg.unregister(jsonStr(body, "name"))
            let flag = if (gone) { "true" } else { "false" }
            emit(okFrame(idText, "{\"disposed\":${flag},\"tools\":${extReg.count()}}"))
            continue
        }
        // 审批的协议面：asked/decided/expired 都进同一份日志，与 session/submit 同一持久化档位
        // （租约内内存可见，退出结算时落盘）。审批工单只在有写者时写事件，读状态不需要写者。
        if (method == "approval/ask") {
            if (!leaseHeld) {
                if (!lease.takeoverIfStale()) {
                    emit(errFrame(idText, -32001, "already-owned"))
                    continue
                }
                if (!loadForWrite(shared, meter)) {
                    lease.release()
                    emit(errFrame(idText, -32002, "replay-rejected"))
                    continue
                }
                leaseHeld = true
            }
            let toolName = jsonStr(body, "name")
            // ttl 只允许把窗口缩短（1..桌面默认值），不接受延长：过期是 fail-closed 的方向，
            // 让调用方能拉长就等于没有过期。缺省（jsonNum 回 -1）或越界一律走默认值。
            let askedTtl = jsonNum(body, "ttl")
            let aid = if (askedTtl >= 1 && askedTtl < approvalDesk.defaultTtl) {
                approvalDesk.askWithTtl(toolName, askedTtl)
            } else {
                approvalDesk.ask(toolName)
            }
            emit(okFrame(idText, "{\"approvalId\":${aid},\"state\":\"pending\",\"pending\":${approvalDesk.pendingCount()}}"))
            continue
        }
        if (method == "approval/answer") {
            if (!leaseHeld) {
                if (!lease.takeoverIfStale()) {
                    emit(errFrame(idText, -32001, "already-owned"))
                    continue
                }
                if (!loadForWrite(shared, meter)) {
                    lease.release()
                    emit(errFrame(idText, -32002, "replay-rejected"))
                    continue
                }
                leaseHeld = true
            }
            // 参数名不能叫 id：本端解析器按整帧字节扫描，"id" 会先撞上 JSON-RPC 信封自己的 id
            let target = jsonNum(body, "approvalId")
            let accepted = approvalDesk.answer(target, jsonStr(body, "decision"))
            let flag = if (accepted) { "true" } else { "false" }
            emit(okFrame(idText, "{\"accepted\":${flag},\"state\":\"${approvalDesk.stateOf(target)}\"}"))
            continue
        }
        if (method == "approval/status") {
            let target2 = jsonNum(body, "approvalId")
            emit(okFrame(idText, "{\"state\":\"${approvalDesk.stateOf(target2)}\",\"pending\":${approvalDesk.pendingCount()}}"))
            continue
        }
        if (method == "turn/start") {
            if (turnBusy) {
                emit(errFrame(idText, -32001, "turn-in-flight"))
                continue
            }
            // 与 session/submit 同一持久化档位：租约内内存可见，结算时落盘
            if (!leaseHeld) {
                if (!lease.takeoverIfStale()) {
                    emit(errFrame(idText, -32001, "already-owned"))
                    continue
                }
                if (!loadForWrite(shared, meter)) {
                    lease.release()
                    emit(errFrame(idText, -32002, "replay-rejected"))
                    continue
                }
                leaseHeld = true
            }
            // 预算拦过一次就不再开新轮：超档必须是停下来问人，而不是自动降级继续跑。
            if (meter.over()) {
                if (leaseHeld) {
                    if (shared.flush()) {
                        leaseHeld = false
                        lease.release()
                    }
                }
                emit(errFrame(idText, -32014, "over-budget"))
                continue
            }
            let limitN = jsonNum(body, "limit")
            let limit = if (limitN < 0) { Int64(2) } else { limitN }
            let tk = TurnToken()
            turnEpoch += 1
            turnHandle = Some(TurnRunner().start(CancellableStreamProvider(tk, limit), tk, shared, turnSink))
            turnBusy = true
            emit(okFrame(idText, "{\"started\":true,\"limit\":${limit},\"epoch\":${turnEpoch}}"))
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
            // 取消一个 turn 必须顺带结算它发起的在途工具调用，否则桌面上会留下
            // 「turn 已停、工具还在跑」的悬空状态。结果帧仍由 poll 交出，这里不编。
            var killed = Int64(0)
            for (cid in inflight.idsForEpoch(turnEpoch)) {
                var done = false
                if (let Some(xp) <- jsHost) {
                    if (let Some(fr) <- xp.cancelCall(cid)) {
                        done = fr.contains("\"cancelled\":true")
                    }
                }
                if (done) {
                    killed += 1
                }
            }
            emit(okFrame(idText, "{\"cancelRequested\":${requested},\"wasRunning\":${wasRunning},\"extensionCallsCancelled\":${killed},\"inflightCalls\":${inflight.count()}}"))
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
                    let verdict = meter.settleTurn(r)
                    let oFlag = if (meter.over()) { "true" } else { "false" }
                    tail = ",\"cancelled\":${cFlag},\"delivered\":${r.delivered},\"text\":\"${r.text}\",\"finishReason\":\"${r.finishReason}\",\"interrupted\":${iFlag},\"settledToolCalls\":${r.settledToolCalls},\"pendingToolCalls\":${r.pendingToolCalls},\"overflow\":${turnSink.overflow()},\"dropped\":${turnSink.dropped()},\"usage\":\"${jsonEscapeText(r.usage)}\",\"usageVerdict\":\"${verdict}\",\"used\":${meter.used()},\"budget\":${meter.budgetValue()},\"over\":${oFlag}"
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
        if (method == "usage/status") {
            // 读数只能由计量器给出，而计量器的账来自日志：界面没有「自己算一份」的通路。
            // 没持有租约时 shared 是空的，必须先按盘上内容重算，否则刚重启的进程会报 0。
            var mv = meter
            if (!leaseHeld) {
                let mlog = SessionLog(p)
                if (mlog.load()) {
                    let rm = TokenMeter(mlog, budget: meter.budgetValue())
                    rm.rebuild()
                    mv = rm
                }
            }
            let oFlag2 = if (mv.over()) { "true" } else { "false" }
            emit(okFrame(idText, "{\"used\":${mv.used()},\"budget\":${mv.budgetValue()},\"over\":${oFlag2},\"verdict\":\"${mv.verdict()}\",\"badUsage\":${mv.badCount}}"))
            continue
        }
        if (method == "usage/set-budget") {
            // 预算只能收紧：调大、持平、缺参数（jsonNum 回 -1）一律 applied=false，
            // 且不改当前档位——能被界面自己抬高的防额不是防额。
            if (!leaseHeld) {
                if (!lease.takeoverIfStale()) {
                    emit(errFrame(idText, -32001, "already-owned"))
                    continue
                }
                if (!loadForWrite(shared, meter)) {
                    lease.release()
                    emit(errFrame(idText, -32002, "replay-rejected"))
                    continue
                }
                leaseHeld = true
            }
            let want = jsonNum(body, "budget")
            let ok2 = meter.lowerBudget(want)
            let appliedText = if (ok2) { "true" } else { "false" }
            emit(okFrame(idText, "{\"applied\":${appliedText},\"budget\":${meter.budgetValue()},\"used\":${meter.used()}}"))
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
            if (!jsAlive) {
                emit(errFrame(idText, -32011, "js-host-not-spawned"))
                continue
            }
            var cid = jsonNum(body, "callId")
            if (cid <= 0) {
                callSeq += 1
                cid = callSeq
            }
            // 归属在发起这一刻定死：turn 在途就记当前轮次，否则记 0（不属于任何轮）
            let owner = if (turnBusy) { turnEpoch } else { Int64(0) }
            if (!inflight.add(cid, epoch: owner)) {
                emit(errFrame(idText, -32022, "duplicate-callId"))
                continue
            }
            var sent = false
            if (let Some(xp) <- jsHost) {
                sent = xp.callAsync(cid, jsonStr(body, "name"), jsonStr(body, "text"), callSink)
            }
            if (!sent) {
                // 帧没写出去 = 这一笔根本不存在：登记表必须退回，不能留个永远等不到帧的在途项
                inflight.settle(cid)
                emit(errFrame(idText, -32013, "js-host-no-reply"))
                continue
            }
            emit(okFrame(idText, "{\"accepted\":true,\"callId\":${cid},\"epoch\":${owner},\"inflight\":${inflight.count()}}"))
            continue
        }
        if (method == "extension/host/poll") {
            // 收帧线程只往 sink 里塞，这里才是唯一动登记表的地方
            let frames = callSink.take(64)
            var arr = "["
            for (i2 in 0..frames.size) {
                if (i2 > 0) {
                    arr += ","
                }
                arr += frames[i2]
            }
            arr += "]"
            for (i2 in 0..frames.size) {
                inflight.settle(jsonNum(frames[i2], "callId"))
            }
            emit(okFrame(idText, "{\"results\":${arr},\"inflight\":${inflight.count()},\"overflow\":${callSink.overflow()},\"dropped\":${callSink.dropped()}}"))
            continue
        }
        if (method == "extension/host/cancel") {
            let cid = jsonNum(body, "callId")
            if (!inflight.has(cid)) {
                // 登记表里没这一笔：要么没发过，要么结果帧已经结算过，不能说「取消成功」
                emit(okFrame(idText, "{\"cancelled\":false,\"known\":false}"))
                continue
            }
            var cf: Option<String> = None
            if (let Some(xp) <- jsHost) {
                cf = xp.cancelCall(cid)
            }
            if (let Some(fr) <- cf) {
                var done = "false"
                if (fr.contains("\"cancelled\":true")) {
                    done = "true"
                }
                emit(okFrame(idText, "{\"cancelled\":${done},\"forwarded\":${fr}}"))
            } else {
                emit(errFrame(idText, -32013, "js-host-no-reply"))
            }
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
    var turnSettled = false
    if (let Some(h) <- turnHandle) {
        h.cancel()
        let r = h.result()
        let verdict = meter.settleTurn(r)
        getStdErr().writeln("host-exit-usage: verdict=${verdict} used=${meter.used()}")
        getStdErr().writeln("host-exit-settled-turn: cancelled=${r.cancelled} delivered=${r.delivered}")
        turnHandle = None
        turnBusy = false
        turnSettled = true
    }
    // 退出前必须主动结算在途工具调用：先按 callId 取消（子进程立刻回一帧 cancelled），
    // 再收束收帧线程，最后才关子进程。少了第一步，这些调用的终态只能靠子进程自己
    // shutdown 时的兜底结算，会混成 host-exiting(-32002)，分不出「本端取消的」和「宿主没了」。
    var extCalls = Int64(0)
    var extFrames = Int64(0)
    var extCancelled = Int64(0)
    var jsForced = false
    if (let Some(xp) <- jsHost) {
        for (cid in inflight.list()) {
            xp.cancelCall(cid)
            extCalls += 1
        }
        extFrames = xp.joinWaiters(3000)
        let drained = callSink.take(Int64(64))
        for (i2 in 0..drained.size) {
            if (drained[i2].contains("-32021")) {
                extCancelled += 1
            }
        }
        let rc = xp.close()
        jsForced = xp.forcedExit()
        getStdErr().writeln("host-exit-settled-js-host: exit=${rc} forced=${jsForced} inflightCalls=${extCalls}")
        jsHost = None
        jsAlive = false
    }
    let jf = if (jsForced) { "true" } else { "false" }
    let ts = if (turnSettled) { "true" } else { "false" }
    // 无 id 的通知帧：调用方（Electron 主进程 / 测试）在退出前拿到一份结算账，
    // 事后能区分「在途调用被收束」和「进程直接没了」。
    emit("{\"jsonrpc\":\"2.0\",\"method\":\"host/settled\",\"params\":{\"extensionCalls\":${extCalls},\"extensionFrames\":${extFrames},\"extensionCancelled\":${extCancelled},\"jsChildForced\":${jf},\"turnSettled\":${ts}}}")
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
