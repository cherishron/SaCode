package core

import std.collection.*
import std.sync.*
import stdx.encoding.json.*

// 运行中消息队列（上游 agent-loop 的 inbox）。唯一持久事件是 `agent/inbox/spliced`——
// 纯位置拼接 {"target","start","removedCount","inserted","outcome?"}：入列、出列、
// 改正文、清空都写成它，别的形态一概没有。上游 core.md:275 把这份语义说得很死：
// 「removes the proposed batch — all next-step input plus, at a turn boundary,
// one next-turn message — through pure deletion splices」。
//
// 被摘走的条目之后由调用方作为独立的 `user/message` 落盘（agent.ts:421），
// 所以队列本身是 log-only：它不进不变量 7 冻住的那五类模型可见事件。
// 用户按停止保留队列（core.md:283「no canceled inbox splice is logged」），
// 只有清空才写 outcome="canceled" 这条自己的事实。
let SPLICE_EVENT = "agent/inbox/spliced"
let TARGET_TURN = "next-turn"
let TARGET_STEP = "next-step"

public class InboxMessage {
    public let id: String
    public let text: String
    public let rpcId: String
    // 排队即绑定：引用跟着条目走，宿主才知道这条 prompt 占了哪几张暂存凭证。
    public let attachments: ArrayList<AttachmentRef>

    public init(id: String, text: String, rpcId: String, attachments: ArrayList<AttachmentRef>) {
        this.id = id
        this.text = text
        this.rpcId = rpcId
        this.attachments = attachments
    }
}

func inboxString(obj: JsonObject, key: String): String {
    if (let Some(v) <- obj.get(key)) {
        return v.asString().getValue()
    }
    return ""
}

func inboxNumber(obj: JsonObject, key: String): Int64 {
    if (let Some(v) <- obj.get(key)) {
        return v.asInt().getValue()
    }
    return Int64(-1)
}

func isBlank(s: String): Bool {
    for (r in s.toArray()) {
        let n = Int64(r)
        // 空格、制表、换行、回车：只有这几种字符不算正文
        if (n != 32 && n != 9 && n != 10 && n != 13) {
            return false
        }
    }
    return true
}

// 仓颉里元组字段取值不便直接用，位置就包成小结构体（同 core/src/uxq.cj 的 UxqSplit）。
class InboxLocate {
    let targetName: String
    let index: Int64
    init(a: String, b: Int64) {
        targetName = a
        index = b
    }
}

public class AgentInbox {
    let log: SessionLog
    let turnItems = ArrayList<InboxMessage>()
    let stepItems = ArrayList<InboxMessage>()
    var canceledSplices: Int64 = 0
    // 读不懂的拼接单独计数：静默当成「队列空了」会把一次记录损坏说成用户没排队
    public var badCount: Int64 = 0
    public init(log: SessionLog) {
        this.log = log
        for (ev in log.snapshotEvents()) {
            if (ev.eventType == SPLICE_EVENT) {
                replaySplice(ev.data)
            }
        }
    }

    public func items(target: String): ArrayList<InboxMessage> {
        return if (target == TARGET_STEP) { stepItems } else { turnItems }
    }

    public func sizeOf(target: String): Int64 {
        return Int64(items(target).size)
    }

    public func textAt(target: String, index: Int64): String {
        let list = items(target)
        if (index < 0 || index >= Int64(list.size)) {
            return ""
        }
        return list[index].text
    }

    func locate(id: String): InboxLocate {
        var i: Int64 = 0
        for (m in turnItems) {
            if (m.id == id) {
                return InboxLocate(TARGET_TURN, i)
            }
            i += 1
        }
        i = Int64(0)
        for (m in stepItems) {
            if (m.id == id) {
                return InboxLocate(TARGET_STEP, i)
            }
            i += 1
        }
        return InboxLocate("", Int64(-1))
    }

    public func pending(id: String): Bool {
        return locate(id).targetName != ""
    }

    public func textOf(id: String): String {
        let at = locate(id)
        if (at.targetName == "") {
            return ""
        }
        return items(at.targetName)[at.index].text
    }

    public func hasRpc(rpcId: String): Bool {
        if (rpcId.size == 0) {
            return false
        }
        for (m in turnItems) {
            if (m.rpcId == rpcId) {
                return true
            }
        }
        for (m in stepItems) {
            if (m.rpcId == rpcId) {
                return true
            }
        }
        return false
    }

    public func clearedCount(): Int64 {
        return canceledSplices
    }

    // 上游：MessageId 是唯一身份，重复的待处理 id 一律拒（「reject duplicate pending ids」）
    private func requireNew(id: String, text: String): Unit {
        if (id.size == 0) {
            throw Exception("inbox-empty-id")
        }
        if (text.size == 0 || isBlank(text)) {
            throw Exception("inbox-empty-text")
        }
        if (pending(id)) {
            throw Exception("inbox-duplicate-id")
        }
    }

    private func writeSplice(target: String, start: Int64, removed: Int64, inserted: ArrayList<InboxMessage>, canceled: Bool): Unit {
        let obj = JsonObject()
        obj.put("target", JsonString(target))
        obj.put("start", JsonInt(start))
        obj.put("removedCount", JsonInt(removed))
        let arr = JsonArray()
        for (m in inserted) {
            let mo = JsonObject()
            mo.put("id", JsonString(m.id))
            mo.put("text", JsonString(m.text))
            mo.put("rpcId", JsonString(m.rpcId))
            // 只在真的带引用时多出这个键：不带引用的拼接报文要与历史逐字相同。
            if (m.attachments.size > 0) {
                let refs = JsonArray()
                for (ref in m.attachments) {
                    refs.add(ref.toJsonObject())
                }
                mo.put("attachments", refs)
            }
            arr.add(mo)
        }
        obj.put("inserted", arr)
        if (canceled) {
            obj.put("outcome", JsonString("canceled"))
            // 「一次清空」是一句话，落盘是按清单各一条的拼接：计数只认落盘条数，
            // 这样内存里的读数和从日志重算出来的读数才是同一个数。
            canceledSplices += 1
        }
        log.append(SPLICE_EVENT, obj.toString())
    }

    // 拼接是纯位置操作：先按 [0,start) + inserted + [start+removed,end) 重排，再整表换回。
    // ArrayList 没有按下标删除的方法，所以走「重建」而不是「就地删」——这也保证一次拼接
    // 要么整体生效，要么整体不生效。
    private func applySplice(target: String, start: Int64, removed: Int64, inserted: ArrayList<InboxMessage>): Bool {
        let list = items(target)
        let size = Int64(list.size)
        if (start < 0 || start > size) {
            return false
        }
        if (removed < 0 || start + removed > size) {
            return false
        }
        let out = ArrayList<InboxMessage>()
        var i: Int64 = 0
        while (i < start) {
            out.add(list[i])
            i += 1
        }
        for (m in inserted) {
            out.add(m)
        }
        i = start + removed
        while (i < size) {
            out.add(list[i])
            i += 1
        }
        list.clear()
        for (m in out) {
            list.add(m)
        }
        return true
    }

    private func replaySplice(data: String): Unit {
        var target = ""
        var start: Int64 = 0
        var removed: Int64 = 0
        var canceled = false
        let inserted = ArrayList<InboxMessage>()
        var ok = true
        try {
            let obj = JsonValue.fromStr(data).asObject()
            target = inboxString(obj, "target")
            start = inboxNumber(obj, "start")
            removed = inboxNumber(obj, "removedCount")
            canceled = inboxString(obj, "outcome") == "canceled"
            let arr = obj.get("inserted").getOrThrow().asArray()
            var pos: Int64 = 0
            while (let Some(item) <- arr.get(pos)) {
                pos += 1
                let mo = item.asObject()
                var refs = ArrayList<AttachmentRef>()
                if (let Some(value) <- mo.get("attachments")) {
                    // 与投影、请求装配共用同一个解析器；形态不合法就整条拼接计为坏，
                    // 不在这里造出半个条目。
                    refs = parseAttachmentRefs(value.toString())
                }
                inserted.add(InboxMessage(inboxString(mo, "id"), inboxString(mo, "text"), inboxString(mo, "rpcId"), refs))
            }
        } catch (e: Exception) {
            ok = false
        }
        if (target != TARGET_TURN && target != TARGET_STEP) {
            ok = false
        }
        if (!ok || !applySplice(target, start, removed, inserted)) {
            badCount += 1
            return
        }
        if (canceled) {
            canceledSplices += 1
        }
    }

    private func appendTo(target: String, msg: InboxMessage): Unit {
        let list = items(target)
        let single = ArrayList<InboxMessage>()
        single.add(msg)
        writeSplice(target, Int64(list.size), Int64(0), single, false)
        applySplice(target, Int64(list.size), Int64(0), single)
    }

    // 拼接是「回放 → 算增量 → 写一条整体替换」的读改写，跨多条事件；单条 append 的锁
    // 护不住它。宿主协议线程与 runner 线程现在都会写拼接，所以所有写入口都持同一把
    // 会话日志锁（本类内部只调私有方法，不出现自己等自己的重入）。
    public func queue(id: String, text: String, rpcId: String, attachments!: ArrayList<AttachmentRef> = ArrayList<AttachmentRef>()): Unit {
        synchronized(log.mtx) {
            requireNew(id, text)
            appendTo(TARGET_TURN, InboxMessage(id, text, rpcId, attachments))
        }
    }

    public func step(id: String, text: String, rpcId: String): Unit {
        synchronized(log.mtx) {
            requireNew(id, text)
            appendTo(TARGET_STEP, InboxMessage(id, text, rpcId, ArrayList<AttachmentRef>()))
        }
    }

    // edit 保留同一个 MessageId 整块替换正文；空白正文按 bad-request 拒，一条都不落
    public func edit(id: String, text: String): Unit {
        synchronized(log.mtx) {
            if (text.size == 0 || isBlank(text)) {
                throw Exception("inbox-empty-text")
            }
            let at = locate(id)
            if (at.targetName == "") {
                throw Exception("inbox-item-not-found")
            }
            let old = items(at.targetName)[at.index]
            // edit 只换正文：绑定在这条 prompt 上的引用原样带过去（凭证已在宿主侧消费，
            // 这里丢了就等于用户选的图被一次编辑吃掉）。
            let next = InboxMessage(id, text, old.rpcId, old.attachments)
            let single = ArrayList<InboxMessage>()
            single.add(next)
            writeSplice(at.targetName, at.index, Int64(1), single, false)
            applySplice(at.targetName, at.index, Int64(1), single)
        }
    }

    public func remove(id: String): Unit {
        synchronized(log.mtx) {
            removeItem(id)
        }
    }

    private func removeItem(id: String): Unit {
        let at = locate(id)
        if (at.targetName == "") {
            throw Exception("inbox-item-not-found")
        }
        let none = ArrayList<InboxMessage>()
        writeSplice(at.targetName, at.index, Int64(1), none, false)
        applySplice(at.targetName, at.index, Int64(1), none)
    }

    // 界面上的「即时补充」：从排队清单挪到补充清单，id 不变，下一两个拼接各自成事实。
    public func steerFromQueue(id: String): Unit {
        synchronized(log.mtx) {
            var queued = false
            var bound = ArrayList<AttachmentRef>()
            for (m in turnItems) {
                if (m.id == id) {
                    queued = true
                    bound = m.attachments
                }
            }
            if (!queued) {
                throw Exception("inbox-item-not-found")
            }
            let msg = InboxMessage(id, textOf(id), rpcIdOf(id), bound)
            removeItem(id)
            let single = ArrayList<InboxMessage>()
            single.add(msg)
            writeSplice(TARGET_STEP, Int64(stepItems.size), Int64(0), single, false)
            applySplice(TARGET_STEP, Int64(stepItems.size), Int64(0), single)
        }
    }

    public func rpcIdOf(id: String): String {
        for (m in turnItems) {
            if (m.id == id) {
                return m.rpcId
            }
        }
        for (m in stepItems) {
            if (m.id == id) {
                return m.rpcId
            }
        }
        return ""
    }

    // 步边界：全部即时补充被摘走。空清单不写事件——日志里不该刻「什么都没发生」。
    public func claimStep(): ArrayList<InboxMessage> {
        return synchronized(log.mtx) { claim(TARGET_STEP, Int64(stepItems.size)) }
    }

    // 轮次边界：恰好一条，按 FIFO 取队首。
    public func claimTurn(): ArrayList<InboxMessage> {
        return synchronized(log.mtx) { claim(TARGET_TURN, Int64(1)) }
    }

    private func claim(target: String, want: Int64): ArrayList<InboxMessage> {
        let list = items(target)
        let take = if (want < Int64(list.size)) { want } else { Int64(list.size) }
        let taken = ArrayList<InboxMessage>()
        if (take <= 0) {
            return taken
        }
        var i: Int64 = 0
        while (i < take) {
            taken.add(list[i])
            i += 1
        }
        writeSplice(target, Int64(0), take, ArrayList<InboxMessage>(), false)
        applySplice(target, Int64(0), take, ArrayList<InboxMessage>())
        return taken
    }

    // 用户按停止：这一轮撤掉，未送达的条目留着——本身不落任何事件。
    public func keepOnCancel(): Unit {
        return
    }

    public func clear(): Unit {
        synchronized(log.mtx) {
            if (Int64(turnItems.size) > 0) {
                writeSplice(TARGET_TURN, Int64(0), Int64(turnItems.size), ArrayList<InboxMessage>(), true)
                applySplice(TARGET_TURN, Int64(0), Int64(turnItems.size), ArrayList<InboxMessage>())
            }
            if (Int64(stepItems.size) > 0) {
                writeSplice(TARGET_STEP, Int64(0), Int64(stepItems.size), ArrayList<InboxMessage>(), true)
                applySplice(TARGET_STEP, Int64(0), Int64(stepItems.size), ArrayList<InboxMessage>())
            }
        }
    }

    // 快照给宿主：两份清单原样交出，界面只按投影渲染，不自带「已送达」的消息。
    public func snapshot(target: String): ArrayList<InboxMessage> {
        let out = ArrayList<InboxMessage>()
        for (m in items(target)) {
            out.add(m)
        }
        return out
    }
}
