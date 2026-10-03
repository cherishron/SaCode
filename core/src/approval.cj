package core

import std.collection.ArrayList

// 审批的协议面：一次工具调用要经过「发号 → 应答 → 一次性消费」，
// 而不是调用方随手带一个字符串说自己批过了。理由是可追问性——
// 只有把 asked/decided/expired 写成事件，才答得出「谁批的、批没批、批过头没有」。
//
// 三条 fail-closed 规则：
// 1) 认得的决定只有 `allowed-once` 与 `denied`，其余（allowed-always、空串、乱码）不改判也不成功；
// 2) 一次性就是字面意思的一次，consume 用过即失效；
// 3) 过期即拒：pending 过了期限自动转 expired，consume 拿不到放行。
// 旧审批 ID 不可重用：已结算的工单不再接受第二次应答，也不产生第二条 decided。
//
// 时钟是逻辑刻度（advance），不是墙钟：过期必须可被测出，而不是靠 sleep 赌时序。
// 接真实单调时钟是后续项，届时的改动只是把 ttl 换成绝对 deadline。
class ApprovalTicket {
    let id: Int64
    let tool: String
    var state: String
    let deadline: Int64

    public init(id: Int64, tool: String, deadline: Int64) {
        this.id = id
        this.tool = tool
        this.state = "pending"
        this.deadline = deadline
    }
}

public class ApprovalDesk {
    let log: SessionLog
    let items = ArrayList<ApprovalTicket>()
    var clock: Int64 = 0
    var nextId: Int64 = 0
    let defaultTtl: Int64 = 30

    public init(log: SessionLog) {
        this.log = log
    }

    public func ask(toolName: String): Int64 {
        return askWithTtl(toolName, defaultTtl)
    }

    public func askWithTtl(toolName: String, ttl: Int64): Int64 {
        nextId += 1
        items.add(ApprovalTicket(nextId, toolName, clock + ttl))
        log.append("approval/asked", "${nextId}:${toolName}")
        return nextId
    }

    public func stateOf(id: Int64): String {
        reap()
        let t = find(id)
        match (t) {
            case Some(x) => x.state
            case None => "unknown"
        }
    }

    public func pendingCount(): Int64 {
        reap()
        var n: Int64 = 0
        for (t in items) {
            if (t.state == "pending") {
                n += 1
            }
        }
        return n
    }

    // 应答只认 pending：已结算（含用过、被拒、过期）的工单一律拒绝改判
    public func answer(id: Int64, decision: String): Bool {
        reap()
        if (let Some(t) <- find(id)) {
            if (t.state != "pending") {
                return false
            }
            if (decision != "allowed-once" && decision != "denied") {
                return false
            }
            t.state = decision
            log.append("approval/decided", "${id}:${decision}")
            return true
        }
        return false
    }

    // 取走放行凭据：只有 allowed-once 且还没被消费过的工单能拿到，取到即作废。
    // 其余情况一律空串，调用方据此拒绝执行——没有「默认放行」这条路。
    public func consume(id: Int64): String {
        reap()
        if (let Some(t) <- find(id)) {
            if (t.state == "allowed-once") {
                t.state = "used"
                return "allowed-once"
            }
        }
        return ""
    }

    public func advance(ticks: Int64) {
        clock += ticks
        reap()
    }

    private func find(id: Int64): Option<ApprovalTicket> {
        for (t in items) {
            if (t.id == id) {
                return Some(t)
            }
        }
        return None
    }

    // 过期结算幂等：state 一旦离开 pending 就不再重写，避免同一张工单落多条 expired 事件
    private func reap() {
        for (t in items) {
            if (t.state == "pending" && clock >= t.deadline) {
                t.state = "expired"
                log.append("approval/expired", "${t.id}:${t.tool}")
            }
        }
    }
}
