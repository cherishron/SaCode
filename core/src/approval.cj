package core

import std.collection.ArrayList
import std.time.MonoTime

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
// 时钟是真实单调钟（MonoTime 差值换算成整秒），不是可由调用方推进的刻度：
// ttl 直接换成 deadline。逻辑刻度有过一个洞——没人 tick 就永不过期，而「谁负责 tick」
// 又只能挂在协议面上，等于把过期权交给调用方。现在过期只由经过的时间决定。
// 钟可注入只为测试确定性（假钟推过期判定），生产默认走单调钟，
// 由 defaultDeskClockExpiresOnRealMonotonicTime 用真实时间钉住接线本身。
// 用单调钟而非墙钟：系统改时不会让未结算的工单提前或无限延后过期。
func monotonicSeconds(): () -> Int64 {
    let base = MonoTime.now()
    return { => (MonoTime.now() - base).toSeconds() }
}

// 从 `approval/asked` 的事件数据（`<id>:<tool>`）里剥出工单号：只认冒号前的连续数字，
// 认不出就返回 -1 而不是猜一个——读日志是为了对账，读出一个没写过的号等于造假账。
func approvalIdFromData(data: String): Int64 {
    var n: Int64 = -1
    for (c in data.toArray()) {
        let d = Int64(c) - 48
        if (d < 0 || d > 9) {
            break
        }
        n = if (n < 0) { d } else { n * 10 + d }
    }
    return n
}

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
    let clock: () -> Int64
    var nextId: Int64 = 0
    public let defaultTtl: Int64 = 30

    public init(log: SessionLog, clock!: () -> Int64 = monotonicSeconds()) {
        this.log = log
        this.clock = clock
    }

    public func ask(toolName: String): Int64 {
        return askWithTtl(toolName, defaultTtl)
    }

    public func askWithTtl(toolName: String, ttl: Int64): Int64 {
        // 号必须从日志里已出现过的最大号往后接，不能靠进程内计数器从头数：
        // CLI 每次 `dsh call`、桌面每次重启宿主都是新进程，计数器归零就会在日志里
        // 再发一个 1 号，两条 `approval/asked 1:write` 让审计答不出「是哪一次批的」。
        // 读日志而不是只读自己的内存，与 TokenMeter 每次接手日志都 rebuild 同一个理由。
        let seen = highestAskedId()
        if (seen > nextId) {
            nextId = seen
        }
        nextId += 1
        items.add(ApprovalTicket(nextId, toolName, clock() + ttl))
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

    // 切换会话时，尚待决定和已放行但未消费的工单都不能丢弃。
    public func hasOpenTickets(): Bool {
        reap()
        for (ticket in items) {
            if (ticket.state == "pending" || ticket.state == "allowed-once") { return true }
        }
        return false
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

    // 日志里出现过的最大工单号；没有 asked 事件时为 0（下一张就是 1 号）。
    private func highestAskedId(): Int64 {
        var hi: Int64 = 0
        for (ev in log.snapshotEvents()) {
            if (ev.eventType == "approval/asked") {
                let v = approvalIdFromData(ev.data)
                if (v > hi) {
                    hi = v
                }
            }
        }
        return hi
    }

    private func find(id: Int64): Option<ApprovalTicket> {
        for (t in items) {
            if (t.id == id) {
                return Some(t)
            }
        }
        return None
    }

    // 过期结算幂等：state 一旦离开 pending 就不再重写，避免同一张工单落多条 expired 事件。
    // 每次读状态都先扫一遍钟——过期不依赖有没有人恰好调用了某个推进接口。
    private func reap() {
        let now = clock()
        for (t in items) {
            if (t.state == "pending" && now >= t.deadline) {
                t.state = "expired"
                log.append("approval/expired", "${t.id}:${t.tool}")
            }
        }
    }
}
